import { BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import type { CutStyle, GenerateCutParams, GenerateNarrationParams, JobInfo, JobKind, JobLogEntry, JobLogState } from '../../src/shared/types'
import { allEpisodes, cacheDir, findDrama, findEpisode, getLibrary, saveLibrary } from './db'
import { analyzeViralBenchmark, generateHookMatrixCuts, generatePromoCut, regeneratePromoCut } from './director'
import { runGlobalAnalysis, type GlobalRange } from './global'
import { detectShots, fileExists, makeThumb, probe } from './media'
import { cleanupCutFiles, renderPromoCut } from './render'
import { runReplicaTask } from './replica-engine'
import { generateNarrationScript, voiceNarrationSegments } from './narration'
import { getCutStyleMeta, getEffectiveTextModel, getSettings, getTtsSettings } from './settings'

interface Job {
  kind: JobKind
  dramaId: string
  episodeId: string
  cutId?: string
  replicaId?: string
  replicaRecutOnly?: boolean
  globalRange?: GlobalRange
  autoCutCount?: number
  genParams?: GenerateCutParams
  variantIndex?: number
  totalVariants?: number
  regenInstruction?: string
  regenStyle?: CutStyle
  regenTargetSec?: number
  narrationId?: string
  narrationMode?: 'full' | 'revoice'
  segmentId?: string
  narrationParams?: GenerateNarrationParams
}

const queue: Job[] = []
let current: JobInfo | null = null
let currentAbort: AbortController | null = null
let pumping = false

const logs: JobLogEntry[] = []
let doneCount = 0
let failCount = 0

export function jobLog(level: JobLogEntry['level'], msg: string): void {
  logs.push({ t: Date.now(), level, msg })
  if (logs.length > 500) logs.splice(0, logs.length - 500)
}

export function getJobLogState(): JobLogState {
  return { logs, done: doneCount, failed: failCount }
}

export function clearJobLogs(): void {
  logs.length = 0
  doneCount = 0
  failCount = 0
}

export function broadcastLibrary(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('library-updated')
  }
}

function emit(): void {
  broadcastLibrary()
}

function labelOf(kind: JobKind, n: number): string {
  if (kind === 'probe') return `读取第 ${n} 集元数据`
  if (kind === 'thumb') return `生成第 ${n} 集缩略图`
  if (kind === 'shots') return `检测第 ${n} 集镜头边界`
  if (kind === 'global') return '全局分幕分析'
  if (kind === 'generate-cut') return 'AI 大师编排切片'
  if (kind === 'replica') return '爆款复刻'
  if (kind === 'narration') return 'AI 解说成片'
  return '渲染引流成片'
}

export function enqueue(kind: JobKind, dramaId: string, episodeId: string): void {
  if (queue.some((j) => j.kind === kind && j.dramaId === dramaId && j.episodeId === episodeId)) return
  if (current && current.kind === kind && current.dramaId === dramaId && current.episodeId === episodeId) return
  queue.push({ kind, dramaId, episodeId })
  const found = findEpisode(dramaId, episodeId)
  jobLog('info', `加入队列：${labelOf(kind, found?.ep.n ?? 0)}（等待 ${queue.length} 个）`)
  void pump()
}

export function enqueueGlobal(dramaId: string, range: GlobalRange, autoCutCount = 3): boolean {
  const drama = findDrama(dramaId)
  if (!drama) return false
  if (queue.some((j) => j.kind === 'global' && j.dramaId === dramaId)) return false
  if (current && current.kind === 'global' && current.dramaId === dramaId) return false
  drama.global = {
    status: 'queue',
    pct: 0,
    model: getSettings().global.model,
    map: drama.global?.map ?? [],
    tokens: drama.global?.tokens ?? 0,
    cachedTokens: drama.global?.cachedTokens ?? 0,
    updatedAt: Date.now()
  }
  saveLibrary()
  emit()
  queue.push({ kind: 'global', dramaId, episodeId: '', globalRange: range, autoCutCount })
  jobLog(
    'info',
    `加入队列：全局分析《${drama.title}》第 ${range.from}-${range.to} 集（完成后${autoCutCount > 0 ? `自动裂变 ${autoCutCount} 条引流切片` : '可随时秒出切片'}）`
  )
  void pump()
  return true
}

