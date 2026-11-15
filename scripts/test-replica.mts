/** 复刻引擎数值对齐门禁（G1 指纹 / G2 检索）。
 *
 * 基准来自开发期一次性导出的 Python 版黄金数据（test/golden/replica/），
 * 运行时零 Python 依赖。Node 26 原生直跑 TS：
 *   node scripts/test-replica.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  describe, describeVariants, blockWeights, topk, prepareVerify, bandScores, D8
} from '../electron/main/replica/fingerprint.ts'
import type { Band } from '../electron/main/replica/types.ts'

const GOLDEN = path.join(import.meta.dirname, '..', 'test', 'golden', 'replica')

let failures = 0
let checks = 0

function check(name: string, ok: boolean, detail: string): void {
  checks++
  if (ok) {
    console.log(`  PASS  ${name}  ${detail}`)
  } else {
    failures++
    console.error(`  FAIL  ${name}  ${detail}`)
  }
}

function readBytes(name: string): Uint8Array {
  const b = fs.readFileSync(path.join(GOLDEN, name))
  return new Uint8Array(b.buffer, b.byteOffset, b.length)
}

function readF32(name: string): Float32Array {
  const b = fs.readFileSync(path.join(GOLDEN, name))
  const ab = new ArrayBuffer(b.length)
  new Uint8Array(ab).set(b)
  return new Float32Array(ab)
}

function readI32(name: string): Int32Array {
  const b = fs.readFileSync(path.join(GOLDEN, name))
  const ab = new ArrayBuffer(b.length)
  new Uint8Array(ab).set(b)
  return new Int32Array(ab)
}

function readJson<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(GOLDEN, name), 'utf8')) as T
}

/** 逐行余弦相似度最小值 + 最大绝对差 */
function compareRows(a: Float32Array, b: Float32Array, rows: number, cols: number): { minCos: number; maxDiff: number } {
  let minCos = Infinity
  let maxDiff = 0
  for (let r = 0; r < rows; r++) {
    let dot = 0
    let na = 0
    let nb = 0
    for (let c = 0; c < cols; c++) {
      const x = a[r * cols + c]
      const y = b[r * cols + c]
      dot += x * y
      na += x * x
      nb += y * y
      const d = Math.abs(x - y)
      if (d > maxDiff) maxDiff = d
    }
    const cos = dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12)
    if (cos < minCos) minCos = cos
  }
  return { minCos, maxDiff }
}

const CFGS: Record<string, { mb: number; mt: number; band: Band | null }> = {
  default: { mb: 0.25, mt: 0, band: null },
  sampleB: { mb: 0.28, mt: 0.08, band: null },
  band: { mb: 0.25, mt: 0, band: [0.63, 0.78] },
  combo: { mb: 0.28, mt: 0.08, band: [0.63, 0.78] }
}

// ---------------------------------------------------------------- 单元自检

function unitSanity(): void {
  console.log('[unit] 基础自检')
  // D8 正交性
  let maxOff = 0
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      let s = 0
      for (let x = 0; x < 8; x++) s += D8[i * 8 + x] * D8[j * 8 + x]
      const expect = i === j ? 1 : 0
      maxOff = Math.max(maxOff, Math.abs(s - expect))
    }
  }
  check('D8 正交', maxOff < 1e-5, `maxOff=${maxOff.toExponential(2)}`)
  for (const [name, c] of Object.entries(CFGS)) {
    const w = blockWeights(c.mb, c.mt, 0.85, c.band)
    let s = 0
    for (let i = 0; i < 16; i++) s += w[i]
    check(`权重和=1 (${name})`, Math.abs(s - 1) < 1e-5, `sum=${s.toFixed(6)}`)
  }
}

// ---------------------------------------------------------------- G1

