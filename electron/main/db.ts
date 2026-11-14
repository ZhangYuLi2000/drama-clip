import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { Drama, Episode, Library } from '../../src/shared/types'

let dbPath = ''
let lib: Library = { version: 1, dramas: [] }

export function initDb(): void {
  dbPath = path.join(app.getPath('userData'), 'library.json')
  try {
    const raw = fs.readFileSync(dbPath, 'utf8')
    const parsed = JSON.parse(raw) as Library
    if (parsed && Array.isArray(parsed.dramas)) {
      lib = parsed
      for (const d of lib.dramas) {
        if (d.global && (d.global.status === 'run' || d.global.status === 'queue')) {
          d.global.status = 'fail'
          d.global.pct = undefined
          d.global.note = '应用重启导致任务中断，请重试'
        }
        for (const ep of d.episodes) {
          if (!ep.ana) ep.ana = 'idle'
          // 进程重启后内存队列已空，残留的 run/queue 是假状态，恢复为可重试的失败
          if (ep.asr === 'run' || ep.asr === 'queue') {
            ep.asr = 'fail'
            ep.asrNote = '应用重启导致任务中断，请重试'
          }
          if (ep.ana === 'run' || ep.ana === 'queue') {
            ep.ana = 'fail'
            ep.anaNote = '应用重启导致任务中断，请重试'
          }
          ep.hl = (ep.candidates ?? []).filter((c) => c.status === 'approved').length
        }
      }
      saveLibrary()
    }
  } catch {
    lib = { version: 1, dramas: [] }
  }
}

export function getLibrary(): Library {
  return lib
}

export function saveLibrary(): void {
  const tmp = `${dbPath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(lib))
  fs.renameSync(tmp, dbPath)
}

export function cacheDir(): string {
  // 不能用 userData/cache：Windows 大小写不敏感，会与 Chromium 的 Cache 目录冲突被清理
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