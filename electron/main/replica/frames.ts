/** 帧精确媒体 IO —— media.py 的 TS 等价移植（纯 Node）。
 *
 * 解码一律用 `select=<帧号表达式>`，返回的第 i 帧严格对应源文件解码帧号；
 * 时码来自 ffprobe 逐帧 PTS，CFR 片源走容器元数据快路径。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import type { MediaInfo } from './types.ts'

export const VIDEO_EXT = new Set([
  '.mp4', '.mkv', '.mov', '.ts', '.m2ts', '.avi', '.webm', '.flv', '.wmv', '.mpg', '.mpeg', '.m4v'
])

export interface RunResult {
  stdout: string
  stderr: string
}

/** 捕获 stdout/stderr 的子进程执行；非零退出抛错（带 stderr 尾部）。 */
export function runCapture(bin: string, args: string[], signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('已取消'))
      return
    }
    const child = spawn(bin, args, { windowsHide: true })
    let out = ''
    let err = ''
    const onAbort = (): void => {
      child.kill('SIGKILL')
      reject(new Error('已取消'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const cleanup = (): void => signal?.removeEventListener('abort', onAbort)
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8')
    })
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString('utf8')
      if (err.length > 64_000) err = err.slice(-32_000)
    })
    child.on('error', (e) => {
      cleanup()
      reject(e)
    })
    child.on('close', (code) => {
      cleanup()
      if (code === 0) resolve({ stdout: out, stderr: err })
      else reject(new Error(`命令失败 (exit ${code}): ${path.basename(bin)}\n${err.slice(-1200)}`))
    })
  })
}

// ---------------------------------------------------------------- 分数帧率

function gcd(a: number, b: number): number {
  while (b) {
    const t = a % b
    a = b
    b = t
  }
  return a
}

/** 等价 Python Fraction(str)：接受 "25"、"30000/1001"；非法/零分母返回 null。 */
export function parseFraction(s: string): { num: number; den: number } | null {
  const m = /^\s*(-?\d+)\s*(?:\/\s*(-?\d+))?\s*$/.exec(s)
  if (!m) return null
  let num = parseInt(m[1], 10)
  let den = m[2] !== undefined ? parseInt(m[2], 10) : 1
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null
  if (den < 0) {
    num = -num
    den = -den
  }
  const g = gcd(Math.abs(num), den) || 1
  return { num: num / g, den: den / g }
}

// ---------------------------------------------------------------- probe

interface ProbeStream {
  codec_type?: string
  width?: number
  height?: number
  r_frame_rate?: string
  avg_frame_rate?: string
  nb_frames?: string
  duration?: string
  start_time?: string
}

function cfrTimes(st: ProbeStream, fps: number, declared: number, duration: number): Float64Array | null {
  const r = parseFraction(String(st.r_frame_rate ?? '0/1'))
  const a = parseFraction(String(st.avg_frame_rate ?? '0/1'))
  if (!r || !a || r.num !== a.num || r.den !== a.den) return null
  if (declared <= 0 || duration <= 0) return null
  if (Math.abs(declared / fps - duration) > Math.max(0.05, 0.5 / fps)) return null
  const start = Number(st.start_time ?? 0)
  if (!Number.isFinite(start)) return null
  const t = new Float64Array(declared)
  for (let i = 0; i < declared; i++) t[i] = start + i / fps
  return t
}

async function frameTimes(file: string, ffprobe: string): Promise<Float64Array | null> {
  let r: RunResult
  try {
    r = await runCapture(ffprobe, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'frame=best_effort_timestamp_time',
      '-of', 'default=noprint_wrappers=1:nokey=1', file
    ])
  } catch {
    return null
  }
  const vals: number[] = []
  for (const line of r.stdout.split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue
    const v = Number(s)
    if (!Number.isFinite(v)) return null
    vals.push(v)
  }
  if (vals.length === 0) return null
  const arr = Float64Array.from(vals)
  let nonMono = false
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] - arr[i - 1] < -1e-6) {
      nonMono = true
      break
    }
  }
  if (nonMono) arr.sort()
  return arr
}