function g1(): void {
  console.log('[G1] 指纹 / 变体 / 权重 / 验证向量')
  const epMeta = readJson<{ n: number; h: number; w: number }>('frames_ep.json')
  const clipMeta = readJson<{ n: number; h: number; w: number }>('frames_clip.json')
  const epFrames = readBytes('frames_ep.raw')
  const clipFrames = readBytes('frames_clip.raw')

  for (const [tag, frames, meta] of [
    ['ep', epFrames, epMeta],
    ['clip', clipFrames, clipMeta]
  ] as const) {
    const desc = describe(frames, meta.n, meta.h, meta.w)
    const gold = readF32(`desc_${tag}.f32`)
    const r1 = compareRows(desc, gold, meta.n, 16 * 9)
    check(`describe(${tag})`, r1.minCos >= 0.9999 && r1.maxDiff <= 0.02,
      `minCos=${r1.minCos.toFixed(6)} maxDiff=${r1.maxDiff.toExponential(2)}`)

    const variants = describeVariants(frames, meta.n, meta.h, meta.w)
    const goldV = readF32(`variants_${tag}.f32`)
    const r2 = compareRows(variants, goldV, meta.n * 2, 16 * 9)
    check(`describeVariants(${tag})`, r2.minCos >= 0.9999 && r2.maxDiff <= 0.02,
      `minCos=${r2.minCos.toFixed(6)} maxDiff=${r2.maxDiff.toExponential(2)}`)

    for (const [cname, c] of Object.entries(CFGS)) {
      const v = prepareVerify(frames, meta.n, meta.h, meta.w, c.mb, c.mt, true, c.band)
      const gm = readJson<{ n: number; m: number }>(`verify_${tag}_${cname}.json`)
      const goldVec = readF32(`verify_${tag}_${cname}.f32`)
      const shapeOk = v.n === gm.n && v.m === gm.m
      const r3 = shapeOk ? compareRows(v.v, goldVec, gm.n, gm.m) : { minCos: 0, maxDiff: 99 }
      check(`prepareVerify(${tag},${cname})`, shapeOk && r3.minCos >= 0.9999 && r3.maxDiff <= 0.01,
        `shape=${v.n}x${v.m} gold=${gm.n}x${gm.m} minCos=${r3.minCos.toFixed(6)} maxDiff=${r3.maxDiff.toExponential(2)}`)
    }
  }

  const goldW = readJson<Record<string, number[]>>('weights.json')
  for (const [cname, c] of Object.entries(CFGS)) {
    const w = blockWeights(c.mb, c.mt, 0.85, c.band)
    let md = 0
    for (let i = 0; i < 16; i++) md = Math.max(md, Math.abs(w[i] - goldW[cname][i]))
    check(`blockWeights(${cname})`, md <= 1e-6, `maxDiff=${md.toExponential(2)}`)
  }

  // band_scores：qv=clip verify(default) 前 16 行，rv=ep verify(default)
  const bsMeta = readJson<{ nq: number; kk: number; nr: number; m: number }>('bandscores.json')
  const clipV = prepareVerify(clipFrames, clipMeta.n, clipMeta.h, clipMeta.w, 0.25, 0, true, null)
  const epV = prepareVerify(epFrames, epMeta.n, epMeta.h, epMeta.w, 0.25, 0, true, null)
  const qv = clipV.v.subarray(0, 16 * clipV.m)
  const pos = readI32('bandscores_pos.i32')
  const valid = readBytes('bandscores_valid.u8')
  const sc = bandScores(qv, bsMeta.nq, bsMeta.m, epV.v, bsMeta.nr, pos, valid, bsMeta.kk)
  const goldSc = readF32('bandscores_sc.f32')
  let md = 0
  for (let i = 0; i < sc.length; i++) md = Math.max(md, Math.abs(sc[i] - goldSc[i]))
  check('bandScores', md <= 1e-4, `maxDiff=${md.toExponential(2)}`)
}

// ---------------------------------------------------------------- G2

