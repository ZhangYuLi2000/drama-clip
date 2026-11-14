import { BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import type { JobInfo, JobKind, JobLogEntry, JobLogState, RenderParams } from '../../src/shared/types'
import { analyzeVideo } from './analyze'
import { transcribe } from './bcut'
import { cacheDir, allEpisodes, findDrama, findEpisode, saveLibrary } from './db'
import { runGlobalAnalysis, type GlobalRange } from './global'
import { extractAudio, fileExists, makeThumb, probe, detectShots, sliceClip } from './media'
import { getSettings } from './settings'
import { buildSynthesis } from './synthesis'
import { renderMix, setRenderState } from './render'

interface Job {
  kind: JobKind
  dramaId: string
  episodeId: string
  candId?: string
  payload?: RenderParams
  globalRange?: GlobalRange
}

const queue: Job[] = []
let current: JobInfo | null = null
let currentCandId: string | undefined
let currentAbort: AbortController | null = null
let stopRequested = false
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

function labelOf(kind: JobKind, n: number, candTitle?: string): string {
  if (kind === 'probe') return `读取第 ${n} 集元数据`
  if (kind === 'thumb') return `生成第 ${n} 集缩略图`
  if (kind === 'shots') return `检测第 ${n} 集镜头边界`
  if (kind === 'analyze') return `视频理解第 ${n} 集（B 路）`
  if (kind === 'slice') return `切片高光「${candTitle ?? ''}」（第 ${n} 集）`
  if (kind === 'synthesis') return '全剧统筹'
  if (kind === 'global') return '全局分析'
  if (kind === 'render') return '渲染混剪'
  return `转写第 ${n} 集（bcut）`
}

export function enqueue(kind: JobKind, dramaId: string, episodeId: string, candId?: string): void {
  if (queue.some((j) => j.kind === kind && j.dramaId === dramaId && j.episodeId === episodeId && j.candId === candId)) return
  if (current && current.kind === kind && current.dramaId === dramaId && current.episodeId === episodeId && currentCandId === candId) return
  queue.push({ kind, dramaId, episodeId, candId })
  const found = findEpisode(dramaId, episodeId)
  const candTitle = candId ? found?.ep.candidates?.find((c) => c.id === candId)?.title : undefined
  jobLog('info', `加入队列：${labelOf(kind, found?.ep.n ?? 0, candTitle)}（等待 ${queue.length} 个）`)
  void pump()
}

export function enqueueAsr(dramaId: string, episodeId: string): boolean {
  const found = findEpisode(dramaId, episodeId)
  if (!found) return false
  const { ep } = found
  if (ep.asr === 'queue' || ep.asr === 'run') return false
  ep.asr = 'queue'
  ep.asrPct = 0
  ep.asrNote = undefined
  saveLibrary()
  emit()
  enqueue('asr', dramaId, episodeId)
  return true
}

export function enqueueAnalyze(dramaId: string, episodeId: string): boolean {
  const found = findEpisode(dramaId, episodeId)
  if (!found) return false
  const { ep } = found
  if (ep.ana === 'queue' || ep.ana === 'run') return false
  ep.ana = 'queue'
  ep.anaPct = 0
  ep.anaNote = undefined
  // bcut 已下线，遗留的转写失败态在重新分析时清掉，避免旧报错误导
  if (ep.asr === 'fail') {
    ep.asr = 'idle'
    ep.asrNote = undefined
  }
  saveLibrary()
  emit()
  enqueue('analyze', dramaId, episodeId)
  return true
}

export function enqueueSynthesis(dramaId: string): boolean {
  const drama = findDrama(dramaId)
  if (!drama) return false
  if (queue.some((j) => j.kind === 'synthesis' && j.dramaId === dramaId)) return false
  if (current && current.kind === 'synthesis' && current.dramaId === dramaId) return false
  enqueue('synthesis', dramaId, '')
  return true
}

export function enqueueGlobal(dramaId: string, range: GlobalRange): boolean {
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
  queue.push({ kind: 'global', dramaId, episodeId: '', globalRange: range })
  jobLog('info', `加入队列：全局分析《${drama.title}》第 ${range.from}-${range.to} 集（等待 ${queue.length} 个）`)
  void pump()
  return true
}

export function enqueueRender(dramaId: string, payload: RenderParams): boolean {
  if (!findDrama(dramaId)) return false
  if (queue.some((j) => j.kind === 'render')) return false
  if (current && current.kind === 'render') return false
  setRenderState({ status: 'running', pct: 0, output: '', error: '' })
  queue.push({ kind: 'render', dramaId, episodeId: '', payload })
  jobLog('info', `加入队列：渲染混剪（等待 ${queue.length} 个）`)
  void pump()
  return true
}

export function currentJob(): JobInfo | null {
  return current
}

export function stopAnalyze(): { cleared: number } {
  let cleared = 0
  for (let i = queue.length - 1; i >= 0; i--) {
    const j = queue[i]
    if (j.kind !== 'analyze') continue
    const found = findEpisode(j.dramaId, j.episodeId)
    if (found && found.ep.ana === 'queue') {
      found.ep.ana = 'idle'
      found.ep.anaPct = undefined
    }
    queue.splice(i, 1)
    cleared++
  }
  if (current && current.kind === 'analyze') {
    stopRequested = true
    currentAbort?.abort()
    cleared++
  }
  if (cleared > 0) {
    jobLog('info', `停止分析：取消 ${cleared} 个任务`)
    saveLibrary()
    emit()
  }
  return { cleared }
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
    for (const c of ep.candidates ?? []) {
      if (c.status !== 'approved') continue
      if (!c.clip || !fileExists(c.clip) || !c.clipThumb || !fileExists(c.clipThumb)) {
        enqueue('slice', drama.id, ep.id, c.id)
        n++
      }
    }
  }
  if (n > 0) jobLog('info', `启动自检：补齐 ${n} 个缺失的媒体处理任务`)
}