export async function probe(file: string, ffprobe: string, exactPts = false): Promise<MediaInfo> {
  if (!fs.existsSync(file)) throw new Error(`文件不存在：${file}`)
  const { stdout } = await runCapture(ffprobe, [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', file
  ])
  const data = JSON.parse(stdout) as { streams?: ProbeStream[]; format?: { duration?: string } }
  const streams = (data.streams ?? []).filter((s) => s.codec_type === 'video')
  if (streams.length === 0) throw new Error(`没有视频流：${file}`)
  const st = streams[0]
  let fr = parseFraction(String(st.r_frame_rate || st.avg_frame_rate || '25/1'))
  let fps = fr ? fr.num / fr.den : 25
  if (!fr || !(fps >= 1 && fps <= 240)) {
    fr = { num: 25, den: 1 }
    fps = 25
  }
  let duration = Number(st.duration ?? data.format?.duration ?? 0) || 0
  const declared = parseInt(String(st.nb_frames ?? '0'), 10) || 0
  let times = exactPts ? null : cfrTimes(st, fps, declared, duration)
  if (times === null) times = await frameTimes(file, ffprobe)
  let nb = times !== null ? times.length : 0
  if (nb === 0) nb = declared || (duration > 0 ? Math.round(duration * fps) : 0)
  if (times === null || times.length !== nb) times = null
  if (duration <= 0 && times !== null && times.length > 0) duration = times[times.length - 1] + 1 / fps
  else if (duration <= 0) duration = nb / fps
  return {
    path: path.resolve(file),
    width: st.width ?? 0,
    height: st.height ?? 0,
    fps,
    fpsNum: fr.num,
    fpsDen: fr.den,
    fpsQ: Math.max(1, Math.round(fps)),
    nbFrames: nb,
    duration,
    times
  }
}

// ---------------------------------------------------------------- select 表达式

export function selectAll(): string {
  return '1'
}

export function selectStep(step: number): string {
  return step <= 1 ? '1' : `not(mod(n\\,${Math.trunc(step)}))`
}

export function mergeWindows(windows: Iterable<[number, number]>, joinGap = 1): [number, number][] {
  const ws: [number, number][] = []
  for (const [a0, b0] of windows) {
    const a = Math.max(0, Math.trunc(a0))
    const b = Math.max(0, Math.trunc(b0))
    if (b >= a) ws.push([a, b])
  }
  ws.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  const out: [number, number][] = []
  for (const [a, b] of ws) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + joinGap) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

export function selectWindows(windows: Iterable<[number, number]>): string {
  const merged = mergeWindows(windows)
  if (merged.length === 0) return '0'
  return merged.map(([a, b]) => `between(n\\,${a}\\,${b})`).join('+')
}

// ---------------------------------------------------------------- 解码

export interface DecodedFrames {
  /** (n, h, w) uint8 行优先扁平缓冲 */
  data: Uint8Array
  n: number
  h: number
  w: number
}

/** 按 select 表达式解码为 (n,h,w) 灰度帧。与 Python 版一致：写临时 raw 文件再读回。 */
export async function decodeSelect(
  file: string, expr: string, w: number, h: number, ffmpeg: string,
  workdir?: string, signal?: AbortSignal
): Promise<DecodedFrames> {
  const base = workdir ?? os.tmpdir()
  fs.mkdirSync(base, { recursive: true })
  const tmp = path.join(base, `dwreplica_${crypto.randomUUID().replace(/-/g, '')}.raw`)
  const vf = `select='${expr}',scale=${Math.trunc(w)}:${Math.trunc(h)},format=gray`
  try {
    await runCapture(ffmpeg, [
      '-y', '-v', 'error', '-nostdin', '-i', file,
      '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', vf,
      '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', tmp
    ], signal)
    if (!fs.existsSync(tmp)) return { data: new Uint8Array(0), n: 0, h, w }
    const buf = fs.readFileSync(tmp)
    if (buf.length % (w * h) !== 0) {
      throw new Error(`FFmpeg 输出长度异常：${buf.length} 字节，不是 ${w * h} 的整数倍`)
    }
    // 独立 ArrayBuffer（byteOffset=0），保证 Transferable 零拷贝传给 worker 时不丢偏移
    const data = new Uint8Array(buf.length)
    data.set(buf)
    return { data, n: buf.length / (w * h), h, w }
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
  }
}

export interface DecodedWindows extends DecodedFrames {
  /** frames[i] 的精确源帧号 */
  indices: Int32Array
}

