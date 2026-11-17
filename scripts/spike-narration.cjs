#!/usr/bin/env node
// P1a 解说稿生成 + 龙书逐段配音 验证脚本（不出片）。
// 用法: node scripts/spike-narration.cjs --dashscope-key=sk-xxx [--drama=被抓住的秘密] [--target=120] [--eps=14-27] [--dry-run]
//   --dry-run 只生成解说稿并打印（不配音/不写盘），先验证文案质量。
//   --target 目标总时长秒（默认120=2分钟主线解说）；--eps 限定集数范围；--with-transcript 附逐句台词。
// 文本模型默认百炼 qwen-plus（compatible-mode），TTS 默认 qwen-audio-3.1-tts-flash + longshu_v3.1。
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const args = {}
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=([\s\S]*))?$/.exec(a)
  if (m) args[m[1]] = m[2] ?? 'true'
}
const dashKey = (args['dashscope-key'] || process.env.DASHSCOPE_API_KEY || '').trim()
const USERDATA = args['user-data'] || 'C:/Users/raolong/AppData/Roaming/drama-workbench'
const TEXT_MODEL = args['text-model'] || 'qwen-plus'
const TEXT_BASE = (args['text-base'] || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '')
const TTS_MODEL = args['tts-model'] || 'qwen-audio-3.1-tts-flash'
const VOICE = args.voice || 'longshu_v3.1'
const RATE = Math.min(2, Math.max(0.5, parseFloat(args.rate || '1.1') || 1.1))
const TARGET = Math.max(30, parseInt(args.target || '120', 10) || 120)
const INSTRUCT = '请用影视解说的语气，节奏明快，吐字清晰，略带悬念感。'
const DRY = args['dry-run'] === 'true'
const OUT = path.join(__dirname, args.out || 'spike-narration-out')
const CHARS_PER_SEC = 4.5

let ffprobe = null, ffmpeg = null
try { ffprobe = require('ffprobe-static').path } catch {}
try { ffmpeg = require('ffmpeg-static') } catch {}
function durationOf(file) {
  if (!ffprobe) return null
  const r = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], { encoding: 'utf8' })
  try { return Math.round(parseFloat(JSON.parse(r.stdout).format.duration) * 100) / 100 } catch { return null }
}

function extractJson(text) {
  const t = text.trim()
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const src = fenced ? fenced[1].trim() : t
  const s = src.indexOf('{'), e = src.lastIndexOf('}')
  if (s >= 0 && e > s) return JSON.parse(src.slice(s, e + 1))
  throw new Error('模型输出不是 JSON：' + text.slice(0, 200))
}

function loadDrama() {
  const lib = JSON.parse(fs.readFileSync(path.join(USERDATA, 'library.json'), 'utf8'))
  const d = args['drama-id']
    ? lib.dramas.find((x) => x.id === args['drama-id'])
    : lib.dramas.find((x) => (x.title || '').includes(args.drama || '被抓住的秘密'))
  if (!d) throw new Error('找不到剧集，可用 --drama=标题关键词 或 --drama-id=')
  const gp = path.join(USERDATA, 'media-cache', 'global', d.id, 'script.json')
  if (!fs.existsSync(gp)) throw new Error(`缺少全局剧本 ${gp}，请先在应用里跑全局分析`)
  const script = JSON.parse(fs.readFileSync(gp, 'utf8'))
  return { d, script }
}

function buildDigest(d, script) {
  let eps = [...d.episodes].sort((a, b) => a.n - b.n)
  if (args.eps) {
    const [a, b] = args.eps.split('-').map((x) => parseInt(x, 10))
    eps = eps.filter((e) => e.n >= a && e.n <= (b || a))
  }
  const sumByN = new Map((script.episodes || []).map((e) => [e.n, e]))
  const chars = (d.synthesis?.characters || []).slice(0, 12)
  const lines = []
  lines.push(`剧名：《${d.title}》`)
  if (script.logline || d.synthesis?.logline) lines.push(`故事主线：${script.logline || d.synthesis.logline}`)
  if (script.arcs || d.synthesis?.arcs) lines.push(`叙事地图：${script.arcs || d.synthesis.arcs}`)
  if (chars.length) lines.push(`核心人物：${chars.map((c) => `${c.name}(${c.role}${c.desc ? '·' + c.desc : ''})`).join('；')}`)
  lines.push('\n=== 分集梗概 + 高光画面库（in/out 为该集内秒数）===')
  for (const e of eps) {
    const s = sumByN.get(e.n)
    const dur = e.duration || 0
    lines.push(`\n第${e.n}集（时长${dur.toFixed(1)}s）梗概：${s?.summary || e.summary || '（无）'}`)
    const cands = [...(e.candidates || [])].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 2)
    for (const c of cands) {
      lines.push(`  画面[${c.in.toFixed(1)}-${c.out.toFixed(1)}s] 分${c.score}《${c.title}》 场景:${c.scene || ''} 金句:${c.quote || ''} 人物:${(c.characters || []).join('/')}`)
    }
    if (args['with-transcript'] === 'true' && s?.transcript?.length) {
      lines.push('  台词：' + s.transcript.map((t) => `[${t.start.toFixed(1)}]${t.text}`).join(' '))
    }
  }
  return { text: lines.join('\n'), eps, count: eps.length }
}

