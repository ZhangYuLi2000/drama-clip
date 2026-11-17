#!/usr/bin/env node
// P0 解说音色试听原型：同一句解说词 × 多引擎多音色，音频输出到 scripts/spike-tts-out/
// 用法: node scripts/spike-tts.cjs --dashscope-key=sk-xxx [--volc-key=xxx] [--text="自定义解说词"] [--rate=1.1] [--only=Ethan,灿灿]
// 密钥也可走环境变量 DASHSCOPE_API_KEY / VOLC_API_KEY；只配一家就只跑一家。
// 百炼 qwen-audio/cosyvoice 若默认端点报错，加 --workspace=业务空间ID（百炼控制台可查）。
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const args = {}
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=([\s\S]*))?$/.exec(a)
  if (m) args[m[1]] = m[2] ?? 'true'
}

const TEXT = args.text || '注意看，这个女人叫苏烟。结婚三年，她无意间发现丈夫手机里的秘密，一条暧昧短信，彻底撕碎了这个家的平静。而她接下来的反击，让所有人都傻了眼。'
const INSTRUCT = '请用影视解说的语气，节奏明快，吐字清晰，略带悬念感。'
const RATE = Math.min(2, Math.max(0.5, parseFloat(args.rate || '1.1') || 1.1))
const SET = args.set || 'default'
const OUT = path.join(__dirname, args.out || (SET === 'narration' ? 'spike-tts-out-narration' : 'spike-tts-out'))
const dashKey = (args['dashscope-key'] || process.env.DASHSCOPE_API_KEY || '').trim()
const volcKey = (args['volc-key'] || process.env.VOLC_API_KEY || '').trim()
const audioBase = args.workspace ? `https://${args.workspace}.cn-beijing.maas.aliyuncs.com` : 'https://dashscope.aliyuncs.com'

const QWEN3_VOICES = [
  ['Ethan', '晨煦·阳光男声'],
  ['Andre', '安德雷·磁性沉稳男声'],
  ['Ryan', '甜茶·戏感男声'],
  ['Cherry', '芊悦·亲切女声'],
  ['Serena', '苏瑶·温柔女声']
]
const VOLC_VOICES = [
  ['zh_male_yuanboxiaoshu_uranus_bigtts', '渊博小叔2.0·沉稳男声'],
  ['zh_female_cancan_uranus_bigtts', '知性灿灿2.0·女声']
]
// 第二轮 --set=narration：解说专用音色（火山专用解说 + 百炼叙事/旁白向）
const VOLC_NARRATION = [
  ['zh_male_cixingjieshuonan_uranus_bigtts', '磁性解说男声2.0'],
  ['zh_male_xuanyijieshuo_uranus_bigtts', '悬疑解说2.0'],
  ['zh_male_jieshuoxiaoming_uranus_bigtts', '解说小明2.0']
]
const QWENAUDIO_NARRATION = [
  ['xunanchuan_v3.1', '许南川·磁性叙事男'],
  ['longshu_v3.1', '龙书·沉稳磁性男'],
  ['baianran_v3.1', '白安然·低沉浑厚女']
]

const jobs = []
if (SET === 'narration') {
  if (volcKey) for (const [voice, label] of VOLC_NARRATION) jobs.push({ kind: 'volc', provider: 'volc', model: 'seed-tts-2.0', voice, label })
  if (dashKey) {
    for (const [voice, label] of QWENAUDIO_NARRATION) jobs.push({ kind: 'synth', provider: 'bailian', model: 'qwen-audio-3.1-tts-flash', voice, label, extra: { rate: RATE, instruction: INSTRUCT } })
    jobs.push({ kind: 'synth', provider: 'bailian', model: 'cosyvoice-v3-flash', voice: 'longfei_v3', label: '龙飞·热血磁性男', extra: {} })
  }
} else {
  if (dashKey) {
    for (const [voice, label] of QWEN3_VOICES) jobs.push({ kind: 'qwen3', provider: 'bailian', model: 'qwen3-tts-flash', voice, label })
    jobs.push({ kind: 'synth', provider: 'bailian', model: 'qwen-audio-3.0-tts-flash', voice: 'longanhuan_v3.6', label: '龙安欢·指令控制解说', extra: { rate: RATE, instruction: INSTRUCT } })
    jobs.push({ kind: 'synth', provider: 'bailian', model: 'cosyvoice-v3-flash', voice: 'longanyang', label: '龙安阳·CosyVoice', extra: {} })
  }
  if (volcKey) for (const [voice, label] of VOLC_VOICES) jobs.push({ kind: 'volc', provider: 'volc', model: 'seed-tts-2.0', voice, label })
}

const only = (args.only || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const picked = only.length ? jobs.filter((j) => only.some((s) => `${j.voice} ${j.label} ${j.model}`.toLowerCase().includes(s))) : jobs

let ffprobe = null
try { ffprobe = require('ffprobe-static').path } catch {}
function durationOf(file) {
  if (!ffprobe) return null
  const r = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], { encoding: 'utf8' })
  try { return Math.round(parseFloat(JSON.parse(r.stdout).format.duration) * 100) / 100 } catch { return null }
}

async function download(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) })
  if (!r.ok) throw new Error(`音频下载失败 HTTP ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

async function bailianQwen3(job) {
  const r = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
    method: 'POST',
    headers: { Authorization: `Bearer ${dashKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: job.model, input: { text: TEXT, voice: job.voice, language_type: 'Chinese' } }),
    signal: AbortSignal.timeout(120000)
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.code) throw new Error(`HTTP ${r.status} ${j.code || ''} ${j.message || JSON.stringify(j).slice(0, 200)}`)
  const url = j.output?.audio?.url
  if (!url) throw new Error(`响应无音频URL：${JSON.stringify(j).slice(0, 200)}`)
  return { buf: await download(url), ext: 'wav', usage: j.usage }
}

