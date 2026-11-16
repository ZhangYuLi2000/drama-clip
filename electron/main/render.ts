import crypto from 'crypto'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { AsrSegment, Drama, PromoCut } from '../../src/shared/types'
import { withPublishTags } from '../../src/shared/types'
import { cacheDir } from './db'
import { detectLeadingSilenceEnd, ffmpegBin, fileExists, run } from './media'

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || '智剪成片'
}

function stamp(): string {
  const d = new Date()
  const p = (x: number): string => String(x).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function fmtSrtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const rem = ms % 1000
  const p2 = (n: number): string => String(n).padStart(2, '0')
  const p3 = (n: number): string => String(n).padStart(3, '0')
  return `${p2(h)}:${p2(m)}:${p2(s)},${p3(rem)}`
}

function segCacheFile(epFile: string, epSize: number, tin: number, tout: number, ratio: string): string {
  const dir = path.join(cacheDir(), 'seg-cache')
  fs.mkdirSync(dir, { recursive: true })
  const key = `${epFile}|${epSize}|${tin.toFixed(2)}|${tout.toFixed(2)}|${ratio}`
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 20)
  return path.join(dir, `seg-${hash}.mp4`)
}

/** 根据成片 clips 拼接时间轴映射出对应的 .srt 字幕内容，方便用户直接导入剪映 */
export function buildCutSrt(drama: Drama, cut: PromoCut): string {
  const entries: { start: number; end: number; text: string }[] = []
  let offset = 0
  for (const clip of cut.clips) {
    const ep = drama.episodes.find((e) => e.id === clip.epId || e.n === clip.epN)
    const dur = Math.max(0.1, clip.out - clip.in)
    const segs: AsrSegment[] = ep?.segments ?? []
    for (const seg of segs) {
      if (seg.end <= clip.in || seg.start >= clip.out) continue
      const s = Math.max(0, seg.start - clip.in) + offset
      const e = Math.min(dur, seg.end - clip.in) + offset
      if (e - s >= 0.2 && seg.text.trim()) {
        entries.push({ start: s, end: e, text: seg.text.trim() })
      }
    }
    offset += dur
  }
  return entries
    .map((item, idx) => `${idx + 1}\n${fmtSrtTime(item.start)} --> ${fmtSrtTime(item.end)}\n${item.text}\n`)
    .join('\n')
}

