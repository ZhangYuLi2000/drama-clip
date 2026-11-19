import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { Drama, Episode, Library } from '../../src/shared/types'
import { deferredWriter } from './throttle'

let dbPath = ''
let lib: Library = { version: 1, dramas: [] }

export function initDb(): void {
  dbPath = path.join(app.getPath('userData'), 'library.json')
  let raw: string
  try {
    raw = fs.readFileSync(dbPath, 'utf8')
  } catch {
    return
  }
  try {
    const parsed = JSON.parse(raw) as Library
    if (!parsed || !Array.isArray(parsed.dramas)) throw new Error('invalid library')
    lib = parsed
    for (const d of lib.dramas) {
      if (d.global && (d.global.status === 'run' || d.global.status === 'queue')) {
        d.global.status = 'fail'
        d.global.pct = undefined
        d.global.note = '应用重启导致任务中断，请重试'
      }
      for (const cut of d.cuts ?? []) {
        if (cut.status === 'rendering' || cut.status === 'draft') {
          const hasOutput = Boolean(cut.output && fs.existsSync(cut.output))
          cut.status = hasOutput ? 'ready' : 'fail'
          cut.pct = hasOutput ? 100 : undefined
          cut.error = hasOutput ? undefined : '应用重启导致渲染中断，可点击重新渲染'
        }
      }
      for (const nc of d.narrations ?? []) {
        if (nc.status === 'generating' || nc.status === 'voicing' || nc.status === 'draft') {
          const hasAudio = nc.segments.some((s) => s.status === 'ready' && s.audioFile && fs.existsSync(s.audioFile))
          nc.status = hasAudio ? 'ready' : 'fail'
          nc.pct = hasAudio ? 100 : undefined
          nc.error = hasAudio ? undefined : '应用重启导致任务中断，可点击重试'
        }
      }
      for (const rep of d.replicas ?? []) {
        if (rep.status === 'queue' || rep.status === 'indexing' || rep.status === 'tracing' || rep.status === 'cutting') {
          rep.status = rep.output ? 'ready' : 'fail'
          rep.pct = 0
          rep.stageNote = undefined
          rep.error = '应用重启导致任务中断，可点击重试'
        }
      }
      for (const ep of d.episodes) {
        if (!ep.ana) ep.ana = 'idle'
        if (ep.asr === 'run' || ep.asr === 'queue') {
          ep.asr = 'fail'
          ep.asrNote = '应用重启导致任务中断'
        }
        if (ep.ana === 'run' || ep.ana === 'queue') {
          ep.ana = 'fail'
          ep.anaNote = '应用重启导致任务中断'
        }
      }
    }
    saveLibrary()
  } catch {
    // 媒体库损坏时留一份备份，避免下一次保存把原文件覆盖成空库
    lib = { version: 1, dramas: [] }
    try {
      fs.copyFileSync(dbPath, `${dbPath}.corrupt-${Date.now()}`)
    } catch {
      // 备份失败不阻塞启动
    }
  }
}

export function getLibrary(): Library {
  return lib
}

const SAVE_DELAY_MS = 250
const SAVE_RETRY_MS = 2000

function writeLibrary(): void {
  if (!dbPath) return
  const tmp = `${dbPath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(lib))
  fs.renameSync(tmp, dbPath)
}

const scheduleSave = deferredWriter(writeLibrary, SAVE_DELAY_MS, SAVE_RETRY_MS, (err) =>
  console.error('[db] 媒体库保存失败，稍后重试', err)
)

// 进度回调里会高频调用：合并为最多每 250ms 落盘一次，退出前由 flushLibrary 兜底
export function saveLibrary(): void {
  scheduleSave()
}

export function flushLibrary(): void {
  scheduleSave.flush()
}

export function cacheDir(): string {
  const dir = path.join(app.getPath('userData'), 'media-cache')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function findDrama(id: string): Drama | undefined {
  return lib.dramas.find((d) => d.id === id)
}

export function findEpisode(dramaId: string, episodeId: string): { drama: Drama; ep: Episode } | null {
  const drama = findDrama(dramaId)
  const ep = drama?.episodes.find((e) => e.id === episodeId)
  return drama && ep ? { drama, ep } : null
}

export function allEpisodes(): { drama: Drama; ep: Episode }[] {
  return lib.dramas.flatMap((drama) => drama.episodes.map((ep) => ({ drama, ep })))
}