async function bailianSynth(job) {
  const r = await fetch(`${audioBase}/api/v1/services/audio/tts/SpeechSynthesizer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${dashKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: job.model, input: { text: TEXT, voice: job.voice, format: 'wav', sample_rate: 24000, ...job.extra } }),
    signal: AbortSignal.timeout(120000)
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.code) throw new Error(`HTTP ${r.status} ${j.code || ''} ${j.message || JSON.stringify(j).slice(0, 200)}（若端点不存在请加 --workspace=业务空间ID）`)
  const url = j.output?.audio?.url
  if (!url) throw new Error(`响应无音频URL：${JSON.stringify(j).slice(0, 200)}`)
  return { buf: await download(url), ext: 'wav', usage: j.usage }
}

async function volcOnce(job, withInstruct) {
  const reqParams = {
    text: TEXT,
    speaker: job.voice,
    audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: Math.round((RATE - 1) * 100), enable_subtitle: true }
  }
  if (withInstruct) reqParams.additions = JSON.stringify({ context_texts: [INSTRUCT] })
  const r = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
    method: 'POST',
    headers: {
      'X-Api-Key': volcKey,
      'X-Api-Resource-Id': 'seed-tts-2.0',
      'X-Api-Request-Id': crypto.randomUUID(),
      'X-Control-Require-Usage-Tokens-Return': 'text_words',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ user: { uid: 'drama-tts-spike' }, req_params: reqParams }),
    signal: AbortSignal.timeout(120000)
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)} (logid ${r.headers.get('x-tt-logid') || '-'})`)
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const chunks = []
  const words = []
  let usage = null
  let err = null
  let done = false
  const handleLine = (line) => {
    const t = line.trim()
    if (!t) return
    const payload = t.startsWith('data:') ? t.slice(5).trim() : t
    let j
    try { j = JSON.parse(payload) } catch { return }
    if (j.code === 20000000) { usage = j.usage; done = true; return }
    if (j.code !== 0) { err = new Error(`code ${j.code}: ${j.message || ''}`); done = true; return }
    if (j.data) chunks.push(Buffer.from(j.data, 'base64'))
    if (j.sentence?.words?.length) words.push(...j.sentence.words)
  }
  while (!done) {
    const { value, done: rDone } = await reader.read()
    if (rDone) break
    buf += dec.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      handleLine(buf.slice(0, idx))
      buf = buf.slice(idx + 1)
      if (done) break
    }
  }
  if (!done && buf.trim()) handleLine(buf)
  if (err) throw err
  if (!chunks.length) throw new Error('没有收到音频数据（检查是否已开通语音合成2.0）')
  return { buf: Buffer.concat(chunks), ext: 'mp3', usage, words }
}

async function volc(job) {
  try {
    return await volcOnce(job, true)
  } catch (e) {
    if (/code 4|HTTP 4/.test(String(e.message))) return await volcOnce(job, false)
    throw e
  }
}

async function main() {
  if (!picked.length) {
    console.log('没有可运行的试听任务。')
    console.log('  百炼: --dashscope-key=sk-xxx 或环境变量 DASHSCOPE_API_KEY（必需，qwen3-tts-flash 有免费额度）')
    console.log('  火山: --volc-key=xxx 或环境变量 VOLC_API_KEY（可选，新版控制台 API Key，需开通语音合成2.0）')
    console.log('  其它: --set=narration(解说专用第二轮) --text="解说词" --rate=1.1 --only=Ethan,灿灿 --workspace=业务空间ID')
    process.exit(1)
  }
  fs.mkdirSync(OUT, { recursive: true })
  console.log(`解说词（${TEXT.length}字）：${TEXT}`)
  console.log(`语速 ${RATE}x（qwen3-tts-flash 无语速参数，按原速）；共 ${picked.length} 条试听\n`)
  const manifest = []
  for (let i = 0; i < picked.length; i++) {
    const job = picked[i]
    const tag = `[${i + 1}/${picked.length}]`
    const base = `${String(i + 1).padStart(2, '0')}-${job.provider}-${job.voice.replace(/[^a-zA-Z0-9_.-]/g, '_')}`
    try {
      const r = job.kind === 'qwen3' ? await bailianQwen3(job) : job.kind === 'synth' ? await bailianSynth(job) : await volc(job)
      const file = path.join(OUT, `${base}.${r.ext}`)
      fs.writeFileSync(file, r.buf)
      if (r.words?.length) fs.writeFileSync(path.join(OUT, `${base}.words.json`), JSON.stringify(r.words, null, 2))
      const dur = durationOf(file)
      const usage = r.usage ? JSON.stringify(r.usage) : ''
      manifest.push({ file: path.basename(file), ...job, durationSec: dur, usage: r.usage, ok: true })
      console.log(`${tag} OK   ${job.provider}/${job.model}  ${job.voice}（${job.label}）  ${dur ? dur + 's' : '?'}  ${usage}  → ${path.basename(file)}`)
    } catch (e) {
      manifest.push({ ...job, ok: false, error: String(e.message || e) })
      console.log(`${tag} FAIL ${job.provider}/${job.model}  ${job.voice}（${job.label}）  ${String(e.message || e).slice(0, 220)}`)
    }
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ text: TEXT, rate: RATE, at: new Date().toISOString(), results: manifest }, null, 2))
  const ok = manifest.filter((m) => m.ok).length
  console.log(`\n完成 ${ok}/${picked.length}，音频目录：${OUT}`)
  console.log('逐条试听后告诉我偏好的编号/音色名；火山未配 key 时只跑了百炼。')
}

main().catch((e) => { console.error(e); process.exit(1) })