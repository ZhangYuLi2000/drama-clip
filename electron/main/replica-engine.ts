/** 爆款复刻编排层：索引管理 + 溯源 + 重剪三阶段流水线。
 *
 * 主进程只做 IO 与调度，数值计算在 replica-worker 线程池；
 * 全部路径绝对化，终止时杀 ffmpeg 子进程并销毁 worker 池。
 */
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { Drama, ReplicaIndexState, ReplicaStats, ReplicaTask } from '../../src/shared/types'
import { cacheDir } from './db'
import { ffmpegBin, ffprobeBin } from './media'
import { buildIndex, loadIndex } from './replica/indexer'
import { frameOrigins, writeFrameOrigins } from './replica/framewise'
import { recut } from './replica/recut'
import { loadTrace } from './replica/edl'
import { probe } from './replica/frames'
import { ComputePool } from './replica/worker-pool'
import { getReplicaSettings } from './settings'
import type { Band, ReplicaIndex } from './replica/types'

export type ReplicaStage = 'indexing' | 'tracing' | 'cutting'
export type ProgressFn = (pct: number, stage: ReplicaStage, note?: string) => void
export type LogFn = (msg: string) => void

function workerScript(): string {
  return path.join(__dirname, 'replica-worker.js')
}

function replicaIndexDir(dramaId: string): string {
  return path.join(cacheDir(), 'replica-index', dramaId)
}

function parseBand(s: string): Band | null {
  if (!s.trim()) return null
  const parts = s.split(/[,，:]/).map((x) => Number(x.trim()))
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null
  return [Math.min(parts[0], parts[1]), Math.max(parts[0], parts[1])]
}

/** 索引是否与当前剧集列表一致（路径集合 + 抽帧率）。 */
export function indexNeedsRebuild(drama: Drama, indexFps: number): boolean {
  const state = drama.replicaIndex
  const dir = state?.dir ?? replicaIndexDir(drama.id)
  const manifestPath = path.join(dir, 'manifest.json')
  if (!state || !fs.existsSync(manifestPath)) return true
  if (state.indexFps !== indexFps) return true
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      episodes: { path: string }[]
    }
    const norm = (p: string): string => path.normalize(p).toLowerCase()
    const want = new Set(drama.episodes.map((e) => norm(e.file)))
    const have = new Set(manifest.episodes.map((e) => norm(e.path)))
    if (want.size !== have.size) return true
    for (const w of want) if (!have.has(w)) return true
    return false
  } catch {
    return true
  }
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || '爆款复刻'
}

