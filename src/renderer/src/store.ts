import { message } from 'antd'
import { create } from 'zustand'

export type Screen = 'studio' | 'queue' | 'settings'
export type StudioTab = 'cuts' | 'replica'
export type ThemeMode = 'dark' | 'light' | 'system'

const THEME_STORAGE_KEY = 'dw-theme-mode'

function readInitialThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'dark' || saved === 'light' || saved === 'system') return saved
  } catch {
    // ignore
  }
  return 'dark'
}

export function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return mode === 'light' ? 'light' : 'dark'
}

export function applyDomTheme(mode: ThemeMode): 'dark' | 'light' {
  const resolved = resolveTheme(mode)
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolved
    document.documentElement.style.colorScheme = resolved
  }
  return resolved
}

interface StoreState {
  screen: Screen
  selectedDramaId: string | null
  selectedCutId: string | null
  studioTab: StudioTab
  selectedReplicaId: string | null
  selectedNarrationId: string | null
  importOpen: boolean
  q: string
  themeMode: ThemeMode
  resolvedTheme: 'dark' | 'light'
}

interface Actions {
  goto: (screen: Screen) => void
  openDrama: (dramaId: string) => void
  backToProjects: () => void
  selectCut: (cutId: string | null) => void
  setStudioTab: (tab: StudioTab) => void
  selectReplica: (replicaId: string | null) => void
  selectNarration: (narrationId: string | null) => void
  openReplicaTab: (dramaId: string) => void
  setImportOpen: (open: boolean) => void
  setQ: (q: string) => void
  setThemeMode: (mode: ThemeMode) => void
  cycleThemeMode: () => void
}

export function toast(msg: string, type: 'success' | 'info' = 'success'): void {
  message.open({ type, content: msg, duration: 3.5 })
}

function withViewTransition(fn: () => void): void {
  if (
    typeof document !== 'undefined' &&
    'startViewTransition' in document &&
    typeof document.startViewTransition === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    document.startViewTransition(fn)
  } else {
    fn()
  }
}

const initMode = readInitialThemeMode()
const initResolved = applyDomTheme(initMode)

export const useStore = create<StoreState & Actions>()((set, get) => ({
  screen: 'studio',
  selectedDramaId: null,
  selectedCutId: null,
  studioTab: 'cuts',
  selectedReplicaId: null,
  selectedNarrationId: null,
  importOpen: false,
  q: '',
  themeMode: initMode,
  resolvedTheme: initResolved,

  goto: (screen) => {
    withViewTransition(() => {
      set({ screen })
    })
  },
  openDrama: (dramaId) => {
    withViewTransition(() => {
      set({ screen: 'studio', selectedDramaId: dramaId, selectedCutId: null, studioTab: 'cuts', selectedReplicaId: null, selectedNarrationId: null })
    })
  },
  backToProjects: () => {
    withViewTransition(() => {
      set({ screen: 'studio', selectedDramaId: null, selectedCutId: null, selectedReplicaId: null, selectedNarrationId: null })
    })
  },
  selectCut: (selectedCutId) => set({ selectedCutId }),
  setStudioTab: (studioTab) => set({ studioTab }),
  selectReplica: (selectedReplicaId) => set({ selectedReplicaId }),
  selectNarration: (selectedNarrationId) => set({ selectedNarrationId }),
  openReplicaTab: (dramaId) => {
    withViewTransition(() => {
      set({ screen: 'studio', selectedDramaId: dramaId, studioTab: 'replica' })
    })
  },
  setImportOpen: (importOpen) => set({ importOpen }),
  setQ: (q) => set({ q }),
  setThemeMode: (themeMode) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeMode)
    } catch {
      // ignore
    }
    const resolvedTheme = applyDomTheme(themeMode)
    set({ themeMode, resolvedTheme })
  },
  cycleThemeMode: () => {
    const order: ThemeMode[] = ['dark', 'light', 'system']
    const cur = get().themeMode
    const next = order[(order.indexOf(cur) + 1) % order.length]
    get().setThemeMode(next)
  }
}))

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mql = window.matchMedia('(prefers-color-scheme: light)')
  mql.addEventListener?.('change', () => {
    const state = useStore.getState()
    if (state.themeMode === 'system') {
      const resolvedTheme = applyDomTheme('system')
      useStore.setState({ resolvedTheme })
    }
  })
}
