import { createElement } from 'react'
import { Button, Space, message } from 'antd'
import { create } from 'zustand'
import {
  Candidate,
  DRAMAS,
  EP_DUR,
  Episode,
  Highlight,
  INITIAL_CANDS,
  INITIAL_EPS,
  INITIAL_HLS,
  MixClip,
  MixResult,
  ROLES,
  ROLE_CAP,
  ROLE_WHY,
  epCat,
  fmt,
  nearestShot
} from './mock/data'

export type Screen = 'home' | 'episodes' | 'highlights' | 'mix' | 'queue' | 'settings'
export type Panel = 'import' | 'preview' | null
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
  sel: number[]
  review: number | null
  candId: string
  pendingOnly: boolean
  time: number
  snap: boolean
  playing: boolean
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
  prompt: string
  target: number
  ratio: '9:16' | '16:9'
  bgm: boolean
  subs: boolean
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
  previewT: number
  previewPlaying: boolean
  scanned: boolean
  cost: number
  seq: number
  eps: Record<string, Episode[]>
  cands: Candidate[]
  hls: Highlight[]
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
  toggleEpSel: (n: number) => void
  toggleEpCheckAll: () => void
  clearEpSel: () => void
  batchAnalyze: () => void
  analyzeEp: (n: number) => void
  analyzeAll: () => void
  retryEp: (n: number) => void
  enterReview: (n: number) => void
  reviewBack: () => void
  gotoDemo: () => void
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
  togglePreviewPlay: () => void

  setMixDrama: (d: string) => void
  setMixQ: (q: string) => void
  openMix: (d: string) => void
  backMix: () => void
  setMixPrompt: (p: string) => void
  setMixTarget: (t: number) => void
  setMixRatio: (r: '9:16' | '16:9') => void
  setMixBgm: (b: boolean) => void
  setMixSubs: (b: boolean) => void
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

let playTimer: ReturnType<typeof setInterval> | null = null
let previewTimer: ReturnType<typeof setInterval> | null = null
let mixTimer: ReturnType<typeof setTimeout> | null = null
let renderTimer: ReturnType<typeof setInterval> | null = null

export function inReviewDemo(s: StoreState): boolean {
  return s.screen === 'episodes' && s.ep.review === 3 && s.ep.drama === 'd1'
}