function stamp(): string {
  const d = new Date()
  const p = (x: number): string => String(x).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function outputDir(drama: Drama, task: ReplicaTask): string {
  const base = `${safeName(task.clipTitle)}_${stamp()}`
  const primary = path.join(drama.dir, '复刻', base)
  try {
    fs.mkdirSync(primary, { recursive: true })
    return primary
  } catch {
    const fallback = path.join(app.getPath('userData'), 'replicas', drama.id, task.id)
    fs.mkdirSync(fallback, { recursive: true })
    return fallback
  }
}

export interface RunReplicaOpts {
  /** 复用已有溯源表，只重剪（换音轨/画质/精修参数） */
  recutOnly?: boolean
}

/** 执行一个复刻任务；直接更新 task 字段，进度经 onProgress 上报。 */
export async function runReplicaTask(
  drama: Drama, task: ReplicaTask, opts: RunReplicaOpts,
  onProgress: ProgressFn, onLog: LogFn, signal: AbortSignal
): Promise<void> {
  const ffmpeg = ffmpegBin()
  const ffprobe = ffprobeBin()
  const configured = getReplicaSettings().workers
  const workers = Math.max(1, Math.min(8, configured || Math.min(6, os.cpus().length - 2)))
  const pool = new ComputePool(workerScript(), workers)
  const band = parseBand(task.maskBand)
  const cfg = {
    size: 64,
    maskBottom: task.maskBottom,
    maskTop: task.maskTop,
    band,
    frameMaxDist: 0.15
  }
  try {
    if (!fs.existsSync(task.clipFile)) throw new Error(`爆款切片文件不存在：${task.clipFile}`)
    for (const ep of drama.episodes) {
      if (!fs.existsSync(ep.file)) throw new Error(`第 ${ep.n} 集原文件不存在：${ep.file}`)
    }

    // ---- 阶段 1：索引（按剧缓存，判脏重建） ----
    let index: ReplicaIndex
    const indexDir = replicaIndexDir(drama.id)
    if (opts.recutOnly && drama.replicaIndex && !indexNeedsRebuild(drama, task.indexFps)) {
      index = loadIndex(drama.replicaIndex.dir)
    } else if (!opts.recutOnly && !indexNeedsRebuild(drama, task.indexFps)) {
      index = loadIndex(indexDir)
      onLog(`复用复刻索引（${index.episodes.length} 集）`)
      onProgress(35, 'indexing', '索引已就绪')
    } else {
      onProgress(0, 'indexing', '建立指纹索引')
      onLog(`建立复刻索引：${drama.episodes.length} 集 · index-fps=${task.indexFps}`)
      const files = drama.episodes.map((e) => e.file)
      index = await buildIndex(files, indexDir, {
        indexFps: task.indexFps,
        ffmpeg,
        ffprobe,
        pool,
        signal,
        note: (m) => {
          onLog(m)
          const mm = /\[(\d+)\/(\d+)\]/.exec(m)
          if (mm) onProgress(Math.round((Number(mm[1]) / Number(mm[2])) * 33), 'indexing', m)
        }
      })
      const state: ReplicaIndexState = {
        dir: indexDir,
        indexFps: task.indexFps,
        builtAt: Date.now(),
        epCount: index.episodes.length
      }
      drama.replicaIndex = state
      onProgress(35, 'indexing', '索引完成')
    }

    // ---- 阶段 2：逐帧溯源 ----
    // 仅重剪：复用溯源表所在目录（产物原地覆盖）；完整重试：清理旧产物目录
    let outDir: string
    if (opts.recutOnly && task.tracePath && fs.existsSync(task.tracePath)) {
      outDir = path.dirname(task.tracePath)
    } else {
      if (task.output) {
        try {
          fs.rmSync(path.dirname(task.output), { recursive: true, force: true })
        } catch {
          /* 旧产物清理失败不阻塞 */
        }
      }
      outDir = outputDir(drama, task)
    }
    let tracePath = task.tracePath
    let coverage = task.stats?.coverage ?? 0
    if (!opts.recutOnly || !tracePath || !fs.existsSync(tracePath)) {
      onProgress(36, 'tracing', '逐帧溯源')
      const { rows, meta } = await frameOrigins(index, task.clipFile, cfg, ffmpeg, ffprobe, outDir, {
        pool,
        signal,
        note: (m) => {
          onLog(m)
          if (m.includes('帧在此集取得最优')) {
            // 逐集进度在 36~54 之间推进
            onProgress(45, 'tracing', m)
          }
        }
      })
      const outs = writeFrameOrigins(rows, meta, outDir)
      tracePath = outs.csv
      coverage = (meta.clip_frames - meta.counts.none) / Math.max(1, meta.clip_frames)
      onLog(`溯源完成：有出处 ${meta.clip_frames - meta.counts.none}/${meta.clip_frames} 帧（${(coverage * 100).toFixed(1)}%）`)
      onProgress(55, 'tracing', '溯源完成')
    } else {
      const trace = loadTrace(tracePath, 'origins')
      coverage = trace.filter((r) => r[2] >= 0).length / Math.max(1, trace.length)
      onLog(`复用溯源表：${path.basename(tracePath)}`)
    }
    if (signal.aborted) throw new Error('已取消')

    // ---- 阶段 3：重剪 ----
    onProgress(56, 'cutting', '按原片重剪')
    const epTotal = new Set(index.episodes.map((e) => e.eid)).size
    let epDone = 0
    const summary = await recut(index, task.clipFile, ffmpeg, ffprobe, outDir, {
      tracePath,
      traceKind: 'origins',
      audio: task.audio,
      crf: task.crf,
      despike: task.despike,
      refine: task.refine,
      refineRadius: task.boundsRadius,
      cfg,
      pool,
      signal,
      note: (m) => {
        onLog(m)
        if (/^ {2}E\d+.*解码/.test(m)) {
          epDone++
          onProgress(Math.min(90, 56 + Math.round((epDone / Math.max(1, epTotal)) * 34)), 'cutting', m)
        } else if (m.startsWith('边界精修')) {
          onProgress(92, 'cutting', m)
        }
      }
    })
    const outInfo = await probe(summary.output, ffprobe)
    const stats: ReplicaStats = {
      segments: summary.segments,
      continuous: summary.continuous,
      still: summary.still_held,
      gap: summary.gap,
      totalSeconds: summary.total_seconds,
      resolution: `${outInfo.width}x${outInfo.height}`,
      fps: outInfo.fps,
      coverage
    }
    task.output = summary.output
    task.edlPath = path.join(outDir, 'recut_edl.csv')
    task.tracePath = tracePath
    task.stats = stats
    onProgress(100, 'cutting', '复刻完成')
  } finally {
    pool.destroy()
  }
}

/** 读取 EDL 供 UI 表格展示。 */
export function readReplicaEdl(edlPath: string): {
  segmentId: number; episode: string; srcIn: number; srcOut: number
  srcInTc: string; srcOutTc: string; clipIn: number; clipOut: number; kind: string; seconds: number
}[] {
  const text = fs.readFileSync(edlPath, 'utf8').replace(/^\ufeff/, '')
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return []
  const head = lines[0].split(',')
  const col = (name: string): number => head.indexOf(name)
  return lines.slice(1).map((l) => {
    const c = l.split(',')
    return {
      segmentId: parseInt(c[col('segment_id')], 10),
      episode: c[col('episode')],
      srcIn: parseInt(c[col('src_in')], 10),
      srcOut: parseInt(c[col('src_out')], 10),
      srcInTc: c[col('src_in_tc')],
      srcOutTc: c[col('src_out_tc')],
      clipIn: parseInt(c[col('clip_in')], 10),
      clipOut: parseInt(c[col('clip_out')], 10),
      kind: c[col('kind')],
      seconds: Number(c[col('seconds')])
    }
  })
}
