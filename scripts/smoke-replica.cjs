/** 产品路径冒烟测试：在真实 Electron 主进程里跑 runReplicaTask 全流水线。
 *
 * 先构建：
 *   node node_modules/esbuild/bin/esbuild electron/main/replica-engine.ts --bundle \
 *     --platform=node --format=cjs --external:electron --outfile=test/.cache/smoke/replica-engine.cjs
 *   并把 out/main/replica-worker.js 与 fingerprint-*.js 复制到 test/.cache/smoke/
 * 再运行：npm run smoke:replica
 */
const { app } = require('electron')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const SMOKE = path.join(ROOT, 'test', '.cache', 'smoke')
const EPS = String.raw`E:\dsh_tmp\cliptrace\demo_out\test_data`
const CLIP = String.raw`E:\dsh_tmp\cliptrace\demo_out\test_data\成片\逼作伪证翻车_v1_20261114-225405.mp4`

// 隔离 userData，不碰真实库
app.setPath('userData', path.join(SMOKE, 'userData'))
fs.mkdirSync(path.join(SMOKE, 'userData'), { recursive: true })

app.whenReady().then(async () => {
  const { runReplicaTask, readReplicaEdl } = require(path.join(SMOKE, 'replica-engine.cjs'))
  const drama = {
    id: 'smoke-drama',
    title: '冒烟测试剧',
    dir: path.join(SMOKE, 'drama'),
    createdAt: Date.now(),
    episodes: [41, 42].map((n) => ({
      id: `ep${n}`,
      n,
      file: path.join(EPS, `被抓住的秘密 ${String(n).padStart(3, '0')}.mp4`),
      fileName: `被抓住的秘密 ${String(n).padStart(3, '0')}.mp4`,
      size: 0,
      duration: null,
      width: null,
      height: null,
      thumb: null,
      asr: 'idle',
      ana: 'idle',
      cand: 0,
      pending: 0,
      hl: 0
    }))
  }
  fs.mkdirSync(drama.dir, { recursive: true })
  const task = {
    id: 'smoke-task',
    clipFile: CLIP,
    clipTitle: '冒烟样本A',
    status: 'queue',
    pct: 0,
    audio: 'source',
    crf: 16,
    despike: true,
    refine: true,
    boundsRadius: 6,
    indexFps: 12,
    maskTop: 0.08,
    maskBottom: 0.28,
    maskBand: '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  const ac = new AbortController()
  let lastPct = -1
  const t0 = Date.now()
  try {
    await runReplicaTask(
      drama,
      task,
      {},
      (pct, stage, note) => {
        if (pct !== lastPct) {
          console.log(`[progress] ${stage} ${pct}% ${note ?? ''}`)
          lastPct = pct
        }
      },
      (m) => console.log(`[log] ${m}`),
      ac.signal
    )
    const edl = readReplicaEdl(task.edlPath)
    const secs = ((Date.now() - t0) / 1000).toFixed(1)
    const ok =
      Boolean(task.output) &&
      fs.existsSync(task.output) &&
      edl.length >= 2 &&
      task.stats &&
      Math.abs(task.stats.totalSeconds - 43.3) <= 3 &&
      task.stats.coverage >= 0.9 &&
      Boolean(drama.replicaIndex)
    console.log(`[stats] ${JSON.stringify(task.stats)}`)
    console.log(`[edl] ${edl.map((s) => `${s.episode}#${s.srcIn}-${s.srcOut}(${s.kind})`).join(' ')}`)
    console.log(`[index] ${JSON.stringify(drama.replicaIndex)}`)
    console.log(ok ? `SMOKE PASSED (${secs}s)` : 'SMOKE FAILED')
    app.exit(ok ? 0 : 1)
  } catch (e) {
    console.error('SMOKE ERROR', e)
    app.exit(1)
  }
})
