#!/usr/bin/env node
/*
 * 全局喂片 spike（独立脚本，不改动工作台任何代码/数据）
 *
 * 首次全局理解：
 *   node scripts/spike-global.cjs --eps=41-45
 *   node scripts/spike-global.cjs --eps=41-45 --model=gemini-4-argon
 *
 * 缓存追问（验证隐式缓存混剪，跳过合并/上传，接续上次会话）：
 *   node scripts/spike-global.cjs --prev=<interactionId>
 *   node scripts/spike-global.cjs --prev=<interactionId> --ask="自定义问题"
 *
 * 需要环境变量 GEMINI_KEY。如有本地代理：
 *   HTTPS_PROXY=http://127.0.0.1:7890 NODE_USE_ENV_PROXY=1 node scripts/spike-global.cjs --eps=41-45
 */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const ffmpeg = require('ffmpeg-static')
const ffprobe = require('ffprobe-static').path

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=([\s\S]*)$/)
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]
  })
)
const KEY = process.env.GEMINI_KEY
if (!KEY) {
  console.error('缺少 GEMINI_KEY 环境变量。PowerShell: $env:GEMINI_KEY="你的key" 后重试')
  process.exit(1)
}
const API = 'https://generativelanguage.googleapis.com'
const MODEL = args.model || 'gemini-4-hydrogen'
const OUT = path.resolve(args.out || path.join(__dirname, 'spike-out'))
const HEADERS = { 'x-goog-api-key': KEY, 'Content-Type': 'application/json', 'Api-Revision': '2026-05-20' }

function run(bin, argv, timeoutMs = 10 * 60_000) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, argv, { windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      p.kill()
      reject(new Error(`进程超时：${path.basename(bin)}`))
    }, timeoutMs)
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    p.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`${path.basename(bin)} 退出码 ${code}：${err.slice(-400)}`))
    })
  })
}

async function api(url, body, timeoutMs = 60_000) {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs)
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 80)}：${text.slice(0, 300)}`)
  return { json: JSON.parse(text), headers: res.headers }
}

async function probeDuration(file) {
  const out = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file])
  return Number(JSON.parse(out).format.duration)
}

async function mergeProxy(eps, map) {
  const inputs = eps.flatMap((ep) => ['-i', ep.file])
  const n = eps.length
  const concatIn = eps.map((_, i) => `[${i}:v][${i}:a]`).join('')
  const filter = `${concatIn}concat=n=${n}:v=1:a=1[v][a];[v]scale=-2:360,fps=8[vout]`
  const out = path.join(OUT, 'merged.mp4')
  await run(ffmpeg, [
    '-y', ...inputs,
    '-filter_complex', filter,
    '-map', '[vout]', '-map', '[a]',
    '-c:v', 'libx264', '-crf', '30', '-preset', 'veryfast',
    '-c:a', 'aac', '-b:a', '32k', '-ac', '1',
    out
  ])
  const mergedDur = await probeDuration(out)
  const sumDur = map[map.length - 1].globalEnd
  const drift = Math.abs(mergedDur - sumDur)
  console.log(`合并完成：${(fs.statSync(out).size / 1048576).toFixed(1)}MB · 实测 ${mergedDur.toFixed(1)}s · 映射表合计 ${sumDur.toFixed(1)}s · 偏差 ${drift.toFixed(2)}s`)
  if (drift > 1) console.warn('警告：偏差超过 1s，高光时间映射可能有系统性偏移，评估时注意')
  return out
}

async function uploadVideo(file) {
  const bytes = fs.statSync(file).size
  const start = await fetch(`${API}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes),
      'X-Goog-Upload-Header-Content-Type': 'video/mp4'
    },
    body: JSON.stringify({ file: { display_name: 'spike-merged' } }),
    signal: AbortSignal.timeout(60_000)
  })
  if (!start.ok) throw new Error(`上传初始化 HTTP ${start.status}：${(await start.text()).slice(0, 300)}`)
  const uploadUrl = start.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new Error('上传初始化未返回 x-goog-upload-url')
  console.log(`上传中：${(bytes / 1048576).toFixed(1)}MB …`)
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(bytes),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: fs.readFileSync(file),
    signal: AbortSignal.timeout(10 * 60_000)
  })
  if (!res.ok) throw new Error(`上传 HTTP ${res.status}：${(await res.text()).slice(0, 300)}`)
  const info = (await res.json()).file
  console.log(`已上传：${info.name}，等待服务端处理…`)
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    const { json } = await api(`${API}/v1beta/${info.name}`)
    if (json.state === 'ACTIVE') return json
    if (json.state === 'FAILED') throw new Error('服务端视频处理失败')
    if (i % 6 === 5) console.log(`  处理中…（${(i + 1) * 5}s）`)
  }
  throw new Error('视频处理超时（10 分钟）')
}