export function pendingOf(s: StoreState, d: string): number {
  return (s.eps[d] ?? []).reduce((n, e) => n + (e.pending ?? 0), 0)
}
export function totalPending(s: StoreState): number {
  return DRAMAS.reduce((n, d) => n + pendingOf(s, d.id), 0)
}
export function hlCountOf(s: StoreState, d: string): number {
  return s.hls.filter((h) => h.d === d).length
}
export function totalAnalyzed(s: StoreState): number {
  return DRAMAS.reduce(
    (n, d) => n + (s.eps[d.id] ?? []).filter((e) => e.ana === 'done').length,
    0
  )
}
export function visibleEps(s: StoreState): Episode[] {
  return (s.eps[s.ep.drama] ?? []).filter((e) => {
    if (s.ep.filter !== 'all' && epCat(e) !== s.ep.filter) return false
    if (s.ep.q && String(e.n).indexOf(s.ep.q.trim()) < 0) return false
    return true
  })
}
export function hlEpOptions(s: StoreState): number[] {
  const eps: number[] = []
  s.hls.forEach((h) => {
    if ((s.hl.drama === 'all' || h.d === s.hl.drama) && !eps.includes(h.ep)) eps.push(h.ep)
  })
  return eps.sort((a, b) => a - b)
}
export function filteredHls(s: StoreState): Highlight[] {
  const epOpts = hlEpOptions(s)
  const epValid = s.hl.ep === 'all' || epOpts.includes(Number(s.hl.ep))
  const list = s.hls.filter((h) => {
    if (s.hl.drama !== 'all' && h.d !== s.hl.drama) return false
    if (epValid && s.hl.ep !== 'all' && String(h.ep) !== s.hl.ep) return false
    if (s.hl.tags.length && !s.hl.tags.some((t) => h.tags.includes(t))) return false
    if (s.hl.q) {
      const q = s.hl.q.toLowerCase()
      const hay = `${h.title} ${h.tags.join(' ')} ${h.scene}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
  if (s.hl.sort === 'score') return [...list].sort((a, b) => b.score - a.score)
  if (s.hl.sort === 'dur') return [...list].sort((a, b) => b.dur - a.dur)
  return list
}
export function basketDur(s: StoreState): number {
  const t = s.basket.reduce((n, id) => {
    const h = s.hls.find((x) => x.id === id)
    return n + (h ? h.dur : 0)
  }, 0)
  return Math.round(t * 10) / 10
}
export function buildMix(s: StoreState): MixClip[] {
  return s.basket
    .map((id, idx) => {
      const h = s.hls.find((x) => x.id === id)
      if (!h) return null
      const role = ROLES[idx] ?? '补充'
      return {
        hl: h,
        role,
        dur: Math.min(h.dur, ROLE_CAP[role] ?? 10),
        why: ROLE_WHY[role] ?? '备选素材'
      }
    })
    .filter((c): c is MixClip => c !== null)
}

function updateEp(
  eps: Record<string, Episode[]>,
  d: string,
  n: number,
  fn: (e: Episode) => Episode
): Record<string, Episode[]> {
  return { ...eps, [d]: (eps[d] ?? []).map((e) => (e.n === n ? fn(e) : e)) }
}

export const useStore = create<Store>()((set, get) => {
  function stopPlay(): void {
    if (playTimer) {
      clearInterval(playTimer)
      playTimer = null
    }
    if (get().ep.playing) set((s) => ({ ep: { ...s.ep, playing: false } }))
  }
  function stopPreview(): void {
    if (previewTimer) {
      clearInterval(previewTimer)
      previewTimer = null
    }
    if (get().previewPlaying) set({ previewPlaying: false })
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
      drama: 'd1',
      q: '',
      filter: 'all',
      sel: [],
      review: null,
      candId: 'c1',
      pendingOnly: false,
      time: 12.4,
      snap: true,
      playing: false
    },
    hl: { page: 'tasks', drama: 'all', ep: 'all', tags: [], q: '', sort: 'score', view: 'grid' },
    mix: {
      page: 'tasks',
      q: '',
      drama: 'd1',
      prompt:
        '剪一条 60 秒《闪婚总裁契约妻》女主逆袭打脸合集：开头 3 秒要钩子，中段冲突升级，结尾留悬念。',
      target: 60,
      ratio: '9:16',
      bgm: true,
      subs: true,
      result: null
    },
    basket: [],
    panel: null,
    previewId: null,
    previewT: 0,
    previewPlaying: false,
    scanned: false,
    cost: 0.42,
    seq: 10,
    eps: INITIAL_EPS,
    cands: INITIAL_CANDS,
    hls: INITIAL_HLS,

    goto: (screen: Screen, params?: object) => {
      stopPlay()
      stopPreview()
      const key = SLICE_KEY[screen]
      set((s) => {
        if (!key) return { screen, panel: null }
        const slice = params ? { ...s[key], ...params } : s[key]
        return { screen, panel: null, [key]: slice } as Partial<Store>
      })
    },
    openPanel: (p) => {
      if (p !== 'preview') stopPreview()
      set({ panel: p })
    },
    closePanel: () => {
      stopPreview()
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
      set((s) => ({
        ep: { ...s.ep, page: 'eps', drama: d, review: null, sel: [], filter: 'all', q: '' }
      }))
    },
    backToTasks: () => {
      stopPlay()
      set((s) => ({
        ep: { ...s.ep, page: 'tasks', review: null, sel: [], filter: 'all', q: '' }
      }))
    },
    setEpQ: (q) => set((s) => ({ ep: { ...s.ep, q } })),
    setEpFilter: (f) => set((s) => ({ ep: { ...s.ep, filter: f, sel: [] } })),
    toggleEpSel: (n) =>
      set((s) => ({
        ep: {
          ...s.ep,
          sel: s.ep.sel.includes(n) ? s.ep.sel.filter((x) => x !== n) : [...s.ep.sel, n]
        }
      })),
    toggleEpCheckAll: () => {
      const s = get()
      const vis = visibleEps(s)
      const allSel = vis.length > 0 && vis.every((e) => s.ep.sel.includes(e.n))
      set((st) => ({
        ep: {
          ...st.ep,
          sel: allSel
            ? st.ep.sel.filter((n) => !vis.some((e) => e.n === n))
            : [...new Set([...st.ep.sel, ...vis.map((e) => e.n)])]
        }
      }))
    },
    clearEpSel: () => set((s) => ({ ep: { ...s.ep, sel: [] } })),
    batchAnalyze: () => {
      toast(`已将 ${get().ep.sel.length} 集加入 AI 分析队列（演示）`, 'info')
      set((s) => ({ ep: { ...s.ep, sel: [] } }))
    },
    analyzeEp: (n) => toast(`第 ${n} 集已加入分析队列（演示）`, 'info'),
    analyzeAll: () => toast('已将当前短剧未处理剧集加入分析队列（演示）', 'info'),
    retryEp: (n) => toast(`第 ${n} 集已用 whisper.cpp 重新排队（演示）`, 'info'),
    enterReview: (n) => {
      stopPlay()
      set((s) => ({ ep: { ...s.ep, review: n, pendingOnly: false } }))
    },
    reviewBack: () => {
      stopPlay()
      set((s) => ({ ep: { ...s.ep, review: null } }))
    },
    gotoDemo: () => {
      stopPlay()
      set((s) => ({ ep: { ...s.ep, drama: 'd1', review: 3 } }))
    },
    epStep: (dir) => {
      stopPlay()
      const s = get()
      const list = s.eps[s.ep.drama] ?? []
      const idx = list.findIndex((e) => e.n === s.ep.review)
      const to = idx + dir
      if (idx >= 0 && to >= 0 && to < list.length) {
        set((st) => ({ ep: { ...st.ep, review: list[to].n } }))
      }
    },
    setReviewEp: (n) => {
      stopPlay()
      set((s) => ({ ep: { ...s.ep, review: n } }))
    },
    selectCand: (id) => {
      stopPlay()
      const c = get().cands.find((x) => x.id === id)
      if (!c) return
      set((s) => ({ ep: { ...s.ep, candId: id, time: c.in } }))
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
      if (!inReviewDemo(s)) return
      const c = s.cands.find((x) => x.id === s.ep.candId)
      if (!c) return
      if (s.ep.playing) {
        stopPlay()
        return
      }
      set((st) => ({ ep: { ...st.ep, playing: true } }))
      playTimer = setInterval(() => {
        const st = get()
        const cand = st.cands.find((x) => x.id === st.ep.candId)
        if (!cand) return
        let t = st.ep.time + 0.1
        if (t >= cand.out) {
          t = cand.out
          stopPlay()
        }
        set((prev) => ({ ep: { ...prev.ep, time: t } }))
      }, 100)
    },
    frameStep: (dir) => {
      stopPlay()
      set((s) => ({
        ep: { ...s.ep, time: Math.max(0, Math.min(EP_DUR, s.ep.time + dir * 0.04)) }
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
    },
    adjustOut: (delta) => {
      set((s) => ({
        cands: s.cands.map((c) =>
          c.id === s.ep.candId
            ? { ...c, out: Math.min(EP_DUR, Math.max(c.in + 0.5, c.out + delta)) }
            : c
        )
      }))
    },
    setInAtPlayhead: () => {
      set((s) => ({
        cands: s.cands.map((c) =>
          c.id === s.ep.candId ? { ...c, in: Math.min(s.ep.time, c.out - 0.5) } : c
        )
      }))
    },
    setOutAtPlayhead: () => {
      set((s) => ({
        cands: s.cands.map((c) =>
          c.id === s.ep.candId ? { ...c, out: Math.max(s.ep.time, c.in + 0.5) } : c
        )
      }))
    },
    toggleCandTag: (t) => {
      set((s) => ({
        cands: s.cands.map((c) =>
          c.id === s.ep.candId
            ? { ...c, tags: c.tags.includes(t) ? c.tags.filter((x) => x !== t) : [...c.tags, t] }
            : c
        )
      }))
    },
    setSnap: (b) => set((s) => ({ ep: { ...s.ep, snap: b } })),
    approve: () => {
      const s = get()
      if (!inReviewDemo(s)) return
      const c = s.cands.find((x) => x.id === s.ep.candId)
      if (!c || c.status !== 'pending' || s.ep.review === null) return
      stopPlay()
      let tin = c.in
      let tout = c.out
      if (s.ep.snap) {
        tin = nearestShot(tin)
        tout = nearestShot(tout)
        if (tout <= tin) tout = tin + 1
      }
      const seq = s.seq + 1
      const hid = `h${seq}`
      const hl: Highlight = {
        id: hid,
        d: s.ep.drama,
        ep: s.ep.review,
        score: c.score,
        dur: Math.round((tout - tin) * 10) / 10,
        tags: [...c.tags],
        title: c.title,
        scene: c.scene
      }
      set((st) => ({
        seq,
        cands: st.cands.map((x) => (x.id === c.id ? { ...x, status: 'approved' as const } : x)),
        hls: [hl, ...st.hls],
        eps: updateEp(st.eps, st.ep.drama, st.ep.review!, (e) => ({
          ...e,
          pending: Math.max(0, (e.pending ?? 0) - 1),
          hl: (e.hl ?? 0) + 1
        }))
      }))
      toast(
        `已入库：第 ${s.ep.review} 集 ${fmt(tin)}–${fmt(tout)}${s.ep.snap ? '（已吸附镜头边界）' : ''}`,
        'success',
        {
          label: '查看高光',
          onClick: () =>
            get().goto('highlights', { page: 'detail', drama: get().ep.drama, ep: 'all', q: '', tags: [] })
        }
      )
      advance()
    },
    reject: () => {
      const s = get()
      if (!inReviewDemo(s)) return
      const c = s.cands.find((x) => x.id === s.ep.candId)
      if (!c || c.status !== 'pending' || s.ep.review === null) return
      set((st) => ({
        cands: st.cands.map((x) => (x.id === c.id ? { ...x, status: 'rejected' as const } : x)),
        eps: updateEp(st.eps, st.ep.drama, st.ep.review!, (e) => ({
          ...e,
          pending: Math.max(0, (e.pending ?? 0) - 1)
        }))
      }))
      toast(`已驳回：${c.title}`, 'info')
      advance()
    },
    skip: () => advance(),
    reopen: () => {
      const s = get()
      if (s.ep.review === null) return
      set((st) => ({
        cands: st.cands.map((x) =>
          x.id === st.ep.candId ? { ...x, status: 'pending' as const } : x
        ),
        eps: updateEp(st.eps, st.ep.drama, st.ep.review!, (e) => ({
          ...e,
          pending: (e.pending ?? 0) + 1
        }))
      }))
    },

    setHlDrama: (d) => set((s) => ({ hl: { ...s.hl, drama: d, ep: 'all' } })),
    openHl: (d) =>
      set((s) => ({
        screen: 'highlights',
        panel: null,
        hl: { ...s.hl, page: 'detail', drama: d, ep: 'all', q: '', tags: [] }
      })),
    backHl: () =>
      set((s) => ({
        hl: { ...s.hl, page: 'tasks', drama: 'all', ep: 'all', q: '', tags: [] }
      })),
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
      const s = get()
      const removed = s.hls.find((h) => h.id === id)
      set((st) => ({
        hls: st.hls.filter((h) => h.id !== id),
        basket: st.basket.filter((x) => x !== id)
      }))
      if (removed) toast(`已删除高光：${removed.title}`, 'info')
    },
    addToBasket: (id) => {
      const s = get()
      if (s.basket.includes(id)) return
      const h = s.hls.find((x) => x.id === id)
      set((st) => ({ basket: [...st.basket, id] }))
      toast(`已加入素材篮：${h ? h.title : ''}`, 'success', {
        label: '去混剪',
        onClick: () => get().goto('mix', { page: 'detail', drama: h?.d ?? get().mix.drama })
      })
    },
    hlSource: (id) => {
      const h = get().hls.find((x) => x.id === id)
      if (h) get().goto('episodes', { page: 'eps', drama: h.d, review: h.ep })
    },
    openPreview: (id) => {
      stopPreview()
      set({ previewId: id, previewT: 0, panel: 'preview' })
    },
    togglePreviewPlay: () => {
      const s = get()
      const h = s.hls.find((x) => x.id === s.previewId)
      if (!h) return
      if (s.previewPlaying) {
        stopPreview()
        return
      }
      set({ previewPlaying: true })
      previewTimer = setInterval(() => {
        const st = get()
        const hl = st.hls.find((x) => x.id === st.previewId)
        if (!hl) return
        let t = st.previewT + 0.1
        if (t >= hl.dur) {
          t = hl.dur
          stopPreview()
        }
        set({ previewT: t })
      }, 100)
    },

    setMixDrama: (d) => set((s) => ({ mix: { ...s.mix, drama: d } })),
    setMixQ: (q) => set((s) => ({ mix: { ...s.mix, q } })),
    openMix: (d) =>
      set((s) => ({
        screen: 'mix',
        panel: null,
        mix: { ...s.mix, page: 'detail', drama: d, q: '' }
      })),
    backMix: () => set((s) => ({ mix: { ...s.mix, page: 'tasks', q: '' } })),
    setMixPrompt: (p) => set((s) => ({ mix: { ...s.mix, prompt: p } })),
    setMixTarget: (t) => set((s) => ({ mix: { ...s.mix, target: t } })),
    setMixRatio: (r) => set((s) => ({ mix: { ...s.mix, ratio: r } })),
    setMixBgm: (b) => set((s) => ({ mix: { ...s.mix, bgm: b } })),
    setMixSubs: (b) => set((s) => ({ mix: { ...s.mix, subs: b } })),
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
      const pool = s.hls
        .filter((h) => h.d === s.mix.drama)
        .sort((a, b) => b.score - a.score)
        .slice(0, 6)
      set({ basket: pool.map((h) => h.id) })
      toast(`已按评分智能选材 ${pool.length} 条（演示：实际版本结合创作需求语义检索）`)
    },
    generate: () => {
      const s = get()
      if (s.basket.length === 0) {
        toast('素材篮为空，先去高光管理选材或点智能选材', 'info')
        return
      }
      if (mixTimer) clearTimeout(mixTimer)
      set((st) => ({ mix: { ...st.mix, result: { status: 'loading', clips: [], pct: 0 } } }))
      mixTimer = setTimeout(() => {
        const st = get()
        set((prev) => ({
          cost: prev.cost + 0.02,
          mix: { ...prev.mix, result: { status: 'ready', clips: buildMix(st), pct: 0 } }
        }))
        toast(`AI 已按叙事策略编排 ${get().mix.result?.clips.length ?? 0} 条（演示）`)
      }, 900)
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
      if (renderTimer) {
        clearInterval(renderTimer)
        renderTimer = null
      }
      set((s) => ({ mix: { ...s.mix, result: null } }))
    },
    render: () => {
      set((s) => {
        const r = s.mix.result
        if (!r) return {}
        return { mix: { ...s.mix, result: { ...r, status: 'rendering', pct: 0 } } }
      })
      renderTimer = setInterval(() => {
        const r = get().mix.result
        if (!r) return
        const pct = Math.min(100, r.pct + 8)
        if (pct >= 100) {
          if (renderTimer) {
            clearInterval(renderTimer)
            renderTimer = null
          }
          set((s) => ({
            cost: s.cost + 0.06,
            mix: { ...s.mix, result: { ...r, status: 'done', pct: 100 } }
          }))
        } else {
          set((s) => ({ mix: { ...s.mix, result: { ...r, pct } } }))
        }
      }, 140)
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
          set((st) => ({ ep: { ...st.ep, review: n } }))
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