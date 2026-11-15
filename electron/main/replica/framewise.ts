/** 逐帧出处（跳切/轮播式切片）—— framewise.py 的 TS 等价移植。
 *
 * 不做时间轴直线假设：切片每一帧直接查全库最近邻索引帧。
 * src_frame 是最近索引帧（粗定位 ±step/2），段边界精度由 EDL despike + 边界精修补偿。
 */
import fs from 'node:fs'
import path from 'node:path'
import { decodeSelect, frameTc, probe, selectAll } from './frames.ts'
import { blockWeights, describe, topk } from './fingerprint.ts'
import { variantName } from './indexer.ts'
import type { ComputePool } from './worker-pool.ts'
import type { Band, Note, OriginRow, ReplicaIndex } from './types.ts'

export interface FramewiseCfg {
  size?: number
  maskBottom?: number
  maskTop?: number
  band?: Band | null
  frameMaxDist?: number
  exactPts?: boolean
  chunk?: number
}

export interface FramewiseMeta {
  clip: string
  clip_fps: number
  clip_frames: number
  clip_duration: number
  episodes: number
  max_dist: number
  counts: { high: number; medium: number; low: number; none: number }
  note: string
}

export interface FramewiseResult {
  rows: OriginRow[]
  meta: FramewiseMeta
}

