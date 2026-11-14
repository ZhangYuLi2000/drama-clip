/* Google 官方 OpenAI 兼容端点视频能力测试
 * 用法（在你存有 GEMINI_KEY 的终端）：node scripts/test-google-openai.cjs
 * 若 video_url 被真实消费（prompt_tokens 数万 + 回复剧情），则现有全局管线换配置即可走官方免费档 */
const fs = require('fs')
const path = require('path')
const BASE = 'https://generativelanguage.googleapis.com/v1beta/openai'
const KEY = process.env.GEMINI_KEY
const MODEL = process.env.GEMINI_MODEL || 'gemini-4-hydrogen'
if (!KEY) { console.error('缺少 GEMINI_KEY 环境变量'); process.exit(1) }
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const VIDEO = path.join(__dirname, 'spike-out', 'merged.mp4')

async function chat(content, maxTokens) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content }], max_tokens: maxTokens }),
    signal: AbortSignal.timeout(240000)
  })
  const text = await res.text()
  let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}

;(async () => {
  console.log(`目标 ${BASE} · 模型 ${MODEL}\n`)
  // 1. 模型列表（仅供参考，OpenAI 兼容层可能未实现 /models，失败不终止）
  try {
    const r = await fetch(`${BASE}/models`, { headers: H, signal: AbortSignal.timeout(20000) })
    const txt = await r.text()
    console.log(`1. /models → ${r.status}（仅参考）· ${txt.slice(0, 120)}`)
  } catch (e) { console.log('1. /models → 网络失败:', e.message) }
  // 2. 文本（真正的连通性判据）
  const t = await chat('只回复四个字：连通正常', 2048)
  console.log(`2. 文本 → ${t.status} · ${JSON.stringify((t.json?.choices?.[0]?.message?.content || t.text).slice(0, 80))}`)
  if (t.status !== 200) { console.log('   文本不通：key 无效或端点/模型名不对，终止'); return }
  // 3. 视频
  if (!fs.existsSync(VIDEO)) { console.log('3. 缺少 spike-out/merged.mp4，跳过视频'); return }
  const b64 = fs.readFileSync(VIDEO).toString('base64')
  const v = await chat([{ type: 'video_url', video_url: { url: `data:video/mp4;base64,${b64}` } }, { type: 'text', text: '用一句话概括这段视频的内容' }], 4096)
  const reply = v.json?.choices?.[0]?.message?.content || v.text
  const pt = v.json?.usage?.prompt_tokens
  console.log(`3. 视频 → ${v.status} · prompt_tokens=${pt} · 回复:${JSON.stringify(String(reply).slice(0, 120))}`)
  if (v.status === 200 && pt > 1000) console.log('\n✓ 官方 OpenAI 兼容端点支持视频！现有全局管线换配置即可：baseUrl=' + BASE + ' model=' + MODEL + ' key=你的Google key')
  else if (v.status === 200) console.log('\n✗ 返回200但 prompt_tokens 极低——视频被静默剥离，官方 OpenAI 兼容端点不支持视频（需原生接口）')
  else console.log('\n✗ 视频请求失败：' + String(v.text).slice(0, 200))
})().catch((e) => { console.error('异常:', e.message); process.exit(1) })