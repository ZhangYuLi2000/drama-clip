import { BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import type {
  AiSettingsPatch,
  ApiResult,
  CreateReplicaParams,
  CutStyle,
  CutStyleConfig,
  Drama,
  Episode,
  GenerateCutParams,
  GenerateNarrationParams,
  ModelCfg,
  NarrationCut,
  ReplicaSettings,
  ReplicaTask,
  ScanFile,
  ScanResult,
  TtsCfg
} from '../../src/shared/types'
import { findDrama, getLibrary, saveLibrary } from './db'
import { globalDir, readGlobalScript } from './global'
import {
  broadcastLibrary,
  clearJobLogs,
  currentJob,
  enqueue,
  enqueueGenerateCut,
  enqueueGlobal,
  enqueueNarration,
  enqueueRegenerateCut,
  enqueueReplica,
  enqueueRenderCut,
  getJobLogState,
  runningCount,
  stopTasks
} from './jobs'
import { fileExists } from './media'
import { readReplicaEdl } from './replica-engine'
import { cleanupCutFiles, syncCutCopyFiles } from './render'
import { narrationDir } from './narration'
import { getSettings, getTtsSettings, saveSettings } from './settings'

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.flv', '.ts', '.m4v', '.wmv', '.webm'])

export function parseEpisodeN(name: string): number | null {
  const base = name.replace(/\.[^.]+$/, '')
  const patterns = [
    /第\s*(\d{1,4})\s*[集话話期]/,
    /(?:^|[\s._\-[])(?:EP|E|EPISODE)\s*(\d{1,4})(?:[\s._\-\]]|$)/i,
    /^(\d{1,4})$/,
    /(\d{1,4})\s*$/,
    /(\d{1,4})/
  ]
  for (const re of patterns) {
    const m = base.match(re)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > 0 && n < 10000) return n
    }
  }
  return null
}

function scanDir(dir: string): ApiResult<ScanResult> {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return { ok: false, error: '目录不存在或无法读取' }
  }
  const files: ScanFile[] = []
  for (const ent of entries) {
    if (!ent.isFile()) continue
    const ext = path.extname(ent.name).toLowerCase()
    if (!VIDEO_EXTS.has(ext)) continue
    const file = path.join(dir, ent.name)
    let size = 0
    try {
      size = fs.statSync(file).size
    } catch {
      continue
    }
    files.push({ file, fileName: ent.name, size, n: parseEpisodeN(ent.name) })
  }
  files.sort((a, b) => (a.n ?? 1e9) - (b.n ?? 1e9) || a.fileName.localeCompare(b.fileName, 'zh-CN'))
  return {
    ok: true,
    data: {
      dir,
      title: path.basename(dir),
      files,
      matched: files.filter((f) => f.n !== null).length,
      unmatched: files.filter((f) => f.n === null).length,
      totalSize: files.reduce((n, f) => n + f.size, 0)
    }
  }
}

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data }
}

function fail(error: string): ApiResult<never> {
  return { ok: false, error }
}