export function enqueueGenerateCut(dramaId: string, params: GenerateCutParams): boolean {
  if (!findDrama(dramaId)) return false
  const total = Math.max(1, Math.min(6, Math.round(params.count ?? 1)))
  const mode = params.mode ?? 'independent'

  // 「1 主体 × N 钩子」赛马矩阵模式：单次任务生成全部钩子变体并自动复用主干片段极速渲染
  if (mode === 'hook-matrix' && total > 1) {
    queue.push({
      kind: 'generate-cut',
      dramaId,
      episodeId: '',
      genParams: { ...params, count: total },
      variantIndex: 1,
      totalVariants: total
    })
    jobLog(
      'info',
      `加入队列：AI 黄金前 3 秒赛马矩阵（1 主体 × ${total} 钩子 · 主干缓存秒级复用）`
    )
    void pump()
    return true
  }

  for (let i = 1; i <= total; i++) {
    queue.push({
      kind: 'generate-cut',
      dramaId,
      episodeId: '',
      genParams: { ...params, count: 1 },
      variantIndex: i,
      totalVariants: total
    })
  }
  const styleName = getCutStyleMeta(params.style)?.name ?? '自由定调'
  const modeLabel =
    mode === 'viral-clone' ? '对标爆款 1:1 节拍复刻' : `「${styleName}」切片`
  jobLog('info', `加入队列：AI 大师编排${modeLabel} × ${total} 条（复用全剧缓存与两阶段因果检索）`)
  void pump()
  return true
}

export function enqueueRegenerateCut(
  dramaId: string,
  cutId: string,
  instruction: string,
  style?: CutStyle,
  targetSec?: number
): boolean {
  const drama = findDrama(dramaId)
  const cut = drama?.cuts?.find((c) => c.id === cutId)
  if (!drama || !cut) return false
  cut.status = 'rendering'
  cut.pct = 5
  cut.error = undefined
  saveLibrary()
  emit()
  queue.push({
    kind: 'generate-cut',
    dramaId,
    episodeId: '',
    cutId,
    regenInstruction: instruction,
    regenStyle: style,
    regenTargetSec: targetSec
  })
  jobLog('info', `加入队列：AI 大师重剪「${cut.title}」`)
  void pump()
  return true
}

export function enqueueRenderCut(dramaId: string, cutId: string): boolean {
  const drama = findDrama(dramaId)
  const cut = drama?.cuts?.find((c) => c.id === cutId)
  if (!drama || !cut) return false
  if (queue.some((j) => j.kind === 'render-cut' && j.cutId === cutId)) return false
  if (current && current.kind === 'render-cut' && current.cutId === cutId) return false
  cut.status = 'rendering'
  cut.pct = 0
  cut.error = undefined
  saveLibrary()
  emit()
  queue.push({ kind: 'render-cut', dramaId, episodeId: '', cutId })
  jobLog('info', `加入队列：渲染成片「${cut.title}」`)
  void pump()
  return true
}

export function enqueueReplica(dramaId: string, replicaId: string, recutOnly = false): boolean {
  const drama = findDrama(dramaId)
  const task = drama?.replicas?.find((r) => r.id === replicaId)
  if (!drama || !task) return false
  if (queue.some((j) => j.kind === 'replica' && j.replicaId === replicaId)) return false
  if (current && current.kind === 'replica' && current.replicaId === replicaId) return false
  task.status = 'queue'
  task.pct = 0
  task.error = undefined
  task.stageNote = undefined
  saveLibrary()
  emit()
  queue.push({ kind: 'replica', dramaId, episodeId: '', replicaId, replicaRecutOnly: recutOnly })
  jobLog('info', `加入队列：${recutOnly ? '重剪' : '爆款复刻'}「${task.clipTitle}」（${drama.title}）`)
  void pump()
  return true
}

