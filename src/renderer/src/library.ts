import { useMemo } from 'react'
import { create } from 'zustand'
import type {
  AiSettings,
  AiSettingsPatch,
  ApiResult,
  ArrangeParams,
  ArrangeResult,
  CandPatch,
  Candidate,
  Drama,
  Episode,
  GlobalScript,
  JobInfo,
  JobLogEntry,
  JobLogState,
  Library,
  RenderParams,
  RenderState,
  ScanResult
} from '../../shared/types'

export interface Highlight {
  id: string
  dramaId: string
  episodeId: string
  ep: number
  title: string
  score: number
  tags: string[]
  scene: string
  reason: string
  in: number
  out: number
  dur: number
  clip?: string
  clipThumb?: string
  approvedAt?: number
}

export function highlightsOf(dramas: Drama[]): Highlight[] {
  const out: Highlight[] = []
  for (const d of dramas) {
    for (const ep of d.episodes) {
      for (const c of ep.candidates ?? []) {
        if (c.status !== 'approved') continue
        out.push({
          id: c.id,
          dramaId: d.id,
          episodeId: ep.id,
          ep: ep.n,
          title: c.title,
          score: c.score,
          tags: c.tags,
          scene: c.scene,
          reason: c.reason,
          in: c.in,
          out: c.out,
          dur: Math.round((c.out - c.in) * 10) / 10,
          clip: c.clip,
          clipThumb: c.clipThumb,
          approvedAt: c.approvedAt
        })
      }
    }
  }
  return out
}

export function useHighlights(): Highlight[] {
  const dramas = useLibrary((s) => s.dramas)
  return useMemo(() => highlightsOf(dramas), [dramas])
}

interface LibraryState {
  ready: boolean
  dramas: Drama[]
  job: JobInfo | null
  running: number
  logs: JobLogEntry[]
  logStats: { done: number; failed: number }
  settings: AiSettings | null
  refresh: () => Promise<void>
  scan: (dir: string) => Promise<ScanResult>
  importDrama: (dir: string, title: string) => Promise<{ dramaId: string; count: number }>
  removeDrama: (id: string) => Promise<void>
  rescan: (id: string) => Promise<{ added: number; repaired: number }>
  startAsr: (dramaId: string, episodeId: string) => Promise<void>
  startAnalyze: (dramaId: string, episodeId: string) => Promise<void>
  startSynthesis: (dramaId: string) => Promise<void>
  startGlobal: (dramaId: string, from: number, to: number) => Promise<void>
  getGlobalScript: (dramaId: string) => Promise<GlobalScript | null>
  stopAnalyze: () => Promise<{ cleared: number }>
  updateCandidate: (dramaId: string, episodeId: string, candId: string, patch: CandPatch) => Promise<void>
  deleteHighlight: (dramaId: string, episodeId: string, candId: string) => Promise<void>
  resliceHighlight: (dramaId: string, episodeId: string, candId: string) => Promise<void>
  arrangeMix: (dramaId: string, params: ArrangeParams) => Promise<ArrangeResult>
  renderMix: (dramaId: string, params: RenderParams) => Promise<void>
  getRenderState: () => Promise<RenderState>
  openOutput: (file: string) => Promise<void>
  clearLogs: () => Promise<void>
  loadSettings: () => Promise<void>
  saveSettings: (patch: AiSettingsPatch) => Promise<void>
}

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const api = window.electronAPI
  if (!api) throw new Error('请在 Electron 应用内使用本功能')
  const res = (await api.invoke(channel, ...args)) as ApiResult<T>
  if (!res.ok) throw new Error(res.error)
  return res.data
}