export async function renderPromoCut(
  drama: Drama,
  cut: PromoCut,
  onProgress: (pct: number) => void,
  onLog?: (msg: string) => void,
  signal?: AbortSignal
): Promise<{ output: string; srtPath: string }> {
  if (cut.clips.length === 0) throw new Error('切片方案没有可用片段')
  const target = cut.ratio === '9:16' ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 }
  const vf = `scale=${target.w}:${target.h}:force_original_aspect_ratio=decrease,pad=${target.w}:${target.h}:(ow-iw)/2:(oh-ih)/2,setsar=1`
  const workDir = path.join(cacheDir(), 'render', `${cut.id}-${Date.now()}`)
  fs.mkdirSync(workDir, { recursive: true })
  const segFiles: string[] = []

  try {
    for (let i = 0; i < cut.clips.length; i++) {
      if (signal?.aborted) throw new Error('已取消')
      const clip = cut.clips[i]
      const ep = drama.episodes.find((e) => e.id === clip.epId || e.n === clip.epN)
      if (!ep) throw new Error(`第 ${i + 1} 段找不到第 ${clip.epN} 集`)
      if (!fileExists(ep.file)) throw new Error(`第 ${clip.epN} 集原文件不存在：${ep.file}`)

      // 首段钩子自动静音包络精修：剔除因 2fps 代理量化带来的前导空白，做到划入即出声
      if (i === 0) {
        const trimmedIn = await detectLeadingSilenceEnd(ep.file, clip.in, clip.out, signal)
        if (trimmedIn > clip.in + 0.12) {
          onLog?.(
            `首段钩子声学精修：自动剔除前 ${(trimmedIn - clip.in).toFixed(2)}s 静音空白（第 ${clip.epN} 集 ${clip.in.toFixed(2)}s → ${trimmedIn.toFixed(2)}s）`
          )
          clip.in = Math.round(trimmedIn * 10) / 10
        }
      }

      const cachedSeg = segCacheFile(ep.file, ep.size, clip.in, clip.out, cut.ratio)
      if (fileExists(cachedSeg) && fs.statSync(cachedSeg).size > 1024) {
        segFiles.push(cachedSeg)
        onProgress(Math.round(((i + 1) / cut.clips.length) * 88))
        onLog?.(
          `复用高速片段缓存 ${i + 1}/${cut.clips.length}（第 ${clip.epN} 集 ${clip.in.toFixed(1)}-${clip.out.toFixed(1)}s）`
        )
        continue
      }

      const dur = Math.max(0.2, clip.out - clip.in)
      const fadeOutStart = Math.max(0, dur - 0.06).toFixed(3)
      const af = `loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.04,afade=t=out:st=${fadeOutStart}:d=0.06`
      const tmpSeg = path.join(workDir, `seg-${i}.mp4`)

      await run(
        ffmpegBin(),
        [
          '-y',
          '-ss',
          clip.in.toFixed(3),
          '-i',
          ep.file,
          '-t',
          dur.toFixed(3),
          '-vf',
          vf,
          '-af',
          af,
          '-r',
          '30',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '19',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '160k',
          '-ar',
          '48000',
          '-ac',
          '2',
          tmpSeg
        ],
        10 * 60_000,
        8000,
        signal
      )
      try {
        fs.copyFileSync(tmpSeg, cachedSeg)
        segFiles.push(cachedSeg)
      } catch {
        segFiles.push(tmpSeg)
      }
      onProgress(Math.round(((i + 1) / cut.clips.length) * 88))
      onLog?.(`渲染片段 ${i + 1}/${cut.clips.length}（第 ${clip.epN} 集 ${clip.in.toFixed(1)}-${clip.out.toFixed(1)}s）`)
    }

    cut.actualSec = Math.round(cut.clips.reduce((s, c) => s + Math.max(0.2, c.out - c.in), 0) * 10) / 10

    const listFile = path.join(workDir, 'list.txt')
    fs.writeFileSync(listFile, segFiles.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))

    let outDir = path.join(drama.dir, '成片')
    try {
      fs.mkdirSync(outDir, { recursive: true })
    } catch {
      outDir = path.join(app.getPath('userData'), 'renders', drama.id)
      fs.mkdirSync(outDir, { recursive: true })
    }
    const baseName = `${safeName(cut.title)}_v${cut.revision}_${stamp()}`
    const output = path.join(outDir, `${baseName}.mp4`)
    const srtPath = path.join(outDir, `${baseName}.srt`)

    await run(
      ffmpegBin(),
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', output],
      10 * 60_000,
      8000,
      signal
    )

    const srt = buildCutSrt(drama, cut)
    fs.writeFileSync(srtPath, srt, 'utf8')
    fs.writeFileSync(path.join(outDir, `${baseName}_文案.txt`), buildCutCopyText(drama, cut), 'utf8')

    onProgress(100)
    onLog?.(`成片渲染完成：${output}`)
    return { output, srtPath }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}

export function buildCutCopyText(drama: Drama, cut: PromoCut): string {
  return [
    `【方案名称】${cut.title} (v${cut.revision})`,
    `【开场花字标题】${cut.hookHeadline}`,
    `【引流发布文案】\n${withPublishTags(cut.publishCopy, drama.publishTags)}`,
    `【核心冲突】${cut.conflictSummary}`,
    `【剪辑师备注】${cut.directorNote}`
  ].join('\n')
}

/** 剧级标签变更后，把已渲染成片的旁挂文案文件同步为最新文案 */
export function syncCutCopyFiles(drama: Drama): void {
  for (const cut of drama.cuts ?? []) {
    if (cut.status !== 'ready' || !cut.output) continue
    try {
      fs.writeFileSync(`${cut.output.replace(/\.mp4$/i, '')}_文案.txt`, buildCutCopyText(drama, cut), 'utf8')
    } catch {
      // 成片文件已被移动或删除时跳过
    }
  }
}

export function cleanupCutFiles(output?: string, srtPath?: string): void {
  if (output) {
    fs.rmSync(output, { force: true })
    const copyFile = `${output.replace(/\.mp4$/i, '')}_文案.txt`
    fs.rmSync(copyFile, { force: true })
  }
  if (srtPath) fs.rmSync(srtPath, { force: true })
}
