/** 剪辑师式重剪 —— recut.py 的 TS 等价移植。
 *
 * 按溯源区间从原剧集精确切段：原分辨率、原生帧率（取用到集的众数 fps，
 * 不做 24→30 上采样）、原声对白；每集只解码一遍，rawvideo 管道路由到各段
 * 编码器（带背压），最后 concat -c copy 无损拼接。
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'
import fs from 'node:fs'
import path from 'node:path'
import { decodeSelect, frameTc, frameTime, probe, runCapture } from './frames.ts'
import { prepareVerify } from './fingerprint.ts'
import { buildEdl, loadTrace, mergeRanges } from './edl.ts'
import { frameOrigins } from './framewise.ts'
import type { FramewiseCfg } from './framewise.ts'
import type { ComputePool } from './worker-pool.ts'
import type { EdlSeg, MediaInfo, Note, ReplicaIndex } from './types.ts'

export interface RecutOpts {
  tracePath?: string | null
  traceKind?: 'origins' | 'map'
  audio?: 'source' | 'clip' | 'none'
  crf?: number
  despike?: boolean
  refine?: boolean
  refineRadius?: number
  cfg?: FramewiseCfg
  pool?: ComputePool
  note?: Note
  signal?: AbortSignal
}

export interface RecutSummary {
  clip: string
  output: string
  segments: number
  from_source: number
  continuous: number
  still_held: number
  gap: number
  total_seconds: number
  resolution: string
  audio: string
  crf: number
  note: string
}

function pyRound(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d > 0.5) return f + 1
  if (d < 0.5) return f
  return f % 2 === 0 ? f : f + 1
}

const r3 = (x: number): number => Number(x.toFixed(3))

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('已取消')
}

/** 进程组：终止时杀全部子进程（Windows 下 ffmpeg 无孙进程，直接 kill 即可）。 */
class ProcGroup {
  private children = new Set<ChildProcess>()
  constructor(signal?: AbortSignal) {
    signal?.addEventListener('abort', () => this.killAll(), { once: true })
  }
  track<T extends ChildProcess>(child: T): T {
    this.children.add(child)
    child.once('close', () => this.children.delete(child))
    return child
  }
  killAll(): void {
    for (const c of this.children) {
      try {
        c.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }
  }
}

/** 定长帧读取器：从解码 stdout 逐帧取 rgb24，超水位暂停实现背压。 */
class FrameReader {
  private chunks: Buffer[] = []
  private buffered = 0
  private ended = false
  private error: Error | null = null
  private waiters: (() => void)[] = []
  private stream: Readable
  private fbytes: number
  constructor(stream: Readable, fbytes: number, highWaterFrames = 4) {
    this.stream = stream
    this.fbytes = fbytes
    stream.on('data', (c: Buffer) => {
      this.chunks.push(c)
      this.buffered += c.length
      if (this.buffered >= this.fbytes * highWaterFrames) stream.pause()
      this.wake()
    })
    stream.on('end', () => {
      this.ended = true
      this.wake()
    })
    stream.on('error', (e: Error) => {
      this.error = e
      this.wake()
    })
  }
  private wake(): void {
    for (const w of this.waiters.splice(0)) w()
  }
  async next(): Promise<Buffer | null> {
    for (;;) {
      if (this.error) throw this.error
      if (this.buffered >= this.fbytes) {
        const out = Buffer.allocUnsafe(this.fbytes)
        let off = 0
        while (off < this.fbytes) {
          const c = this.chunks[0]
          const take = Math.min(c.length, this.fbytes - off)
          c.copy(out, off, 0, take)
          off += take
          if (take === c.length) this.chunks.shift()
          else this.chunks[0] = c.subarray(take)
        }
        this.buffered -= this.fbytes
        if (this.buffered < this.fbytes * 2) this.stream.resume()
        return out
      }
      if (this.ended) {
        if (this.buffered > 0) throw new Error(`解码输出截断：剩余 ${this.buffered} 字节不足一帧`)
        return null
      }
      await new Promise<void>((res) => this.waiters.push(res))
    }
  }
}

/** 段编码器：rawvideo stdin → libx264，write 带 drain 背压。 */
class SegEncoder {
  private stderr = ''
  private closed = false
  private exitPromise: Promise<number>
  private child: ChildProcess
  constructor(child: ChildProcess) {
    this.child = child
    child.stderr?.on('data', (d: Buffer) => {
      this.stderr += d.toString('utf8')
      if (this.stderr.length > 16_000) this.stderr = this.stderr.slice(-8_000)
    })
    child.stdin?.on('error', () => {
      /* EPIPE：进程提前退出时由 finish 报错 */
    })
    this.exitPromise = new Promise((res) => child.once('close', (code) => res(code ?? -1)))
  }
  async write(buf: Buffer): Promise<void> {
    const stdin = this.child.stdin
    if (!stdin || this.closed) throw new Error('编码器已关闭')
    if (!stdin.write(buf)) {
      await new Promise<void>((resolve, reject) => {
        const onDrain = (): void => {
          cleanup()
          resolve()
        }
        const onClose = (): void => {
          cleanup()
          reject(new Error(`编码器提前退出：${this.stderr.slice(-300)}`))
        }
        const cleanup = (): void => {
          stdin.removeListener('drain', onDrain)
          this.child.removeListener('close', onClose)
        }
        stdin.once('drain', onDrain)
        this.child.once('close', onClose)
      })
    }
  }
  async finish(): Promise<void> {
    this.closed = true
    this.child.stdin?.end()
    const code = await this.exitPromise
    if (code !== 0) throw new Error(`段编码失败: ${this.stderr.slice(-300)}`)
  }
}

interface PlanItem {
  segNo: number
  seg: EdlSeg
  entry: ReplicaIndex['episodes'][number] | null
  vname: string
  aname: string
  seconds: number
}

/** 段边界精修（_refine_edl_bounds 等价）：±radius 帧高通 NCC 吸附，只平移不改段长。 */
async function refineEdlBounds(
  edl: EdlSeg[], index: ReplicaIndex, clipPath: string, cfg: FramewiseCfg,
  ffmpeg: string, ffprobe: string, workdir: string, radius: number,
  note?: Note, signal?: AbortSignal, pool?: ComputePool
): Promise<void> {
  const floor = 0.66
  const margin = 0.02
  const alreadyOk = 0.86
  const probeT = [0, 0.25, 0.5, 0.75, 1]

  const qinfo = await probe(clipPath, ffprobe, cfg.exactPts ?? false)
  void qinfo
  const qluma = await decodeSelect(clipPath, '1', 64, 64, ffmpeg, workdir, signal)
  const maskB = cfg.maskBottom ?? 0.25
  const maskT = cfg.maskTop ?? 0
  const band = cfg.band ?? null
  const qv = pool
    ? (await pool.run<{ v: Float32Array; m: number }>('prepareVerify', {
        data: qluma.data.buffer, n: qluma.n, h: 64, w: 64, maskBottom: maskB, maskTop: maskT, band
      }, [qluma.data.buffer as ArrayBuffer]))
    : prepareVerify(qluma.data, qluma.n, 64, 64, maskB, maskT, true, band)
  const qvAll = qv.v
  const qm = qv.m

  const segByEp = new Map<string, EdlSeg[]>()
  for (const s of edl) {
    if (s.srcIn >= 0) {
      const list = segByEp.get(s.episode) ?? []
      list.push(s)
      segByEp.set(s.episode, list)
    }
  }
  const epById = new Map(index.episodes.map((e) => [e.eid, e]))
  const offs: number[] = []
  for (let o = -radius; o <= radius; o++) offs.push(o)
  let moved = 0
  let kept = 0

  for (const [epId, segs] of segByEp) {
    throwIfAborted(signal)
    const entry = epById.get(epId)
    if (!entry) continue
    const need = new Set<number>()
    const probeQ = new Map<EdlSeg, number[]>()
    for (const s of segs) {
      const ci = s.clipIn
      const co = s.clipOut
      const picks = co - ci <= 1
        ? [ci]
        : [...new Set(probeT.map((t) => ci + Math.round(t * (co - 1 - ci))))].slice(0, 5)
      const pq = picks.filter((q) => q >= 0 && q < qluma.n)
      probeQ.set(s, pq)
      for (const q of pq) {
        const base = s.srcIn + (q - ci)
        for (const o of offs) {
          const n = base + o
          if (n >= 0 && n < entry.info.nbFrames) need.add(n)
        }
      }
    }
    const cand = [...need].sort((a, b) => a - b)
    if (cand.length === 0) continue
    const expr = cand.map((n) => `eq(n\\,${n})`).join('+')
    const srcluma = await decodeSelect(entry.path, expr, 64, 64, ffmpeg, workdir, signal)
    const lut = new Map<number, number>()
    cand.forEach((n, i) => lut.set(n, i))
    const sv = pool
      ? (await pool.run<{ v: Float32Array; m: number }>('prepareVerify', {
          data: srcluma.data.buffer, n: srcluma.n, h: 64, w: 64, maskBottom: maskB, maskTop: maskT, band
        }, [srcluma.data.buffer as ArrayBuffer]))
      : prepareVerify(srcluma.data, srcluma.n, 64, 64, maskB, maskT, true, band)
    const srcv = sv.v
    const sm = sv.m
    for (const s of segs) {
      const ci = s.clipIn
      const pq = probeQ.get(s) ?? []
      if (pq.length === 0) continue
      const offScores = new Map<number, number>()
      for (const o of offs) {
        let sum = 0
        let cnt = 0
        for (const q of pq) {
          const base = s.srcIn + (q - ci) + o
          const gi = lut.get(base)
          if (gi === undefined || q >= qluma.n) continue
          let dot = 0
          const qb = q * qm
          const rb = gi * sm
          for (let c = 0; c < qm; c++) dot += qvAll[qb + c] * srcv[rb + c]
          sum += dot
          cnt++
        }
        if (cnt > 0) offScores.set(o, sum / cnt)
      }
      if (offScores.size === 0) continue
      let bestO = 0
      let bestSc = -Infinity
      for (const [o, sc] of offScores) {
        if (sc > bestSc) {
          bestSc = sc
          bestO = o
        }
      }
      const baseSc = offScores.get(0) ?? -1
      if (bestO !== 0 && bestSc >= floor && baseSc < alreadyOk && bestSc - baseSc >= margin) {
        s.srcIn += bestO
        s.srcOut += bestO
        moved++
      } else {
        kept++
      }
    }
  }
  note?.(`边界精修：吸附 ${moved} 段 / 保持 ${kept} 段（±${radius} 帧，阈值 ${floor}）`)
}

export async function recut(
  index: ReplicaIndex, clipPath: string, ffmpeg: string, ffprobe: string,
  outdir: string, opts: RecutOpts = {}
): Promise<RecutSummary> {
  const { note, signal, pool } = opts
  const audio = opts.audio ?? 'source'
  const crf = opts.crf ?? 16
  // despike 只用于粗索引（origins）的量化抖动；frame_map 已是帧精确路径，
  // 其中 25→30 帧率转换的合法重复帧不能被强制单调递增破坏。
  const despike = opts.despike ?? ((opts.traceKind ?? 'origins') === 'origins')
  const refine = opts.refine ?? true
  const refineRadius = opts.refineRadius ?? 6
  const cfg = opts.cfg ?? {}
  outdir = path.resolve(outdir)
  const segdir = path.join(outdir, '_segments')
  fs.mkdirSync(segdir, { recursive: true })
  const group = new ProcGroup(signal)

  try {
    const qinfo = await probe(clipPath, ffprobe, cfg.exactPts ?? false)
    let trace
    if (opts.tracePath) {
      trace = loadTrace(path.resolve(opts.tracePath), opts.traceKind ?? 'origins')
      note?.(`读取溯源表 ${path.basename(opts.tracePath)}：${trace.length} 行`)
    } else {
      const { rows } = await frameOrigins(index, clipPath, cfg, ffmpeg, ffprobe, outdir, { pool, note, signal })
      trace = rows.map((r) => [r.clipFrame, r.episode, r.srcFrame ?? -1, r.flip, r.confidence] as
        [number, string, number, string, string])
    }
    const epMax: Record<string, number> = {}
    for (const e of index.episodes) epMax[e.eid] = e.info.nbFrames
    const edl = buildEdl(trace, trace.length, despike, epMax)
    if (refine) {
      await refineEdlBounds(edl, index, clipPath, cfg, ffmpeg, ffprobe, outdir, refineRadius, note, signal, pool)
    }

    // 输出帧率 = 实际用到集的众数 fps（原生节奏，1:1 无重采样）
    const usedEps = new Set(edl.filter((s) => s.srcIn >= 0).map((s) => s.episode))
    const fpsPool = index.episodes.filter((e) => usedEps.has(e.eid))
    const poolEps = fpsPool.length > 0 ? fpsPool : index.episodes
    const fpsCount = new Map<number, number>()
    for (const e of poolEps) {
      const k = Number(e.info.fps.toFixed(3))
      fpsCount.set(k, (fpsCount.get(k) ?? 0) + 1)
    }
    let outFps = 30
    let bestCnt = -1
    for (const [k, cnt] of fpsCount) {
      if (cnt > bestCnt) {
        bestCnt = cnt
        outFps = k
      }
    }
    if (!(outFps >= 1 && outFps <= 240)) outFps = 30

    const epById = new Map(index.episodes.map((e) => [e.eid, e]))
    const plan: PlanItem[] = edl.map((s, i) => ({
      segNo: i + 1, seg: s,
      entry: s.srcIn >= 0 ? (epById.get(s.episode) ?? null) : null,
      vname: path.join(segdir, `v${String(i + 1).padStart(4, '0')}.mp4`),
      aname: path.join(segdir, `a${String(i + 1).padStart(4, '0')}.m4a`),
      seconds: 0
    }))

    const byEp = new Map<string, PlanItem[]>()
    for (const p of plan) {
      if (p.entry) {
        const list = byEp.get(p.seg.episode) ?? []
        list.push(p)
        byEp.set(p.seg.episode, list)
      }
    }
    const epOrder = [...byEp.keys()].sort((a, b) => {
      const na = /^\d+$/.test(a.slice(1)) ? parseInt(a.slice(1), 10) : 0
      const nb = /^\d+$/.test(b.slice(1)) ? parseInt(b.slice(1), 10) : 0
      return na - nb
    })

    const startEnc = (p: PlanItem, epFps: number, w: number, h: number): SegEncoder => {
      const child = spawn(ffmpeg, [
        '-y', '-v', 'error', '-nostdin',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`,
        '-r', String(epFps), '-i', 'pipe:0', '-r', String(outFps),
        '-c:v', 'libx264', '-crf', String(crf), '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p', '-an', p.vname
      ], { windowsHide: true })
      return new SegEncoder(group.track(child))
    }

    // ---- 每集一遍解码，按段路由 ----
    for (const epId of epOrder) {
      throwIfAborted(signal)
      const items = byEp.get(epId)!.sort((a, b) => a.seg.srcIn - b.seg.srcIn)
      const entry = items[0].entry!
      const epFps = entry.info.fps
      const allFrames: number[] = []
      for (const p of items) {
        for (let f = p.seg.srcIn; f < p.seg.srcOut; f++) allFrames.push(f)
      }
      const ranges = mergeRanges(allFrames, 2)
      const expr = ranges.map(([a, b]) => `between(n\\,${a}\\,${b})`).join('+')
      const expect = ranges.reduce((s, [a, b]) => s + (b - a + 1), 0)
      note?.(`  ${epId}: 解码 ${expect} 帧（${ranges.length} 区间）→ ${items.length} 段`)

      const dec = group.track(spawn(ffmpeg, [
        '-v', 'error', '-nostdin', '-i', entry.path, '-map', '0:v:0',
        '-an', '-vf', `select='${expr}'`, '-fps_mode', 'passthrough',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
      ], { windowsHide: true }))
      let decErr = ''
      dec.stderr?.on('data', (d: Buffer) => {
        decErr += d.toString('utf8')
        if (decErr.length > 8000) decErr = decErr.slice(-4000)
      })
      const fbytes = entry.info.width * entry.info.height * 3
      const reader = new FrameReader(dec.stdout!, fbytes)
      const heads = new Map<PlanItem, number>()
      const lens = new Map<PlanItem, number>()
      for (const p of items) {
        heads.set(p, 0)
        lens.set(p, p.seg.srcOut - p.seg.srcIn)
      }
      const encs = new Map<PlanItem, SegEncoder>()
      const outIds: number[] = []
      for (const [a, b] of ranges) for (let f = a; f <= b; f++) outIds.push(f)

      for (const f of outIds) {
        throwIfAborted(signal)
        const buf = await reader.next()
        if (buf === null) {
          dec.kill('SIGKILL')
          throw new Error(`${epId} 解码提前结束于帧 ${f}：${decErr.slice(-300)}`)
        }
        for (const p of items) {
          const head = heads.get(p)!
          const len = lens.get(p)!
          if (head >= len) continue
          const s = p.seg
          if (s.srcIn + head !== f) continue
          if (s.kind === 'still') {
            const reps = Math.max(1, pyRound((s.clipFrames * epFps) / qinfo.fps))
            const enc = startEnc(p, epFps, entry.info.width, entry.info.height)
            for (let i = 0; i < reps; i++) await enc.write(buf)
            await enc.finish()
            p.seconds = r3(reps / epFps)
            heads.set(p, len)
          } else {
            let enc = encs.get(p)
            if (!enc) {
              enc = startEnc(p, epFps, entry.info.width, entry.info.height)
              encs.set(p, enc)
            }
            await enc.write(buf)
            heads.set(p, head + 1)
            if (head + 1 >= len) {
              await enc.finish()
              encs.delete(p)
              p.seconds = r3((s.srcOut - s.srcIn) / epFps)
            }
          }
        }
      }
      dec.stdout?.destroy()
      for (const [p, enc] of encs) {
        await enc.finish()
        p.seconds = r3((p.seg.srcOut - p.seg.srcIn) / epFps)
      }
      encs.clear()
      await new Promise<void>((res) => {
        if (dec.exitCode !== null) res()
        else dec.once('close', () => res())
      })
    }

    // ---- gap 段：黑场 + 静音 ----
    for (const p of plan) {
      throwIfAborted(signal)
      const s = p.seg
      if (s.srcIn >= 0) continue
      const dur = s.clipFrames / qinfo.fps
      await runCapture(ffmpeg, [
        '-y', '-v', 'error', '-f', 'lavfi',
        '-i', `color=c=black:s=${qinfo.width}x${qinfo.height}:d=${dur.toFixed(3)}`,
        '-r', String(outFps), '-c:v', 'libx264', '-crf', String(crf),
        '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', p.vname
      ], signal)
      await runCapture(ffmpeg, [
        '-y', '-v', 'error', '-f', 'lavfi',
        '-i', 'anullsrc=r=48000:cl=stereo', '-t', dur.toFixed(3),
        '-c:a', 'aac', '-b:a', '128k', p.aname
      ], signal)
      p.seconds = r3(dur)
    }

    // ---- 原声对白（按段对齐） ----
    if (audio === 'source') {
      for (const p of plan) {
        throwIfAborted(signal)
        const s = p.seg
        if (s.srcIn < 0 || !p.entry) continue
        const t0 = frameTime(s.srcIn, p.entry.info)
        await runCapture(ffmpeg, [
          '-y', '-v', 'error', '-nostdin',
          '-ss', t0.toFixed(3), '-t', p.seconds.toFixed(3), '-i', p.entry.path,
          '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'aac', '-b:a', '160k', p.aname
        ], signal)
      }
    }

    // ---- 拼接（全部绝对路径，规避相对路径 concat 坑） ----
    const concatList = (file: string, names: string[]): void => {
      fs.writeFileSync(file, names.map((n) => `file '${n.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8')
    }
    const vlist = path.join(segdir, 'v.txt')
    concatList(vlist, plan.map((p) => p.vname))
    const vcat = path.join(outdir, '_vcat.mp4')
    await runCapture(ffmpeg, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', vlist, '-c', 'copy', vcat], signal)

    const final = path.join(outdir, 'recut.mp4')
    if (audio === 'source') {
      const alist = path.join(segdir, 'a.txt')
      concatList(alist, plan.map((p) => p.aname))
      const acat = path.join(outdir, '_acat.m4a')
      await runCapture(ffmpeg, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', alist, '-c', 'copy', acat], signal)
      await runCapture(ffmpeg, [
        '-y', '-v', 'error', '-i', vcat, '-i', acat,
        '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', final
      ], signal)
    } else if (audio === 'clip') {
      await runCapture(ffmpeg, [
        '-y', '-v', 'error', '-i', vcat, '-i', clipPath,
        '-map', '0:v:0', '-map', '1:a:0?', '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', final
      ], signal)
    } else {
      await runCapture(ffmpeg, ['-y', '-v', 'error', '-i', vcat, '-c', 'copy', '-movflags', '+faststart', final], signal)
    }

    // ---- EDL + summary ----
    const edlPath = path.join(outdir, 'recut_edl.csv')
    const cols = ['segment_id', 'episode', 'src_in', 'src_out', 'src_in_tc', 'src_out_tc', 'clip_in', 'clip_out', 'kind', 'seconds']
    const lines = [cols.join(',')]
    for (const p of plan) {
      const s = p.seg
      const info: MediaInfo | null = p.entry ? p.entry.info : null
      lines.push([
        p.segNo, s.episode, s.srcIn, s.srcOut,
        info ? frameTc(s.srcIn, info) : '', info ? frameTc(s.srcOut, info) : '',
        s.clipIn, s.clipOut, s.kind, p.seconds
      ].join(','))
    }
    fs.writeFileSync(edlPath, `\ufeff${lines.join('\r\n')}\r\n`, 'utf8')
    const totalV = plan.reduce((s, p) => s + p.seconds, 0)
    const summary: RecutSummary = {
      clip: path.resolve(clipPath),
      output: final,
      segments: plan.length,
      from_source: plan.filter((p) => p.seg.srcIn >= 0).length,
      continuous: plan.filter((p) => p.seg.kind === 'continuous').length,
      still_held: plan.filter((p) => p.seg.kind === 'still').length,
      gap: plan.filter((p) => p.seg.kind === 'gap').length,
      total_seconds: Number(totalV.toFixed(2)),
      resolution: `${qinfo.width}x${qinfo.height}`,
      audio, crf,
      note: '每段按原片帧号精确切出、原分辨率重编码一次后无损拼接；音轨为原剧集原声（对白），非切片解说音'
    }
    fs.writeFileSync(path.join(outdir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
    try {
      for (const p of plan) {
        fs.rmSync(p.vname, { force: true })
        fs.rmSync(p.aname, { force: true })
      }
      fs.rmSync(vlist, { force: true })
      fs.rmSync(vcat, { force: true })
      if (audio === 'source') {
        fs.rmSync(path.join(segdir, 'a.txt'), { force: true })
        fs.rmSync(path.join(outdir, '_acat.m4a'), { force: true })
      }
      fs.rmdirSync(segdir)
    } catch {
      /* 清理失败不影响产物 */
    }
    note?.(`完成：${final}  ${plan.length} 段 / ${totalV.toFixed(1)}s（${summary.resolution}, 音轨=${audio}）`)
    return summary
  } finally {
    group.killAll()
  }
}