function newEpisode(file: ScanFile, n: number): Episode {
  return {
    id: `ep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    n,
    file: file.file,
    fileName: file.fileName,
    size: file.size,
    duration: null,
    width: null,
    height: null,
    thumb: null,
    asr: 'idle',
    ana: 'idle',
    cand: 0,
    pending: 0,
    hl: 0
  }
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.wmv': 'video/x-ms-wmv',
  '.jpg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
}

export function registerMediaProtocol(): void {
  protocol.handle('dw-media', (request) => {
    let filePath: string
    try {
      const rawPath = decodeURIComponent(new URL(request.url).pathname)
      filePath = rawPath.replace(/^\/+/, process.platform === 'win32' ? '' : '/')
    } catch {
      return new Response('bad path', { status: 400 })
    }
    const norm = path.normalize(filePath)
    const allowed = getLibrary().dramas.some(
      (d) =>
        (d.cuts ?? []).some((c) => c.output && path.normalize(c.output) === norm) ||
        (d.narrations ?? []).some(
          (nc) =>
            (nc.output && path.normalize(nc.output) === norm) ||
            (nc.fullAudio && path.normalize(nc.fullAudio) === norm) ||
            nc.segments.some((s) => s.audioFile && path.normalize(s.audioFile) === norm)
        ) ||
        (d.replicas ?? []).some(
          (r) =>
            (r.output && path.normalize(r.output) === norm) || path.normalize(r.clipFile) === norm
        ) ||
        d.episodes.some(
          (ep) =>
            path.normalize(ep.file) === norm ||
            (ep.thumb !== null && path.normalize(ep.thumb) === norm)
        )
    )
    if (!allowed) return new Response('not found', { status: 404 })
    let stat: fs.Stats
    try {
      stat = fs.statSync(filePath)
    } catch {
      return new Response('not found', { status: 404 })
    }
    const type = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    const range = request.headers.get('range')
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      if (m) {
        let start = m[1] ? parseInt(m[1], 10) : 0
        let end = m[2] ? parseInt(m[2], 10) : stat.size - 1
        if (!m[1] && m[2]) {
          start = Math.max(0, stat.size - parseInt(m[2], 10))
          end = stat.size - 1
        }
        end = Math.min(end, stat.size - 1)
        if (start >= stat.size || start > end) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
        }
        const stream = fs.createReadStream(filePath, { start, end })
        return new Response(stream as unknown as ReadableStream, {
          status: 206,
          headers: {
            'Content-Type': type,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes'
          }
        })
      }
    }
    const stream = fs.createReadStream(filePath)
    return new Response(stream as unknown as ReadableStream, {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Length': String(stat.size), 'Accept-Ranges': 'bytes' }
    })
  })
}

export function registerIpc(): void {
  ipcMain.handle('library:get', () => ok(getLibrary()))
  ipcMain.handle('library:job', () => ok(currentJob()))
  ipcMain.handle('library:running', () => ok(runningCount()))
  ipcMain.handle('library:logs', () => ok(getJobLogState()))

  ipcMain.handle('library:logs-clear', () => {
    clearJobLogs()
    return ok(null)
  })

  ipcMain.handle('select-reference-video', async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const picked = await dialog.showOpenDialog(parent, {
      title: '选择对标爆款参考视频',
      properties: ['openFile'],
      filters: [{ name: '视频文件', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return ok('')
    return ok(picked.filePaths[0])
  })

  ipcMain.handle('library:scan', (_e, dir: unknown) => {
    if (typeof dir !== 'string' || !dir.trim()) return fail('请先选择素材目录')
    return scanDir(path.resolve(dir.trim()))
  })

  ipcMain.handle('library:import', (_e, payload: unknown) => {
    const { dir, title, autoStart } = (payload ?? {}) as { dir?: string; title?: string; autoStart?: boolean }
    if (typeof dir !== 'string' || !dir.trim()) return fail('请先选择素材目录')
    const cleanTitle = typeof title === 'string' && title.trim() ? title.trim() : path.basename(dir)
    const scan = scanDir(path.resolve(dir.trim()))
    if (!scan.ok) return scan
    const matched = scan.data.files.filter((f) => f.n !== null)
    if (matched.length === 0) return fail('没有识别到可导入的剧集文件（文件名需包含集数，如「第3集.mp4」）')
    if (getLibrary().dramas.some((d) => path.normalize(d.dir) === path.normalize(scan.data.dir))) {
      return fail('该目录已导入，可在项目列表使用「重新扫描」同步新集')
    }
    const seen = new Set<number>()
    const episodes: Episode[] = []
    for (const f of matched) {
      if (seen.has(f.n!)) continue
      seen.add(f.n!)
      episodes.push(newEpisode(f, f.n!))
    }
    episodes.sort((a, b) => a.n - b.n)
    const drama: Drama = {
      id: `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title: cleanTitle,
      dir: scan.data.dir,
      createdAt: Date.now(),
      episodes,
      cuts: []
    }
    getLibrary().dramas.push(drama)
    saveLibrary()
    for (const ep of episodes) enqueue('probe', drama.id, ep.id)
    for (const ep of episodes) enqueue('thumb', drama.id, ep.id)
    for (const ep of episodes) enqueue('shots', drama.id, ep.id)
    if (autoStart) {
      enqueueGlobal(drama.id, { from: episodes[0].n, to: episodes[episodes.length - 1].n }, 3)
    }
    broadcastLibrary()
    return ok({ dramaId: drama.id, count: episodes.length })
  })

  ipcMain.handle('library:remove', (_e, dramaId: unknown) => {
    if (typeof dramaId !== 'string') return fail('参数错误')
    const lib = getLibrary()
    const idx = lib.dramas.findIndex((d) => d.id === dramaId)
    if (idx < 0) return fail('短剧不存在')
    const target = lib.dramas[idx]
    for (const cut of target.cuts ?? []) {
      cleanupCutFiles(cut.output, cut.srtPath)
    }
    for (const nc of target.narrations ?? []) {
      cleanupCutFiles(nc.output, nc.srtPath)
      fs.rmSync(narrationDir(dramaId, nc.id), { recursive: true, force: true })
    }
    for (const ep of target.episodes) {
      if (ep.thumb) fs.rmSync(ep.thumb, { force: true })
    }
    fs.rmSync(globalDir(dramaId), { recursive: true, force: true })
    lib.dramas.splice(idx, 1)
    saveLibrary()
    broadcastLibrary()
    return ok(null)
  })

  ipcMain.handle('library:rescan', (_e, dramaId: unknown) => {
    if (typeof dramaId !== 'string') return fail('参数错误')
    const drama = findDrama(dramaId)
    if (!drama) return fail('短剧不存在')
    const scan = scanDir(drama.dir)
    if (!scan.ok) return scan
    const known = new Set(drama.episodes.map((e) => path.normalize(e.file)))
    const used = new Set(drama.episodes.map((e) => e.n))
    const added: Episode[] = []
    for (const f of scan.data.files) {
      if (f.n === null || known.has(path.normalize(f.file)) || used.has(f.n)) continue
      used.add(f.n)
      const ep = newEpisode(f, f.n)
      drama.episodes.push(ep)
      added.push(ep)
    }
    drama.episodes.sort((a, b) => a.n - b.n)
    saveLibrary()
    for (const ep of added) enqueue('probe', drama.id, ep.id)
    for (const ep of added) enqueue('thumb', drama.id, ep.id)
    for (const ep of added) enqueue('shots', drama.id, ep.id)
    broadcastLibrary()
    return ok({ added: added.length })
  })

  ipcMain.handle('drama:auto-analyze', (_e, payload: unknown) => {
    const { dramaId, from, to, autoCutCount } = (payload ?? {}) as {
      dramaId?: string
      from?: number
      to?: number
      autoCutCount?: number
    }
    if (typeof dramaId !== 'string') return fail('参数错误')
    const drama = findDrama(dramaId)
    if (!drama || drama.episodes.length === 0) return fail('短剧不存在或没有剧集')
    const f = from ?? drama.episodes[0].n
    const t = to ?? drama.episodes[drama.episodes.length - 1].n
    if (!enqueueGlobal(dramaId, { from: f, to: t }, autoCutCount ?? 3)) {
      return fail('该剧已在全局分析队列中')
    }
    return ok(null)
  })

  ipcMain.handle('drama:script', (_e, dramaId: unknown) => {
    if (typeof dramaId !== 'string') return fail('参数错误')
    return ok(readGlobalScript(dramaId))
  })

  ipcMain.handle('drama:publish-tags', (_e, payload: unknown) => {
    const { dramaId, tags } = (payload ?? {}) as { dramaId?: string; tags?: unknown }
    if (typeof dramaId !== 'string' || !Array.isArray(tags)) return fail('参数错误')
    const drama = findDrama(dramaId)
    if (!drama) return fail('短剧不存在')
    const clean: string[] = []
    for (const t of tags) {
      if (typeof t !== 'string') continue
      const s = t.trim().replace(/\s+/g, '').replace(/^#+/, '')
      if (!s) continue
      const tag = `#${s.slice(0, 24)}`
      if (!clean.includes(tag)) clean.push(tag)
      if (clean.length >= 12) break
    }
    drama.publishTags = clean.length > 0 ? clean : undefined
    saveLibrary()
    syncCutCopyFiles(drama)
    broadcastLibrary()
    return ok(clean)
  })

  ipcMain.handle('cut:generate', (_e, payload: unknown) => {
    const { dramaId, params } = (payload ?? {}) as { dramaId?: string; params?: GenerateCutParams }
    if (typeof dramaId !== 'string' || !params) return fail('参数错误')
    if (!enqueueGenerateCut(dramaId, params)) return fail('短剧不存在')
    return ok(null)
  })

  ipcMain.handle('cut:regenerate', (_e, payload: unknown) => {
    const { dramaId, cutId, instruction, style, targetSec } = (payload ?? {}) as {
      dramaId?: string
      cutId?: string
      instruction?: string
      style?: CutStyle
      targetSec?: number
    }
    if (typeof dramaId !== 'string' || typeof cutId !== 'string') return fail('参数错误')
    if (!enqueueRegenerateCut(dramaId, cutId, instruction ?? '', style, targetSec)) {
      return fail('切片方案不存在')
    }
    return ok(null)
  })

  ipcMain.handle('cut:render', (_e, payload: unknown) => {
    const { dramaId, cutId } = (payload ?? {}) as { dramaId?: string; cutId?: string }
    if (typeof dramaId !== 'string' || typeof cutId !== 'string') return fail('参数错误')
    if (!enqueueRenderCut(dramaId, cutId)) return fail('该切片已在渲染队列中')
    return ok(null)
  })

  ipcMain.handle('cut:delete', (_e, payload: unknown) => {
    const { dramaId, cutId } = (payload ?? {}) as { dramaId?: string; cutId?: string }
    if (typeof dramaId !== 'string' || typeof cutId !== 'string') return fail('参数错误')
    const drama = findDrama(dramaId)
    if (!drama || !drama.cuts) return fail('切片不存在')
    const idx = drama.cuts.findIndex((c) => c.id === cutId)
    if (idx < 0) return fail('切片不存在')
    const cut = drama.cuts[idx]
    cleanupCutFiles(cut.output, cut.srtPath)
    drama.cuts.splice(idx, 1)
    saveLibrary()
    broadcastLibrary()
    return ok(null)
  })

  ipcMain.handle('cut:open-output', (_e, file: unknown) => {
    if (typeof file === 'string' && fileExists(file)) shell.showItemInFolder(file)
    return ok(null)
  })

  ipcMain.handle('narration:create', (_e, payload: unknown) => {
    const { dramaId, params } = (payload ?? {}) as { dramaId?: string; params?: GenerateNarrationParams }
    if (typeof dramaId !== 'string' || !params) return fail('参数错误')
    const drama = findDrama(dramaId)
    if (!drama) return fail('短剧不存在')
    const tts = getTtsSettings()
    const targetSec = Math.max(30, Math.min(600, Math.round(params.targetSec || 120)))
    const cut: NarrationCut = {
      id: `nc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      title: '新解说',
      hookHeadline: '',
      publishCopy: '',
      voice: params.voice?.trim() || tts.voice,
      ttsModel: tts.model,
      rate: params.rate ?? tts.rate,
      ratio: params.ratio === '16:9' ? '16:9' : '9:16',
      targetSec,
      segments: [],
      status: 'draft',
      revision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    drama.narrations = [cut, ...(drama.narrations ?? [])]
    saveLibrary()
    broadcastLibrary()
    if (!enqueueNarration(dramaId, cut.id, 'full', undefined, { ...params, targetSec })) return fail('任务入队失败')
    return ok({ narrationId: cut.id })
  })

  ipcMain.handle('narration:update', (_e, payload: unknown) => {
    const { dramaId, narrationId, title, hookHeadline, publishCopy, segments } = (payload ?? {}) as {
      dramaId?: string
      narrationId?: string
      title?: string
      hookHeadline?: string
      publishCopy?: string
      segments?: { id: string; text?: string; in?: number; out?: number; role?: string }[]
    }
    if (typeof dramaId !== 'string' || typeof narrationId !== 'string') return fail('参数错误')
    const drama = findDrama(dramaId)
    const cut = drama?.narrations?.find((c) => c.id === narrationId)
    if (!drama || !cut) return fail('解说方案不存在')
    if (typeof title === 'string') cut.title = title.slice(0, 40)
    if (typeof hookHeadline === 'string') cut.hookHeadline = hookHeadline.slice(0, 24)
    if (typeof publishCopy === 'string') cut.publishCopy = publishCopy.slice(0, 160)
    if (Array.isArray(segments)) {
      for (const su of segments) {
        const seg = cut.segments.find((s) => s.id === su.id)
        if (!seg) continue
        if (typeof su.text === 'string' && su.text.trim() && su.text !== seg.text) {
          seg.text = su.text.trim().slice(0, 200)
          seg.status = 'pending'
          seg.error = undefined
        }
        const dur = drama.episodes.find((e) => e.n === seg.epN)?.duration || 0
        if (typeof su.in === 'number') seg.in = Math.round(Math.max(0, Math.min(su.in, dur - 1)) * 10) / 10
        if (typeof su.out === 'number') seg.out = Math.round(Math.max(seg.in + 1, Math.min(su.out, dur)) * 10) / 10
        if (typeof su.role === 'string') seg.role = su.role.slice(0, 8)
      }
    }
    cut.updatedAt = Date.now()
    saveLibrary()
    broadcastLibrary()
    return ok(null)
  })

  ipcMain.handle('narration:revoice', (_e, payload: unknown) => {
    const { dramaId, narrationId, segmentId } = (payload ?? {}) as { dramaId?: string; narrationId?: string; segmentId?: string }
    if (typeof dramaId !== 'string' || typeof narrationId !== 'string') return fail('参数错误')
    if (!enqueueNarration(dramaId, narrationId, 'revoice', typeof segmentId === 'string' ? segmentId : undefined)) {
      return fail('解说方案不存在或已在队列中')
    }
    return ok(null)
  })

  ipcMain.handle('narration:render', (_e, payload: unknown) => {
    const { dramaId, narrationId } = (payload ?? {}) as { dramaId?: string; narrationId?: string }
    if (typeof dramaId !== 'string' || typeof narrationId !== 'string') return fail('参数错误')
    if (!enqueueNarration(dramaId, narrationId, 'render')) {
      return fail('解说方案不存在或已在队列中')
    }
    return ok(null)
  })

  ipcMain.handle('narration:delete', (_e, payload: unknown) => {
    const { dramaId, narrationId } = (payload ?? {}) as { dramaId?: string; narrationId?: string }
    if (typeof dramaId !== 'string' || typeof narrationId !== 'string') return fail('参数错误')
    const drama = findDrama(dramaId)
    if (!drama || !drama.narrations) return fail('解说方案不存在')
    const idx = drama.narrations.findIndex((c) => c.id === narrationId)
    if (idx < 0) return fail('解说方案不存在')
    const nc = drama.narrations[idx]
    cleanupCutFiles(nc.output, nc.srtPath)
    fs.rmSync(narrationDir(dramaId, narrationId), { recursive: true, force: true })
    drama.narrations.splice(idx, 1)
    saveLibrary()
    broadcastLibrary()
    return ok(null)
  })

  ipcMain.handle('narration:open-output', (_e, file: unknown) => {
    if (typeof file === 'string' && fileExists(file)) shell.showItemInFolder(file)
    return ok(null)
  })

  ipcMain.handle('job:stop', (_e, dramaId?: unknown) => {
    return ok(stopTasks(typeof dramaId === 'string' && dramaId ? dramaId : undefined))
  })

  // ---------------------------------------------------------------- 爆款复刻

  ipcMain.handle('select-video-file', async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const picked = await dialog.showOpenDialog(parent, {
      title: '选择爆款切片视频',
      properties: ['openFile'],
      filters: [{ name: '视频', extensions: ['mp4', 'mov', 'mkv', 'avi', 'flv', 'ts', 'm4v', 'wmv', 'webm'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return ok({ canceled: true, file: '' })
    return ok({ canceled: false, file: picked.filePaths[0] })
  })

  ipcMain.handle('replica:create', (_e, payload: unknown) => {
    const { dramaId, params } = (payload ?? {}) as { dramaId?: string; params?: CreateReplicaParams }
    if (typeof dramaId !== 'string' || !params || typeof params.clipFile !== 'string') return fail('参数错误')
    const drama = findDrama(dramaId)
    if (!drama) return fail('短剧不存在')
    if (drama.episodes.length === 0) return fail('该剧没有剧集素材')
    const clipFile = path.resolve(params.clipFile.trim())
    if (!fileExists(clipFile)) return fail('爆款切片文件不存在')
    const s = getSettings().replica
    const task: ReplicaTask = {
      id: `rp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      clipFile,
      clipTitle: (params.clipTitle?.trim() || path.basename(clipFile).replace(/\.[^.]+$/, '')).slice(0, 60),
      status: 'queue',
      pct: 0,
      audio: params.audio ?? s.audio,
      crf: params.crf ?? s.crf,
      despike: params.despike ?? s.despike,
      refine: params.refine ?? s.refine,
      boundsRadius: params.boundsRadius ?? s.boundsRadius,
      indexFps: params.indexFps ?? s.indexFps,
      maskTop: params.maskTop ?? s.maskTop,
      maskBottom: params.maskBottom ?? s.maskBottom,
      maskBand: params.maskBand ?? s.maskBand,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    drama.replicas = [task, ...(drama.replicas ?? [])]
    saveLibrary()
    broadcastLibrary()
    if (!enqueueReplica(dramaId, task.id)) return fail('任务入队失败')
    return ok({ replicaId: task.id })
  })

  ipcMain.handle('replica:retry', (_e, payload: unknown) => {
    const { dramaId, replicaId, recutOnly } = (payload ?? {}) as {
      dramaId?: string; replicaId?: string; recutOnly?: boolean
    }
    if (typeof dramaId !== 'string' || typeof replicaId !== 'string') return fail('参数错误')
    if (!enqueueReplica(dramaId, replicaId, Boolean(recutOnly))) return fail('任务不存在或已在队列中')
    return ok(null)
  })

  ipcMain.handle('replica:recut-only', (_e, payload: unknown) => {
    const { dramaId, replicaId, params } = (payload ?? {}) as {
      dramaId?: string; replicaId?: string; params?: Partial<CreateReplicaParams>
    }
    if (typeof dramaId !== 'string' || typeof replicaId !== 'string') return fail('参数错误')
    const drama = findDrama(dramaId)
    const task = drama?.replicas?.find((r) => r.id === replicaId)
    if (!drama || !task) return fail('复刻任务不存在')
    if (!task.tracePath || !fileExists(task.tracePath)) return fail('溯源表不存在，请完整重试')
    if (params) {
      if (params.audio) task.audio = params.audio
      if (typeof params.crf === 'number') task.crf = params.crf
      if (typeof params.despike === 'boolean') task.despike = params.despike
      if (typeof params.refine === 'boolean') task.refine = params.refine
      if (typeof params.boundsRadius === 'number') task.boundsRadius = params.boundsRadius
    }
    task.updatedAt = Date.now()
    saveLibrary()
    broadcastLibrary()
    if (!enqueueReplica(dramaId, replicaId, true)) return fail('任务已在队列中')
    return ok(null)
  })

  ipcMain.handle('replica:delete', (_e, payload: unknown) => {
    const { dramaId, replicaId } = (payload ?? {}) as { dramaId?: string; replicaId?: string }
    if (typeof dramaId !== 'string' || typeof replicaId !== 'string') return fail('参数错误')
    const drama = findDrama(dramaId)
    const idx = drama?.replicas?.findIndex((r) => r.id === replicaId) ?? -1
    if (!drama || idx < 0) return fail('复刻任务不存在')
    const task = drama.replicas![idx]
    if (task.status === 'queue' || task.status === 'indexing' || task.status === 'tracing' || task.status === 'cutting') {
      return fail('任务运行中，请先终止')
    }
    // 产物目录整体清理（任务独占目录）
    if (task.output) {
      try {
        fs.rmSync(path.dirname(task.output), { recursive: true, force: true })
      } catch {
        fs.rmSync(task.output, { force: true })
      }
    }
    drama.replicas!.splice(idx, 1)
    saveLibrary()
    broadcastLibrary()
    return ok(null)
  })

  ipcMain.handle('replica:edl', (_e, payload: unknown) => {
    const { dramaId, replicaId } = (payload ?? {}) as { dramaId?: string; replicaId?: string }
    if (typeof dramaId !== 'string' || typeof replicaId !== 'string') return fail('参数错误')
    const task = findDrama(dramaId)?.replicas?.find((r) => r.id === replicaId)
    if (!task?.edlPath || !fileExists(task.edlPath)) return fail('EDL 尚未生成')
    return ok(readReplicaEdl(task.edlPath))
  })

  ipcMain.handle('replica:open-output', (_e, file: unknown) => {
    if (typeof file === 'string' && fileExists(file)) shell.showItemInFolder(file)
    return ok(null)
  })

  ipcMain.handle('settings:get', () => ok(getSettings()))

  ipcMain.handle('settings:save', (_e, patch: unknown) => {
    const p = (patch ?? {}) as AiSettingsPatch
    const cleanCfg = (c?: Partial<ModelCfg>): Partial<ModelCfg> | undefined => {
      if (!c) return undefined
      const out: Partial<ModelCfg> = {}
      if (typeof c.baseUrl === 'string') out.baseUrl = c.baseUrl.trim()
      if (typeof c.apiKey === 'string') out.apiKey = c.apiKey.trim()
      if (typeof c.model === 'string') out.model = c.model.trim()
      return out
    }
    const clean: AiSettingsPatch = {}
    const g = cleanCfg(p.global)
    const t = cleanCfg(p.text)
    if (g) clean.global = g
    if (t) clean.text = t
    if (p.tts) {
      const out: Partial<TtsCfg> = { ...(cleanCfg(p.tts) ?? {}) }
      if (typeof p.tts.voice === 'string') out.voice = p.tts.voice.trim()
      if (typeof p.tts.rate === 'number' && p.tts.rate >= 0.5 && p.tts.rate <= 2) out.rate = Math.round(p.tts.rate * 100) / 100
      clean.tts = out
    }
    if (Array.isArray(p.styles)) clean.styles = p.styles as CutStyleConfig[]
    if (p.replica) {
      const r = p.replica
      const out: Partial<ReplicaSettings> = {}
      if (typeof r.indexFps === 'number' && r.indexFps >= 4 && r.indexFps <= 30) out.indexFps = r.indexFps
      if (r.audio === 'source' || r.audio === 'clip' || r.audio === 'none') out.audio = r.audio
      if (typeof r.crf === 'number' && r.crf >= 10 && r.crf <= 28) out.crf = Math.round(r.crf)
      if (typeof r.despike === 'boolean') out.despike = r.despike
      if (typeof r.refine === 'boolean') out.refine = r.refine
      if (typeof r.boundsRadius === 'number' && r.boundsRadius >= 0 && r.boundsRadius <= 16) out.boundsRadius = Math.round(r.boundsRadius)
      if (typeof r.maskTop === 'number' && r.maskTop >= 0 && r.maskTop <= 0.75) out.maskTop = r.maskTop
      if (typeof r.maskBottom === 'number' && r.maskBottom >= 0 && r.maskBottom <= 0.75) out.maskBottom = r.maskBottom
      if (typeof r.maskBand === 'string') out.maskBand = r.maskBand.trim()
      if (typeof r.workers === 'number' && r.workers >= 1 && r.workers <= 8) out.workers = Math.round(r.workers)
      clean.replica = out
    }
    return ok(saveSettings(clean))
  })
}
