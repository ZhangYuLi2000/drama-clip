/** 感知指纹与抗裁剪/镜像验证 —— fingerprint.py 的 TS 等价移植。
 *
 * 每帧 → 4×4 块网格，每块 8 个最低频 DCT 系数（去 DC、L2 归一化）+ 归一化块均值
 * → (16, 9) 描述子。块独立加权匹配，字幕带/裁边只破坏少数块。
 * 参考帧索引原图 + 水平镜像两版。全程 float32 存储，与 numpy 版数值对齐（G1/G2 门禁）。
 *
 * 数据布局（行优先扁平）：
 *   frames: Uint8Array (n, h, w)
 *   desc:   Float32Array (n, 16, 9)
 *   vdesc:  Float32Array (n, F, 16, 9)
 *   verify: Float32Array (n, M)
 */
import type { Band } from './types.ts'

export const GRID = 4
export const BS = 8
export const NCOEF = 8
export const DIM = 9

const fround = Math.fround

// ---------------------------------------------------------------- DCT 基

function buildD8(): Float32Array {
  const m = new Float32Array(64)
  for (let x = 0; x < 8; x++) {
    for (let k = 0; k < 8; k++) {
      let v = Math.cos((Math.PI * (2 * x + 1) * k) / 16)
      if (k === 0) v *= 1 / Math.SQRT2
      v *= Math.sqrt(2 / 8)
      m[x * 8 + k] = fround(v)
    }
  }
  return m
}

export const D8 = buildD8()

/** 低频系数坐标（去 DC），顺序与 Python LOW 一致 */
export const LOW: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]
]

// ---------------------------------------------------------------- 降采样

