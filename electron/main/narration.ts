import fs from 'fs'
import path from 'path'
import type { Drama, GenerateNarrationParams, GlobalScript, ModelCfg, NarrationCut, NarrationSegment, TtsCfg } from '../../src/shared/types'
import { cacheDir } from './db'
import { readGlobalScript } from './global'
import { extractJson, streamChat } from './llm'
import { ffmpegBin, run } from './media'
import { synthesizeSpeech, ttsCacheKey } from './tts'

const CHARS_PER_SEC = 4.5

export function narrationDir(dramaId: string, cutId: string): string {
  return path.join(cacheDir(), 'narration', dramaId, cutId)
}

function buildDigest(drama: Drama, script: GlobalScript, eps?: string): string {
  let epsList = [...drama.episodes].sort((a, b) => a.n - b.n)
  if (eps) {
    const [a, b] = eps.split('-').map((x) => parseInt(x, 10))
    if (Number.isFinite(a)) epsList = epsList.filter((e) => e.n >= a && e.n <= (Number.isFinite(b) ? b : a))
  }
  const sumByN = new Map((script.episodes || []).map((e) => [e.n, e]))
  const chars = (drama.synthesis?.characters || []).slice(0, 12)
  const lines: string[] = []
  lines.push(`剧名：《${drama.title}》`)
  const logline = script.logline || drama.synthesis?.logline
  const arcs = script.arcs || drama.synthesis?.arcs
  if (logline) lines.push(`故事主线：${logline}`)
  if (arcs) lines.push(`叙事地图：${arcs}`)
  if (chars.length) lines.push(`核心人物：${chars.map((c) => `${c.name}(${c.role}${c.desc ? '·' + c.desc : ''})`).join('；')}`)
  lines.push('\n=== 分集梗概 + 高光画面库（in/out 为该集内秒数）===')
  for (const e of epsList) {
    const s = sumByN.get(e.n)
    const dur = e.duration || 0
    lines.push(`\n第${e.n}集（时长${dur.toFixed(1)}s）梗概：${s?.summary || e.summary || '（无）'}`)
    const cands = [...(e.candidates || [])].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 2)
    for (const c of cands) {
      lines.push(`  画面[${c.in.toFixed(1)}-${c.out.toFixed(1)}s] 分${c.score}《${c.title}》 场景:${c.scene || ''} 金句:${c.quote || ''} 人物:${(c.characters || []).join('/')}`)
    }
  }
  return lines.join('\n')
}

function buildPrompt(digest: string, targetSec: number, userPrompt?: string): string {
  const budget = Math.round(targetSec * CHARS_PER_SEC)
  const parts = [
    digest,
    '\n=== 任务 ===',
    '为这部短剧写一条「主线解说」短视频文案（连贯的第三人称解说旁白，不是混剪标题），锁定故事主线所述的那条冲突线，按剧情时间顺序讲清楚。',
    `目标成片总时长约 ${targetSec} 秒；解说语速约 ${CHARS_PER_SEC} 字/秒，所以解说词总字数约 ${budget} 字（允许 ±15%）。`,
    '结构：钩子（开场3秒抓人）→ 剧情（起因/升级）→ 高潮 → 悬念/引导（结尾留钩子引导看正片，不要把结局彻底讲死）。',
    '分成 8-16 段，每段解说词 30-80 字，口语化、有节奏感和悬念感，像抖音影视解说那样讲故事。',
    '每段必须绑定一个画面：优先从上面「高光画面库」里选 epN + in/out（可微调起止），画面内容要能支撑这段解说；in/out 必须落在该集时长内、out>in。',
    '只依据给出的剧情写作，不要编造人物或情节；人物用真实姓名。',
    '只输出一个 JSON 对象，不要 markdown 包裹：',
    '{"title":"解说标题≤20字","hookHeadline":"开场花字≤12字","segments":[{"text":"解说词","epN":集数,"in":起始秒,"out":结束秒,"role":"钩子/剧情/高潮/悬念/引导","reason":"≤30字画面理由"}],"publishCopy":"引流发布文案≤80字"}'
  ]
  if (userPrompt?.trim()) parts.push(`\n用户额外要求：${userPrompt.trim()}`)
  return parts.join('\n')
}

export interface NarrationScriptResult {
  title: string
  hookHeadline: string
  publishCopy: string
  segments: NarrationSegment[]
  tokens: number
}