export const useLibrary = create<LibraryState>()((set, get) => ({
  ready: false,
  dramas: [],
  job: null,
  running: 0,
  logs: [],
  logStats: { done: 0, failed: 0 },
  settings: null,
  refresh: async () => {
    const api = window.electronAPI
    if (!api) return
    try {
      const lib = await call<Library>('library:get')
      const job = await call<JobInfo | null>('library:job')
      const running = await call<number>('library:running')
      const logState = await call<JobLogState>('library:logs')
      set({
        ready: true,
        dramas: lib.dramas,
        job,
        running,
        logs: logState.logs,
        logStats: { done: logState.done, failed: logState.failed }
      })
    } catch {
      set({ ready: true })
    }
  },
  scan: (dir) => call<ScanResult>('library:scan', dir),
  importDrama: (dir, title) => call<{ dramaId: string; count: number }>('library:import', { dir, title }),
  removeDrama: async (id) => {
    await call<null>('library:remove', id)
    await get().refresh()
  },
  rescan: async (id) => {
    const r = await call<{ added: number; repaired: number }>('library:rescan', id)
    await get().refresh()
    return r
  },
  startAsr: async (dramaId, episodeId) => {
    await call<null>('library:start-asr', { dramaId, episodeId })
    await get().refresh()
  },
  startAnalyze: async (dramaId, episodeId) => {
    await call<null>('library:start-analyze', { dramaId, episodeId })
    await get().refresh()
  },
  startSynthesis: async (dramaId) => {
    await call<null>('library:start-synthesis', dramaId)
    await get().refresh()
  },
  startGlobal: async (dramaId, from, to) => {
    await call<null>('library:start-global', { dramaId, from, to })
    await get().refresh()
  },
  getGlobalScript: (dramaId) => call<GlobalScript | null>('library:global-script', dramaId),
  stopAnalyze: async () => {
    const r = await call<{ cleared: number }>('library:stop-analyze')
    await get().refresh()
    return r
  },
  updateCandidate: async (dramaId, episodeId, candId, patch) => {
    await call<null>('library:cand-update', { dramaId, episodeId, candId, patch })
  },
  deleteHighlight: async (dramaId, episodeId, candId) => {
    await call<null>('library:hl-delete', { dramaId, episodeId, candId })
    await get().refresh()
  },
  resliceHighlight: async (dramaId, episodeId, candId) => {
    await call<null>('library:hl-reslice', { dramaId, episodeId, candId })
    await get().refresh()
  },
  arrangeMix: (dramaId, params) => call<ArrangeResult>('mix:arrange', { dramaId, params }),
  renderMix: async (dramaId, params) => {
    await call<null>('mix:render', { dramaId, params })
  },
  getRenderState: () => call<RenderState>('mix:render-state'),
  openOutput: async (file) => {
    await call<null>('mix:open-output', file)
  },
  clearLogs: async () => {
    await call<null>('library:logs-clear')
    set({ logs: [], logStats: { done: 0, failed: 0 } })
  },
  loadSettings: async () => {
    try {
      const settings = await call<AiSettings>('settings:get')
      set({ settings })
    } catch {
      // 非 Electron 环境忽略
    }
  },
  saveSettings: async (patch) => {
    const settings = await call<AiSettings>('settings:save', patch)
    set({ settings })
  }
}))

export function mediaUrl(file: string): string {
  return `dw-media:///${encodeURIComponent(file.replace(/\\/g, '/'))}`
}

export function findDrama(dramas: Drama[], id: string): Drama | undefined {
  return dramas.find((d) => d.id === id)
}

export function findEpisode(dramas: Drama[], dramaId: string, n: number): Episode | undefined {
  return findDrama(dramas, dramaId)?.episodes.find((e) => e.n === n)
}

export function candsOf(dramas: Drama[], dramaId: string, n: number): Candidate[] {
  return findEpisode(dramas, dramaId, n)?.candidates ?? []
}

export function fmtDur(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function fmtSize(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(2)} GB`
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export type EpCategory = 'running' | 'failed' | 'review' | 'done' | 'idle'

export function epCat(e: Episode): EpCategory {
  if (e.asr === 'run' || e.asr === 'queue' || e.ana === 'run' || e.ana === 'queue') return 'running'
  if (e.asr === 'fail' || e.ana === 'fail') return 'failed'
  if (e.pending > 0) return 'review'
  if (e.asr === 'done') return 'done'
  return 'idle'
}

let pollTimer: ReturnType<typeof setInterval> | null = null

export function startLibrarySync(): () => void {
  void useLibrary.getState().refresh()
  void useLibrary.getState().loadSettings()
  const off = window.electronAPI?.onLibraryUpdate(() => {
    void useLibrary.getState().refresh()
  })
  pollTimer = setInterval(() => {
    if (useLibrary.getState().running > 0) void useLibrary.getState().refresh()
  }, 2500)
  return () => {
    off?.()
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
}