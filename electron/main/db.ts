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
        for (const cut of d.cuts ?? []) {
          if (cut.status === 'rendering' || cut.status === 'draft') {
            cut.status = 'fail'
            cut.pct = undefined
            cut.error = '应用重启导致渲染中断，可点击重新渲染'
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
