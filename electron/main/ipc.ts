import { ipcMain, protocol, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import type { AiSettingsPatch, ApiResult, ArrangeParams, CandPatch, Drama, Episode, ModelCfg, RenderParams, ScanFile, ScanResult } from '../../src/shared/types'
import { allEpisodes, findDrama, findEpisode, getLibrary, saveLibrary } from './db'
import { buildArrange } from './arrange'
import { broadcastLibrary, clearJobLogs, currentJob, enqueue, enqueueAnalyze, enqueueAsr, enqueueGlobal, enqueueRender, enqueueSynthesis, getJobLogState, runningCount, stopAnalyze } from './jobs'
import { readGlobalScript } from './global'
import { fileExists } from './media'
import { getRenderState } from './render'
import { getSettings, saveSettings } from './settings'

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
  '.jpg': 'image/jpeg'
}

export function registerMediaProtocol(): void {
  protocol.handle('dw-media', (request) => {
    let filePath: string
    try {
      filePath = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '')
    } catch {
      return new Response('bad path', { status: 400 })
    }
    // 只允许播放已登记的剧集文件、缩略图及高光切片，避免任意文件读取
    const allowed = allEpisodes().some(
      ({ ep }) =>
        path.normalize(ep.file) === path.normalize(filePath) ||
        (ep.thumb !== null && path.normalize(ep.thumb) === path.normalize(filePath)) ||
        (ep.candidates ?? []).some(
          (c) =>
            (c.clip !== undefined && path.normalize(c.clip) === path.normalize(filePath)) ||
            (c.clipThumb !== undefined && path.normalize(c.clipThumb) === path.normalize(filePath))
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

  ipcMain.handle('library:scan', (_e, dir: unknown) => {
    if (typeof dir !== 'string' || !dir.trim()) return fail('请先选择素材目录')
    return scanDir(path.resolve(dir.trim()))
  })

  ipcMain.handle('library:import', (_e, payload: unknown) => {
    const { dir, title } = (payload ?? {}) as { dir?: string; title?: string }
    if (typeof dir !== 'string' || !dir.trim()) return fail('请先选择素材目录')
    const cleanTitle = typeof title === 'string' && title.trim() ? title.trim() : path.basename(dir)
    const scan = scanDir(path.resolve(dir.trim()))
    if (!scan.ok) return scan
    const matched = scan.data.files.filter((f) => f.n !== null)
    if (matched.length === 0) return fail('没有识别到可导入的剧集文件（文件名需包含集数，如「第3集.mp4」）')
    if (getLibrary().dramas.some((d) => path.normalize(d.dir) === path.normalize(scan.data.dir))) {
      return fail('该目录已导入，可在剧集列表里使用「重新扫描」增量添加新集')
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
      episodes
    }
    getLibrary().dramas.push(drama)
    saveLibrary()
    for (const ep of episodes) {
      enqueue('probe', drama.id, ep.id)
      enqueue('thumb', drama.id, ep.id)
      enqueue('shots', drama.id, ep.id)
    }
    broadcastLibrary()
    return ok({ dramaId: drama.id, count: episodes.length })
  })

  ipcMain.handle('library:remove', (_e, dramaId: unknown) => {
    if (typeof dramaId !== 'string') return fail('参数错误')
    const lib = getLibrary()
    const idx = lib.dramas.findIndex((d) => d.id === dramaId)
    if (idx < 0) return fail('短剧不存在')
    for (const ep of lib.dramas[idx].episodes) {
      for (const c of ep.candidates ?? []) {
        if (c.clip) fs.rmSync(c.clip, { force: true })
        if (c.clipThumb) fs.rmSync(c.clipThumb, { force: true })
      }
    }
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
    let repaired = 0
    for (const ep of drama.episodes) {
      if (!fileExists(ep.file)) continue
      const thumbMissing = ep.thumb === null || !fileExists(ep.thumb)
      if (ep.duration === null || thumbMissing || ep.shots === undefined) repaired++
      if (ep.duration === null) enqueue('probe', drama.id, ep.id)
      if (thumbMissing) enqueue('thumb', drama.id, ep.id)
      if (ep.shots === undefined) enqueue('shots', drama.id, ep.id)
    }
    saveLibrary()
    for (const ep of added) {
      enqueue('probe', drama.id, ep.id)
      enqueue('thumb', drama.id, ep.id)
      enqueue('shots', drama.id, ep.id)
    }
    broadcastLibrary()
    return ok({ added: added.length, repaired })
  })

  ipcMain.handle('library:start-asr', (_e, payload: unknown) => {
    const { dramaId, episodeId } = (payload ?? {}) as { dramaId?: string; episodeId?: string }
    if (typeof dramaId !== 'string' || typeof episodeId !== 'string') return fail('参数错误')
    const found = allEpisodes().find(({ ep }) => ep.id === episodeId)
    if (!found) return fail('剧集不存在')
    if (!fileExists(found.ep.file)) return fail('视频文件不存在，可能已被移动或删除')
    if (!enqueueAsr(dramaId, episodeId)) return fail('该剧集已在转写队列中')
    return ok(null)
  })

  ipcMain.handle('library:start-analyze', (_e, payload: unknown) => {
    const { dramaId, episodeId } = (payload ?? {}) as { dramaId?: string; episodeId?: string }
    if (typeof dramaId !== 'string' || typeof episodeId !== 'string') return fail('参数错误')
    const found = findEpisode(dramaId, episodeId)
    if (!found) return fail('剧集不存在')
    if (!fileExists(found.ep.file)) return fail('视频文件不存在，可能已被移动或删除')
    if (!enqueueAnalyze(dramaId, episodeId)) return fail('该剧集已在分析队列中')
    return ok(null)
  })

  ipcMain.handle('library:start-synthesis', (_e, dramaId: unknown) => {
    if (typeof dramaId !== 'string') return fail('参数错误')
    if (!findDrama(dramaId)) return fail('短剧不存在')
    if (!enqueueSynthesis(dramaId)) return fail('该剧已在统筹队列中')
    return ok(null)
  })

  ipcMain.handle('library:start-global', (_e, payload: unknown) => {
    const { dramaId, from, to } = (payload ?? {}) as { dramaId?: string; from?: number; to?: number }
    if (typeof dramaId !== 'string' || !Number.isFinite(from) || !Number.isFinite(to) || from! > to!) return fail('参数错误')
    const drama = findDrama(dramaId)
    if (!drama) return fail('短剧不存在')
    if (!drama.episodes.some((e) => e.n >= from! && e.n <= to!)) return fail('范围内没有剧集')
    if (!enqueueGlobal(dramaId, { from: from!, to: to! })) return fail('该剧已在全局分析队列中')
    return ok(null)
  })

  ipcMain.handle('library:global-script', (_e, dramaId: unknown) => {
    if (typeof dramaId !== 'string') return fail('参数错误')
    return ok(readGlobalScript(dramaId))
  })

  ipcMain.handle('library:stop-analyze', () => ok(stopAnalyze()))

  ipcMain.handle('library:cand-update', (_e, payload: unknown) => {
    const { dramaId, episodeId, candId, patch } = (payload ?? {}) as {
      dramaId?: string
      episodeId?: string
      candId?: string
      patch?: CandPatch
    }
    if (typeof dramaId !== 'string' || typeof episodeId !== 'string' || typeof candId !== 'string' || !patch) {
      return fail('参数错误')
    }
    const found = findEpisode(dramaId, episodeId)
    if (!found) return fail('剧集不存在')
    const c = found.ep.candidates?.find((x) => x.id === candId)
    if (!c) return fail('候选不存在')
    const wasApproved = c.status === 'approved'
    if (patch.status === 'pending' || patch.status === 'approved' || patch.status === 'rejected') {
      c.status = patch.status
    }
    if (c.status === 'approved' && !wasApproved) c.approvedAt = Date.now()
    if (typeof patch.in === 'number' && Number.isFinite(patch.in)) {
      c.in = Math.max(0, Math.min(patch.in, c.out - 0.5))
    }
    if (typeof patch.out === 'number' && Number.isFinite(patch.out)) {
      c.out = Math.min(found.ep.duration ?? patch.out, Math.max(patch.out, c.in + 0.5))
    }
    if (Array.isArray(patch.tags)) c.tags = patch.tags.map(String)
    found.ep.pending = (found.ep.candidates ?? []).filter((x) => x.status === 'pending').length
    found.ep.hl = (found.ep.candidates ?? []).filter((x) => x.status === 'approved').length
    saveLibrary()
    if (c.status === 'approved' && (!wasApproved || typeof patch.in === 'number' || typeof patch.out === 'number')) {
      enqueue('slice', dramaId, episodeId, candId)
    }
    broadcastLibrary()
    return ok(null)
  })

  ipcMain.handle('library:hl-delete', (_e, payload: unknown) => {
    const { dramaId, episodeId, candId } = (payload ?? {}) as {
      dramaId?: string
      episodeId?: string
      candId?: string
    }
    if (typeof dramaId !== 'string' || typeof episodeId !== 'string' || typeof candId !== 'string') {
      return fail('参数错误')
    }
    const found = findEpisode(dramaId, episodeId)
    if (!found) return fail('剧集不存在')
    const c = found.ep.candidates?.find((x) => x.id === candId)
    if (!c) return fail('候选不存在')
    if (c.clip) fs.rmSync(c.clip, { force: true })
    if (c.clipThumb) fs.rmSync(c.clipThumb, { force: true })
    c.clip = undefined
    c.clipThumb = undefined
    c.approvedAt = undefined
    c.status = 'pending'
    found.ep.pending = (found.ep.candidates ?? []).filter((x) => x.status === 'pending').length
    found.ep.hl = (found.ep.candidates ?? []).filter((x) => x.status === 'approved').length
    saveLibrary()
    broadcastLibrary()
    return ok(null)
  })

  ipcMain.handle('library:hl-reslice', (_e, payload: unknown) => {
    const { dramaId, episodeId, candId } = (payload ?? {}) as {
      dramaId?: string
      episodeId?: string
      candId?: string
    }
    if (typeof dramaId !== 'string' || typeof episodeId !== 'string' || typeof candId !== 'string') {
      return fail('参数错误')
    }
    const found = findEpisode(dramaId, episodeId)
    if (!found) return fail('剧集不存在')
    const c = found.ep.candidates?.find((x) => x.id === candId)
    if (!c || c.status !== 'approved') return fail('该高光不在库中')
    if (!fileExists(found.ep.file)) return fail('视频文件不存在，可能已被移动或删除')
    enqueue('slice', dramaId, episodeId, candId)
    return ok(null)
  })

  ipcMain.handle('mix:arrange', async (_e, payload: unknown) => {
    const { dramaId, params } = (payload ?? {}) as { dramaId?: string; params?: ArrangeParams }
    if (typeof dramaId !== 'string' || !params) return fail('参数错误')
    const drama = findDrama(dramaId)
    if (!drama) return fail('短剧不存在')
    try {
      const result = await buildArrange(drama, params, getSettings().text)
      return ok(result)
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('mix:render', (_e, payload: unknown) => {
    const { dramaId, params } = (payload ?? {}) as { dramaId?: string; params?: RenderParams }
    if (typeof dramaId !== 'string' || !params || !Array.isArray(params.clips) || params.clips.length === 0) {
      return fail('参数错误')
    }
    if (!findDrama(dramaId)) return fail('短剧不存在')
    if (!enqueueRender(dramaId, params)) return fail('已有渲染任务在进行，请稍候')
    return ok(null)
  })

  ipcMain.handle('mix:render-state', () => ok(getRenderState()))

  ipcMain.handle('mix:open-output', (_e, file: unknown) => {
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
    const v = cleanCfg(p.video)
    const t = cleanCfg(p.text)
    const g = cleanCfg(p.global)
    if (v) clean.video = v
    if (t) clean.text = t
    if (g) clean.global = g
    return ok(saveSettings(clean))
  })
}