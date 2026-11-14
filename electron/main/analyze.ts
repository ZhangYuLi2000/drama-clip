import fs from 'fs'
import path from 'path'
import type { ModelCfg, AsrSegment, Candidate, Character } from '../../src/shared/types'
import { cacheDir } from './db'
import { streamChat } from './llm'
import { ffmpegBin, run } from './media'

const CHUNK_SEC = 140
const MAX_BYTES = 9 * 1024 * 1024
const TAGS = ['冲突', '反转', '爽点', '打脸', '甜宠', '哭戏', '悬念']

export interface AnalyzeResult {
  candidates: Candidate[]
  segments: AsrSegment[]
  summary: string
  tokens: number
}

interface AnalyzeEpisode {
  id: string
  file: string
  duration: number | null
  segments?: AsrSegment[]
}

async function makeProxy(file: string, out: string, start: number, len: number, low: boolean, signal?: AbortSignal): Promise<void> {
  const scale = low ? 'scale=-2:240' : 'scale=-2:360'
  const fps = low ? 5 : 8
  const crf = low ? '34' : '30'
  await run(
    ffmpegBin(),
    [
      '-y',
      '-ss', start.toFixed(2),
      '-t', len.toFixed(2),
      '-i', file,
      '-vf', `${scale},fps=${fps}`,
      '-c:v', 'libx264',
      '-crf', crf,
      '-preset', 'veryfast',
      '-c:a', 'aac',
      '-b:a', '32k',
      '-ac', '1',
      out
    ],
    10 * 60_000,
    8000,
    signal
  )
}

function buildPrompt(transcript: string, len: number, characters?: Character[]): string {
  const anchor =
    characters && characters.length > 0
      ? `本剧主要人物（请据此识别画面人物，不要凭空猜测性别或身份）：\n${characters
          .map((c) => `- ${c.name}（${c.role}）${c.desc ? '：' + c.desc : ''}`)
          .join('\n')}\n`
      : ''
  return [
    `这是一集竖屏短剧的片段（时长 ${len.toFixed(0)} 秒，含声音）。`,
    anchor,
    transcript
      ? `下方已有台词转写（相对本片段起点的秒数），transcript 直接沿用并可补全遗漏：\n${transcript}`
      : '（本片段没有现成转写，请你边看边听逐句转写）',
    '请完成两件事：1) 逐句转写片段中的全部台词，时间戳精确到 0.1 秒、不要取整；2) 找出 3-8 个适合做引流切片的高光片段（冲突、反转、爽点、打脸、甜宠、哭戏、悬念）。',
    '只输出一个 JSON 对象，不要 markdown 包裹，结构：',
    '{"summary":"本集梗概，不超过80字","transcript":[{"start":起始秒,"end":结束秒,"text":"台词"}],"highlights":[{"title":"不超过20字的标题，尽量用金句原话","start":起始秒,"end":结束秒,"score":0到100,"hook":0到100,"quote":"片段中最有传播力的金句原话","conflict":"冲突类型，如打脸/逼婚/揭穿/反转","characters":["出场人物名"],"tags":["冲突","反转","爽点","打脸","甜宠","哭戏","悬念"],"bd":{"钩子":0到100,"冲突":0到100,"情绪":0到100,"金句":0到100},"reason":"不超过60字的理由","scene":"场景描述"}]}',
    `要求：所有时间为相对本片段起点的秒数（0 到 ${len.toFixed(0)}），精确到 0.1；hook 表示开场 3 秒的钩子强度；高光单段时长 5-30 秒、互不重叠、按 score 降序。`,
    '如果你无法获取音频，transcript 输出空数组，不要根据画面猜测台词。'
  ].join('\n')
}

async function chatVideo(
  cfg: ModelCfg,
  b64: string,
  transcript: string,
  len: number,
  characters?: Character[],
  signal?: AbortSignal
): Promise<{ text: string; tokens: number }> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: 'system', content: '你是短剧高光片段分析助手，只输出 JSON，不输出其它内容。' },
      {
        role: 'user',
        content: [
          { type: 'video_url', video_url: { url: `data:video/mp4;base64,${b64}` } },
          { type: 'text', text: buildPrompt(transcript, len, characters) }
        ]
      }
    ]
  }
  if (/omni/i.test(cfg.model)) body.modalities = ['text']
  return streamChat(cfg, body, '视觉模型', signal)
}

interface ParsedOutput {
  candidates: Candidate[]
  segments: AsrSegment[]
  summary: string
}

