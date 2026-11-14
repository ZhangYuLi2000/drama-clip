/* Google 官方原生接口视频测试（免费档验证）
 * 用法：node scripts/test-google-native.cjs   （需 GEMINI_KEY + 可直连 Google）
 * 走 generateContent inline_data 视频，与 app 内原生传输一致 */
const fs = require('fs')
const path = require('path')
const ROOT = 'https://generativelanguage.googleapis.com'
const KEY = process.env.GEMINI_KEY
const MODEL = process.env.GEMINI_MODEL || 'gemini-4-hydrogen'
if (!KEY) { console.error('缺少 GEMINI_KEY'); process.exit(1) }
const VIDEO = path.join(__dirname, 'spike-out', 'merged.mp4')

async function native(parts, maxOutputTokens) {
  const res = await fetch(`${ROOT}/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens, thinkingConfig: { thinkingLevel: 'low' } } }),
    signal: AbortSignal.timeout(240000)
  })
  const text = await res.text()
  let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}

;(async () => {
  console.log(`原生接口 ${ROOT} · 模型 ${MODEL}\n`)
  const t = await native([{ text: '只回复四个字：连通正常' }], 2048)
  const tt = t.json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || t.text
  console.log(`1. 文本 → ${t.status} · ${JSON.stringify(String(tt).slice(0, 60))}`)
  if (t.status !== 200) { console.log('   文本不通，终止：' + t.text.slice(0, 200)); return }
  if (!fs.existsSync(VIDEO)) { console.log('2. 缺少 merged.mp4'); return }
  const b64 = fs.readFileSync(VIDEO).toString('base64')
  const v = await native([{ inline_data: { mime_type: 'video/mp4', data: b64 } }, { text: '用一句话概括这段视频的内容' }], 4096)
  const vt = v.json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || v.text
  const u = v.json?.usageMetadata || {}
  console.log(`2. 视频 → ${v.status} · promptTokenCount=${u.promptTokenCount} · 回复:${JSON.stringify(String(vt).slice(0, 120))}`)
  if (v.status === 200 && u.promptTokenCount > 1000) console.log('\n✓ 官方原生接口支持视频，免费档可用！app 里点「预设：Google 官方免费」填 key 即可')
  else console.log('\n✗ 视频失败：' + String(v.text).slice(0, 250))
})().catch((e) => { console.error('异常:', e.message); process.exit(1) })