export async function generateNarrationScript(
  drama: Drama,
  params: GenerateNarrationParams,
  cfg: ModelCfg,
  signal?: AbortSignal
): Promise<NarrationScriptResult> {
  const script = readGlobalScript(drama.id)
  if (!script) throw new Error('缺少全局剧本，请先在「剧集」里跑全局分析')
  const digest = buildDigest(drama, script, params.eps)
  const prompt = buildPrompt(digest, params.targetSec, params.prompt)
  const r = await streamChat(
    cfg,
    {
      model: cfg.model,
      temperature: 0.7,
      max_tokens: 8000,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: '你是短剧解说文案高手，只输出 JSON，不输出其它内容。' },
        { role: 'user', content: prompt }
      ]
    },
    '解说文案',
    signal
  )
  const parsed = extractJson(r.text) as Record<string, unknown>
  const raw = Array.isArray(parsed.segments) ? (parsed.segments as Record<string, unknown>[]) : []
  const durByN = new Map(drama.episodes.map((e) => [e.n, e.duration || 0]))
  const idByN = new Map(drama.episodes.map((e) => [e.n, e.id]))
  const stamp = Date.now().toString(36)
  const segments: NarrationSegment[] = []
  raw.forEach((o, i) => {
    const text = String(o.text ?? '').trim()
    const epN = Number(o.epN)
    if (!text || !Number.isFinite(epN)) return
    const dur = durByN.get(epN) || 0
    let tin = Math.max(0, Math.min(Number(o.in) || 0, dur - 1))
    let tout = Math.max(tin + 1, Math.min(Number(o.out) || tin + 5, dur))
    tin = Math.round(tin * 10) / 10
    tout = Math.round(tout * 10) / 10
    segments.push({
      id: `ns-${stamp}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      text: text.slice(0, 200),
      epN,
      epId: idByN.get(epN) || '',
      in: tin,
      out: tout,
      role: String(o.role ?? '剧情').slice(0, 8),
      reason: String(o.reason ?? '').slice(0, 60),
      status: 'pending'
    })
  })
  if (!segments.length) throw new Error('解说稿没有有效分段（模型输出缺少 segments）')
  return {
    title: String(parsed.title ?? drama.title).slice(0, 40),
    hookHeadline: String(parsed.hookHeadline ?? '').slice(0, 24),
    publishCopy: String(parsed.publishCopy ?? '').slice(0, 160),
    segments,
    tokens: r.tokens
  }
}

async function concatFullAudio(dir: string, files: string[], signal?: AbortSignal): Promise<string | undefined> {
  if (!files.length) return undefined
  const list = path.join(dir, 'concat.txt')
  const full = path.join(dir, 'full.wav')
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
  try {
    await run(ffmpegBin(), ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', full], 120000, 8000, signal)
    return fs.existsSync(full) ? full : undefined
  } catch {
    return undefined
  }
}

/** 逐段配音（onlySegmentId 时只重配单段），完成后拼接整段音频并回填时长。直接 mutate cut。 */
export async function voiceNarrationSegments(
  dramaId: string,
  cut: NarrationCut,
  ttsCfg: TtsCfg,
  onProgress: (pct: number) => void,
  onLog: (msg: string) => void,
  signal?: AbortSignal,
  onlySegmentId?: string
): Promise<void> {
  const dir = narrationDir(dramaId, cut.id)
  const targets = onlySegmentId ? cut.segments.filter((s) => s.id === onlySegmentId) : cut.segments
  if (!targets.length) throw new Error('没有可配音的解说段')
  for (let i = 0; i < targets.length; i++) {
    if (signal?.aborted) throw new Error('已取消')
    const seg = targets[i]
    seg.status = 'voicing'
    seg.error = undefined
    const cacheFile = path.join(dir, 'cache', `${ttsCacheKey(seg.text, cut.voice, cut.rate, ttsCfg.model)}.wav`)
    try {
      const r = await synthesizeSpeech(ttsCfg, seg.text, cacheFile, { voice: cut.voice, rate: cut.rate }, signal)
      seg.audioFile = r.file
      seg.durationSec = r.durationSec
      seg.status = 'ready'
      onLog(`配音 ${i + 1}/${targets.length}（第${seg.epN}集 ${seg.in}-${seg.out}s）${r.durationSec}s${r.cached ? ' · 缓存' : ''}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      seg.status = 'fail'
      seg.error = msg
      if (onlySegmentId) throw e
      onLog(`配音失败 ${i + 1}/${targets.length}：${msg.slice(0, 120)}`)
    }
    onProgress(Math.round(((i + 1) / targets.length) * 100))
  }
  const ready = cut.segments.filter((s) => s.status === 'ready' && s.audioFile)
  cut.totalAudioSec = Math.round(ready.reduce((a, s) => a + (s.durationSec || 0), 0) * 10) / 10
  cut.fullAudio = await concatFullAudio(dir, ready.map((s) => s.audioFile!), signal)
}