function buildPrompt(map) {
  const boundaries = map.map((m) => `第${m.n}集 ${m.globalStart.toFixed(1)}s–${m.globalEnd.toFixed(1)}s`).join('；')
  return [
    `这是一部竖屏短剧的 ${map.length} 集按顺序拼接成的完整视频（含声音），各集边界：${boundaries}。`,
    '请通读全剧后输出一个 JSON 对象（不要 markdown 包裹），包含四部分：',
    '1) logline：一句话故事，不超过50字; 2) characters：全剧统一人物表 [{"name":"剧中真实姓名，无名用称谓","role":"男主/女主/反派/配角等","desc":"≤30字身份","relations":"≤30字关系"}]，合并同一人物的不同称呼，按重要度排序; 3) arcs：主线叙事地图（开端/发展/高潮/反转/结局各在哪几集），≤200字;',
    '4) episodes：分集剧本 [{"n":集数,"summary":"≤80字梗概","transcript":[{"start":起始秒,"end":结束秒,"text":"台词"}]}]，逐句转写全部台词;',
    '5) highlights：高光库，每集 3-5 条 [{"ep":集数,"title":"≤20字标题，尽量用金句原话","start":起始秒,"end":结束秒,"score":0到100,"hook":0到100,"quote":"最有传播力的金句原话","conflict":"冲突类型","characters":["出场人物"],"tags":["冲突","反转","爽点","打脸","甜宠","哭戏","悬念"],"bd":{"钩子":0到100,"冲突":0到100,"情绪":0到100,"金句":0到100},"reason":"≤60字理由","scene":"≤60字场景"}]。',
    '要求：所有时间都是相对合并视频起点的全局秒数，精确到 0.1 不要取整; 高光单段 5-30 秒、同集内互不重叠、按 score 降序; hook 指开场 3 秒钩子强度; 台词听不清就跳过，不要编造; 只输出 JSON。'
  ].join('\n')
}

async function interact(body) {
  const { json: created } = await api(`${API}/v1beta/interactions`, body, 120_000)
  console.log(`会话已创建：${created.id}（${created.status}），轮询中…`)
  let raw = created
  for (let i = 0; i < 360; i++) {
    if (raw.status !== 'in_progress' && raw.status !== 'queued') break
    await new Promise((r) => setTimeout(r, 5000))
    raw = (await api(`${API}/v1beta/interactions/${created.id}`)).json
    if (i % 6 === 5) console.log(`  生成中…（${(i + 1) * 5}s）`)
  }
  if (raw.status === 'failed' || raw.status === 'cancelled') throw new Error(`会话 ${raw.status}：${JSON.stringify(raw).slice(0, 300)}`)
  if (raw.status === 'incomplete') console.warn('警告：输出达到 max_output_tokens 被截断（incomplete），JSON 可能不完整')
  const text = (raw.steps || [])
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('')
  return { text, raw }
}

function extractJson(text) {
  const t = text.trim()
  const os = t.indexOf('{')
  const oe = t.lastIndexOf('}')
  if (os >= 0 && oe > os) {
    try {
      return JSON.parse(t.slice(os, oe + 1))
    } catch {}
  }
  throw new Error(`输出不是合法 JSON：${t.slice(0, 200)}`)
}