export function enqueueNarration(
  dramaId: string,
  narrationId: string,
  mode: 'full' | 'revoice' = 'full',
  segmentId?: string,
  params?: GenerateNarrationParams
): boolean {
  const drama = findDrama(dramaId)
  const cut = drama?.narrations?.find((c) => c.id === narrationId)
  if (!drama || !cut) return false
  if (queue.some((j) => j.kind === 'narration' && j.narrationId === narrationId)) return false
  if (current && current.kind === 'narration' && current.narrationId === narrationId) return false
  cut.status = mode === 'full' ? 'generating' : 'voicing'
  cut.pct = 0
  cut.error = undefined
  saveLibrary()
  emit()
  queue.push({ kind: 'narration', dramaId, episodeId: '', narrationId, narrationMode: mode, segmentId, narrationParams: params })
  jobLog('info', `加入队列：${mode === 'full' ? 'AI 解说成片' : '解说重配'}「${cut.title || '新解说'}」（${drama.title}）`)
  void pump()
  return true
}

export function stopTasks(dramaId?: string): { cleared: number } {
  let cleared = 0
  for (let i = queue.length - 1; i >= 0; i--) {
    const j = queue[i]
    if (dramaId && j.dramaId !== dramaId) continue
    queue.splice(i, 1)
    cleared++
  }

  for (const d of getLibrary().dramas) {
    if (dramaId && d.id !== dramaId) continue
    if (d.global && (d.global.status === 'queue' || (d.global.status === 'run' && current?.dramaId === d.id))) {
      d.global.status = d.synthesis && d.global.map.length > 0 ? 'done' : 'idle'
      d.global.pct = undefined
      d.global.note = '已手动终止（已完成的分幕已保存，下次可断点续传）'
    }
    for (const cut of d.cuts ?? []) {
      if (cut.status === 'rendering') {
        cut.status = cut.output && fileExists(cut.output) ? 'ready' : 'fail'
        cut.pct = undefined
        cut.error = '已手动终止'
      }
    }
    for (const nc of d.narrations ?? []) {
      if (nc.status === 'generating' || nc.status === 'voicing') {
        nc.status = nc.segments.some((s) => s.status === 'ready') ? 'ready' : 'fail'
        nc.pct = undefined
        nc.error = '已手动终止'
      }
    }
    for (const rep of d.replicas ?? []) {
      if (rep.status === 'queue' || rep.status === 'indexing' || rep.status === 'tracing' || rep.status === 'cutting') {
        rep.status = rep.output && fileExists(rep.output) ? 'ready' : 'fail'
        rep.pct = 0
        rep.error = '已手动终止'
        rep.stageNote = undefined
      }
    }
  }

  if (current && (!dramaId || current.dramaId === dramaId)) {
    currentAbort?.abort()
    cleared++
  }

  if (cleared > 0) {
    jobLog('warn', `已手动终止 ${cleared} 个任务`)
    saveLibrary()
    emit()
  }
  return { cleared }
}

export function currentJob(): JobInfo | null {
  return current
}

export function runningCount(): number {
  return queue.length + (current ? 1 : 0)
}

export function repairMissingMedia(): void {
  let n = 0
  for (const { drama, ep } of allEpisodes()) {
    if (!fileExists(ep.file)) continue
    if (ep.duration === null) {
      enqueue('probe', drama.id, ep.id)
      n++
    }
    if (ep.thumb === null || !fileExists(ep.thumb)) {
      enqueue('thumb', drama.id, ep.id)
      n++
    }
    if (ep.shots === undefined) {
      enqueue('shots', drama.id, ep.id)
      n++
    }
  }
  if (n > 0) jobLog('info', `启动自检：补齐 ${n} 个缺失的媒体预处理任务`)
}

