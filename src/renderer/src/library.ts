import { create } from 'zustand'
import type {
  AiSettings,
  AiSettingsPatch,
  ApiResult,
  CreateReplicaParams,
  CutStyle,
  Drama,
  GenerateCutParams,
  GlobalScript,
  JobInfo,
  JobLogEntry,
  JobLogState,
  Library,
  ReplicaEdlRow,
  ScanResult
} from '../../shared/types'

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
  pickVideoFile: () => Promise<string>
  importDrama: (dir: string, title: string, autoStart?: boolean) => Promise<{ dramaId: string; count: number }>
  removeDrama: (id: string) => Promise<void>
  rescan: (id: string) => Promise<{ added: number }>
  autoAnalyze: (dramaId: string, from?: number, to?: number, autoCutCount?: number) => Promise<void>
  getGlobalScript: (dramaId: string) => Promise<GlobalScript | null>
  generateCut: (dramaId: string, params: GenerateCutParams) => Promise<void>
  regenerateCut: (
    dramaId: string,
    cutId: string,
    instruction: string,
    style?: CutStyle,
    targetSec?: number
  ) => Promise<void>
  renderCut: (dramaId: string, cutId: string) => Promise<void>
  deleteCut: (dramaId: string, cutId: string) => Promise<void>
  openOutput: (file: string) => Promise<void>
  exportCutPackage: (dramaId: string, cutId: string) => Promise<{ canceled: boolean; dir: string }>
  stopTasks: (dramaId?: string) => Promise<{ cleared: number }>
  clearLogs: () => Promise<void>
  loadSettings: () => Promise<void>
  saveSettings: (patch: AiSettingsPatch) => Promise<void>
  createReplica: (dramaId: string, params: CreateReplicaParams) => Promise<{ replicaId: string }>
  retryReplica: (dramaId: string, replicaId: string) => Promise<void>
  recutReplica: (dramaId: string, replicaId: string, params?: Partial<CreateReplicaParams>) => Promise<void>
  deleteReplica: (dramaId: string, replicaId: string) => Promise<void>
  getReplicaEdl: (dramaId: string, replicaId: string) => Promise<ReplicaEdlRow[]>
  openReplicaOutput: (file: string) => Promise<void>
  selectVideoFile: () => Promise<{ canceled: boolean; file: string }>
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
  pickVideoFile: () => call<string>('select-video-file'),
  importDrama: (dir, title, autoStart = true) =>
    call<{ dramaId: string; count: number }>('library:import', { dir, title, autoStart }),
  removeDrama: async (id) => {
    await call<null>('library:remove', id)
    await get().refresh()
  },
  rescan: async (id) => {
    const r = await call<{ added: number }>('library:rescan', id)
    await get().refresh()
    return r
  },
  autoAnalyze: async (dramaId, from, to, autoCutCount = 3) => {
    await call<null>('drama:auto-analyze', { dramaId, from, to, autoCutCount })
    await get().refresh()
  },
  getGlobalScript: (dramaId) => call<GlobalScript | null>('drama:script', dramaId),
  generateCut: async (dramaId, params) => {
    await call<null>('cut:generate', { dramaId, params })
    await get().refresh()
  },
  regenerateCut: async (dramaId, cutId, instruction, style, targetSec) => {
    await call<null>('cut:regenerate', { dramaId, cutId, instruction, style, targetSec })
    await get().refresh()
  },
  renderCut: async (dramaId, cutId) => {
    await call<null>('cut:render', { dramaId, cutId })
    await get().refresh()
  },
  deleteCut: async (dramaId, cutId) => {
    await call<null>('cut:delete', { dramaId, cutId })
    await get().refresh()
  },
  openOutput: async (file) => {
    await call<null>('cut:open-output', file)
  },
  exportCutPackage: (dramaId, cutId) =>
    call<{ canceled: boolean; dir: string }>('cut:export-package', { dramaId, cutId }),
  stopTasks: async (dramaId) => {
    const r = await call<{ cleared: number }>('job:stop', dramaId)
    await get().refresh()
    return r
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
  },
  createReplica: async (dramaId, params) => {
    const r = await call<{ replicaId: string }>('replica:create', { dramaId, params })
    await get().refresh()
    return r
  },
  retryReplica: async (dramaId, replicaId) => {
    await call<null>('replica:retry', { dramaId, replicaId })
    await get().refresh()
  },
  recutReplica: async (dramaId, replicaId, params) => {
    await call<null>('replica:recut-only', { dramaId, replicaId, params })
    await get().refresh()
  },
  deleteReplica: async (dramaId, replicaId) => {
    await call<null>('replica:delete', { dramaId, replicaId })
    await get().refresh()
  },
  getReplicaEdl: (dramaId, replicaId) => call<ReplicaEdlRow[]>('replica:edl', { dramaId, replicaId }),
  openReplicaOutput: async (file) => {
    await call<null>('replica:open-output', file)
  },
  selectVideoFile: () => call<{ canceled: boolean; file: string }>('select-video-file')
}))

export function mediaUrl(file: string): string {
  return `dw-media:///${encodeURIComponent(file.replace(/\\/g, '/'))}`
}

export function findDrama(dramas: Drama[], id: string | null): Drama | undefined {
  if (!id) return undefined
  return dramas.find((d) => d.id === id)
}

export function fmtSec(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function fmtSize(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(2)} GB`
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
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
  }, 2000)
  return () => {
    off?.()
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
}