function parseModelOutput(text: string, offset: number, limit: number, epId: string, chunkIdx: number): ParsedOutput {
  const t = text.trim()
  let parsed: unknown = null
  const os = t.indexOf('{')
  const oe = t.lastIndexOf('}')
  if (os >= 0 && oe > os) {
    try {
      parsed = JSON.parse(t.slice(os, oe + 1))
    } catch {
      parsed = null
    }
  }
  if (parsed === null) {
    const as = t.indexOf('[')
    const ae = t.lastIndexOf(']')
    if (as < 0 || ae <= as) throw new Error(`模型输出不是 JSON：${text.slice(0, 120)}`)
    try {
      parsed = JSON.parse(t.slice(as, ae + 1))
    } catch {
      throw new Error(`模型 JSON 解析失败：${text.slice(0, 120)}`)
    }
  }
  let rawHl: unknown[] = []
  let rawTr: unknown[] = []
  let summary = ''
  if (Array.isArray(parsed)) {
    rawHl = parsed
  } else if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>
    if (Array.isArray(o.highlights)) rawHl = o.highlights
    if (Array.isArray(o.transcript)) rawTr = o.transcript
    if (typeof o.summary === 'string') summary = o.summary.slice(0, 200)
  }
  const candidates: Candidate[] = []
  rawHl.forEach((it, i) => {
    const o = (it ?? {}) as Record<string, unknown>
    const start = Number(o.start)
    const end = Number(o.end)
    const score = Math.max(0, Math.min(100, Math.round(Number(o.score) || 0)))
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return
    const tin = Math.round(Math.max(offset, offset + start) * 10) / 10
    const tout = Math.round(Math.min(limit, offset + end) * 10) / 10
    if (tout - tin < 1) return
    const hook = Math.max(0, Math.min(100, Math.round(Number(o.hook) || score)))
    const bd: Record<string, number> = {}
    if (o.bd && typeof o.bd === 'object') {
      for (const [k, v] of Object.entries(o.bd as Record<string, unknown>)) {
        const n = Math.round(Number(v))
        if (Number.isFinite(n)) bd[k] = Math.max(0, Math.min(100, n))
      }
    }
    if (Object.keys(bd).length === 0) {
      bd['钩子'] = hook
      bd['冲突'] = score
      bd['情绪'] = score
      bd['金句'] = score
    }
    candidates.push({
      id: `c-${epId}-${chunkIdx}-${i}`,
      score,
      title: String(o.title ?? '高光片段').slice(0, 40),
      tags: Array.isArray(o.tags) ? (o.tags as unknown[]).map(String).filter((t) => TAGS.includes(t)) : [],
      in: tin,
      out: tout,
      src: 'B',
      status: 'pending',
      reason: String(o.reason ?? '').slice(0, 200),
      bd,
      scene: String(o.scene ?? '').slice(0, 60),
      hook,
      quote: String(o.quote ?? '').slice(0, 80),
      conflict: String(o.conflict ?? '').slice(0, 20),
      characters: Array.isArray(o.characters) ? (o.characters as unknown[]).map(String).slice(0, 8) : []
    })
  })
  const segments: AsrSegment[] = []
  rawTr.forEach((it) => {
    const o = (it ?? {}) as Record<string, unknown>
    const start = Number(o.start)
    const end = Number(o.end)
    const txt = String(o.text ?? '').trim()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !txt) return
    segments.push({
      start: Math.round(Math.max(offset, offset + start) * 10) / 10,
      end: Math.round(Math.min(limit, offset + end) * 10) / 10,
      text: txt
    })
  })
  segments.sort((a, b) => a.start - b.start)
  return { candidates, segments, summary }
}

export async function analyzeVideo(
  ep: AnalyzeEpisode,
  cfg: ModelCfg,
  onProgress: (pct: number) => void,
  onLog?: (msg: string) => void,
  characters?: Character[],
  signal?: AbortSignal
): Promise<AnalyzeResult> {
  if (!cfg.apiKey.trim()) throw new Error('请先在「设置」里填写视觉模型 API Key')
  if (!cfg.baseUrl.trim() || !cfg.model.trim()) throw new Error('请先在「设置」里配置视觉模型 Base URL 和模型名')
  const dur = ep.duration
  if (!dur || dur <= 0) throw new Error('缺少视频时长，请先等待元数据读取完成')

  const chunks: { start: number; len: number }[] = []
  for (let s = 0; s < dur; s += CHUNK_SEC) {
    chunks.push({ start: s, len: Math.min(CHUNK_SEC, dur - s) })
  }
  const tmp = path.join(cacheDir(), 'analyze', `${ep.id}.mp4`)
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  const all: Candidate[] = []
  const segs: AsrSegment[] = []
  const summaries: string[] = []
  let tokens = 0
  try {
    for (let i = 0; i < chunks.length; i++) {
      const { start, len } = chunks[i]
      onProgress(2 + Math.round((i / chunks.length) * 88))
      await makeProxy(ep.file, tmp, start, len, false, signal)
      if (fs.statSync(tmp).size > MAX_BYTES) {
        await makeProxy(ep.file, tmp, start, len, true, signal)
        if (fs.statSync(tmp).size > MAX_BYTES) {
          throw new Error('压缩后的代理视频仍超过 9MB，无法 base64 发送（模型接口限制）')
        }
      }
      const b64 = fs.readFileSync(tmp).toString('base64')
      onLog?.(`第 ${i + 1}/${chunks.length} 块代理 ${(fs.statSync(tmp).size / 1048576).toFixed(1)}MB，调用 ${cfg.model}…`)
      const transcript = (ep.segments ?? [])
        .filter((sg) => sg.start >= start && sg.start < start + len)
        .map((sg) => `[${(sg.start - start).toFixed(1)}s] ${sg.text}`)
        .join('\n')
      const r = await chatVideo(cfg, b64, transcript, len, characters, signal)
      tokens += r.tokens
      const parsed = parseModelOutput(r.text, start, Math.min(start + len, dur), ep.id, i)
      all.push(...parsed.candidates)
      segs.push(...parsed.segments)
      if (parsed.summary) summaries.push(parsed.summary)
      onLog?.(`第 ${i + 1}/${chunks.length} 块返回：候选 ${parsed.candidates.length} 条 · 转写 ${parsed.segments.length} 句`)
      onProgress(2 + Math.round(((i + 1) / chunks.length) * 88))
    }
  } finally {
    fs.rmSync(tmp, { force: true })
  }
  all.sort((a, b) => b.score - a.score)
  return { candidates: all, segments: segs, summary: summaries.join(' '), tokens }
}