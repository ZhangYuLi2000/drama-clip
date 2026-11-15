/** G3 门禁：索引构建 + 逐帧溯源 对齐黄金基准。
 *
 * A. 迷你索引（3 集）：TS 构建的描述子与 Python 黄金逐值对齐
 * B. 全量 86 集索引 + 样本 B（150s AI 轮播解说）溯源，对齐 frame_origins.csv
 *
 *   node scripts/test-replica-g3.mts [--rebuild]
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildIndex, loadIndex } from '../electron/main/replica/indexer.ts'
import { frameOrigins } from '../electron/main/replica/framewise.ts'
import { ComputePool } from '../electron/main/replica/worker-pool.ts'

const require = createRequire(import.meta.url)
const FFMPEG = require('ffmpeg-static') as string
const FFPROBE = (require('ffprobe-static') as { path: string }).path
const ROOT = path.join(import.meta.dirname, '..')
const GOLDEN = path.join(ROOT, 'test', 'golden', 'replica')
const CACHE = path.join(ROOT, 'test', '.cache')
const WORKER = path.join(ROOT, 'electron', 'main', 'replica', 'worker.ts')
const EPS = String.raw`E:\dsh_tmp\cliptrace\demo_out\test_data`
const CLIP = String.raw`C:\Users\raolong\Downloads\下载.mp4`
const REBUILD = process.argv.includes('--rebuild')

let failures = 0
function check(name: string, ok: boolean, detail: string): void {
  if (ok) console.log(`  PASS  ${name}  ${detail}`)
  else {
    failures++
    console.error(`  FAIL  ${name}  ${detail}`)
  }
}

function readF32(p: string): Float32Array {
  const b = fs.readFileSync(p)
  const ab = new ArrayBuffer(b.length)
  new Uint8Array(ab).set(b)
  return new Float32Array(ab)
}

const pool = new ComputePool(WORKER, 3)

async function partA(): Promise<void> {
  console.log('[G3a] 迷你索引构建对齐（3 集，ffmpeg-static 同源）')
  const epFiles = [1, 2, 3].map((i) => path.join(EPS, `被抓住的秘密 ${String(i).padStart(3, '0')}.mp4`))
  const outdir = path.join(CACHE, 'mini_ts')
  const t0 = Date.now()
  const idx = await buildIndex(epFiles, outdir, { indexFps: 8, ffmpeg: FFMPEG, ffprobe: FFPROBE, pool })
  console.log(`  构建耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  for (const ep of idx.episodes) {
    const goldDesc = readF32(path.join(GOLDEN, 'mini_index', `${ep.eid}.desc.f32`))
    let md = 0
    if (goldDesc.length !== ep.desc.length) md = Infinity
    else for (let i = 0; i < goldDesc.length; i++) md = Math.max(md, Math.abs(goldDesc[i] - ep.desc[i]))
    check(`${ep.eid} desc 对齐`, md <= 1e-5, `ni=${ep.ni} maxDiff=${md.toExponential(2)}`)
    const goldMeta = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'mini_index', `${ep.eid}.json`), 'utf8')) as {
      step: number; nb_frames: number; ni: number
    }
    check(`${ep.eid} 元信息`, ep.step === goldMeta.step && ep.info.nbFrames === goldMeta.nb_frames && ep.ni === goldMeta.ni,
      `step=${ep.step} nb=${ep.info.nbFrames} ni=${ep.ni}`)
    let idxOk = true
    for (let i = 0; i < ep.ni; i++) if (ep.frameIdx[i] !== i * ep.step) idxOk = false
    check(`${ep.eid} frameIdx`, idxOk, `i*step`)
  }
}

interface GoldRow {
  q: number
  ep: string
  src: number | null
  conf: string
}

function parseGoldCsv(): GoldRow[] {
  const text = fs.readFileSync(path.join(GOLDEN, 'trace_origins.csv'), 'utf8').replace(/^\ufeff/, '')
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const head = lines[0].split(',')
  const iq = head.indexOf('clip_frame')
  const ie = head.indexOf('episode')
  const is = head.indexOf('src_frame')
  const ic = head.indexOf('confidence')
  return lines.slice(1).map((l) => {
    const c = l.split(',')
    return { q: parseInt(c[iq], 10), ep: c[ie], src: c[is] === '' ? null : parseInt(c[is], 10), conf: c[ic] }
  })
}

async function partB(): Promise<void> {
  console.log('[G3b] 全量 86 集索引（index-fps 12，与黄金 trace 同步长）+ 样本 B 溯源对齐')
  const indexDir = path.join(CACHE, 'index86_f12')
  let idx
  const t0 = Date.now()
  if (!REBUILD && fs.existsSync(path.join(indexDir, 'manifest.json'))) {
    idx = loadIndex(indexDir)
    console.log(`  复用缓存索引（${idx.episodes.length} 集）`)
  } else {
    idx = await buildIndex([EPS], indexDir, { indexFps: 12, ffmpeg: FFMPEG, ffprobe: FFPROBE, pool })
    console.log(`  全量索引构建耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  }
  const t1 = Date.now()
  const { rows, meta } = await frameOrigins(
    idx, CLIP,
    { size: 64, maskBottom: 0.28, maskTop: 0.08, frameMaxDist: 0.15 },
    FFMPEG, FFPROBE, path.join(CACHE, 'work'),
    { pool }
  )
  console.log(`  溯源耗时 ${((Date.now() - t1) / 1000).toFixed(1)}s（含切片解码）`)
  const gold = parseGoldCsv()
  check('帧数一致', rows.length === gold.length, `ts=${rows.length} gold=${gold.length}`)
  let withSrc = 0
  let agree = 0
  let confAgree = 0
  let tsHasSrc = 0
  const mismatches: string[] = []
  for (let i = 0; i < Math.min(rows.length, gold.length); i++) {
    const t = rows[i]
    const g = gold[i]
    if (t.srcFrame !== null) tsHasSrc++
    if (g.src !== null) {
      withSrc++
      if (t.episode === g.ep && t.srcFrame === g.src) agree++
      else if (mismatches.length < 8) mismatches.push(`q=${g.q} ts=${t.episode}#${t.srcFrame} gold=${g.ep}#${g.src}`)
    }
    if (t.confidence === g.conf) confAgree++
  }
  const rate = agree / Math.max(1, withSrc)
  const coverage = tsHasSrc / rows.length
  check('集+源帧一致率 ≥99%', rate >= 0.99, `${agree}/${withSrc} = ${(rate * 100).toFixed(2)}%`)
  check('覆盖率 ≥97.5%', coverage >= 0.975, `${tsHasSrc}/${rows.length} = ${(coverage * 100).toFixed(2)}%（gold ${(100 * (1 - 73 / 4491)).toFixed(2)}%）`)
  console.log(`  置信分级一致率 ${(100 * confAgree / rows.length).toFixed(2)}%（参考）`)
  if (mismatches.length) console.log(`  不一致样例：\n    ${mismatches.join('\n    ')}`)
  console.log(`  counts: ${JSON.stringify(meta.counts)}`)
}

try {
  await partA()
  await partB()
} finally {
  pool.destroy()
}
console.log(failures === 0 ? '\nG3 GATE PASSED' : `\nGATE FAILED: ${failures} 项未达标`)
process.exit(failures === 0 ? 0 : 1)
