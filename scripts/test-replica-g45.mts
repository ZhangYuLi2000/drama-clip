/** G4/G5 门禁：EDL 对齐 + 重剪渲染质量。
 *
 * G4  buildEdl(despike/nodespike) 与 Python 黄金 EDL 逐段逐字段一致
 * G5a 样本 B（150s AI 轮播）完整 recut：EDL≥95% 一致、24fps 原生、
 *     顿挫签名不劣于 Python 精修版
 * G5b 样本 A（43s 连续剪辑，frame_map 帧精确）：3 段边界逐帧吻合、25fps
 *
 *   node scripts/test-replica-g45.mts [--skip-render]
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { loadTrace, buildEdl } from '../electron/main/replica/edl.ts'
import { recut } from '../electron/main/replica/recut.ts'
import { loadIndex } from '../electron/main/replica/indexer.ts'
import { decodeSelect, probe, runCapture } from '../electron/main/replica/frames.ts'
import { ComputePool } from '../electron/main/replica/worker-pool.ts'
import type { EdlSeg } from '../electron/main/replica/types.ts'

const require = createRequire(import.meta.url)
const FFMPEG = require('ffmpeg-static') as string
const FFPROBE = (require('ffprobe-static') as { path: string }).path
const ROOT = path.join(import.meta.dirname, '..')
const GOLDEN = path.join(ROOT, 'test', 'golden', 'replica')
const CACHE = path.join(ROOT, 'test', '.cache')
const WORKER = path.join(ROOT, 'electron', 'main', 'replica', 'worker.ts')
const CLIP_B = String.raw`C:\Users\raolong\Downloads\下载.mp4`
const CLIP_A = String.raw`E:\dsh_tmp\cliptrace\demo_out\test_data\成片\逼作伪证翻车_v1_20261114-225405.mp4`
const PY_REFINED = String.raw`E:\dsh_tmp\cliptrace\real_test\newclip\recut_refined\recut.mp4`
const SKIP_RENDER = process.argv.includes('--skip-render')
const ONLY_A = process.argv.includes('--only-a')

let failures = 0
function check(name: string, ok: boolean, detail: string): void {
  if (ok) console.log(`  PASS  ${name}  ${detail}`)
  else {
    failures++
    console.error(`  FAIL  ${name}  ${detail}`)
  }
}

function readCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(file, 'utf8').replace(/^\ufeff/, '')
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const head = lines[0].split(',')
  return lines.slice(1).map((l) => {
    const c = l.split(',')
    const o: Record<string, string> = {}
    head.forEach((h, i) => {
      o[h] = c[i] ?? ''
    })
    return o
  })
}

// ---------------------------------------------------------------- G4

function g4(): void {
  console.log('[G4] EDL 构建对齐（despike / no-despike）')
  const trace = loadTrace(path.join(GOLDEN, 'trace_origins.csv'), 'origins')
  const epMax = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'ep_max.json'), 'utf8')) as Record<string, number>
  check('trace 行数', trace.length === 4491, `${trace.length}`)

  const fields: (keyof EdlSeg)[] = ['segmentId', 'clipIn', 'clipOut', 'clipFrames', 'episode', 'srcIn', 'srcOut', 'srcFrames', 'kind', 'flip']
  const snake: Record<string, string> = {
    segmentId: 'segment_id', clipIn: 'clip_in', clipOut: 'clip_out', clipFrames: 'clip_frames',
    episode: 'episode', srcIn: 'src_in', srcOut: 'src_out', srcFrames: 'src_frames', kind: 'kind', flip: 'flip'
  }
  for (const [tag, despike, goldFile] of [
    ['despike', true, 'edl_despike.csv'],
    ['nodespike', false, 'edl_nodespike.csv']
  ] as const) {
    const edl = buildEdl(trace, trace.length, despike, epMax)
    const gold = readCsv(path.join(GOLDEN, goldFile))
    let bad = 0
    let firstBad = ''
    if (edl.length !== gold.length) bad = Math.abs(edl.length - gold.length)
    for (let i = 0; i < Math.min(edl.length, gold.length); i++) {
      for (const f of fields) {
        const a = String(edl[i][f])
        const b = gold[i][snake[f]]
        if (a !== b) {
          bad++
          if (!firstBad) firstBad = `seg${i + 1} ${f}: ts=${a} gold=${b}`
          break
        }
      }
    }
    check(`buildEdl(${tag})`, bad === 0, `${edl.length} 段 vs gold ${gold.length} 段${firstBad ? ` · ${firstBad}` : ''}`)
  }
}

// ---------------------------------------------------------------- 质量度量

interface MotionStats {
  frames: number
  frozen: number
  ftl: number
  median: number
}

async function motionStats(file: string): Promise<MotionStats> {
  const { data, n } = await decodeSelect(file, '1', 64, 64, FFMPEG, CACHE)
  const d: number[] = []
  const px = 64 * 64
  for (let i = 1; i < n; i++) {
    let s = 0
    const a = (i - 1) * px
    const b = i * px
    for (let j = 0; j < px; j++) s += Math.abs(data[a + j] - data[b + j])
    d.push(s / px)
  }
  let frozen = 0
  let ftl = 0
  for (let i = 0; i < d.length; i++) {
    if (d[i] < 0.5) {
      frozen++
      if (i + 1 < d.length && d[i + 1] > 8) ftl++
    }
  }
  const sorted = [...d].sort((a, b) => a - b)
  return { frames: n, frozen, ftl, median: sorted[Math.floor(sorted.length / 2)] ?? 0 }
}

// ---------------------------------------------------------------- G5

async function g5(): Promise<void> {
  const indexDir = [path.join(CACHE, 'index86_f12'), path.join(CACHE, 'index86')]
    .find((d) => fs.existsSync(path.join(d, 'manifest.json')))
  if (!indexDir) {
    console.error('缺少全量索引缓存，请先运行 test:replica:g3')
    process.exit(1)
  }
  const idx = loadIndex(indexDir)
  const pool = new ComputePool(WORKER, 3)
  try {
    if (!ONLY_A) {
    console.log('[G5a] 样本 B 完整重剪（despike + 边界精修 + 原声）')
    const outB = path.join(CACHE, 'recut_b_ts')
    const t0 = Date.now()
    const sumB = await recut(idx, CLIP_B, FFMPEG, FFPROBE, outB, {
      tracePath: path.join(GOLDEN, 'trace_origins.csv'),
      traceKind: 'origins',
      audio: 'source',
      cfg: { maskBottom: 0.28, maskTop: 0.08 },
      pool,
      note: (m) => console.log(`    ${m}`)
    })
    console.log(`  重剪耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)

    const tsEdl = readCsv(path.join(outB, 'recut_edl.csv'))
    const pyEdl = readCsv(path.join(GOLDEN, 'edl_refined.csv'))
    let same = 0
    const n = Math.min(tsEdl.length, pyEdl.length)
    for (let i = 0; i < n; i++) {
      const a = tsEdl[i]
      const b = pyEdl[i]
      if (a.episode === b.episode && a.src_in === b.src_in && a.src_out === b.src_out &&
          a.clip_in === b.clip_in && a.clip_out === b.clip_out && a.kind === b.kind) same++
    }
    check('EDL 段数一致', tsEdl.length === pyEdl.length, `ts=${tsEdl.length} py=${pyEdl.length}`)
    check('EDL 边界一致率 ≥95%', same / Math.max(1, pyEdl.length) >= 0.95, `${same}/${pyEdl.length}`)

    const info = await probe(sumB.output, FFPROBE)
    check('输出 24fps 原生', Math.abs(info.fps - 24) < 0.01, `fps=${info.fps}`)
    check('帧数 ≈3281 (±2%)', Math.abs(info.nbFrames - 3281) <= 66, `nbFrames=${info.nbFrames}`)
    check('时长 ≈136.7s (±3)', Math.abs(info.duration - 136.7) <= 3, `duration=${info.duration.toFixed(2)}`)
    const { stdout } = await runCapture(FFPROBE, ['-v', 'error', '-show_streams', '-of', 'json', sumB.output])
    const streams = (JSON.parse(stdout) as { streams: { codec_type: string; codec_name: string }[] }).streams
    check('含原声音轨', streams.some((s) => s.codec_type === 'audio' && s.codec_name === 'aac'),
      streams.map((s) => `${s.codec_type}:${s.codec_name}`).join(' '))

    const tsStats = await motionStats(sumB.output)
    const pyStats = await motionStats(PY_REFINED)
    console.log(`  动效统计 ts: ${JSON.stringify(tsStats)}`)
    console.log(`  动效统计 py: ${JSON.stringify(pyStats)}`)
    check('顿挫签名不劣于 Python 版', tsStats.ftl <= pyStats.ftl + 15, `ftl ts=${tsStats.ftl} py=${pyStats.ftl}`)
    check('冻结帧不劣于 Python 版', tsStats.frozen <= pyStats.frozen * 1.3 + 20, `frozen ts=${tsStats.frozen} py=${pyStats.frozen}`)
    }

    console.log('[G5b] 样本 A 连续剪辑重剪（frame_map 帧精确）')
    const outA = path.join(CACHE, 'recut_a_ts')
    const sumA = await recut(idx, CLIP_A, FFMPEG, FFPROBE, outA, {
      tracePath: path.join(GOLDEN, 'trace_map_a.csv'),
      traceKind: 'map',
      audio: 'source',
      pool,
      note: (m) => console.log(`    ${m}`)
    })
    const tsA = readCsv(path.join(outA, 'recut_edl.csv'))
    const pyA = readCsv(path.join(GOLDEN, 'edl_sample_a.csv'))
    check('样本 A 3 段', tsA.length === 3 && pyA.length === 3, `ts=${tsA.length}`)
    let boundOk = tsA.length === pyA.length
    for (let i = 0; i < Math.min(tsA.length, pyA.length); i++) {
      if (tsA[i].episode !== pyA[i].episode || tsA[i].src_in !== pyA[i].src_in || tsA[i].src_out !== pyA[i].src_out) boundOk = false
    }
    check('样本 A 边界逐帧吻合（含 E42 791→802 缺口）', boundOk,
      tsA.map((s) => `${s.episode}#${s.src_in}-${s.src_out}`).join(' '))
    const infoA = await probe(sumA.output, FFPROBE)
    check('样本 A 25fps 原生', Math.abs(infoA.fps - 25) < 0.01, `fps=${infoA.fps}`)
    check('样本 A 时长 ≈43.28s', Math.abs(infoA.duration - 43.28) <= 0.15, `duration=${infoA.duration.toFixed(2)}`)
  } finally {
    pool.destroy()
  }
}

g4()
if (!SKIP_RENDER) await g5()
else console.log('[G5] 跳过渲染（--skip-render）')
console.log(failures === 0 ? '\nG4/G5 GATE PASSED' : `\nGATE FAILED: ${failures} 项未达标`)
process.exit(failures === 0 ? 0 : 1)