export async function frameOrigins(
  index: ReplicaIndex, clipPath: string, cfg: FramewiseCfg,
  ffmpeg: string, ffprobe: string, workdir: string,
  opts: { pool?: ComputePool; note?: Note; signal?: AbortSignal } = {}
): Promise<FramewiseResult> {
  const { pool, note, signal } = opts
  const size = cfg.size ?? 64
  const qinfo = await probe(clipPath, ffprobe, cfg.exactPts ?? false)
  const qluma = await decodeSelect(clipPath, selectAll(), size, size, ffmpeg, workdir, signal)
  const nq = qluma.n
  if (nq === 0) throw new Error('切片解码不到帧')
  qinfo.nbFrames = Math.max(qinfo.nbFrames, nq)
  if (qinfo.times !== null && qinfo.times.length < nq) {
    const pad = new Float64Array(nq)
    pad.set(qinfo.times)
    const last = qinfo.times.length > 0 ? qinfo.times[qinfo.times.length - 1] : 0
    for (let i = qinfo.times.length; i < nq; i++) pad[i] = last + (i - qinfo.times.length + 1) / qinfo.fps
    qinfo.times = pad
  }
  note?.(`解码切片 ${nq} 帧 → 逐帧检索 ${index.episodes.length} 集`)

  let qdesc: Float32Array
  if (pool) {
    const r = await pool.run<{ desc: Float32Array }>('describe', {
      data: qluma.data.buffer, n: nq, h: size, w: size
    }, [qluma.data.buffer as ArrayBuffer])
    qdesc = r.desc
  } else {
    qdesc = describe(qluma.data, nq, size, size)
  }
  const weights = blockWeights(cfg.maskBottom ?? 0.25, cfg.maskTop ?? 0, 0.85, cfg.band ?? null)
  const maxDist = cfg.frameMaxDist ?? 0.15
  const chunk = cfg.chunk ?? 128

  const bestD = new Float32Array(nq).fill(Infinity)
  const bestEp = new Int32Array(nq).fill(-1)
  const bestR = new Int32Array(nq).fill(-1)
  const bestV = new Int32Array(nq).fill(-1)

  const merge = (ei: number, d: Float32Array, r: Int32Array, f: Uint8Array): number => {
    let take = 0
    const ep = index.episodes[ei]
    for (let q = 0; q < nq; q++) {
      if (d[q] < bestD[q]) {
        bestD[q] = d[q]
        bestEp[q] = ei
        bestR[q] = ep.frameIdx[r[q]]
        bestV[q] = f[q]
        take++
      }
    }
    return take
  }

  if (pool) {
    const jobs = index.episodes.map((ep, ei) =>
      pool.run<{ d: Float32Array; r: Int32Array; f: Uint8Array }>('topk', {
        qdesc: qdesc.buffer, nq, rdesc: ep.desc.buffer, nr: ep.ni, nf: ep.nf,
        weights: weights.buffer, k: 1, chunk
      }).then((res) => ({ ei, ...res }))
    )
    const results = await Promise.all(jobs)
    results.sort((a, b) => a.ei - b.ei)
    for (const res of results) {
      if (signal?.aborted) throw new Error('已取消')
      const take = merge(res.ei, res.d, res.r, res.f)
      note?.(`  ${index.episodes[res.ei].eid}: ${take} 帧在此集取得最优`)
    }
  } else {
    for (let ei = 0; ei < index.episodes.length; ei++) {
      if (signal?.aborted) throw new Error('已取消')
      const ep = index.episodes[ei]
      const res = topk(qdesc, nq, ep.desc, ep.ni, ep.nf, weights, 1, chunk)
      const take = merge(ei, res.d, res.r, res.f)
      note?.(`  ${ep.eid}: ${take} 帧在此集取得最优`)
    }
  }

  const rows: OriginRow[] = []
  const counts = { high: 0, medium: 0, low: 0, none: 0 }
  for (let q = 0; q < nq; q++) {
    const ei = bestEp[q]
    const d = bestD[q]
    const ep = ei >= 0 ? index.episodes[ei] : undefined
    const r = bestR[q]
    let label: OriginRow['confidence']
    if (!ep || d > maxDist) label = 'none'
    else if (d < 0.03) label = 'high'
    else if (d < 0.08) label = 'medium'
    else label = 'low'
    counts[label]++
    rows.push({
      clipFrame: q,
      clipTc: frameTc(q, qinfo),
      episode: ep ? ep.eid : '',
      episodeFile: ep ? ep.name : '',
      srcFrame: ep && label !== 'none' ? r : null,
      srcTc: ep && label !== 'none' ? frameTc(r, ep.info) : '',
      distance: Number(d.toFixed(5)),
      flip: ep ? variantName(index, bestV[q]) : '',
      indexStep: ep ? ep.step : null,
      confidence: label
    })
  }
  note?.(`逐帧出处：high=${counts.high} medium=${counts.medium} low=${counts.low} none=${counts.none}（有出处 ${nq - counts.none} / ${nq}）`)
  const meta: FramewiseMeta = {
    clip: path.resolve(clipPath),
    clip_fps: qinfo.fps,
    clip_frames: nq,
    clip_duration: qinfo.duration,
    episodes: index.episodes.length,
    max_dist: maxDist,
    counts,
    note: 'src_frame 为最近的索引帧（粗定位，±step/2）；段边界由 despike+精修补偿'
  }
  return { rows, meta }
}

function csvCell(v: string | number | null): string {
  const s = v === null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function writeFrameOrigins(rows: OriginRow[], meta: FramewiseMeta, outdir: string): { csv: string; json: string } {
  fs.mkdirSync(outdir, { recursive: true })
  const cols = ['clip_frame', 'clip_tc', 'episode', 'episode_file', 'src_frame', 'src_tc', 'distance', 'flip', 'index_step', 'confidence']
  const lines = [cols.join(',')]
  for (const r of rows) {
    lines.push([
      r.clipFrame, r.clipTc, r.episode, r.episodeFile, r.srcFrame, r.srcTc,
      r.distance, r.flip, r.indexStep, r.confidence
    ].map(csvCell).join(','))
  }
  const cp = path.join(outdir, 'frame_origins.csv')
  fs.writeFileSync(cp, `\ufeff${lines.join('\r\n')}\r\n`, 'utf8')
  const jp = path.join(outdir, 'frame_origins.json')
  fs.writeFileSync(jp, JSON.stringify({ meta, frames: rows }, null, 1), 'utf8')
  return { csv: cp, json: jp }
}