function reportUsage(usage) {
  if (!usage) return console.log('（响应无 usage 字段）')
  const input = usage.total_input_tokens || 0
  const cached = usage.total_cached_tokens || 0
  const output = usage.total_output_tokens || 0
  const thought = usage.total_thought_tokens || 0
  const rates = MODEL.includes('argon') ? [2, 10, 0.1] : MODEL.includes('hydrogen') ? [1.5, 7.5, 0.075] : [2, 10, 0.1]
  const usd = ((input - cached) * rates[0] + cached * rates[2] + output * rates[1]) / 1e6
  console.log('—— 用量 ——')
  console.log(`输入 ${input}（缓存命中 ${cached}，命中率 ${input ? ((cached / input) * 100).toFixed(1) : 0}%）· 输出 ${output}（thinking ${thought}）`)
  console.log(`按付费价估算：$${usd.toFixed(4)} ≈ ¥${(usd * 7.2).toFixed(2)}（Hydrogen 免费档实际 ¥0）`)
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  console.log(`模型 ${MODEL} · 输出目录 ${OUT}`)
  if (process.env.HTTPS_PROXY || process.env.https_proxy) console.log(`代理 ${process.env.HTTPS_PROXY || process.env.https_proxy}（需 NODE_USE_ENV_PROXY=1 才生效）`)

  if (args.prev) {
    const ask =
      args.ask ||
      '基于你看过的这部短剧和刚才产出的高光库，剪一条 30 秒「单点爆破」引流混剪：输出 JSON {"clips":[{"ep":集数,"start":全局秒,"end":全局秒,"role":"钩子/高潮","why":"≤30字选用理由"}]}，总时长不超过 30 秒，开场用钩子最强的片段，结尾留悬念。只输出 JSON。'
    const { text, raw } = await interact({
      model: MODEL,
      previous_interaction_id: args.prev,
      input: [{ type: 'text', text: ask }],
      store: true,
      generation_config: { max_output_tokens: 16384, thinking_level: 'low' }
    })
    fs.writeFileSync(path.join(OUT, 'follow-response.json'), JSON.stringify(raw, null, 2))
    fs.writeFileSync(path.join(OUT, 'follow-result.json'), text)
    console.log('—— 追问输出 ——\n' + text.slice(0, 2000))
    reportUsage(raw.usage)
    console.log(`完整结果已存 ${OUT}`)
    return
  }

  const lib = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'drama-workbench', 'library.json'), 'utf8'))
  const drama = args.drama ? lib.dramas.find((d) => d.title.includes(args.drama)) : lib.dramas[0]
  if (!drama) throw new Error('找不到剧集')
  const epsArg = String(args.eps || '41-45')
  const nums = epsArg.includes('-')
    ? Array.from({ length: Number(epsArg.split('-')[1]) - Number(epsArg.split('-')[0]) + 1 }, (_, i) => Number(epsArg.split('-')[0]) + i)
    : epsArg.split(',').map(Number)
  const eps = nums.map((n) => drama.episodes.find((e) => e.n === n)).filter(Boolean)
  if (eps.length !== nums.length) throw new Error('部分集数在媒体库中不存在')
  for (const ep of eps) {
    if (!fs.existsSync(ep.file)) throw new Error(`文件不存在：${ep.file}`)
    if (!ep.duration) throw new Error(`第 ${ep.n} 集缺少时长，请先在 app 里完成元数据读取`)
  }
  let acc = 0
  const map = eps.map((ep) => {
    const m = { epId: ep.id, n: ep.n, globalStart: acc, globalEnd: acc + ep.duration, duration: ep.duration }
    acc += ep.duration
    return m
  })
  console.log(`《${drama.title}》第 ${nums.join(',')} 集 · 共 ${acc.toFixed(1)}s`)
  fs.writeFileSync(path.join(OUT, 'map.json'), JSON.stringify(map, null, 2))

  const merged = await mergeProxy(eps, map)
  const file = await uploadVideo(merged)
  console.log(`视频已就绪：${file.uri}`)
  const { text, raw } = await interact({
    model: MODEL,
    input: [
      { type: 'video', uri: file.uri, mime_type: 'video/mp4' },
      { type: 'text', text: buildPrompt(map) }
    ],
    background: true,
    store: true,
    generation_config: { max_output_tokens: 65536, thinking_level: 'low' }
  })
  fs.writeFileSync(path.join(OUT, 'response.json'), JSON.stringify(raw, null, 2))
  reportUsage(raw.usage)
  let parsed = null
  try {
    parsed = extractJson(text)
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(parsed, null, 2))
    const hls = parsed.highlights || []
    console.log('—— 产出概览 ——')
    console.log(`人物 ${(parsed.characters || []).length} 个：${(parsed.characters || []).map((c) => c.name).join('、')}`)
    console.log(`分集剧本 ${(parsed.episodes || []).length} 集 · 台词 ${(parsed.episodes || []).reduce((s, e) => s + (e.transcript || []).length, 0)} 句`)
    console.log(`高光 ${hls.length} 条（每集 ${nums.map((n) => hls.filter((h) => h.ep === n).length).join('/')}）`)
    console.log(`logline：${parsed.logline || ''}`)
  } catch (e) {
    fs.writeFileSync(path.join(OUT, 'result-raw.txt'), text)
    console.warn(`JSON 解析失败（原文已存 result-raw.txt）：${e.message}`)
  }
  console.log(`\n全部产物已存 ${OUT}`)
  console.log(`缓存追问命令：node scripts/spike-global.cjs --prev=${raw.id}`)
}

main().catch((e) => {
  console.error(`失败：${e.message}`)
  process.exit(1)
})