/** (n,h,w) uint8 → (n,32,32) float32；整除时面积池化，否则中心最近邻。 */
export function down32(data: Uint8Array, n: number, h: number, w: number): Float32Array {
  const out = new Float32Array(n * 32 * 32)
  if (h % 32 === 0 && w % 32 === 0) {
    const kh = h / 32
    const kw = w / 32
    const area = kh * kw
    for (let q = 0; q < n; q++) {
      const fb = q * h * w
      const ob = q * 1024
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          let s = 0
          for (let dy = 0; dy < kh; dy++) {
            const row = fb + (y * kh + dy) * w + x * kw
            for (let dx = 0; dx < kw; dx++) s += data[row + dx]
          }
          out[ob + y * 32 + x] = fround(s / area)
        }
      }
    }
  } else {
    const ys = new Int32Array(32)
    const xs = new Int32Array(32)
    for (let i = 0; i < 32; i++) {
      ys[i] = Math.min(Math.trunc(((i + 0.5) * h) / 32), h - 1)
      xs[i] = Math.min(Math.trunc(((i + 0.5) * w) / 32), w - 1)
    }
    for (let q = 0; q < n; q++) {
      const fb = q * h * w
      const ob = q * 1024
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) out[ob + y * 32 + x] = data[fb + ys[y] * w + xs[x]]
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- 描述子

/** (n,h,w) uint8 → (n,16,9) float32 块描述子。 */
export function describe(data: Uint8Array, n: number, h: number, w: number): Float32Array {
  const out = new Float32Array(n * 16 * DIM)
  if (n === 0) return out
  const small = down32(data, n, h, w)
  const tmp = new Float64Array(3 * 8) // 只需 DCT 前 3 行
  for (let q = 0; q < n; q++) {
    const sb = q * 1024
    let gsum = 0
    for (let i = 0; i < 1024; i++) gsum += small[sb + i]
    const gmean = gsum / 1024
    for (let br = 0; br < GRID; br++) {
      for (let bc = 0; bc < GRID; bc++) {
        const b = br * GRID + bc
        const ob = (q * 16 + b) * DIM
        // 块像素与块均值
        let bsum = 0
        const px = new Float64Array(64)
        for (let y = 0; y < BS; y++) {
          for (let x = 0; x < BS; x++) {
            const v = small[sb + (br * BS + y) * 32 + (bc * BS + x)]
            px[y * 8 + x] = v
            bsum += v
          }
        }
        const bmean = bsum / 64
        // coef = D8 @ B @ D8^T，只算 u,v ∈ [0,3)
        for (let u = 0; u < 3; u++) {
          for (let j = 0; j < 8; j++) {
            let s = 0
            for (let x = 0; x < 8; x++) s += D8[u * 8 + x] * px[x * 8 + j]
            tmp[u * 8 + j] = s
          }
        }
        for (let j = 0; j < NCOEF; j++) {
          const [u, v] = LOW[j]
          let s = 0
          for (let x = 0; x < 8; x++) s += tmp[u * 8 + x] * D8[v * 8 + x]
          out[ob + j] = fround(s)
        }
        const meanFeat = Math.max(-2, Math.min(2, (bmean - gmean) / 24)) * 0.35
        out[ob + 8] = fround(meanFeat)
        // 前 8 维 L2 归一化（对比度不变）
        let norm = 0
        for (let j = 0; j < NCOEF; j++) {
          const v = out[ob + j]
          norm += v * v
        }
        norm = Math.sqrt(norm)
        for (let j = 0; j < NCOEF; j++) out[ob + j] = fround(out[ob + j] / (norm + 1e-6))
      }
    }
  }
  return out
}

export type FlipVariant = readonly [boolean, boolean]
export const DEFAULT_VARIANTS: FlipVariant[] = [[false, false], [true, false]]
export const VARIANTS_4: FlipVariant[] = [[false, false], [true, false], [false, true], [true, true]]

/** (n,h,w) → (n,F,16,9)；每个 (hflip,vflip) 变体一份描述子。 */
export function describeVariants(
  data: Uint8Array, n: number, h: number, w: number,
  variants: FlipVariant[] = DEFAULT_VARIANTS
): Float32Array {
  const nf = variants.length
  const out = new Float32Array(n * nf * 16 * DIM)
  const per = 16 * DIM
  const flipBuf = new Uint8Array(n * h * w)
  for (let f = 0; f < nf; f++) {
    const [hf, vf] = variants[f]
    let src = data
    if (hf || vf) {
      for (let q = 0; q < n; q++) {
        for (let y = 0; y < h; y++) {
          const sy = vf ? h - 1 - y : y
          for (let x = 0; x < w; x++) {
            const sx = hf ? w - 1 - x : x
            flipBuf[(q * h + y) * w + x] = data[(q * h + sy) * w + sx]
          }
        }
      }
      src = flipBuf
    }
    const d = describe(src, n, h, w)
    for (let q = 0; q < n; q++) {
      out.set(d.subarray(q * per, (q + 1) * per), (q * nf + f) * per)
    }
  }
  return out
}

// ---------------------------------------------------------------- 块权重

/** 16 块检索权重：底/顶字幕带与任意横带降权，外列降权，总和归一。 */
export function blockWeights(
  maskBottom = 0.25, maskTop = 0, edge = 0.85, band: Band | null = null
): Float32Array {
  const mb = Math.max(0, Math.min(0.75, maskBottom))
  const mt = Math.max(0, Math.min(0.75, maskTop))
  const w = new Float64Array(16).fill(1)
  for (let r = 0; r < GRID; r++) {
    const y0 = r / GRID
    const y1 = (r + 1) / GRID
    const ovBot = Math.max(0, Math.min(y1, 1) - Math.max(y0, 1 - mb))
    const ovTop = Math.max(0, Math.min(y1, mt) - y0)
    const ovBand = band ? Math.max(0, Math.min(y1, band[1]) - Math.max(y0, band[0])) : 0
    const masked = Math.min(1, (ovBot + ovTop + ovBand) / (y1 - y0))
    const factor = Math.max(0.06, 1 - 0.94 * masked)
    for (let c = 0; c < GRID; c++) w[r * GRID + c] *= factor
  }
  for (let r = 0; r < GRID; r++) {
    w[r * GRID + 0] *= edge
    w[r * GRID + 3] *= edge
  }
  let sum = 0
  for (let i = 0; i < 16; i++) sum += w[i]
  const out = new Float32Array(16)
  for (let i = 0; i < 16; i++) out[i] = fround(w[i] / sum)
  return out
}

// ---------------------------------------------------------------- 检索

export interface TopkResult {
  /** (nq, kk) 距离，越小越好 */
  d: Float32Array
  /** (nq, kk) 参考行号 */
  r: Int32Array
  /** (nq, kk) 镜像变体号 */
  f: Uint8Array
  kk: number
}

/** 加权块余弦检索。qdesc (nq,16,9)，rdesc (nr,nf,16,9)。 */
export function topk(
  qdesc: Float32Array, nq: number,
  rdesc: Float32Array, nr: number, nf: number,
  weights: Float32Array, k: number, chunk = 256
): TopkResult {
  const kk = Math.min(Math.trunc(k), nf * nr)
  if (nr === 0 || nq === 0 || kk <= 0) {
    const sz = nq * Math.max(kk, 0)
    return { d: new Float32Array(sz), r: new Int32Array(sz), f: new Uint8Array(sz), kk: Math.max(kk, 0) }
  }
  const dOut = new Float32Array(nq * kk)
  const rOut = new Int32Array(nq * kk)
  const fOut = new Uint8Array(nq * kk)
  let wsum = 0
  for (let b = 0; b < 16; b++) wsum += weights[b]
  wsum = fround(wsum)

  const rStride = nf * 16 * DIM // rdesc 行距
  const total = nf * nr
  const dist = new Float32Array(total)
  const bd = new Float64Array(kk)
  const bi = new Int32Array(kk)

  for (let s = 0; s < nq; s += chunk) {
    const m = Math.min(chunk, nq - s)
    const acc = new Float32Array(nf * m * nr)
    for (let b = 0; b < 16; b++) {
      const wb = weights[b]
      if (wb <= 0) continue
      const half = wb * 0.5
      for (let f = 0; f < nf; f++) {
        const accBase = (f * m) * nr
        const rBase0 = f * 16 * DIM + b * DIM
        for (let i = 0; i < m; i++) {
          const qBase = ((s + i) * 16 + b) * DIM
          const q0 = qdesc[qBase]
          const q1 = qdesc[qBase + 1]
          const q2 = qdesc[qBase + 2]
          const q3 = qdesc[qBase + 3]
          const q4 = qdesc[qBase + 4]
          const q5 = qdesc[qBase + 5]
          const q6 = qdesc[qBase + 6]
          const q7 = qdesc[qBase + 7]
          const qm = qdesc[qBase + 8]
          const accRow = accBase + i * nr
          for (let j = 0; j < nr; j++) {
            const rb = j * rStride + rBase0
            const dot =
              q0 * rdesc[rb] + q1 * rdesc[rb + 1] + q2 * rdesc[rb + 2] + q3 * rdesc[rb + 3] +
              q4 * rdesc[rb + 4] + q5 * rdesc[rb + 5] + q6 * rdesc[rb + 6] + q7 * rdesc[rb + 7]
            const md = Math.abs(qm - rdesc[rb + 8])
            const a = accRow + j
            acc[a] = fround(acc[a] + fround(wb * dot))
            acc[a] = fround(acc[a] - fround(half * md))
          }
        }
      }
    }
    for (let i = 0; i < m; i++) {
      for (let f = 0; f < nf; f++) {
        const accRow = (f * m + i) * nr
        const dRow = f * nr
        for (let j = 0; j < nr; j++) dist[dRow + j] = fround(wsum - acc[accRow + j])
      }
      // top-kk 插入选择（严格小于 → 平局取更早的 idx，与检索语义一致）
      for (let t = 0; t < kk; t++) {
        bd[t] = Infinity
        bi[t] = -1
      }
      for (let idx = 0; idx < total; idx++) {
        const d = dist[idx]
        if (d < bd[kk - 1]) {
          let p = kk - 1
          while (p > 0 && bd[p - 1] > d) {
            bd[p] = bd[p - 1]
            bi[p] = bi[p - 1]
            p--
          }
          bd[p] = d
          bi[p] = idx
        }
      }
      const ob = (s + i) * kk
      for (let t = 0; t < kk; t++) {
        dOut[ob + t] = fround(bd[t])
        rOut[ob + t] = bi[t] % nr
        fOut[ob + t] = Math.floor(bi[t] / nr)
      }
    }
  }
  return { d: dOut, r: rOut, f: fOut, kk }
}

// ---------------------------------------------------------------- 验证向量

/** Python round（银行家舍入），用于遮罩行边界。 */
function pyRound(x: number): number {
  const f = Math.floor(x)
  const d = x - f
  if (d > 0.5) return f + 1
  if (d < 0.5) return f
  return f % 2 === 0 ? f : f + 1
}

/** 边缘复制填充 + 积分图盒式模糊（半径 r），等价 numpy 版 _boxblur。 */
function boxblurFrame(f: Float64Array, h: number, w: number, r: number): Float64Array {
  const ph = h + 2 * r
  const pw = w + 2 * r
  const p = new Float64Array(ph * pw)
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(Math.max(y - r, 0), h - 1)
    for (let x = 0; x < pw; x++) {
      const sx = Math.min(Math.max(x - r, 0), w - 1)
      p[y * pw + x] = f[sy * w + sx]
    }
  }
  const iw = pw + 1
  const ii = new Float64Array((ph + 1) * iw)
  for (let y = 0; y < ph; y++) {
    let rowSum = 0
    for (let x = 0; x < pw; x++) {
      rowSum += p[y * pw + x]
      ii[(y + 1) * iw + (x + 1)] = ii[y * iw + (x + 1)] + rowSum
    }
  }
  const k = 2 * r + 1
  const inv = 1 / (k * k)
  const out = new Float64Array(h * w)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] =
        (ii[(y + k) * iw + (x + k)] - ii[y * iw + (x + k)] - ii[(y + k) * iw + x] + ii[y * iw + x]) * inv
    }
  }
  return out
}

