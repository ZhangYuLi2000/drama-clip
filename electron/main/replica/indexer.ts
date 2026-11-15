/** 剧集指纹索引 —— indexer.py 的 TS 等价移植。
 *
 * 存储格式（每集一个 .dwidx 二进制 + 总 manifest.json）：
 *   'DWI1' | u32 metaJsonLen | metaJson(utf8) | desc f32 (ni*nf*144) | [times f32 (nbFrames)]
 * frame_idx 恒为 i*step，加载时重建，不单独存储。
 */
import fs from 'node:fs'
import path from 'node:path'
import { decodeSelect, probe, scanEpisodes, selectStep } from './frames.ts'
import { DEFAULT_VARIANTS, VARIANTS_4, describeVariants } from './fingerprint.ts'
import type { FlipVariant } from './fingerprint.ts'
import type { ComputePool } from './worker-pool.ts'
import type {
  EpisodeIndex, IndexManifest, IndexManifestEpisode, MediaInfo, Note, ReplicaIndex
} from './types.ts'

export interface BuildIndexOpts {
  indexFps?: number
  size?: number
  vflip?: boolean
  ffmpeg: string
  ffprobe: string
  exactPts?: boolean
  pool?: ComputePool
  note?: Note
  signal?: AbortSignal
}

/** Python round（银行家舍入）：step 计算必须与 int(round(fps/index_fps)) 一致，
 *  例如 30fps / index-fps 12 = 2.5 → Python 取 2，Math.round 会取 3。 */
function pyRound(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d > 0.5) return f + 1
  if (d < 0.5) return f
  return f % 2 === 0 ? f : f + 1
}

interface EpMeta {
  eid: string
  name: string
  path: string
  width: number
  height: number
  fps: number
  fpsNum: number
  fpsDen: number
  fpsQ: number
  nbFrames: number
  duration: number
  hasTimes: boolean
  step: number
  ni: number
  nf: number
}

function infoToMeta(info: MediaInfo, eid: string, name: string, step: number, ni: number, nf: number): EpMeta {
  return {
    eid, name, path: info.path, width: info.width, height: info.height,
    fps: info.fps, fpsNum: info.fpsNum, fpsDen: info.fpsDen, fpsQ: info.fpsQ,
    nbFrames: info.nbFrames, duration: info.duration, hasTimes: info.times !== null,
    step, ni, nf
  }
}

function metaToInfo(m: EpMeta, times: Float64Array | null): MediaInfo {
  return {
    path: m.path, width: m.width, height: m.height, fps: m.fps,
    fpsNum: m.fpsNum, fpsDen: m.fpsDen, fpsQ: m.fpsQ,
    nbFrames: m.nbFrames, duration: m.duration, times
  }
}

async function indexOne(
  n: number, eid: string, name: string, file: string, outdir: string,
  size: number, variants: FlipVariant[], indexFps: number, exactPts: boolean,
  ffmpeg: string, ffprobe: string, pool: ComputePool | undefined,
  note: Note | undefined, signal: AbortSignal | undefined
): Promise<IndexManifestEpisode> {
  const t0 = Date.now()
  const info = await probe(file, ffprobe, exactPts)
  const step = Math.max(1, pyRound(info.fps / Math.max(0.2, indexFps)))
  const frames = await decodeSelect(file, selectStep(step), size, size, ffmpeg, outdir, signal)
  if (frames.n === 0) throw new Error(`解码不到帧：${file}`)
  const ni = frames.n
  info.nbFrames = Math.max(info.nbFrames, (ni - 1) * step + 1)
  if (info.times !== null && info.times.length < info.nbFrames) {
    const pad = new Float64Array(info.nbFrames)
    pad.set(info.times)
    const last = info.times[info.times.length - 1]
    for (let i = info.times.length; i < info.nbFrames; i++) pad[i] = last + (i - info.times.length + 1) / info.fps
    info.times = pad
  }
  let desc: Float32Array
  if (pool) {
    const r = await pool.run<{ desc: Float32Array }>('describeVariants', {
      data: frames.data.buffer, n: ni, h: size, w: size, variants
    }, [frames.data.buffer as ArrayBuffer])
    desc = r.desc
  } else {
    desc = describeVariants(frames.data, ni, size, size, variants)
  }
  const nf = variants.length
  const meta = infoToMeta(info, eid, name, step, ni, nf)
  const metaJson = Buffer.from(JSON.stringify(meta), 'utf8')
  const header = Buffer.alloc(8)
  header.write('DWI1', 0, 'ascii')
  header.writeUInt32LE(metaJson.length, 4)
  const parts: Buffer[] = [header, metaJson, Buffer.from(desc.buffer, desc.byteOffset, desc.byteLength)]
  if (info.times !== null) {
    const t32 = Float32Array.from(info.times)
    parts.push(Buffer.from(t32.buffer, t32.byteOffset, t32.byteLength))
  }
  const fn = `ep${String(n).padStart(3, '0')}_${eid}.dwidx`
  fs.writeFileSync(path.join(outdir, fn), Buffer.concat(parts))
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2)
  note?.(`  ${eid} · ${ni} 索引帧 / ${info.nbFrames} 源帧 (step=${step}, ${info.fps}fps) · ${elapsed}s`)
  return {
    eid, name, path: file, file: fn, nbFrames: info.nbFrames, fps: info.fps,
    step, indexed: ni, width: info.width, height: info.height, duration: info.duration
  }
}

