/* 兼容管线冒烟测试：用 magpie 对 spike 的 5 集代理跑 P1 剧本 + P2 高光，验证 prompt/解析/缓存 */
const fs = require('fs')
const path = require('path')
const BASE = 'http://127.0.0.1:3425/v1'
const KEY = 'magpie'
const MODEL = 'wandapi/gemini-4-hydrogen'
const b64 = fs.readFileSync(path.join(__dirname, 'spike-out', 'merged.mp4')).toString('base64')
const lib = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'drama-workbench', 'library.json'), 'utf8'))
const eps = lib.dramas[0].episodes.filter((e) => e.n >= 41 && e.n <= 45)
let acc = 0
const map = eps.map((e) => { const m = { n: e.n, globalStart: acc, globalEnd: acc + e.duration, duration: e.duration }; acc += e.duration; return m })
const boundaries = map.map((m) => `第${m.n}集 ${m.globalStart.toFixed(1)}s–${m.globalEnd.toFixed(1)}s`).join('；')

async function chat(prompt, maxTokens) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, stream: true, stream_options: { include_usage: true }, max_tokens: maxTokens,
      messages: [
        { role: 'system', content: '你是短剧全局分析助手，只输出 JSON，不输出其它内容。' },
        { role: 'user', content: [{ type: 'video_url', video_url: { url: `data:video/mp4;base64,${b64}` } }, { type: 'text', text: prompt }] }
      ]
    }),
    signal: AbortSignal.timeout(300000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = '', text = '', tokens = 0, cached = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
      if (!line.startsWith('data:')) continue
      const p = line.slice(5).trim()
      if (!p || p === '[DONE]') continue
      let j; try { j = JSON.parse(p) } catch { continue }
      if (j.choices?.[0]?.delta?.content) text += j.choices[0].delta.content
      if (j.usage?.total_tokens) tokens = j.usage.total_tokens
      if (j.usage?.prompt_tokens_details?.cached_tokens) cached = j.usage.prompt_tokens_details.cached_tokens
    }
  }
  return { text, tokens, cached }
}
function extractJson(t) { const s = t.trim(); const a = s.indexOf('{'), b = s.lastIndexOf('}'); return JSON.parse(s.slice(a, b + 1)) }

;(async () => {
  const prompt = [
    `这是一部竖屏短剧的 ${map.length} 集按顺序拼接成的视频片段（含声音），各集边界：${boundaries}。`,
    '请通读后输出一个 JSON 对象（不要 markdown 包裹），包含五部分：',
    '{"logline":"一句话故事，不超过50字","characters":[{"name":"剧中真实姓名，无名用称谓如男主","role":"男主/女主/反派/配角等","desc":"不超过30字身份描述","relations":"不超过30字人物关系"}],"arcs":"本片段叙事地图：开端/发展/高潮/反转/结局分别集中在哪几集，不超过200字","episodes":[{"n":集数,"summary":"本集梗概不超过80字","transcript":[{"start":起始秒,"end":结束秒,"text":"台词"}]}],"highlights":[{"ep":集数,"title":"不超过20字的标题，尽量用金句原话","start":起始秒,"end":结束秒,"score":0到100,"hook":0到100,"quote":"片段中最有传播力的金句原话","conflict":"冲突类型","characters":["出场人物名"],"tags":["冲突","反转","爽点","打脸","甜宠","哭戏","悬念"],"bd":{"钩子":0到100,"冲突":0到100,"情绪":0到100,"金句":0到100},"reason":"不超过60字的理由","scene":"不超过60字的场景描述"}]}',
    `要求：characters 合并同一人物的不同称呼、按重要度排序；transcript 逐句转写全部台词；highlights 每集必须 3-5 条（共 ${map.length * 3}-${map.length * 5} 条），优先冲突/反转/爽点/打脸时刻，单段 5-30 秒、同集内互不重叠、按 score 降序，hook 表示开场 3 秒钩子强度；所有时间为相对本视频片段起点的全局秒数，精确到 0.1 不要取整；台词听不清就跳过，不要编造；只输出 JSON。`
  ].join('\n')
  console.log('单次合并调用（剧本+人物+高光）…')
  const r = await chat(prompt, 65536)
  const s = extractJson(r.text)
  const h = s.highlights || []
  const perEp = map.map((m) => h.filter((x) => x.ep === m.n).length)
  console.log(`✓ tokens=${r.tokens} cached=${r.cached} · 输出文本 ${r.text.length} 字符`)
  console.log(`人物 ${(s.characters || []).length}：${(s.characters || []).map((c) => c.name).join('、')}`)
  console.log(`剧本 ${(s.episodes || []).length} 集 · 台词 ${(s.episodes || []).reduce((n, e) => n + (e.transcript || []).length, 0)} 句`)
  console.log(`高光 ${h.length} 条 · 每集 ${perEp.join('/')} · logline: ${s.logline}`)
  console.log('样本:', JSON.stringify(h[0]))
})().catch((e) => { console.error('失败:', e.message); process.exit(1) })