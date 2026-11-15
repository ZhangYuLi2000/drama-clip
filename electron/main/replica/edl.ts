/** EDL 构建与源帧去量化 —— rebuild.py 的 EDL 部分等价移植。
 *
 * despike：粗索引把真实运动量化成 0,2,0,2 抖动，直接建 EDL 会把一个镜头
 * 撕成上百个 1 帧碎段。这里按真跳切拆段，段内鲁棒直线拟合还原单调源帧路径，
 * 并用每集真实帧数上界钳制，禁止外推越界。
 */
import fs from 'node:fs'
import type { EdlSeg, TraceRow } from './types.ts'

/** Python round（银行家舍入）——拟合取整必须与 numpy/int(round()) 一致。 */
function pyRound(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d > 0.5) return f + 1
  if (d < 0.5) return f
  return f % 2 === 0 ? f : f + 1
}

/** 读取溯源表（frame_origins.csv / frame_map.csv），按切片帧号排序。 */
export function loadTrace(file: string, kind: 'origins' | 'map'): TraceRow[] {
  const text = fs.readFileSync(file, 'utf8').replace(/^\ufeff/, '')
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return []
  const head = lines[0].split(',')
  const idx = (name: string): number => head.indexOf(name)
  const iq = idx('clip_frame')
  const ie = idx('episode')
  const is = idx('src_frame')
  const iflip = idx('flip')
  const ic = kind === 'origins' ? idx('confidence') : idx('score')
  const out: TraceRow[] = []
  for (const line of lines.slice(1)) {
    const c = line.split(',')
    const sf = c[is] ?? ''
    out.push([
      parseInt(c[iq], 10),
      c[ie] ?? '',
      sf !== '' ? parseInt(sf, 10) : -1,
      iflip >= 0 ? (c[iflip] ?? '') : '',
      ic >= 0 ? (c[ic] ?? '') : ''
    ])
  }
  out.sort((a, b) => a[0] - b[0])
  return out
}

/** 去量化重建一段同集连续源帧序列（_reconstruct_run 等价）。 */
export function reconstructRun(sfSeq: number[], hi: number | null = null): number[] {
  const n = sfSeq.length
  if (n === 0) return []
  const out = sfSeq.slice()
  // 真跳切（负跳或 >6 帧跃进）处拆段
  const pieces: [number, number][] = []
  let start = 0
  for (let i = 1; i < n; i++) {
    const d = sfSeq[i] - sfSeq[i - 1]
    if (d < 0 || d > 6) {
      pieces.push([start, i])
      start = i
    }
  }
  pieces.push([start, n])
  for (const [a, b] of pieces) {
    const m = b - a
    if (m <= 2) continue
    let sumX = 0
    let sumY = 0
    for (let i = 0; i < m; i++) {
      sumX += i
      sumY += sfSeq[a + i]
    }
    const meanX = sumX / m
    const meanY = sumY / m
    let denom = 0
    for (let i = 0; i < m; i++) denom += (i - meanX) * (i - meanX)
    if (denom <= 0) continue
    let num = 0
    for (let i = 0; i < m; i++) num += (i - meanX) * (sfSeq[a + i] - meanY)
    const slope = num / denom
    if (Math.abs(slope) < 0.35) continue // 真静帧保持平直
    const intercept = meanY - slope * meanX
    const fit: number[] = new Array(m)
    for (let i = 0; i < m; i++) fit[i] = pyRound(intercept + slope * i)
    for (let i = 1; i < m; i++) {
      if (fit[i] <= fit[i - 1]) fit[i] = fit[i - 1] + (slope > 0 ? 1 : 0)
    }
    for (let i = 0; i < m; i++) out[a + i] = fit[i]
  }
  // 全局单调钳制 + 集帧数上界
  for (let i = 1; i < n; i++) {
    if (out[i] < out[i - 1]) out[i] = out[i - 1]
  }
  if (hi !== null && hi > 0) {
    for (let i = 0; i < n; i++) {
      if (out[i] > hi) out[i] = hi
    }
  }
  return out
}

/** 逐帧溯源 → 片段 EDL（build_edl 等价，含 despike）。 */
export function buildEdl(
  trace: TraceRow[], totalFrames: number, despike = true,
  epMax: Record<string, number> | null = null
): EdlSeg[] {
  let rows = trace
  if (despike && trace.length > 0) {
    const rec: TraceRow[] = trace.map((r) => [...r] as TraceRow)
    const n = rec.length
    let i = 0
    while (i < n) {
      const [q0, ep0, r0] = rec[i]
      if (r0 < 0 || ep0 === '') {
        i++
        continue
      }
      let j = i + 1
      while (j < n) {
        const [q, ep, r] = rec[j]
        if (q === rec[j - 1][0] + 1 && ep === ep0 && r >= 0) j++
        else break
      }
      if (j - i >= 2) {
        const sf: number[] = []
        for (let k = i; k < j; k++) sf.push(rec[k][2])
        let hi: number | null = null
        if (epMax) {
          const nb = epMax[ep0]
          hi = nb ? nb - 1 : null
        }
        const fit = reconstructRun(sf, hi)
        for (let k = i; k < j; k++) rec[k][2] = fit[k - i]
      }
      i = j
    }
    rows = rec
  }
  void totalFrames

  const segs: EdlSeg[] = []
  type Cur = EdlSeg & { lastR: number }
  const finalize = (s: Cur): void => {
    s.clipFrames = s.clipOut - s.clipIn
    s.srcFrames = s.srcIn >= 0 ? s.srcOut - s.srcIn : 0
    const { lastR: _drop, ...seg } = s
    void _drop
    segs.push(seg)
  }
  const make = (q: number, ep: string, r: number, flip: string, kind: EdlSeg['kind']): Cur => ({
    segmentId: segs.length + 1, clipIn: q, clipOut: q + 1, clipFrames: 0,
    episode: ep, srcIn: r, srcOut: r + 1, srcFrames: 0, kind, flip, lastR: r
  })
  let cur: Cur | null = null

  for (const [q, ep, r, flip] of rows) {
    const c = cur
    if (c === null || q !== c.clipOut) {
      if (c) finalize(c)
      cur = make(q, ep, r, flip, r < 0 ? 'gap' : 'still')
    } else if (r < 0) {
      if (c.kind === 'gap') {
        c.clipOut = q + 1
      } else {
        finalize(c)
        cur = make(q, ep, r, flip, 'gap')
      }
    } else if (ep === c.episode && c.lastR >= 0 && r - c.lastR >= 0 && r - c.lastR <= 4) {
      c.clipOut = q + 1
      c.srcOut = r + 1
      c.lastR = r
      if (r > c.srcIn) c.kind = 'continuous'
    } else {
      finalize(c)
      cur = make(q, ep, r, flip, 'still')
    }
  }
  if (cur) finalize(cur)
  return segs
}

/** 帧号列表 → 合并区间（gap 容忍），_merge_ranges 等价。 */
export function mergeRanges(frames: number[], gap = 2): [number, number][] {
  const sorted = [...frames].sort((a, b) => a - b)
  const out: [number, number][] = []
  for (const f of sorted) {
    const last = out[out.length - 1]
    if (last && f <= last[1] + gap) last[1] = Math.max(last[1], f)
    else out.push([f, f])
  }
  return out
}
