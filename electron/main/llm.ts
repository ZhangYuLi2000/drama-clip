import type { ModelCfg } from '../../src/shared/types'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface SseChunk {
  choices?: {
    delta?: { content?: string; reasoning_content?: string; reasoning?: string }
    finish_reason?: string | null
  }[]
  usage?: {
    total_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
    completion_tokens_details?: { reasoning_tokens?: number }
  }
  error?: { message?: string }
}

export interface StreamResult {
  text: string
  tokens: number
  cached: number
  finishReason: string | null
  reasoningTokens: number
}

// 推理模型的思考 token 与正文共享 max_tokens 预算，长思考可能耗时十几分钟
const STREAM_TIMEOUT_MS = 20 * 60_000

function emptyReplyError(label: string, finishReason: string | null, reasoningTokens: number, reasoningChars: number): Error {
  const think = reasoningTokens > 0 ? `，思考已用 ${reasoningTokens} tokens` : reasoningChars > 0 ? `，思考输出 ${reasoningChars} 字符` : ''
  const msg =
    finishReason === 'length'
      ? `${label}推理耗尽输出预算（finish_reason=length${think}，正文 0 token）——请加大 max_tokens 或降低推理强度`
      : `${label}没有返回内容（finish_reason=${finishReason ?? '未知'}${think}）`
  return Object.assign(new Error(msg), { finishReason })
}

