#!/usr/bin/env node
/* 中转站能力探针：node scripts/probe-relay.cjs [--base-url=https://keda8.ai]
 * 需要环境变量 KEDA_KEY。依次探测：模型列表 / OpenAI文本 / 原生文本 / Files上传 / 视频理解 */
const fs = require('fs')
const path = require('path')
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=([\s\S]*)$/); return m ? [m[1], m[2]] : [a, true] }))
const BASE = (args['base-url'] || 'https://keda8.ai').replace(/\/+$/, '')
const KEY = process.env.KEDA_KEY
if (!KEY) { console.error('缺少 KEDA_KEY'); process.exit(1) }
const MODEL = args.model || 'gemini-4-hydrogen'
const VIDEO = path.join(__dirname, 'spike-out', 'merged.mp4')
const results = []
const mark = (name, ok, info) => { results.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`) }

async function req(method, url, { headers = {}, body, timeout = 60000 } = {}) {
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeout) })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text, headers: res.headers }
}
const bearer = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const goog = { 'x-goog-api-key': KEY, 'Content-Type': 'application/json' }

async function main() {
  console.log(`探针目标 ${BASE} · 模型 ${MODEL}\n`)

  // 1. 模型列表
  let nativeOk = false
  for (const [name, url, h] of [
    ['OpenAI /v1/models', `${BASE}/v1/models`, bearer],
    ['原生 /v1beta/models (Bearer)', `${BASE}/v1beta/models`, bearer],
    ['原生 /v1beta/models (x-goog)', `${BASE}/v1beta/models`, goog]
  ]) {
    try {
      const r = await req('GET', url, { headers: h, timeout: 20000 })
      const arr = r.json?.data || r.json?.models || []
      const g4 = arr.map((m) => m.id || m.name).filter((x) => /gemini-4/i.test(x || ''))
      mark(name, r.status === 200, `HTTP ${r.status} · 模型 ${arr.length} 个 · gemini-4: ${g4.slice(0, 5).join(', ') || '无'}`)
      if (r.status === 200 && name.includes('原生')) nativeOk = true
    } catch (e) { mark(name, false, e.message) }
  }

  // 2. OpenAI 兼容文本
  let openaiOk = false
  try {
    const r = await req('POST', `${BASE}/v1/chat/completions`, {
      headers: bearer,
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: '只回复四个字：连通正常' }], max_tokens: 2048 })
    })
    const reply = r.json?.choices?.[0]?.message?.content
    openaiOk = r.status === 200 && Boolean(reply)
    mark('OpenAI 文本对话', openaiOk, `HTTP ${r.status} · 回复:${JSON.stringify((reply || r.text).slice(0, 60))} · usage:${JSON.stringify(r.json?.usage || {})}`)
  } catch (e) { mark('OpenAI 文本对话', false, e.message) }

  // 3. 原生文本（interactions 与 generateContent 两条路径）
  let interactionsOk = false
  let generateOk = false
  if (nativeOk) {
    try {
      const r = await req('POST', `${BASE}/v1beta/interactions`, {
        headers: bearer,
        body: JSON.stringify({ model: MODEL, input: [{ type: 'text', text: '只回复四个字：连通正常' }], generation_config: { max_output_tokens: 2048, thinking_level: 'low' } })
      })
      const txt = (r.json?.steps || []).filter((s) => s.type === 'model_output').flatMap((s) => s.content || []).map((c) => c.text).join('')
      interactionsOk = r.status === 200 && Boolean(txt)
      mark('原生 interactions', interactionsOk, `HTTP ${r.status} · ${JSON.stringify((txt || r.text).slice(0, 80))} · usage:${JSON.stringify(r.json?.usage || {})}`)
    } catch (e) { mark('原生 interactions', false, e.message) }
    try {
      const r = await req('POST', `${BASE}/v1beta/models/${MODEL}:generateContent`, {
        headers: bearer,
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: '只回复四个字：连通正常' }] }], generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'low' } } })
      })
      const txt = r.json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('')
      generateOk = r.status === 200 && Boolean(txt)
      mark('原生 generateContent', generateOk, `HTTP ${r.status} · ${JSON.stringify((txt || r.text).slice(0, 80))} · usage:${JSON.stringify(r.json?.usageMetadata || {})}`)
    } catch (e) { mark('原生 generateContent', false, e.message) }
  } else {
    mark('原生 interactions / generateContent', false, '原生模型列表不可用，跳过')
  }

  // 4. Files API 上传（用 spike 的真实合并视频 2.4MB）
  let fileUri = null
  if (nativeOk && fs.existsSync(VIDEO)) {
    try {
      const bytes = fs.statSync(VIDEO).size
      const start = await req('POST', `${BASE}/upload/v1beta/files`, {
        headers: { ...bearer, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(bytes), 'X-Goog-Upload-Header-Content-Type': 'video/mp4' },
        body: JSON.stringify({ file: { display_name: 'relay-probe' } })
      })
      const upUrl = start.headers.get('x-goog-upload-url')
      if (start.status !== 200 || !upUrl) throw new Error(`start HTTP ${start.status} ${start.text.slice(0, 120)}`)
      const up = await fetch(upUrl, { method: 'POST', headers: { 'Content-Length': String(bytes), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: fs.readFileSync(VIDEO), signal: AbortSignal.timeout(120000) })
      const info = (await up.json()).file
      if (!up.ok || !info?.name) throw new Error(`upload HTTP ${up.status}`)
      for (let i = 0; i < 36; i++) {
        await new Promise((r) => setTimeout(r, 5000))
        const st = await req('GET', `${BASE}/v1beta/${info.name}`, { headers: bearer, timeout: 20000 })
        if (st.json?.state === 'ACTIVE') { fileUri = st.json.uri || info.uri; break }
        if (st.json?.state === 'FAILED') throw new Error('服务端处理 FAILED')
      }
      mark('Files API 上传+处理', Boolean(fileUri), fileUri || '超时')
    } catch (e) { mark('Files API 上传+处理', false, e.message) }
  } else {
    mark('Files API 上传+处理', false, nativeOk ? '缺少 spike-out/merged.mp4' : '原生接口不可用，跳过')
  }

  // 5. 视频理解（优先原生 file_data，兜底 OpenAI base64）
  if (fileUri && (interactionsOk || generateOk)) {
    try {
      let r
      if (interactionsOk) {
        r = await req('POST', `${BASE}/v1beta/interactions`, {
          headers: bearer,
          body: JSON.stringify({ model: MODEL, input: [{ type: 'video', uri: fileUri, mime_type: 'video/mp4' }, { type: 'text', text: '用一句话概括这段视频的内容' }], generation_config: { max_output_tokens: 4096, thinking_level: 'low' } }),
          timeout: 300000
        })
        const txt = (r.json?.steps || []).filter((s) => s.type === 'model_output').flatMap((s) => s.content || []).map((c) => c.text).join('')
        mark('原生视频理解(interactions+file)', r.status === 200 && Boolean(txt), `HTTP ${r.status} · ${JSON.stringify((txt || r.text).slice(0, 100))} · usage:${JSON.stringify(r.json?.usage || {})}`)
      } else {
        r = await req('POST', `${BASE}/v1beta/models/${MODEL}:generateContent`, {
          headers: bearer,
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ file_data: { file_uri: fileUri, mime_type: 'video/mp4' } }, { text: '用一句话概括这段视频的内容' }] }], generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'low' } } }),
          timeout: 300000
        })
        const txt = r.json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('')
        mark('原生视频理解(generateContent+file)', r.status === 200 && Boolean(txt), `HTTP ${r.status} · ${JSON.stringify((txt || r.text).slice(0, 100))} · usage:${JSON.stringify(r.json?.usageMetadata || {})}`)
      }
    } catch (e) { mark('原生视频理解', false, e.message) }
  } else if (openaiOk && fs.existsSync(VIDEO)) {
    try {
      const b64 = fs.readFileSync(VIDEO).toString('base64')
      const r = await req('POST', `${BASE}/v1/chat/completions`, {
        headers: bearer,
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: [{ type: 'video_url', video_url: { url: `data:video/mp4;base64,${b64}` } }, { type: 'text', text: '用一句话概括这段视频的内容' }] }], max_tokens: 4096 }),
        timeout: 300000
      })
      const reply = r.json?.choices?.[0]?.message?.content
      mark('OpenAI兼容视频(base64)', r.status === 200 && Boolean(reply), `HTTP ${r.status} · ${JSON.stringify((reply || r.text).slice(0, 100))} · usage:${JSON.stringify(r.json?.usage || {})}`)
    } catch (e) { mark('OpenAI兼容视频(base64)', false, e.message) }
  } else {
    mark('视频理解', false, '无可用路径，跳过')
  }

  console.log('\n—— 能力矩阵 ——')
  for (const [name, ok] of results) console.log(`${ok ? '支持' : '不支持'}  ${name}`)
}
main().catch((e) => { console.error('探针异常：', e.message); process.exit(1) })