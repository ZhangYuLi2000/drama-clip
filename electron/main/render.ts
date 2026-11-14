import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { Drama, RenderParams, RenderState } from '../../src/shared/types'
import { cacheDir } from './db'
import { ffmpegBin, fileExists, run } from './media'

let state: RenderState = { status: 'idle', pct: 0, output: '', error: '' }

export function getRenderState(): RenderState {
  return state
}

export function setRenderState(patch: Partial<RenderState>): void {
  state = { ...state, ...patch }
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || '混剪'
}

function stamp(): string {
  const d = new Date()
  const p = (x: number): string => String(x).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export async function renderMix(
  drama: Drama,
  params: RenderParams,
  onProgress: (pct: number) => void,
  onLog?: (msg: string) => void
): Promise<string> {
  const { clips, ratio } = params
  if (clips.length === 0) throw new Error('没有可渲染的片段')
  const target = ratio === '9:16' ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 }
  const vf = `scale=${target.w}:${target.h}:force_original_aspect_ratio=decrease,pad=${target.w}:${target.h}:(ow-iw)/2:(oh-ih)/2,setsar=1`
  const dir = path.join(cacheDir(), 'render', `${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  const segFiles: string[] = []
  try {
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]
      let epFile: string | null = null
      for (const ep of drama.episodes) {
        if (ep.candidates?.some((c) => c.id === clip.candId)) {
          epFile = ep.file
          break
        }
      }
      if (!epFile) throw new Error(`第 ${i + 1} 段找不到对应剧集`)
      if (!fileExists(epFile)) throw new Error('原视频文件不存在，可能已被移动或删除')
      const seg = path.join(dir, `seg-${i}.mp4`)
      const dur = Math.max(0.1, clip.out - clip.in)
      await run(
        ffmpegBin(),
        [
          '-y',
          '-ss',
          clip.in.toFixed(3),
          '-i',
          epFile,
          '-t',
          dur.toFixed(3),
          '-vf',
          vf,
          '-r',
          '30',
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
          '-ar',
          '48000',
          '-ac',
          '2',
          seg
        ],
        10 * 60_000
      )
      segFiles.push(seg)
      onProgress(Math.round(((i + 1) / clips.length) * 90))
      onLog?.(`渲染分段 ${i + 1}/${clips.length} 完成`)
    }
    const listFile = path.join(dir, 'list.txt')
    fs.writeFileSync(listFile, segFiles.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
    const outDir = path.join(app.getPath('userData'), 'renders')
    fs.mkdirSync(outDir, { recursive: true })
    const output = path.join(outDir, `${safeName(drama.title)}_混剪_${stamp()}.mp4`)
    await run(
      ffmpegBin(),
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', output],
      10 * 60_000
    )
    onProgress(100)
    onLog?.(`混剪渲染完成：${output}`)
    return output
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}