export interface VerifyResult {
  v: Float32Array
  n: number
  m: number
}

/** (n,h,w) uint8 → (n,M) L2 归一化高通亮度，字幕行剔除。 */
export function prepareVerify(
  data: Uint8Array, n: number, h: number, w: number,
  maskBottom = 0.25, maskTop = 0, highpass = true, band: Band | null = null, pool = 1
): VerifyResult {
  if (n === 0) return { v: new Float32Array(0), n: 0, m: 1 }
  // 行遮罩
  const rows = new Uint8Array(h).fill(1)
  const topCut = Math.min(pyRound(maskTop * h), h - 2)
  for (let y = 0; y < topCut; y++) rows[y] = 0
  const botStart = Math.max(0, h - pyRound(maskBottom * h))
  for (let y = botStart; y < h; y++) rows[y] = 0
  if (band) {
    const b0 = Math.max(0, Math.trunc(band[0] * h))
    const b1 = Math.min(h, Math.trunc(band[1] * h))
    for (let y = b0; y < b1; y++) rows[y] = 0
  }
  let kept = 0
  for (let y = 0; y < h; y++) kept += rows[y]
  if (kept < 2) {
    rows.fill(1)
    kept = h
  }
  const rowList: number[] = []
  for (let y = 0; y < h; y++) if (rows[y]) rowList.push(y)

  let outH = kept
  let outW = w
  if (pool > 1) {
    const r2 = Math.floor(kept / pool) * pool
    const c2 = Math.floor(w / pool) * pool
    if (r2 >= pool && c2 >= pool) {
      outH = r2 / pool
      outW = c2 / pool
    } else {
      pool = 1
    }
  }
  const m = outH * outW
  const out = new Float32Array(n * m)
  const f = new Float64Array(h * w)
  for (let q = 0; q < n; q++) {
    const fb = q * h * w
    for (let i = 0; i < h * w; i++) f[i] = data[fb + i]
    let hp: Float64Array
    if (highpass) {
      const blur = boxblurFrame(f, h, w, 4)
      hp = new Float64Array(h * w)
      for (let i = 0; i < h * w; i++) hp[i] = f[i] - blur[i]
    } else {
      let mean = 0
      for (let i = 0; i < h * w; i++) mean += f[i]
      mean /= h * w
      hp = new Float64Array(h * w)
      for (let i = 0; i < h * w; i++) hp[i] = f[i] - mean
    }
    //  gather 保留行（+ 可选池化）
    const v = new Float64Array(m)
    let vi = 0
    if (pool === 1) {
      for (const y of rowList) {
        for (let x = 0; x < w; x++) v[vi++] = hp[y * w + x]
      }
    } else {
      for (let by = 0; by < outH; by++) {
        for (let bx = 0; bx < outW; bx++) {
          let s = 0
          for (let dy = 0; dy < pool; dy++) {
            const y = rowList[by * pool + dy]
            for (let dx = 0; dx < pool; dx++) s += hp[y * w + bx * pool + dx]
          }
          v[vi++] = s / (pool * pool)
        }
      }
    }
    let mean = 0
    for (let i = 0; i < m; i++) mean += v[i]
    mean /= m
    let norm = 0
    for (let i = 0; i < m; i++) {
      v[i] -= mean
      norm += v[i] * v[i]
    }
    norm = Math.sqrt(norm)
    const ob = q * m
    for (let i = 0; i < m; i++) out[ob + i] = fround(v[i] / (norm + 1e-6))
  }
  return { v: out, n, m }
}

/** 逐行点积打分：qv (nq,M) × rv 的 pos 带状行；invalid → -1。 */
export function bandScores(
  qv: Float32Array, nq: number, m: number,
  rv: Float32Array, nr: number,
  pos: Int32Array, valid: Uint8Array, kk: number, chunk = 64
): Float32Array {
  const out = new Float32Array(nq * kk).fill(-1)
  if (nr === 0) return out
  for (let s = 0; s < nq; s += chunk) {
    const e = Math.min(nq, s + chunk)
    for (let i = s; i < e; i++) {
      const qb = i * m
      for (let j = 0; j < kk; j++) {
        const p = i * kk + j
        if (!valid[p]) continue
        let r = pos[p]
        if (r < 0) r = 0
        if (r > nr - 1) r = nr - 1
        const rb = r * m
        let dot = 0
        for (let c = 0; c < m; c++) dot += qv[qb + c] * rv[rb + c]
        out[p] = fround(dot)
      }
    }
  }
  return out
}
