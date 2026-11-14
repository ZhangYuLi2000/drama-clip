/* 诊断：复用 act-1.mp4（11-27集）跑合并 prompt，dump 原始高光，看覆盖与时间基准
 * 用法：node scripts/diag-highlights.cjs  （有 GEMINI_KEY 走 Google 官方原生，否则走 magpie）
 * 原始输出存 scripts/diag-act1-raw.txt */
const fs = require('fs')
const path = require('path')
const lib = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'drama-workbench', 'library.json'), 'utf8'))
const d = lib.dramas[0]
const dir = path.join(process.env.APPDATA, 'drama-workbench', 'media-cache', 'global', d.id)
const eps = d.episodes.filter((e) => e.n >= 11 && e.n <= 27)
let acc = 0
const map = eps.map((e) => { const m = { n: e.n, epId: e.id, globalStart: acc, globalEnd: acc + e.duration, duration: e.duration }; acc += e.duration; return m })
const boundaries = map.map((m) => `第${m.n}集 ${m.globalStart.toFixed(1)}s–${m.globalEnd.toFixed(1)}s`).join('；')
const b64 = fs.readFileSync(path.join(dir, 'act-1.mp4')).toString('base64')
const prompt = [
  `这是一部竖屏短剧的 ${map.length} 集按顺序拼接成的视频片段（含声音），各集边界：${boundaries}。`,
  '请通读后输出一个 JSON 对象（不要 markdown 包裹），包含五部分：',
  '{"logline":"一句话故事","characters":[{"name":"姓名","role":"角色","desc":"身份","relations":"关系"}],"arcs":"叙事地图","episodes":[{"n":集数,"summary":"梗概","transcript":[{"start":秒,"end":秒,"text":"台词"}]}],"highlights":[{"ep":集数,"title":"标题","start":起始秒,"end":结束秒,"score":0到100,"hook":0到100,"quote":"金句","conflict":"冲突","characters":["人物"],"tags":["冲突"],"bd":{"钩子":80,"冲突":80,"情绪":80,"金句":80},"reason":"理由","scene":"场景"}]}',
  `要求：highlights 每集必须 3-5 条（共 ${map.length * 3}-${map.length * 5} 条）；所有时间为相对本视频片段起点的全局秒数，精确到 0.1；只输出 JSON。`
].join('\n')

async function callNative() {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'video/mp4', data: b64 } }, { text: prompt }] }], generationConfig: { maxOutputTokens: 65536, thinkingConfig: { thinkingLevel: 'low' } } }),
    signal: AbortSignal.timeout(300000)
  })
  const t = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`)
  const j = JSON.parse(t)
  return { text: (j.candidates?.[0]?.content?.parts || []).map((p) => p.text).join(''), usage: j.usageMetadata, finish: j.candidates?.[0]?.finishReason }
}
async function callMagpie() {
  const res = await fetch('http://127.0.0.1:3425/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer magpie', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'wandapi/gemini-4-hydrogen', stream: true, stream_options: { include_usage: true }, max_tokens: 65536, messages: [{ role: 'system', content: '你是短剧全局分析助手，只输出 JSON。' }, { role: 'user', content: [{ type: 'video_url', video_url: { url: 'data:video/mp4;base64,' + b64 } }, { type: 'text', text: prompt }] }] }),
    signal: AbortSignal.timeout(300000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = '', text = '', usage = null
  for (;;) { const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l.startsWith('data:')) continue; const p = l.slice(5).trim(); if (!p || p === '[DONE]') continue; let j; try { j = JSON.parse(p) } catch { continue } if (j.choices?.[0]?.delta?.content) text += j.choices[0].delta.content; if (j.usage) usage = j.usage } }
  return { text, usage, finish: null }
}

;(async () => {
  const useNative = Boolean(process.env.GEMINI_KEY)
  console.log('provider:', useNative ? 'Google原生' : 'magpie', '· 幕1代理', (b64.length / 1048576).toFixed(1) + 'MB base64')
  const { text, usage, finish } = useNative ? await callNative() : await callMagpie()
  fs.writeFileSync(path.join(__dirname, 'diag-act1-raw.txt'), text)
  console.log('usage:', JSON.stringify(usage), '· finishReason:', finish, '· 输出字符', text.length)
  const s = text.indexOf('{'), e = text.lastIndexOf('}')
  let obj; try { obj = JSON.parse(text.slice(s, e + 1)) } catch (err) { console.log('JSON解析失败:', err.message, '· 尾部:', text.slice(-150)); return }
  const h = obj.highlights || []
  console.log('highlights', h.length, '条 · episodes', (obj.episodes || []).length, '集')
  const perEp = {}
  for (const x of h) {
    const entry = map.find((m) => m.n === x.ep) ?? map.find((m) => x.start >= m.globalStart && x.start < m.globalEnd)
    let status = '无映射'
    if (entry) { const tin = x.start - entry.globalStart, tout = x.end - entry.globalStart; status = (tout - tin < 1 || tin < 0 || tin > entry.duration) ? `丢弃(tin=${tin.toFixed(0)},dur=${entry.duration.toFixed(0)})` : 'OK' }
    perEp[x.ep] = (perEp[x.ep] || 0) + 1
    console.log(`ep${x.ep} ${x.start}-${x.end} → ${status}`)
  }
  console.log('每集高光数:', map.map((m) => m.n + ':' + (perEp[m.n] || 0)).join(' '))
})().catch((e) => { console.error('失败:', e.message); process.exit(1) })