async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  while (queue.length > 0) {
    const job = queue.shift()!
    currentAbort = new AbortController()
    const signal = currentAbort.signal

    if (job.kind === 'global') {
      const drama = findDrama(job.dramaId)
      if (!drama || !job.globalRange) continue
      const label = `全局分析《${drama.title}》（第 ${job.globalRange.from}-${job.globalRange.to} 集）`
      current = { kind: 'global', dramaId: job.dramaId, episodeId: '', label, pct: 0 }
      if (drama.global) {
        drama.global.status = 'run'
        drama.global.pct = 0
        drama.global.note = undefined
      }
      saveLibrary()
      jobLog('info', `开始：${label}`)
      emit()
      try {
        const r = await runGlobalAnalysis(
          drama,
          getSettings().global,
          job.globalRange,
          (pct) => {
            if (current) current.pct = pct
            if (drama.global) drama.global.pct = pct
            emit()
          },
          (msg) => jobLog(/放弃|均失败/.test(msg) ? 'error' : /失败|跳过|警告|超限|偏差/.test(msg) ? 'warn' : 'info', msg),
          signal
        )
        for (const m of r.map) {
          const ep = drama.episodes.find((e) => e.id === m.epId)
          if (!ep) continue
          ep.candidates = r.candidates.get(m.epId) ?? []
          const se = r.script.episodes.find((x) => x.n === m.n)
          if (se?.summary) ep.summary = se.summary
          ep.cand = ep.candidates.length
          const segs = r.segments.get(m.epId)
          if (segs && segs.length > 0) {
            ep.segments = segs
            ep.asr = 'done'
            ep.asrPct = 100
          }
          ep.ana = 'done'
          ep.anaPct = 100
        }
        drama.synthesis = r.synthesis
        drama.global = {
          status: 'done',
          pct: 100,
          model: getSettings().global.model,
          acts: r.acts,
          map: r.map,
          tokens: r.tokens,
          cachedTokens: r.cachedTokens,
          updatedAt: Date.now()
        }
        saveLibrary()
        jobLog('info', `${label} 完成：${r.tokens} tokens（缓存命中 ${r.cachedTokens}）`)
        doneCount++

        const count = job.autoCutCount ?? 3
        if (count > 0 && !signal.aborted) {
          const presetStyles: { style: CutStyle; targetSec: number }[] = [
            { style: 'conflict', targetSec: 45 },
            { style: 'reversal', targetSec: 60 },
            { style: 'suspense', targetSec: 75 }
          ]
          for (let i = 0; i < count; i++) {
            const preset = presetStyles[i % presetStyles.length]
            enqueueGenerateCut(drama.id, { style: preset.style, targetSec: preset.targetSec, ratio: '9:16', count: 1 })
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (signal.aborted || msg === '已取消') {
          jobLog('warn', `${label} 已手动终止（已完成的分幕已缓存）`)
          if (drama.global) {
            drama.global.status = drama.synthesis && drama.global.map.length > 0 ? 'done' : 'idle'
            drama.global.pct = undefined
            drama.global.note = '已手动终止'
          }
        } else {
          failCount++
          jobLog('error', `${label} 失败：${msg}`)
          if (drama.global) {
            drama.global.status = 'fail'
            drama.global.pct = undefined
            drama.global.note = msg
          }
        }
        saveLibrary()
      }
      current = null
      currentAbort = null
      emit()
      continue
    }

    if (job.kind === 'generate-cut') {
      const drama = findDrama(job.dramaId)
      if (!drama) continue
      const isRegen = Boolean(job.cutId)
      const isMatrix = job.genParams?.mode === 'hook-matrix' && (job.totalVariants ?? 1) > 1
      const isClone = job.genParams?.mode === 'viral-clone'
      const batchSuffix =
        !isMatrix && (job.totalVariants ?? 1) > 1 ? `（第 ${job.variantIndex}/${job.totalVariants} 条）` : ''
      const label = isRegen
        ? `AI 重剪《${drama.title}》`
        : isMatrix
          ? `AI 赛马矩阵（1主体×${job.totalVariants}钩子）《${drama.title}》`
          : isClone
            ? `对标爆款 1:1 复刻《${drama.title}》${batchSuffix}`
            : `AI 编排引流成片《${drama.title}》${batchSuffix}`
      current = { kind: 'generate-cut', dramaId: job.dramaId, episodeId: '', cutId: job.cutId, label, pct: 20 }
      jobLog('info', `开始：${label}`)
      emit()
      try {
        const cfg = getEffectiveTextModel()
        const globalCfg = getSettings().global
        if (isRegen && job.cutId) {
          const idx = (drama.cuts ?? []).findIndex((c) => c.id === job.cutId)
          if (idx < 0) throw new Error('待重剪的切片方案不存在')
          const existing = drama.cuts![idx]
          const { cut, tokens } = await regeneratePromoCut(
            drama,
            existing,
            job.regenInstruction ?? '',
            cfg,
            job.regenStyle,
            job.regenTargetSec,
            signal
          )
          drama.cuts![idx] = cut
          saveLibrary()
          jobLog('info', `AI 重剪完成：「${cut.title}」v${cut.revision}（${cut.actualSec}s · ${tokens} tokens），开始自动渲染`)
          if (!signal.aborted) enqueueRenderCut(drama.id, cut.id)
        } else if (job.genParams && isMatrix) {
          const { cuts, tokens } = await generateHookMatrixCuts(
            drama,
            job.genParams,
            cfg,
            job.totalVariants ?? 3,
            signal
          )
          drama.cuts = [...cuts, ...(drama.cuts ?? [])]
          saveLibrary()
          jobLog(
            'info',
            `AI 赛马矩阵编排完成：一次性产出 ${cuts.length} 条钩子变体（${tokens} tokens），开始共享主干极速渲染`
          )
          if (!signal.aborted) {
            for (const c of cuts) enqueueRenderCut(drama.id, c.id)
          }
        } else if (job.genParams) {
          let benchmark: { beats: import('../../src/shared/types').ViralBeat[]; hookPattern: string; pacingNote: string } | undefined
          if (job.genParams.mode === 'viral-clone' && (job.genParams.refVideoPath || job.genParams.refCopy)) {
            const bm = await analyzeViralBenchmark(
              job.genParams.refVideoPath,
              job.genParams.refCopy,
              globalCfg,
              cfg,
              (msg) => jobLog('info', msg),
              signal
            )
            benchmark = { beats: bm.beats, hookPattern: bm.hookPattern, pacingNote: bm.pacingNote }
          }
          const { cut, tokens } = await generatePromoCut(
            drama,
            job.genParams,
            cfg,
            job.variantIndex ?? 1,
            job.totalVariants ?? 1,
            signal,
            benchmark
          )
          drama.cuts = [cut, ...(drama.cuts ?? [])]
          saveLibrary()
          jobLog('info', `AI 编排完成：「${cut.title}」（${cut.actualSec}s · ${tokens} tokens），开始自动渲染`)
          if (!signal.aborted) enqueueRenderCut(drama.id, cut.id)
        }
        doneCount++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (signal.aborted || msg === '已取消') {
          jobLog('warn', `${label} 已手动终止`)
        } else {
          failCount++
          jobLog('error', `${label} 失败：${msg}`)
        }
        if (isRegen && job.cutId) {
          const cut = drama.cuts?.find((c) => c.id === job.cutId)
          if (cut) {
            cut.status = cut.output && fileExists(cut.output) ? 'ready' : 'fail'
            cut.pct = undefined
            cut.error = signal.aborted ? '已手动终止' : msg
            saveLibrary()
          }
        }
      }
      current = null
      currentAbort = null
      emit()
      continue
    }

    if (job.kind === 'render-cut') {
      const drama = findDrama(job.dramaId)
      const cut = drama?.cuts?.find((c) => c.id === job.cutId)
      if (!drama || !cut) continue
      const label = `渲染成片「${cut.title}」`
      current = { kind: 'render-cut', dramaId: job.dramaId, episodeId: '', cutId: cut.id, label, pct: 0 }
      cut.status = 'rendering'
      cut.pct = 0
      cut.error = undefined
      saveLibrary()
      jobLog('info', `开始：${label}`)
      emit()
      try {
        const oldOutput = cut.output
        const oldSrt = cut.srtPath
        const { output, srtPath } = await renderPromoCut(
          drama,
          cut,
          (pct) => {
            cut.pct = pct
            if (current) current.pct = pct
            emit()
          },
          (msg) => jobLog('info', msg),
          signal
        )
        if (oldOutput && oldOutput !== output) cleanupCutFiles(oldOutput, oldSrt && oldSrt !== srtPath ? oldSrt : undefined)
        else if (oldSrt && oldSrt !== srtPath) fs.rmSync(oldSrt, { force: true })
        cut.status = 'ready'
        cut.pct = 100
        cut.output = output
        cut.srtPath = srtPath
        cut.error = undefined
        cut.updatedAt = Date.now()
        saveLibrary()
        doneCount++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        cut.status = cut.output && fileExists(cut.output) ? 'ready' : 'fail'
        cut.pct = undefined
        cut.error = signal.aborted || msg === '已取消' ? '已手动终止' : msg
        saveLibrary()
        if (signal.aborted || msg === '已取消') {
          jobLog('warn', `${label} 已手动终止`)
        } else {
          failCount++
          jobLog('error', `${label} 失败：${msg}`)
        }
      }
      current = null
      currentAbort = null
      emit()
      continue
    }

    if (job.kind === 'replica') {
      const drama = findDrama(job.dramaId)
      const task = drama?.replicas?.find((r) => r.id === job.replicaId)
      if (!drama || !task) continue
      const label = `${job.replicaRecutOnly ? '重剪' : '爆款复刻'}「${task.clipTitle}」`
      current = { kind: 'replica', dramaId: job.dramaId, episodeId: '', replicaId: task.id, label, pct: 0 }
      task.status = 'indexing'
      task.pct = 0
      task.error = undefined
      saveLibrary()
      jobLog('info', `开始：${label}`)
      emit()
      try {
        await runReplicaTask(
          drama,
          task,
          { recutOnly: job.replicaRecutOnly },
          (pct, stage, note) => {
            task.pct = pct
            task.status = stage
            if (note) task.stageNote = note
            if (current) current.pct = pct
            saveLibrary()
            emit()
          },
          (msg) => jobLog('info', msg),
          signal
        )
        task.status = 'ready'
        task.pct = 100
        task.stageNote = undefined
        task.error = undefined
        task.updatedAt = Date.now()
        saveLibrary()
        doneCount++
        jobLog('info', `${label} 完成：${task.stats?.segments ?? 0} 段 / ${task.stats?.totalSeconds ?? 0}s`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        task.status = task.output && fileExists(task.output) ? 'ready' : 'fail'
        task.pct = 0
        task.stageNote = undefined
        task.error = signal.aborted || msg === '已取消' ? '已手动终止' : msg
        task.updatedAt = Date.now()
        saveLibrary()
        if (signal.aborted || msg === '已取消') {
          jobLog('warn', `${label} 已手动终止`)
        } else {
          failCount++
          jobLog('error', `${label} 失败：${msg}`)
        }
      }
      current = null
      currentAbort = null
      emit()
      continue
    }

    if (job.kind === 'narration') {
      const drama = findDrama(job.dramaId)
      const cut = drama?.narrations?.find((c) => c.id === job.narrationId)
      if (!drama || !cut) continue
      const isRevoice = job.narrationMode === 'revoice'
      const label = isRevoice ? `解说重配「${cut.title}」` : `AI 解说成片《${drama.title}》`
      current = { kind: 'narration', dramaId: job.dramaId, episodeId: '', narrationId: cut.id, label, pct: 0 }
      cut.status = isRevoice ? 'voicing' : 'generating'
      cut.pct = 0
      cut.error = undefined
      saveLibrary()
      jobLog('info', `开始：${label}`)
      emit()
      try {
        const ttsCfg = getTtsSettings()
        if (!isRevoice) {
          const cfg = getEffectiveTextModel()
          const params = job.narrationParams ?? { targetSec: cut.targetSec }
          const r = await generateNarrationScript(drama, params, cfg, signal)
          cut.title = r.title
          cut.hookHeadline = r.hookHeadline
          cut.publishCopy = r.publishCopy
          cut.segments = r.segments
          cut.tokens = r.tokens
          cut.status = 'voicing'
          cut.pct = 5
          saveLibrary()
          jobLog('info', `解说稿生成完成：「${r.title}」${r.segments.length} 段（${r.tokens} tokens），开始逐段配音`)
          emit()
        }
        await voiceNarrationSegments(
          drama.id,
          cut,
          ttsCfg,
          (pct) => {
            cut.pct = isRevoice ? pct : 5 + Math.round(pct * 0.95)
            if (current) current.pct = cut.pct
            saveLibrary()
            emit()
          },
          (msg) => jobLog('info', msg),
          signal,
          isRevoice ? job.segmentId : undefined
        )
        cut.status = cut.segments.some((s) => s.status === 'ready') ? 'ready' : 'fail'
        cut.pct = 100
        cut.error = cut.status === 'fail' ? '所有解说段配音失败' : undefined
        cut.updatedAt = Date.now()
        saveLibrary()
        doneCount++
        jobLog('info', `${label} 完成：${cut.segments.filter((s) => s.status === 'ready').length}/${cut.segments.length} 段配音 · ${cut.totalAudioSec ?? 0}s`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        cut.status = cut.segments.some((s) => s.status === 'ready') ? 'ready' : 'fail'
        cut.pct = undefined
        cut.error = signal.aborted || msg === '已取消' ? '已手动终止' : msg
        cut.updatedAt = Date.now()
        saveLibrary()
        if (signal.aborted || msg === '已取消') {
          jobLog('warn', `${label} 已手动终止`)
        } else {
          failCount++
          jobLog('error', `${label} 失败：${msg}`)
        }
      }
      current = null
      currentAbort = null
      emit()
      continue
    }

    const found = findEpisode(job.dramaId, job.episodeId)
    if (!found) continue
    const { ep } = found
    const label = labelOf(job.kind, ep.n)
    current = { kind: job.kind, dramaId: job.dramaId, episodeId: job.episodeId, label, pct: 0 }
    jobLog('info', `开始：${label}`)
    emit()
    try {
      if (job.kind === 'probe') {
        const info = await probe(ep.file)
        ep.duration = info.duration
        ep.width = info.width
        ep.height = info.height
        saveLibrary()
      } else if (job.kind === 'thumb') {
        const out = path.join(cacheDir(), 'thumbs', `${ep.id}.jpg`)
        fs.mkdirSync(path.dirname(out), { recursive: true })
        await makeThumb(ep.file, out, ep.duration ?? 10)
        ep.thumb = out
        saveLibrary()
      } else if (job.kind === 'shots') {
        ep.shots = await detectShots(ep.file)
        saveLibrary()
      }
      doneCount++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!signal.aborted && msg !== '已取消') {
        failCount++
        jobLog('error', `${label} 失败：${msg}`)
      }
    }
    current = null
    currentAbort = null
    emit()
  }
  pumping = false
}
