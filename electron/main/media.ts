import { spawn } from 'child_process'
import fs from 'fs'
import { createRequire } from 'module'

const req = createRequire(__filename)

export function ffmpegBin(): string {
  let p: string | null = null
  try {
    p = req('ffmpeg-static') as string | null
  } catch {
    p = null
  }
  if (!p) throw new Error('ffmpeg 二进制缺失：请先运行 npm install（ffmpeg-static）')
  return p
}

export function ffprobeBin(): string {
  let p: { path: string } | null = null
  try {
    p = req('ffprobe-static') as { path: string }
  } catch {
    p = null
  }
  if (!p?.path) throw new Error('ffprobe 二进制缺失：请先运行 npm install（ffprobe-static）')
  return p.path
}

export function run(
  bin: string,
  args: string[],
  timeoutMs: number,
  errCap = 8000,
  signal?: AbortSignal
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('已取消'))
      return
    }
    const child = spawn(bin, args, { windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`FFmpeg 执行超时（${Math.round(timeoutMs / 1000)}s）`))
    }, timeoutMs)
    const onAbort = (): void => {
      child.kill('SIGKILL')
      reject(new Error('已取消'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const cleanup = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString()
      if (err.length > errCap) err = err.slice(-errCap)
    })
    child.on('error', (e) => {
      cleanup()
      reject(e)
    })
    child.on('close', (code) => {
      cleanup()
      if (code === 0) resolve({ stdout: out, stderr: err })
      else reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `FFmpeg 退出码 ${code}`))
    })
  })
}

export interface ProbeInfo {
  duration: number
  width: number | null
  height: number | null
}

export async function probe(file: string): Promise<ProbeInfo> {
  const { stdout } = await run(
    ffprobeBin(),
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    60_000
  )
  const info = JSON.parse(stdout) as {
    format?: { duration?: string }
    streams?: { codec_type?: string; width?: number; height?: number; duration?: string }[]
  }
  const video = (info.streams ?? []).find((s) => s.codec_type === 'video')
  const durStr = info.format?.duration ?? video?.duration
  const duration = durStr ? Number(durStr) : NaN
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取视频时长，文件可能已损坏')
  return { duration, width: video?.width ?? null, height: video?.height ?? null }
}

export async function makeThumb(file: string, out: string, duration: number): Promise<void> {
  const seek = Math.max(0.5, duration * 0.1)
  await run(
    ffmpegBin(),
    ['-y', '-ss', seek.toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', out],
    120_000
  )
}

export async function extractAudio(file: string, out: string): Promise<void> {
  await run(
    ffmpegBin(),
    ['-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', out],
    10 * 60_000
  )
}

export async function sliceClip(file: string, tin: number, tout: number, out: string): Promise<void> {
  const dur = Math.max(0.1, tout - tin)
  await run(
    ffmpegBin(),
    [
      '-y',
      '-ss',
      tin.toFixed(3),
      '-i',
      file,
      '-t',
      dur.toFixed(3),
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      out
    ],
    10 * 60_000
  )
}

export async function detectShots(file: string): Promise<number[]> {
  const { stderr } = await run(
    ffmpegBin(),
    ['-nostats', '-i', file, '-vf', "scale=320:-2,select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-'],
    10 * 60_000,
    512 * 1024
  )
  const shots: number[] = []
  const re = /pts_time:([0-9.]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stderr)) !== null) {
    const t = Math.round(Number(m[1]) * 100) / 100
    if (!Number.isFinite(t) || t <= 0) continue
    if (shots.length === 0 || t - shots[shots.length - 1] > 0.1) shots.push(t)
  }
  return shots
}

export function fileExists(file: string): boolean {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}