export async function buildIndex(sources: string[], outdir: string, opts: BuildIndexOpts): Promise<ReplicaIndex> {
  const { ffmpeg, ffprobe, note, signal } = opts
  const indexFps = opts.indexFps ?? 8
  const size = opts.size ?? 64
  const variants = opts.vflip ? VARIANTS_4 : DEFAULT_VARIANTS
  fs.mkdirSync(outdir, { recursive: true })

  const seen = new Set<string>()
  const files: [string, string, string][] = []
  for (const src of sources) {
    for (const [eid, name, p] of scanEpisodes(src)) {
      const key = process.platform === 'win32' ? p.toLowerCase() : p
      if (!seen.has(key)) {
        seen.add(key)
        files.push([eid, name, p])
      }
    }
  }
  if (files.length === 0) throw new Error(`没有找到视频文件：${sources.join(', ')}`)

  const used = new Map<string, number>()
  const tasks = files.map(([eid0, name, p], i) => {
    const cnt = used.get(eid0) ?? 0
    used.set(eid0, cnt + 1)
    const eid = cnt === 0 ? eid0 : `${eid0}_${cnt + 1}`
    return { n: i + 1, eid, name, path: p }
  })

  note?.(`建立索引：${tasks.length} 集 · index-fps=${indexFps} · ${variants.length} 镜像变体`)
  // 每集流水线：主进程解码 → worker 指纹 → 落盘；2 集并发让解码与计算重叠
  const manifestEps: IndexManifestEpisode[] = new Array(tasks.length)
  const concurrency = opts.pool ? 2 : 1
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const t = tasks[cursor++]
      if (signal?.aborted) throw new Error('已取消')
      note?.(`[${t.n}/${tasks.length}] 索引 ${t.eid} · ${t.name}`)
      manifestEps[t.n - 1] = await indexOne(
        t.n, t.eid, t.name, t.path, outdir, size, variants, indexFps,
        opts.exactPts ?? false, ffmpeg, ffprobe, opts.pool, note, signal
      )
    }
  })
  await Promise.all(workers)

  const config: IndexManifest = {
    version: 1,
    format: 'dw-replica-index',
    created: new Date().toISOString(),
    size,
    indexFps,
    variants: variants.map((v) => [v[0], v[1]]),
    episodes: manifestEps
  }
  fs.writeFileSync(path.join(outdir, 'manifest.json'), JSON.stringify(config, null, 2), 'utf8')
  note?.(`索引完成：${manifestEps.length} 集 → ${path.resolve(outdir)}`)
  return loadIndex(outdir)
}

export function loadIndex(indexdir: string): ReplicaIndex {
  const config = JSON.parse(fs.readFileSync(path.join(indexdir, 'manifest.json'), 'utf8')) as IndexManifest
  if (config.format !== 'dw-replica-index') throw new Error(`索引格式不兼容：${config.format ?? '未知'}`)
  const episodes: EpisodeIndex[] = []
  for (const e of config.episodes) {
    const buf = fs.readFileSync(path.join(indexdir, e.file))
    if (buf.toString('ascii', 0, 4) !== 'DWI1') throw new Error(`索引文件损坏：${e.file}`)
    const metaLen = buf.readUInt32LE(4)
    const meta = JSON.parse(buf.toString('utf8', 8, 8 + metaLen)) as EpMeta
    let off = 8 + metaLen
    const descLen = meta.ni * meta.nf * 16 * 9 * 4
    const descAb = new ArrayBuffer(descLen)
    new Uint8Array(descAb).set(buf.subarray(off, off + descLen))
    off += descLen
    let times: Float64Array | null = null
    if (meta.hasTimes) {
      const tLen = meta.nbFrames * 4
      const tAb = new ArrayBuffer(tLen)
      new Uint8Array(tAb).set(buf.subarray(off, off + tLen))
      times = Float64Array.from(new Float32Array(tAb))
    }
    const frameIdx = new Int32Array(meta.ni)
    for (let i = 0; i < meta.ni; i++) frameIdx[i] = i * meta.step
    episodes.push({
      eid: e.eid, name: e.name, path: e.path,
      info: metaToInfo(meta, times),
      step: meta.step, frameIdx,
      desc: new Float32Array(descAb), ni: meta.ni, nf: meta.nf
    })
  }
  return { episodes, config }
}

export function variantName(index: ReplicaIndex, vid: number): string {
  const v = index.config.variants[vid]
  if (!v) return `variant${vid}`
  return ((v[0] ? 'hflip' : '') + (v[1] ? '+vflip' : '')) || 'none'
}