export async function streamChat(
  cfg: ModelCfg,
  body: Record<string, unknown>,
  label: string,
  signal?: AbortSignal
): Promise<StreamResult> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const timeout = AbortSignal.timeout(STREAM_TIMEOUT_MS)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey.trim()}`
    },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout
  })
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${label} API Key 无效或无权限（HTTP ${res.status}），请到「设置」检查`)
  }
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '')
    throw new Error(`${label}接口 HTTP ${res.status}：${t.slice(0, 500)}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let text = ''
  let tokens = 0
  let cached = 0
  let finishReason: string | null = null
  let reasoningTokens = 0
  let reasoningChars = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let j: SseChunk
      try {
        j = JSON.parse(payload) as SseChunk
      } catch {
        continue
      }
      if (j.error) throw new Error(`${label}返回错误：${j.error.message ?? '未知'}`)
      const choice = j.choices?.[0]
      const piece = choice?.delta?.content
      if (piece) text += piece
      const think = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning
      if (think) reasoningChars += think.length
      if (choice?.finish_reason) finishReason = choice.finish_reason
      if (j.usage?.total_tokens) tokens = j.usage.total_tokens
      if (j.usage?.prompt_tokens_details?.cached_tokens) cached = j.usage.prompt_tokens_details.cached_tokens
      if (j.usage?.completion_tokens_details?.reasoning_tokens) reasoningTokens = j.usage.completion_tokens_details.reasoning_tokens
    }
  }
  if (!text.trim()) throw emptyReplyError(label, finishReason, reasoningTokens, reasoningChars)
  return { text, tokens, cached, finishReason, reasoningTokens }
}

export async function chatText(cfg: ModelCfg, messages: ChatMessage[]): Promise<{ text: string; tokens: number }> {
  if (!cfg.apiKey.trim()) throw new Error('请先在「设置」里填写文本模型 API Key')
  if (!cfg.baseUrl.trim() || !cfg.model.trim()) throw new Error('请先在「设置」里配置文本模型 Base URL 和模型名')
  return streamChat(
    cfg,
    { model: cfg.model, stream: true, stream_options: { include_usage: true }, messages },
    '文本模型'
  )
}

// 尝试修复大模型常见的 JSON 瑕疵：markdown 代码围栏、前后多余说明文字、
// 尾随逗号、行内注释、被截断的尾部（对象/数组未闭合）。
function tryParseLoose(json: string): unknown {
  const cleaned = json
    // 去掉行注释和块注释（字符串外的简单处理，模型极少在字符串里放 // ）
    .replace(/\/\/[^\n\r]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // 去掉对象/数组末尾的多余逗号
    .replace(/,\s*([}\]])/g, '$1')
  try {
    return JSON.parse(cleaned)
  } catch {
    // 尝试补齐被截断的尾部：逐个丢弃最后不完整的片段，补上缺失的闭合括号
    for (let cut = 1; cut <= 40 && cut < cleaned.length; cut++) {
      const head = cleaned.slice(0, cleaned.length - cut)
      const repaired = closeBrackets(head)
      if (repaired == null) continue
      try {
        return JSON.parse(repaired)
      } catch {
        // continue
      }
    }
    throw new Error('loose parse failed')
  }
}

// 统计当前括号栈并补齐闭合符号；返回 null 表示明显不可修复（如括号严重不匹配）
function closeBrackets(s: string): string | null {
  const stack: string[] = []
  let inStr = false
  let esc = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') stack.push('}')
    else if (c === '[') stack.push(']')
    else if (c === '}' || c === ']') {
      if (stack.length === 0 || stack[stack.length - 1] !== c) return null
      stack.pop()
    }
  }
  if (inStr) return null
  // 截断在某个键值中间时，先补一个引号收尾可能更稳；此处退一步用空串收口
  let tail = ''
  // 若最后一个非空白字符是逗号或冒号，先去掉
  let body = s.replace(/[\s,]+$/, '')
  if (/:\s*$/.test(body)) body = body.replace(/:\s*$/, '')
  // 若截断在字符串值中间，前一步 inStr 已返回 null，不在此处理
  return body + tail + stack.reverse().join('')
}

export function extractJson(text: string): unknown {
  const t = text.trim()
  // 1) 去掉 ```json ... ``` 代码围栏
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const source = fenced ? fenced[1].trim() : t
  const os = source.indexOf('{')
  const oe = source.lastIndexOf('}')
  if (os >= 0 && oe > os) {
    const slice = source.slice(os, oe + 1)
    try {
      return JSON.parse(slice)
    } catch {
      try {
        return tryParseLoose(slice)
      } catch {
        // fall through
      }
    }
  }
  // 2) 对象解析失败时，尝试数组
  const as = source.indexOf('[')
  const ae = source.lastIndexOf(']')
  if (as >= 0 && ae > as) {
    const slice = source.slice(as, ae + 1)
    try {
      return JSON.parse(slice)
    } catch {
      try {
        return tryParseLoose(slice)
      } catch {
        // ignore
      }
    }
  }
  // 3) 完全没有闭合符（被截断到没有结尾}或]）：尝试从第一个{或[宽松修复
  const startObj = source.indexOf('{')
  const startArr = source.indexOf('[')
  const start = [startObj, startArr].filter((x) => x >= 0).sort((a, b) => a - b)[0]
  if (start !== undefined && start >= 0) {
    try {
      return tryParseLoose(source.slice(start))
    } catch {
      // ignore
    }
  }
  throw new Error(`模型输出不是 JSON：${text.slice(0, 120)}`)
}

export function isGoogleNative(cfg: ModelCfg): boolean {
  return /generativelanguage\.googleapis\.com/i.test(cfg.baseUrl)
}

interface NativeChunk {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  usageMetadata?: { totalTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number }
  error?: { message?: string }
}

// Google 官方原生接口（generateContent SSE）。OpenAI 兼容端点不支持视频，官方免费档走这里。
export async function streamNative(
  cfg: ModelCfg,
  parts: Record<string, unknown>[],
  generationConfig: Record<string, unknown>,
  label: string,
  system?: string,
  signal?: AbortSignal
): Promise<StreamResult> {
  const root = cfg.baseUrl.trim().replace(/\/+$/, '').replace(/\/v1beta.*$/, '')
  const url = `${root}/v1beta/models/${cfg.model}:streamGenerateContent?alt=sse`
  const body: Record<string, unknown> = { contents: [{ role: 'user', parts }], generationConfig }
  if (system) body.systemInstruction = { parts: [{ text: system }] }
  const timeout = AbortSignal.timeout(STREAM_TIMEOUT_MS)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey.trim() },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout
  })
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${label} API Key 无效或无权限（HTTP ${res.status}），请到「设置」检查`)
  }
  if (res.status === 429) {
    const t = await res.text().catch(() => '')
    throw new Error(`${label}配额超限（429）：免费档请缩小分析范围或稍后重试。${t.slice(0, 300)}`)
  }
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '')
    throw new Error(`${label}接口 HTTP ${res.status}：${t.slice(0, 500)}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let text = ''
  let tokens = 0
  let cached = 0
  let finishReason: string | null = null
  let reasoningTokens = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let j: NativeChunk
      try {
        j = JSON.parse(payload) as NativeChunk
      } catch {
        continue
      }
      if (j.error) throw new Error(`${label}返回错误：${j.error.message ?? '未知'}`)
      const cand = j.candidates?.[0]
      for (const p of cand?.content?.parts ?? []) {
        if (p.text) text += p.text
      }
      if (cand?.finishReason) finishReason = cand.finishReason === 'MAX_TOKENS' ? 'length' : cand.finishReason
      if (j.usageMetadata?.totalTokenCount) tokens = j.usageMetadata.totalTokenCount
      if (j.usageMetadata?.cachedContentTokenCount) cached = j.usageMetadata.cachedContentTokenCount
      if (j.usageMetadata?.thoughtsTokenCount) reasoningTokens = j.usageMetadata.thoughtsTokenCount
    }
  }
  if (!text.trim()) throw emptyReplyError(label, finishReason, reasoningTokens, 0)
  return { text, tokens, cached, finishReason, reasoningTokens }
}