/** 解码若干帧窗口；容器帧数与解码器不一致时回退为连续解码再按帧号切片。 */
export async function decodeWindows(
  file: string, windows: [number, number][], w: number, h: number, ffmpeg: string,
  workdir?: string, signal?: AbortSignal
): Promise<DecodedWindows> {
  const merged = mergeWindows(windows)
  if (merged.length === 0) return { data: new Uint8Array(0), n: 0, h, w, indices: new Int32Array(0) }
  const expected = merged.reduce((s, [a, b]) => s + (b - a + 1), 0)
  const frames = await decodeSelect(file, selectWindows(merged), w, h, ffmpeg, workdir, signal)
  if (frames.n !== expected) {
    const lo = merged[0][0]
    const hi = merged[merged.length - 1][1]
    const whole = await decodeSelect(file, `between(n\\,${lo}\\,${hi})`, w, h, ffmpeg, workdir, signal)
    const keepIdx: number[] = []
    for (let i = 0; i < whole.n; i++) {
      const f = lo + i
      if (merged.some(([a, b]) => f >= a && f <= b)) keepIdx.push(i)
    }
    const data = new Uint8Array(keepIdx.length * w * h)
    const indices = new Int32Array(keepIdx.length)
    keepIdx.forEach((src, dst) => {
      data.set(whole.data.subarray(src * w * h, (src + 1) * w * h), dst * w * h)
      indices[dst] = lo + src
    })
    return { data, n: keepIdx.length, h, w, indices }
  }
  const indices = new Int32Array(expected)
  let k = 0
  for (const [a, b] of merged) for (let f = a; f <= b; f++) indices[k++] = f
  return { ...frames, indices }
}

// ---------------------------------------------------------------- 时码

export function isCfr(info: MediaInfo): boolean {
  const t = info.times
  if (t === null || t.length < 2) return true
  let ok = 0
  for (let i = 1; i < t.length; i++) {
    if (Math.abs(t[i] - t[i - 1] - 1 / info.fps) < 0.002) ok++
  }
  return ok / (t.length - 1) > 0.95
}

/** 距文件首帧的秒数（去掉流起始偏移）。 */
export function frameTime(frame: number, info: MediaInfo): number {
  const f = Math.round(frame)
  const t = info.times
  const base = isCfr(info) && t !== null && t.length > 0 ? t[0] : 0
  if (t !== null && t.length > 0) {
    if (f >= 0 && f < t.length) return t[f] - base
    if (f >= t.length) return t[t.length - 1] - base + (f - t.length + 1) / info.fps
    return t[0] - base + f / info.fps
  }
  return f / info.fps
}

const p2 = (n: number): string => String(n).padStart(2, '0')

export function frameTc(frame: number, info: MediaInfo): string {
  const total = isCfr(info) ? Math.round(frame) : Math.round(frameTime(frame, info) * info.fps)
  const q = info.fpsQ
  const ff = ((total % q) + q) % q
  const sec = Math.floor(total / q)
  return `${p2(Math.floor(sec / 3600))}:${p2(Math.floor((sec % 3600) / 60))}:${p2(sec % 60)}:${p2(ff)}`
}

export function fmtSeconds(t: number): string {
  return t.toFixed(3)
}

// ---------------------------------------------------------------- 剧集发现

const NUM_RE = /(?:第\s*(\d+)\s*集|[Ee][Pp]?\.?\s*(\d+)|[Ss]\d+[Ee](\d+)|(?<!\d)(\d{1,3})(?!\d))/

export function episodeNumber(name: string): number | null {
  const m = NUM_RE.exec(name)
  if (!m) return null
  for (let i = 1; i < m.length; i++) {
    if (m[i] !== undefined) return parseInt(m[i], 10)
  }
  return null
}

export function naturalKey(name: string): (number | string)[] {
  return name.split(/(\d+)/).filter((t) => t !== '').map((t) => (/^\d+$/.test(t) ? parseInt(t, 10) : t.toLowerCase()))
}

function cmpNatural(a: (number | string)[], b: (number | string)[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]
    const y = b[i]
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return String(x) < String(y) ? -1 : 1
  }
  return a.length - b.length
}

/** 返回 [eid, 文件名, 绝对路径]，按文件名自然序。 */
export function scanEpisodes(source: string): [string, string, string][] {
  let paths: string[]
  if (fs.existsSync(source) && fs.statSync(source).isFile()) {
    paths = [source]
  } else if (fs.existsSync(source) && fs.statSync(source).isDirectory()) {
    paths = fs.readdirSync(source)
      .filter((n) => {
        const p = path.join(source, n)
        return fs.statSync(p).isFile() && VIDEO_EXT.has(path.extname(n).toLowerCase())
      })
      .map((n) => path.join(source, n))
  } else {
    paths = []
  }
  paths = [...new Set(paths.map((p) => path.resolve(p)))]
  paths.sort((a, b) => cmpNatural(naturalKey(path.basename(a)), naturalKey(path.basename(b))))
  const out: [string, string, string][] = []
  for (const p of paths) {
    const name = path.basename(p)
    const n = episodeNumber(name)
    const eid = n !== null ? `E${String(n).padStart(2, '0')}` : `E${String(out.length + 1).padStart(2, '0')}`
    out.push([eid, name, p])
  }
  return out
}
