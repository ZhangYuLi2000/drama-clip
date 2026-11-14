import { createElement } from 'react'
import { Button, Space, message } from 'antd'
import { create } from 'zustand'
import type { AsrSegment, CandPatch, Candidate as RealCandidate, Episode as RealEpisode, MixStructure } from '../../shared/types'
import { STRUCTURES } from '../../shared/types'
import { candsOf, epCat, highlightsOf, useLibrary } from './library'
import type { Highlight } from './library'
import { Candidate, EP_DUR, MixClip, MixResult, fmt } from './mock/data'

export type Screen = 'home' | 'episodes' | 'highlights' | 'mix' | 'queue' | 'settings'
export type Panel = 'import' | 'preview' | 'transcript' | null
export type EpFilter = 'all' | 'review' | 'running' | 'failed' | 'idle' | 'done'
export type EpPage = 'tasks' | 'eps'
export type HlSort = 'score' | 'dur' | 'new'
export type WorkPage = 'tasks' | 'detail'

export interface HomeSlice {
  q: string
}
export interface EpSlice {
  page: EpPage
  drama: string
  q: string
  filter: EpFilter
  sel: string[]
  review: number | null
  candId: string
  pendingOnly: boolean
  time: number
  snap: boolean
  playing: boolean
  pendingSeek: number | null
}
export interface HlSlice {
  page: WorkPage
  drama: string
  ep: string
  tags: string[]
  q: string
  sort: HlSort
  view: 'grid' | 'table'
}
export interface MixSlice {
  page: WorkPage
  q: string
  drama: string
  structure: MixStructure
  prompt: string
  target: number
  ratio: '9:16' | '16:9'
  result: MixResult | null
}

export interface StoreState {
  screen: Screen
  home: HomeSlice
  ep: EpSlice
  hl: HlSlice
  mix: MixSlice
  basket: string[]
  panel: Panel
  previewId: string | null
  transcriptEp: { dramaId: string; n: number } | null
  cost: number
  cands: Candidate[]
}

interface Actions {
  goto: {
    (s: 'home', params?: Partial<HomeSlice>): void
    (s: 'episodes', params?: Partial<EpSlice>): void
    (s: 'highlights', params?: Partial<HlSlice>): void
    (s: 'mix', params?: Partial<MixSlice>): void
    (s: 'queue' | 'settings'): void
  }
  openPanel: (p: Exclude<Panel, null>) => void
  closePanel: () => void
  setHomeQ: (q: string) => void

  setEpDrama: (d: string) => void
  openDrama: (d: string) => void
  backToTasks: () => void
  setEpQ: (q: string) => void
  setEpFilter: (f: EpFilter) => void
  setEpSel: (ids: string[]) => void
  clearEpSel: () => void
  analyzeSelected: () => void
  enterReview: (n: number) => void
  reviewBack: () => void
  seekReview: (n: number, t: number) => void
  epStep: (dir: -1 | 1) => void
  setReviewEp: (n: number) => void
  selectCand: (id: string) => void
  togglePendingOnly: () => void
  togglePlay: () => void
  frameStep: (dir: -1 | 1) => void
  adjustIn: (delta: number) => void
  adjustOut: (delta: number) => void
  setInAtPlayhead: () => void
  setOutAtPlayhead: () => void
  toggleCandTag: (t: string) => void
  setSnap: (b: boolean) => void
  approve: () => void
  reject: () => void
  skip: () => void
  reopen: () => void

  setHlDrama: (d: string) => void
  openHl: (d: string) => void
  backHl: () => void
  setHlEp: (ep: string) => void
  setHlQ: (q: string) => void
  setHlSort: (s: HlSort) => void
  toggleHlTag: (t: string) => void
  setHlView: (v: 'grid' | 'table') => void
  deleteHl: (id: string) => void
  addToBasket: (id: string) => void
  hlSource: (id: string) => void
  openPreview: (id: string) => void