async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  while (queue.length > 0) {
    const job = queue.shift()!
    if (job.kind === 'synthesis') {
      const drama = findDrama(job.dramaId)
      if (!drama) continue
      const label = `全剧统筹《${drama.title}》`
      current = { kind: 'synthesis', dramaId: job.dramaId, episodeId: '', label, pct: 0 }
      currentCandId = undefined
      jobLog('info', `开始：${label}`)
      emit()
      try {
        const { synthesis, tokens } = await buildSynthesis(
          drama,
          getSettings().text,
          (pct) => {
            if (current) current.pct = pct
            emit()
          },
          (msg) => jobLog('info', msg)
        )
        drama.synthesis = synthesis
        saveLibrary()
        jobLog('info', `全剧统筹完成：人物 ${synthesis.characters.length} 个 · ${tokens} tokens`)
        doneCount++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        failCount++
        jobLog('error', `${label} 失败：${msg}`)
      }
      current = null
      emit()
      continue
    }
    if (job.kind === 'global') {
      const drama = findDrama(job.dramaId)
      if (!drama || !job.globalRange) continue
      const label = `全局分析《${drama.title}》（第 ${job.globalRange.from}-${job.globalRange.to} 集）`
      current = { kind: 'global', dramaId: job.dramaId, episodeId: '', label, pct: 0 }
      currentCandId = undefined
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
          (msg) => jobLog(/放弃|均失败/.test(msg) ? 'error' : /失败|跳过|警告|超限|偏差/.test(msg) ? 'warn' : 'info', msg)
        )
        let hlTotal = 0
        for (const m of r.map) {
          const ep = drama.episodes.find((e) => e.id === m.epId)
          if (!ep) continue
          for (const old of ep.candidates ?? []) {
            if (old.clip) fs.rmSync(old.clip, { force: true })
            if (old.clipThumb) fs.rmSync(old.clipThumb, { force: true })
          }
          ep.candidates = r.candidates.get(m.epId) ?? []
          const se = r.script.episodes.find((x) => x.n === m.n)
          if (se?.summary) ep.summary = se.summary
          ep.cand = ep.candidates.length
          ep.pending = ep.candidates.filter((c) => c.status === 'pending').length
          ep.hl = ep.candidates.filter((c) => c.status === 'approved').length
          hlTotal += ep.cand
          const segs = r.segments.get(m.epId)
          if (segs && segs.length > 0 && !(ep.segments && ep.segments.length > 0)) {
            ep.segments = segs
            ep.asr = 'done'
            ep.asrPct = 100
            ep.asrNote = '全局模型转写'
          }
          ep.ana = 'done'
          ep.anaPct = 100
          ep.anaNote = '全局分析'
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
        jobLog(
          'info',
          `${label} 完成：高光 ${hlTotal} 条 · 人物 ${r.synthesis.characters.length} 个 · ${r.tokens} tokens（缓存命中 ${r.cachedTokens}）`
        )
        doneCount++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        failCount++
        jobLog('error', `${label} 失败：${msg}`)
        if (drama.global) {
          drama.global.status = 'fail'
          drama.global.pct = undefined
          drama.global.note = msg
        }
        saveLibrary()
      }
      current = null
      emit()
      continue
    }
    if (job.kind === 'render') {
      const drama = findDrama(job.dramaId)
      if (!drama || !job.payload) continue
      const label = `渲染混剪《${drama.title}》`
      current = { kind: 'render', dramaId: job.dramaId, episodeId: '', label, pct: 0 }
      currentCandId = undefined
      setRenderState({ status: 'running', pct: 0, output: '', error: '' })
      jobLog('info', `开始：${label}`)
      emit()
      try {
        const output = await renderMix(
          drama,
          job.payload,
          (pct) => {
            if (current) current.pct = pct
            setRenderState({ pct })
            emit()
          },
          (msg) => jobLog('info', msg)
        )
        setRenderState({ status: 'done', pct: 100, output })
        jobLog('info', `${label} 完成：${output}`)
        doneCount++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setRenderState({ status: 'fail', error: msg })
        failCount++
        jobLog('error', `${label} 失败：${msg}`)
      }
      current = null
      emit()
      continue
    }
    const found = findEpisode(job.dramaId, job.episodeId)
    if (!found) continue
    const { ep } = found
    if (job.kind === 'slice') {
      const c = ep.candidates?.find((x) => x.id === job.candId)
      if (!c || c.status !== 'approved') continue
    }
    const label = labelOf(job.kind, ep.n, ep.candidates?.find((x) => x.id === job.candId)?.title)
    current = { kind: job.kind, dramaId: job.dramaId, episodeId: job.episodeId, label, pct: 0 }
    currentCandId = job.candId
    currentAbort = new AbortController()
    jobLog('info', `开始：${label}`)
    emit()
    try {
      if (job.kind === 'probe') {
        const info = await probe(ep.file)
        ep.duration = info.duration
        ep.width = info.width
        ep.height = info.height
        if (ep.asrNote?.startsWith('媒体处理失败')) ep.asrNote = undefined
        saveLibrary()
        jobLog('info', `第 ${ep.n} 集元数据：${info.duration.toFixed(1)}s · ${info.width ?? '?'}x${info.height ?? '?'}`)
      } else if (job.kind === 'thumb') {
        const out = path.join(cacheDir(), 'thumbs', `${ep.id}.jpg`)
        fs.mkdirSync(path.dirname(out), { recursive: true })
        await makeThumb(ep.file, out, ep.duration ?? 10)
        ep.thumb = out
        if (ep.asrNote?.startsWith('媒体处理失败')) ep.asrNote = undefined
        saveLibrary()
        jobLog('info', `第 ${ep.n} 集缩略图已生成`)
      } else if (job.kind === 'shots') {
        ep.shots = await detectShots(ep.file)
        if (ep.asrNote?.startsWith('媒体处理失败')) ep.asrNote = undefined
        saveLibrary()
        jobLog('info', `第 ${ep.n} 集镜头边界：${ep.shots.length} 个`)
      } else if (job.kind === 'slice') {
        const c = ep.candidates!.find((x) => x.id === job.candId)!
        if (!fileExists(ep.file)) throw new Error('视频文件不存在，可能已被移动或删除')
        if (current) current.pct = 10
        emit()
        const dir = path.join(cacheDir(), 'clips')
        fs.mkdirSync(dir, { recursive: true })
        const out = path.join(dir, `${ep.id}-${c.id}.mp4`)
        await sliceClip(ep.file, c.in, c.out, out)
        c.clip = out
        if (current) current.pct = 70
        emit()
        const thumb = path.join(dir, `${ep.id}-${c.id}.jpg`)
        await makeThumb(out, thumb, c.out - c.in)
        c.clipThumb = thumb
        saveLibrary()
        jobLog('info', `高光切片完成：「${c.title}」 ${(c.out - c.in).toFixed(1)}s`)
      } else if (job.kind === 'asr') {
        ep.asr = 'run'
        ep.asrPct = 2
        saveLibrary()
        emit()
        const wav = path.join(cacheDir(), 'audio', `${ep.id}.mp3`)
        fs.mkdirSync(path.dirname(wav), { recursive: true })
        try {
          await extractAudio(ep.file, wav)
          jobLog('info', `第 ${ep.n} 集音频已提取，提交 bcut…`)
          const segments = await transcribe(wav, (pct) => {
            ep.asrPct = pct
            if (current) current.pct = pct
            emit()
          })
          ep.segments = segments
          ep.asr = 'done'
          ep.asrPct = 100
          ep.asrNote = undefined
          jobLog('info', `第 ${ep.n} 集 bcut 转写完成：${segments.length} 句`)
        } finally {
          fs.rmSync(wav, { force: true })
        }
        saveLibrary()
      } else {
        ep.ana = 'run'
        ep.anaPct = 2
        saveLibrary()
        emit()
        const { candidates, segments, summary, tokens } = await analyzeVideo(
          ep,
          getSettings().video,
          (pct) => {
            ep.anaPct = pct
            if (current) current.pct = pct
            emit()
          },
          (msg) => jobLog('info', msg),
          found.drama.synthesis?.characters,
          currentAbort.signal
        )
        for (const old of ep.candidates ?? []) {
          if (old.clip) fs.rmSync(old.clip, { force: true })
          if (old.clipThumb) fs.rmSync(old.clipThumb, { force: true })
        }
        ep.candidates = candidates
        ep.summary = summary || ep.summary
        ep.cand = candidates.length
        ep.pending = candidates.filter((c) => c.status === 'pending').length
        ep.hl = candidates.filter((c) => c.status === 'approved').length
        if (segments.length > 0 && !(ep.segments && ep.segments.length > 0)) {
          ep.segments = segments
          ep.asr = 'done'
          ep.asrPct = 100
          ep.asrNote = '模型转写 · 时间戳精度低于专业 ASR'
        } else if (ep.asr === 'fail') {
          ep.asr = 'idle'
          ep.asrNote = undefined
        }
        ep.ana = 'done'
        ep.anaPct = 100
        ep.anaNote = tokens > 0 ? `消耗 ${tokens} tokens` : undefined
        saveLibrary()
        jobLog('info', `第 ${ep.n} 集视频理解完成：候选 ${candidates.length} 条 · 转写 ${segments.length} 句 · ${tokens} tokens`)
      }
      doneCount++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (stopRequested) {
        stopRequested = false
        if (job.kind === 'analyze') {
          ep.ana = 'idle'
          ep.anaPct = undefined
          ep.anaNote = undefined
        }
        jobLog('info', `${label} 已停止`)
        saveLibrary()
      } else {
        failCount++
        jobLog('error', `${label} 失败：${msg}`)
        if (job.kind === 'asr') {
          ep.asr = 'fail'
          ep.asrPct = undefined
          ep.asrNote = msg
        } else if (job.kind === 'analyze') {
          ep.ana = 'fail'
          ep.anaPct = undefined
          ep.anaNote = msg
        } else if (job.kind !== 'slice') {
          ep.asrNote = `媒体处理失败：${msg}`
        }
        saveLibrary()
      }
    }
    current = null
    currentCandId = undefined
    currentAbort = null
    emit()
  }
  pumping = false
}