function buildPrompt(digest) {
  const budget = Math.round(TARGET * CHARS_PER_SEC)
  return [
    digest.text,
    '\n=== 任务 ===',
    `为这部短剧写一条「主线解说」短视频文案（不是混剪标题，是连贯的第三人称解说旁白），锁定故事主线所述的那条冲突线，按剧情时间顺序讲清楚。`,
    `目标成片总时长约 ${TARGET} 秒；解说语速约 ${CHARS_PER_SEC} 字/秒，所以解说词总字数约 ${budget} 字（允许 ±15%）。`,
    '结构：钩子（开场3秒抓人）→ 剧情（起因/升级）→ 高潮 → 悬念/引导（结尾留钩子引导看正片，不要把结局彻底讲死）。',
    '分成 8-16 段，每段解说词 30-80 字，口语化、有节奏感和悬念感，像抖音影视解说那样讲故事。',
    '每段必须绑定一个画面：优先从上面「高光画面库」里选 epN + in/out（可微调起止），画面内容要能支撑这段解说；in/out 必须落在该集时长内、out>in。',
    '只依据给出的剧情写作，不要编造人物或情节；人物用真实姓名（陈峰/苏烟/沈晏等）。',
    '只输出一个 JSON 对象，不要 markdown 包裹：',
    '{"title":"解说标题≤20字","hookHeadline":"开场花字≤12字","segments":[{"text":"解说词","epN":集数,"in":起始秒,"out":结束秒,"role":"钩子/剧情/高潮/悬念/引导","reason":"≤30字画面理由"}],"publishCopy":"引流发布文案≤80字"}'
  ].join('\n')
}

async function genScript(prompt) {
  const r = await fetch(`${TEXT_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${dashKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: TEXT_MODEL, temperature: 0.7, max_tokens: 8000, messages: [{ role: 'system', content: '你是短剧解说文案高手，只输出 JSON，不输出其它内容。' }, { role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(180000)
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.error) throw new Error(`文本模型 HTTP ${r.status} ${j.error?.message || JSON.stringify(j).slice(0, 200)}`)
  const content = j.choices?.[0]?.message?.content || ''
  if (!content.trim()) throw new Error('文本模型空返回 finish_reason=' + j.choices?.[0]?.finish_reason)
  return { parsed: extractJson(content), usage: j.usage, raw: content }
}

async function tts(text, cacheFile) {
  if (cacheFile && fs.existsSync(cacheFile) && fs.statSync(cacheFile).size > 1024) return { file: cacheFile, cached: true }
  const r = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer', {
    method: 'POST',
    headers: { Authorization: `Bearer ${dashKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: TTS_MODEL, input: { text, voice: VOICE, format: 'wav', sample_rate: 24000, rate: RATE, instruction: INSTRUCT } }),
    signal: AbortSignal.timeout(120000)
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.code) throw new Error(`TTS HTTP ${r.status} ${j.code || ''} ${j.message || JSON.stringify(j).slice(0, 160)}`)
  const url = j.output?.audio?.url
  if (!url) throw new Error('TTS 无音频URL')
  const ar = await fetch(url, { signal: AbortSignal.timeout(120000) })
  const buf = Buffer.from(await ar.arrayBuffer())
  if (cacheFile) { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, buf) }
  return { buf, file: cacheFile, usage: j.usage }
}