  setMixDrama: (d: string) => void
  setMixStructure: (s: MixStructure) => void
  setMixQ: (q: string) => void
  openMix: (d: string) => void
  backMix: () => void
  setMixPrompt: (p: string) => void
  setMixTarget: (t: number) => void
  setMixRatio: (r: '9:16' | '16:9') => void
  basketMove: (idx: number, dir: -1 | 1) => void
  basketRemove: (id: string) => void
  basketClear: () => void
  smartPick: () => void
  generate: () => void
  clipMove: (idx: number, dir: -1 | 1) => void
  clipRemove: (idx: number) => void
  mixReset: () => void
  render: () => void

  globalSearch: (q: string) => void
}

export type Store = StoreState & Actions

const SLICE_KEY: Partial<Record<Screen, 'home' | 'ep' | 'hl' | 'mix'>> = {
  home: 'home',
  episodes: 'ep',
  highlights: 'hl',
  mix: 'mix'
}

let toastSeq = 0
export function toast(
  msg: string,
  type: 'success' | 'info' = 'success',
  action?: { label: string; onClick: () => void }
): void {
  const key = `dw-toast-${++toastSeq}`
  message.open({
    key,
    type,
    duration: 3.8,
    content: createElement(
      Space,
      { size: 4 },
      createElement('span', null, msg),
      action
        ? createElement(
            Button,
            {
              type: 'link',
              size: 'small',
              style: { padding: 0 },
              onClick: () => {
                action.onClick()
                message.destroy(key)
              }
            },
            action.label
          )
        : null
    )
  })
}

let renderPollTimer: ReturnType<typeof setInterval> | null = null

