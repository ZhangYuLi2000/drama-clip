import { message } from 'antd'
import { create } from 'zustand'

export type Screen = 'studio' | 'queue' | 'settings'
export type StudioTab = 'cuts' | 'replica'

interface StoreState {
  screen: Screen
  selectedDramaId: string | null
  selectedCutId: string | null
  studioTab: StudioTab
  selectedReplicaId: string | null
  importOpen: boolean
  q: string
}

interface Actions {
  goto: (screen: Screen) => void
  openDrama: (dramaId: string) => void
  backToProjects: () => void
  selectCut: (cutId: string | null) => void
  setStudioTab: (tab: StudioTab) => void
  selectReplica: (replicaId: string | null) => void
  openReplicaTab: (dramaId: string) => void
  setImportOpen: (open: boolean) => void
  setQ: (q: string) => void
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

export const useStore = create<StoreState & Actions>()((set) => ({
  screen: 'studio',
  selectedDramaId: null,
  selectedCutId: null,
  studioTab: 'cuts',
  selectedReplicaId: null,
  importOpen: false,
  q: '',

  goto: (screen) => {
    withViewTransition(() => {
      set({ screen })
    })
  },
  openDrama: (dramaId) => {
    withViewTransition(() => {
      set({ screen: 'studio', selectedDramaId: dramaId, selectedCutId: null, studioTab: 'cuts', selectedReplicaId: null })
    })
  },
  backToProjects: () => {
    withViewTransition(() => {
      set({ screen: 'studio', selectedDramaId: null, selectedCutId: null, selectedReplicaId: null })
    })
  },
  selectCut: (selectedCutId) => set({ selectedCutId }),
  setStudioTab: (studioTab) => set({ studioTab }),
  selectReplica: (selectedReplicaId) => set({ selectedReplicaId }),
  openReplicaTab: (dramaId) => {
    withViewTransition(() => {
      set({ screen: 'studio', selectedDramaId: dramaId, studioTab: 'replica' })
    })
  },
  setImportOpen: (importOpen) => set({ importOpen }),
  setQ: (q) => set({ q })
}))