function g2(): void {
  console.log('[G2] 加权检索 topk（迷你索引 3 集 × 64 查询 × 2 权重）')
  const clipMeta = readJson<{ n: number }>('frames_clip.json')
  const nq = clipMeta.n
  const qdesc = readF32('desc_clip.f32')
  const goldW = readJson<Record<string, number[]>>('weights.json')
  const miniDir = path.join(GOLDEN, 'mini_index')
  const eids = fs.readdirSync(miniDir)
    .filter((f) => f.endsWith('.json') && !f.includes('topk'))
    .map((f) => f.replace('.json', ''))
    .sort()

  let totalCases = 0
  let top1Match = 0
  let maxDistDiff = 0
  let setMismatch = 0
  const t0 = performance.now()
  for (const eid of eids) {
    const meta = readJson<{ ni: number; nf: number }>(path.join('mini_index', `${eid}.json`))
    const rdesc = readF32(path.join('mini_index', `${eid}.desc.f32`))
    for (const cname of ['default', 'sampleB']) {
      const weights = Float32Array.from(goldW[cname])
      const got = topk(qdesc, nq, rdesc, meta.ni, meta.nf, weights, 4, 128)
      const gd = readF32(path.join('mini_index', `${eid}.topk_${cname}.d.f32`))
      const gr = readI32(path.join('mini_index', `${eid}.topk_${cname}.r.i32`))
      const gv = readBytes(path.join('mini_index', `${eid}.topk_${cname}.v.u8`))
      for (let q = 0; q < nq; q++) {
        totalCases++
        const ob = q * 4
        // 排序后的距离序列对比
        const a = Array.from(got.d.subarray(ob, ob + 4)).sort((x, y) => x - y)
        const b = Array.from(gd.subarray(ob, ob + 4)).sort((x, y) => x - y)
        for (let t = 0; t < 4; t++) maxDistDiff = Math.max(maxDistDiff, Math.abs(a[t] - b[t]))
        // top1（平局容差：距离差 ≤1e-6 视为平局，允许不同 ref）
        const d0g = got.d[ob]
        const d0p = gd[ob]
        const sameRef = got.r[ob] === gr[ob] && got.f[ob] === gv[ob]
        if (sameRef || Math.abs(d0g - d0p) <= 1e-6) top1Match++
        // top4 逐名次：ref 一致，或该名次距离为平局（≤1e-5，镜像变体噪声级并列）
        let rankOk = true
        for (let t = 0; t < 4; t++) {
          const sameRef = got.r[ob + t] === gr[ob + t] && got.f[ob + t] === gv[ob + t]
          if (!sameRef && Math.abs(got.d[ob + t] - gd[ob + t]) > 1e-5) {
            rankOk = false
            break
          }
        }
        if (!rankOk) {
          setMismatch++
          const fmt = (ds: ArrayLike<number>, rs: ArrayLike<number>, fs2: ArrayLike<number>): string =>
            Array.from({ length: 4 }, (_, t) => `${ds[ob + t].toFixed(7)}#${rs[ob + t]}v${fs2[ob + t]}`).join(' ')
          console.log(`    mismatch ${eid}/${cname} q=${q}\n      ts : ${fmt(got.d, got.r, got.f)}\n      py : ${fmt(gd, gr, gv)}`)
        }
      }
    }
  }
  const elapsed = performance.now() - t0
  check('top1 命中', top1Match / totalCases >= 0.99, `${top1Match}/${totalCases}`)
  check('top4 集合一致', setMismatch === 0, `mismatch=${setMismatch}/${totalCases}`)
  check('距离误差', maxDistDiff <= 1e-3, `maxDiff=${maxDistDiff.toExponential(2)}`)

  // 微基准：外推全量（86 集 ≈37.5k 索引行，150s 切片 4491 帧）
  const miniRows = eids.reduce((s, eid) => s + readJson<{ ni: number }>(path.join('mini_index', `${eid}.json`)).ni, 0)
  const perQueryRow = elapsed / 1000 / (nq * 2 * miniRows)
  const fullEst = perQueryRow * 4491 * 37500
  console.log(`  bench: ${(elapsed / 1000).toFixed(2)}s / ${nq * 2} 次检索×${miniRows} 行 → 全量单线程估算 ${fullEst.toFixed(1)}s（worker 池 ÷3）`)
}

// ---------------------------------------------------------------- main

unitSanity()
g1()
g2()
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`GATE FAILED: ${failures} 项未达标`)
  process.exit(1)
}
console.log('G1/G2 GATE PASSED')