export function pendingOf(s: StoreState, d: string): number {
  const drama = useLibrary.getState().dramas.find((x) => x.id === d)
  return (drama?.episodes ?? []).reduce((n, e) => n + e.pending, 0)
}
export function totalPending(s: StoreState): number {
  return useLibrary
    .getState()
    .dramas.reduce((n, d) => n + d.episodes.reduce((m, e) => m + e.pending, 0), 0)
}
export function totalAnalyzed(s: StoreState): number {
  return useLibrary
    .getState()
    .dramas.reduce((n, d) => n + d.episodes.filter((e) => e.asr === 'done').length, 0)
}
export function visibleEps(s: StoreState): RealEpisode[] {
  const d = useLibrary.getState().dramas.find((x) => x.id === s.ep.drama)
  return (d?.episodes ?? []).filter((e) => {
    if (s.ep.filter !== 'all' && epCat(e) !== s.ep.filter) return false
    if (s.ep.q && String(e.n).indexOf(s.ep.q.trim()) < 0) return false
    return true
  })
}
export function hlEpOptions(hls: Highlight[], drama: string): number[] {
  const eps: number[] = []
  hls.forEach((h) => {
    if ((drama === 'all' || h.dramaId === drama) && !eps.includes(h.ep)) eps.push(h.ep)
  })
  return eps.sort((a, b) => a - b)
}
export function filterHls(hls: Highlight[], hl: HlSlice): Highlight[] {
  const epOpts = hlEpOptions(hls, hl.drama)
  const epValid = hl.ep === 'all' || epOpts.includes(Number(hl.ep))
  const list = hls.filter((h) => {
    if (hl.drama !== 'all' && h.dramaId !== hl.drama) return false
    if (epValid && hl.ep !== 'all' && String(h.ep) !== hl.ep) return false
    if (hl.tags.length && !hl.tags.some((t) => h.tags.includes(t))) return false
    if (hl.q) {
      const q = hl.q.toLowerCase()
      const hay = `${h.title} ${h.tags.join(' ')} ${h.scene}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
  if (hl.sort === 'score') return [...list].sort((a, b) => b.score - a.score)
  if (hl.sort === 'dur') return [...list].sort((a, b) => b.dur - a.dur)
  return [...list].sort((a, b) => (b.approvedAt ?? 0) - (a.approvedAt ?? 0))
}
export function basketDurOf(hls: Highlight[], basket: string[]): number {
  const t = basket.reduce((n, id) => {
    const h = hls.find((x) => x.id === id)
    return n + (h ? h.dur : 0)
  }, 0)
  return Math.round(t * 10) / 10
}

function toUi(c: RealCandidate): Candidate {
  return { ...c, lines: [] }
}

function loadedCands(dramaId: string, n: number): Candidate[] {
  return candsOf(useLibrary.getState().dramas, dramaId, n).map(toUi)
}

function epIdOf(s: StoreState): string | null {
  const d = useLibrary.getState().dramas.find((x) => x.id === s.ep.drama)
  return d?.episodes.find((e) => e.n === s.ep.review)?.id ?? null
}

function persistCand(s: StoreState, candId: string, patch: CandPatch): void {
  const epId = epIdOf(s)
  if (!epId) return
  void useLibrary
    .getState()
    .updateCandidate(s.ep.drama, epId, candId, patch)
    .catch(() => {
      // 持久化失败时，下次进入审核以媒体库为准
    })
}

function snapToShot(t: number, shots: number[], segments: AsrSegment[]): number {
  let best = t
  let bestDist = 0.75
  for (const b of shots) {
    const d = Math.abs(b - t)
    if (d < bestDist) {
      best = b
      bestDist = d
    }
  }
  if (best === t) return t
  // 落在台词中间则放弃吸附，避免切断半句话
  for (const sg of segments) {
    if (best > sg.start + 0.15 && best < sg.end - 0.15) return t
  }
  return best
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

export const useStore = create<Store>()((set, get) => {
  function stopPlay(): void {
    if (get().ep.playing) set((s) => ({ ep: { ...s.ep, playing: false } }))
  }
  function reviewDur(s: StoreState): number {
    const d = useLibrary.getState().dramas.find((x) => x.id === s.ep.drama)
    const e = d?.episodes.find((x) => x.n === s.ep.review)
    return e?.duration ?? EP_DUR
  }
  function advance(): void {
    const s = get()
    const idx = s.cands.findIndex((c) => c.id === s.ep.candId)
    for (let j = idx + 1; j < s.cands.length; j++) {
      if (s.cands[j].status === 'pending') {
        get().selectCand(s.cands[j].id)
        return
      }
    }
    for (let k = 0; k < idx; k++) {
      if (s.cands[k].status === 'pending') {
        get().selectCand(s.cands[k].id)
        return
      }
    }
    toast('本集候选已全部审完')
  }

  return {
    screen: 'home',
    home: { q: '' },
    ep: {
      page: 'tasks',
      drama: '',
      q: '',
      filter: 'all',
      sel: [],
      review: null,
      candId: '',
      pendingOnly: false,
      time: 0,
      snap: false,
      playing: false,
      pendingSeek: null
    },
    hl: { page: 'tasks', drama: 'all', ep: 'all', tags: [], q: '', sort: 'score', view: 'grid' },
    mix: {
      page: 'tasks',
      q: '',
      drama: '',
      structure: 'blast',
      prompt: '剪一条 60 秒高光合集：开头 3 秒要钩子，中段冲突升级，结尾留悬念。',
      target: 60,
      ratio: '9:16',
      result: null
    },
    basket: [],
    panel: null,
    previewId: null,
    transcriptEp: null,
    cost: 0.42,
    cands: [],

    goto: (screen: Screen, params?: object) => {
      stopPlay()
      const key = SLICE_KEY[screen]
      withViewTransition(() => {
        set((s) => {
          if (!key) return { screen, panel: null }
          const slice = params ? { ...s[key], ...params } : s[key]
          return { screen, panel: null, [key]: slice } as Partial<Store>
        })
      })
    },
    openPanel: (p) => {
      set({ panel: p })
    },
    closePanel: () => {
      set({ panel: null })
    },
    setHomeQ: (q) => set((s) => ({ home: { ...s.home, q } })),

    setEpDrama: (d) => {
      stopPlay()
      set((s) => ({
        ep: { ...s.ep, drama: d, review: null, sel: [], filter: 'all', q: '' }
      }))
    },
    openDrama: (d) => {
      stopPlay()
      withViewTransition(() => {
        set((s) => ({
          ep: { ...s.ep, page: 'eps', drama: d, review: null, sel: [], filter: 'all', q: '' }
        }))
      })
    },
    backToTasks: () => {
      stopPlay()
      withViewTransition(() => {
        set((s) => ({
          ep: { ...s.ep, page: 'tasks', review: null, sel: [], filter: 'all', q: '' }
        }))
      })
    },
    setEpQ: (q) => set((s) => ({ ep: { ...s.ep, q } })),
    setEpFilter: (f) => set((s) => ({ ep: { ...s.ep, filter: f, sel: [] } })),
    setEpSel: (ids) => set((s) => ({ ep: { ...s.ep, sel: ids } })),
    clearEpSel: () => set((s) => ({ ep: { ...s.ep, sel: [] } })),
    analyzeSelected: () => {
      const s = get()
      const d = useLibrary.getState().dramas.find((x) => x.id === s.ep.drama)
      const chosen = (d?.episodes ?? []).filter((e) => s.ep.sel.includes(e.id))
      const eligible = chosen.filter((e) => e.ana !== 'run' && e.ana !== 'queue')
      if (eligible.length === 0) {
        toast('所选剧集都已在分析队列中', 'info')
        return
      }
      const dramaId = s.ep.drama
      void (async () => {
        let ok = 0
        let skip = chosen.length - eligible.length
        for (const e of eligible) {
          try {
            await useLibrary.getState().startAnalyze(dramaId, e.id)
            ok++
          } catch {
            skip++
          }
        }
        set((st) => ({ ep: { ...st.ep, sel: [] } }))
        toast(`已加入视频理解队列 ${ok} 集${skip > 0 ? `，跳过 ${skip} 集` : ''}`)
      })()
    },
    enterReview: (n) => {
      stopPlay()
      const list = loadedCands(get().ep.drama, n)
      withViewTransition(() => {
        set((st) => ({
          cands: list,
          ep: { ...st.ep, review: n, candId: list[0]?.id ?? '', pendingOnly: false, pendingSeek: null }
        }))
      })
    },
    reviewBack: () => {
      stopPlay()
      withViewTransition(() => {
        set((s) => ({ ep: { ...s.ep, review: null } }))
      })
    },
    seekReview: (n, t) => {
      stopPlay()
      const list = loadedCands(get().ep.drama, n)
      set((st) => ({
        cands: list,
        ep: { ...st.ep, review: n, candId: list[0]?.id ?? '', pendingSeek: t }
      }))
    },
    epStep: (dir) => {
      stopPlay()
      const s = get()
      const d = useLibrary.getState().dramas.find((x) => x.id === s.ep.drama)
      const list = d?.episodes ?? []
      const idx = list.findIndex((e) => e.n === s.ep.review)
      const to = idx + dir
      if (idx >= 0 && to >= 0 && to < list.length) {
        const n = list[to].n
        const cands = loadedCands(s.ep.drama, n)
        set((st) => ({
          cands,
          ep: { ...st.ep, review: n, candId: cands[0]?.id ?? '', pendingSeek: null }
        }))
      }
    },
    setReviewEp: (n) => {
      stopPlay()
      const list = loadedCands(get().ep.drama, n)
      set((st) => ({
        cands: list,
        ep: { ...st.ep, review: n, candId: list[0]?.id ?? '', pendingSeek: null }
      }))
    },
    selectCand: (id) => {
      stopPlay()
      const c = get().cands.find((x) => x.id === id)
      if (!c) return
      set((s) => ({ ep: { ...s.ep, candId: id, time: c.in, pendingSeek: null } }))
    },
    togglePendingOnly: () => {
      const s = get()
      const next = !s.ep.pendingOnly
      set((st) => ({ ep: { ...st.ep, pendingOnly: next } }))
      if (next) {
        const cur = get().cands.find((c) => c.id === get().ep.candId)
        if (cur && cur.status !== 'pending') {
          const first = get().cands.find((c) => c.status === 'pending')
          if (first) get().selectCand(first.id)
        }
      }
    },
    togglePlay: () => {
      const s = get()
      if (s.ep.review === null) return
      if (s.ep.playing) {
        stopPlay()
        return
      }
      set((st) => ({ ep: { ...st.ep, playing: true } }))
    },
    frameStep: (dir) => {
      stopPlay()
      const s = get()
      set((st) => ({
        ep: { ...st.ep, time: Math.max(0, Math.min(reviewDur(st), st.ep.time + dir * 0.04)) }
      }))
    },
    adjustIn: (delta) => {
      set((s) => ({
        cands: s.cands.map((c) =>
          c.id === s.ep.candId
            ? { ...c, in: Math.max(0, Math.min(c.out - 0.5, c.in + delta)) }
            : c
        )
      }))
      const s = get()
      const c = s.cands.find((x) => x.id === s.ep.candId)
      if (c) persistCand(s, c.id, { in: c.in })
    },
    adjustOut: (delta) => {
      const dur = reviewDur(get())
      set((s) => ({
        cands: s.cands.map((c) =>
          c.id === s.ep.candId
            ? { ...c, out: Math.min(dur, Math.max(c.in + 0.5, c.out + delta)) }
            : c
        )
      }))
      const s = get()
      const c = s.cands.find((x) => x.id === s.ep.candId)
      if (c) persistCand(s, c.id, { out: c.out })
    },
    setInAtPlayhead: () => {
      set((s) => ({
        cands: s.cands.map((c) =>
          c.id === s.ep.candId ? { ...c, in: Math.min(s.ep.time, c.out - 0.5) } : c
        )
      }))
      const s = get()
      const c = s.cands.find((x) => x.id === s.ep.candId)
      if (c) persistCand(s, c.id, { in: c.in })
    },
    setOutAtPlayhead: () => {
      set((s) => ({
        cands: s.cands.map((c) =>
          c.id === s.ep.candId ? { ...c, out: Math.max(s.ep.time, c.in + 0.5) } : c
        )
      }))
      const s = get()
      const c = s.cands.find((x) => x.id === s.ep.candId)
      if (c) persistCand(s, c.id, { out: c.out })
    },
    toggleCandTag: (t) => {
      set((s) => ({
        cands: s.cands.map((c) =>
          c.id === s.ep.candId
            ? { ...c, tags: c.tags.includes(t) ? c.tags.filter((x) => x !== t) : [...c.tags, t] }
            : c
        )
      }))
      const s = get()
      const c = s.cands.find((x) => x.id === s.ep.candId)
      if (c) persistCand(s, c.id, { tags: c.tags })
    },
    setSnap: (b) => set((s) => ({ ep: { ...s.ep, snap: b } })),
    approve: () => {
      const s = get()
      const c = s.cands.find((x) => x.id === s.ep.candId)
      if (!c || c.status !== 'pending' || s.ep.review === null) return
      stopPlay()
      const realEp = useLibrary
        .getState()
        .dramas.find((x) => x.id === s.ep.drama)
        ?.episodes.find((e) => e.n === s.ep.review)
      let tin = c.in
      let tout = c.out
      let snapped = false
      const shots = realEp?.shots ?? []
      if (s.ep.snap && shots.length > 0) {
        const segs = realEp?.segments ?? []
        const si = snapToShot(c.in, shots, segs)
        const so = snapToShot(c.out, shots, segs)
        if (so - si >= 1) {
          tin = si
          tout = so
          snapped = si !== c.in || so !== c.out
        }
      }
      set((st) => ({
        cands: st.cands.map((x) => (x.id === c.id ? { ...x, status: 'approved' as const, in: tin, out: tout } : x))
      }))
      persistCand(get(), c.id, { status: 'approved', in: tin, out: tout, tags: c.tags })
      toast(
        `已通过：第 ${s.ep.review} 集 ${fmt(tin)}–${fmt(tout)}${snapped ? '（已吸附镜头边界）' : ''} · 切片入库中`,
        'success'
      )
      advance()
    },
    reject: () => {
      const s = get()
      const c = s.cands.find((x) => x.id === s.ep.candId)
      if (!c || c.status !== 'pending' || s.ep.review === null) return
      set((st) => ({
        cands: st.cands.map((x) => (x.id === c.id ? { ...x, status: 'rejected' as const } : x))
      }))
      persistCand(get(), c.id, { status: 'rejected' })
      toast(`已驳回：${c.title}`, 'info')
      advance()
    },
    skip: () => advance(),
    reopen: () => {
      const s = get()
      if (s.ep.review === null) return
      const c = s.cands.find((x) => x.id === s.ep.candId)
      if (!c) return
      set((st) => ({
        cands: st.cands.map((x) => (x.id === c.id ? { ...x, status: 'pending' as const } : x))
      }))
      persistCand(get(), c.id, { status: 'pending' })
    },

    setHlDrama: (d) => set((s) => ({ hl: { ...s.hl, drama: d, ep: 'all' } })),
    openHl: (d) =>
      withViewTransition(() => {
        set((s) => ({
          screen: 'highlights',
          panel: null,
          hl: { ...s.hl, page: 'detail', drama: d, ep: 'all', q: '', tags: [] }
        }))
      }),
    backHl: () =>
      withViewTransition(() => {
        set((s) => ({
          hl: { ...s.hl, page: 'tasks', drama: 'all', ep: 'all', q: '', tags: [] }
        }))
      }),
    setHlEp: (ep) => set((s) => ({ hl: { ...s.hl, ep } })),
    setHlQ: (q) => set((s) => ({ hl: { ...s.hl, q } })),
    setHlSort: (sort) => set((s) => ({ hl: { ...s.hl, sort } })),
    toggleHlTag: (t) =>
      set((s) => ({
        hl: {
          ...s.hl,
          tags: s.hl.tags.includes(t) ? s.hl.tags.filter((x) => x !== t) : [...s.hl.tags, t]
        }
      })),
    setHlView: (v) => set((s) => ({ hl: { ...s.hl, view: v } })),
    deleteHl: (id) => {
      const h = highlightsOf(useLibrary.getState().dramas).find((x) => x.id === id)
      if (!h) return
      void useLibrary
        .getState()
        .deleteHighlight(h.dramaId, h.episodeId, h.id)
        .then(() => {
          set((st) => ({ basket: st.basket.filter((x) => x !== id) }))
          toast(`已删除高光：${h.title}（候选回到待审）`, 'info')
        })
        .catch((e: unknown) => toast(e instanceof Error ? e.message : '删除失败', 'info'))
    },
    addToBasket: (id) => {
      const s = get()
      if (s.basket.includes(id)) return
      const h = highlightsOf(useLibrary.getState().dramas).find((x) => x.id === id)
      set((st) => ({ basket: [...st.basket, id] }))
      toast(`已加入素材篮：${h ? h.title : ''}`, 'success', {
        label: '去混剪',
        onClick: () => get().goto('mix', { page: 'detail', drama: h?.dramaId ?? get().mix.drama })
      })
    },
    hlSource: (id) => {
      const h = highlightsOf(useLibrary.getState().dramas).find((x) => x.id === id)
      if (!h) return
      get().goto('episodes', { page: 'eps', drama: h.dramaId })
      get().seekReview(h.ep, h.in)
    },
    openPreview: (id) => {
      set({ previewId: id, panel: 'preview' })
    },

    setMixDrama: (d) => set((s) => ({ mix: { ...s.mix, drama: d } })),
    setMixStructure: (structure) => set((s) => ({ mix: { ...s.mix, structure } })),
    setMixQ: (q) => set((s) => ({ mix: { ...s.mix, q } })),
    openMix: (d) =>
      withViewTransition(() => {
        set((s) => ({
          screen: 'mix',
          panel: null,
          mix: { ...s.mix, page: 'detail', drama: d, q: '' }
        }))
      }),
    backMix: () =>
      withViewTransition(() => {
        set((s) => ({ mix: { ...s.mix, page: 'tasks', q: '' } }))
      }),
    setMixPrompt: (p) => set((s) => ({ mix: { ...s.mix, prompt: p } })),
    setMixTarget: (t) => set((s) => ({ mix: { ...s.mix, target: t } })),
    setMixRatio: (r) => set((s) => ({ mix: { ...s.mix, ratio: r } })),
    basketMove: (idx, dir) => {
      set((s) => {
        const to = idx + dir
        if (to < 0 || to >= s.basket.length) return {}
        const basket = [...s.basket]
        ;[basket[idx], basket[to]] = [basket[to], basket[idx]]
        return { basket }
      })
    },
    basketRemove: (id) => set((s) => ({ basket: s.basket.filter((x) => x !== id) })),
    basketClear: () => set({ basket: [] }),
    smartPick: () => {
      const s = get()
      if (!s.mix.drama) {
        toast('请先选择素材范围（短剧）', 'info')
        return
      }
      const pool = highlightsOf(useLibrary.getState().dramas)
        .filter((h) => h.dramaId === s.mix.drama)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
      if (pool.length === 0) {
        toast('该剧还没有入库高光，先去剧集管理审核', 'info')
        return
      }
      set({ basket: pool.map((h) => h.id) })
      toast(`已按评分智能选材 ${pool.length} 条（演示：实际版本结合创作需求语义检索）`)
    },
    generate: () => {
      const s = get()
      if (s.basket.length === 0) {
        toast('素材篮为空，先去高光管理选材或点智能选材', 'info')
        return
      }
      if (!s.mix.drama) {
        toast('请先选择素材范围（短剧）', 'info')
        return
      }
      set((st) => ({ mix: { ...st.mix, result: { status: 'loading', clips: [], pct: 0 } } }))
      void useLibrary
        .getState()
        .arrangeMix(s.mix.drama, {
          structure: s.mix.structure,
          target: s.mix.target,
          ratio: s.mix.ratio,
          prompt: s.mix.prompt,
          basket: s.basket
        })
        .then((res) => {
          const hls = highlightsOf(useLibrary.getState().dramas)
          const clips: MixClip[] = []
          for (const c of res.clips) {
            const hl = hls.find((h) => h.id === c.candId)
            if (!hl) continue
            clips.push({
              hl,
              role: c.role,
              dur: Math.round((c.out - c.in) * 10) / 10,
              why: c.why,
              in: c.in,
              out: c.out
            })
          }
          set((st) => ({ mix: { ...st.mix, result: { status: 'ready', clips, pct: 0 } } }))
          toast(`AI 已按「${STRUCTURES[s.mix.structure].name}」编排 ${clips.length} 条`)
        })
        .catch((e: unknown) => {
          set((st) => ({ mix: { ...st.mix, result: null } }))
          toast(e instanceof Error ? e.message : '编排失败', 'info')
        })
    },
    clipMove: (idx, dir) => {
      set((s) => {
        const r = s.mix.result
        if (!r) return {}
        const to = idx + dir
        if (to < 0 || to >= r.clips.length) return {}
        const clips = [...r.clips]
        ;[clips[idx], clips[to]] = [clips[to], clips[idx]]
        return { mix: { ...s.mix, result: { ...r, clips } } }
      })
    },
    clipRemove: (idx) => {
      set((s) => {
        const r = s.mix.result
        if (!r) return {}
        const clips = r.clips.filter((_, i) => i !== idx)
        return { mix: { ...s.mix, result: clips.length ? { ...r, clips } : null } }
      })
    },
    mixReset: () => {
      if (renderPollTimer) {
        clearInterval(renderPollTimer)
        renderPollTimer = null
      }
      set((s) => ({ mix: { ...s.mix, result: null } }))
    },
    render: () => {
      const s = get()
      const r = s.mix.result
      if (!r || r.clips.length === 0) return
      if (!s.mix.drama) {
        toast('请先选择素材范围（短剧）', 'info')
        return
      }
      set((st) => ({ mix: { ...st.mix, result: { ...r, status: 'rendering', pct: 0 } } }))
      void useLibrary
        .getState()
        .renderMix(s.mix.drama, {
          ratio: s.mix.ratio,
          clips: r.clips.map((c) => ({ candId: c.hl.id, in: c.in, out: c.out }))
        })
        .then(() => {
          if (renderPollTimer) clearInterval(renderPollTimer)
          renderPollTimer = setInterval(() => {
            void useLibrary
              .getState()
              .getRenderState()
              .then((rs) => {
                const cur = get().mix.result
                if (!cur) {
                  if (renderPollTimer) {
                    clearInterval(renderPollTimer)
                    renderPollTimer = null
                  }
                  return
                }
                if (rs.status === 'done') {
                  if (renderPollTimer) {
                    clearInterval(renderPollTimer)
                    renderPollTimer = null
                  }
                  set((st) => ({ mix: { ...st.mix, result: { ...cur, status: 'done', pct: 100, output: rs.output } } }))
                  toast('渲染完成')
                } else if (rs.status === 'fail') {
                  if (renderPollTimer) {
                    clearInterval(renderPollTimer)
                    renderPollTimer = null
                  }
                  set((st) => ({ mix: { ...st.mix, result: { ...cur, status: 'ready' } } }))
                  toast(rs.error || '渲染失败', 'info')
                } else {
                  set((st) => ({ mix: { ...st.mix, result: { ...cur, pct: rs.pct } } }))
                }
              })
              .catch(() => {
                // 轮询瞬时失败忽略，下次重试
              })
          }, 1000)
        })
        .catch((e: unknown) => {
          set((st) => ({ mix: { ...st.mix, result: { ...r, status: 'ready' } } }))
          toast(e instanceof Error ? e.message : '渲染失败', 'info')
        })
    },

    globalSearch: (q) => {
      const s = get()
      if (s.screen === 'highlights') {
        set((st) => ({ hl: { ...st.hl, q } }))
      } else if (s.screen === 'mix' && s.mix.page === 'tasks') {
        set((st) => ({ mix: { ...st.mix, q } }))
      } else if (s.screen === 'mix') {
        toast('混剪处理页不支持搜索', 'info')
      } else if (s.screen === 'episodes' && s.ep.page === 'eps') {
        const n = parseInt(q, 10)
        if (n > 0) {
          stopPlay()
          const list = loadedCands(s.ep.drama, n)
          set((st) => ({ cands: list, ep: { ...st.ep, review: n, candId: list[0]?.id ?? '' } }))
        }
      } else if (s.screen === 'episodes') {
        set((st) => ({ ep: { ...st.ep, q } }))
      } else if (s.screen === 'home') {
        toast('首页只做总览，搜索请到剧集管理或高光管理', 'info')
      } else {
        toast('当前模块不支持搜索', 'info')
      }
    }
  }
})