async function main() {
  if (!dashKey) { console.log('需要 --dashscope-key=sk-xxx（或环境变量 DASHSCOPE_API_KEY），文本与TTS共用百炼key'); process.exit(1) }
  const { d, script } = loadDrama()
  const digest = buildDigest(d, script)
  console.log(`剧：${d.title}（${d.id}）  素材集数：${digest.count}  目标时长：${TARGET}s  音色：${VOICE}@${TTS_MODEL}`)
  console.log(`证据摘要 ${digest.text.length} 字，调用 ${TEXT_MODEL} 生成解说稿…\n`)
  const { parsed, usage } = await genScript(buildPrompt(digest))
  const segs = Array.isArray(parsed.segments) ? parsed.segments : []
  if (!segs.length) throw new Error('解说稿没有 segments')
  const durByN = new Map(d.episodes.map((e) => [e.n, e.duration || 0]))
  for (const s of segs) {
    const dur = durByN.get(s.epN) || 0
    s.in = Math.max(0, Math.min(Number(s.in) || 0, dur - 1))
    s.out = Math.max(s.in + 1, Math.min(Number(s.out) || s.in + 5, dur))
    s.in = Math.round(s.in * 10) / 10; s.out = Math.round(s.out * 10) / 10
    s.chars = (s.text || '').length
  }
  const totalChars = segs.reduce((a, s) => a + s.chars, 0)
  console.log(`标题：${parsed.title || ''}  开场花字：${parsed.hookHeadline || ''}`)
  console.log(`段数：${segs.length}  总字数：${totalChars}  预估时长：${(totalChars / CHARS_PER_SEC).toFixed(1)}s（目标${TARGET}s）  文本tokens：${JSON.stringify(usage || {})}\n`)
  segs.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2, '0')} [${s.role || '?'}] 第${s.epN}集 ${s.in}-${s.out}s (${s.chars}字) ${s.text}`))

  if (DRY) { console.log('\n--dry-run：仅生成文案，未配音/未写盘。去掉 --dry-run 重跑即可逐段配音。'); return }

  fs.mkdirSync(OUT, { recursive: true })
  const cacheDir = path.join(OUT, 'cache')
  const results = []
  const wavFiles = []
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const key = crypto.createHash('sha1').update(`${s.text}|${VOICE}|${RATE}|${TTS_MODEL}`).digest('hex').slice(0, 16)
    const cacheFile = path.join(cacheDir, `${key}.wav`)
    const tag = `[${i + 1}/${segs.length}]`
    try {
      const r = await tts(s.text, cacheFile)
      const file = r.file || path.join(OUT, `seg-${String(i + 1).padStart(2, '0')}.wav`)
      if (!r.file) fs.writeFileSync(file, r.buf)
      const dur = durationOf(file)
      wavFiles.push(file)
      results.push({ ...s, audio: path.basename(file), durationSec: dur, ok: true })
      console.log(`${tag} OK 第${s.epN}集 ${s.in}-${s.out}s 配音${dur ? dur + 's' : '?'}${r.cached ? ' (缓存)' : ''} → ${path.basename(file)}`)
    } catch (e) {
      results.push({ ...s, ok: false, error: String(e.message || e) })
      console.log(`${tag} FAIL ${String(e.message || e).slice(0, 180)}`)
    }
  }
  const totalAudio = results.reduce((a, r) => a + (r.durationSec || 0), 0)
  fs.writeFileSync(path.join(OUT, 'narration.json'), JSON.stringify({ drama: d.title, dramaId: d.id, title: parsed.title, hookHeadline: parsed.hookHeadline, publishCopy: parsed.publishCopy, voice: VOICE, ttsModel: TTS_MODEL, rate: RATE, targetSec: TARGET, totalAudioSec: Math.round(totalAudio * 10) / 10, segments: results }, null, 2))
  fs.writeFileSync(path.join(OUT, '稿子.txt'), [`《${parsed.title || d.title}》解说稿`, `开场花字：${parsed.hookHeadline || ''}`, '', ...results.map((r, i) => `${i + 1}. [${r.role}] 第${r.epN}集 ${r.in}-${r.out}s\n${r.text}`), '', `引流文案：${parsed.publishCopy || ''}`].join('\n'))
  if (ffmpeg && wavFiles.length) {
    const list = path.join(OUT, 'concat.txt')
    fs.writeFileSync(list, wavFiles.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
    const full = path.join(OUT, 'full-narration.wav')
    const rr = spawnSync(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', full], { encoding: 'utf8' })
    if (fs.existsSync(full)) console.log(`\n整段解说音频：${full}（${durationOf(full) || '?'}s）`)
    else console.log('\n整段拼接失败：' + (rr.stderr || '').slice(0, 160))
  }
  console.log(`\n完成：配音 ${results.filter((r) => r.ok).length}/${segs.length} 段，实测总时长 ${totalAudio.toFixed(1)}s（目标${TARGET}s）`)
  console.log(`输出目录：${OUT}（narration.json / 稿子.txt / seg-*.wav / full-narration.wav）`)
}

main().catch((e) => { console.error('错误：', e.message || e); process.exit(1) })