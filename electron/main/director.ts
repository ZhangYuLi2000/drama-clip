import type {
  AsrSegment,
  Candidate,
  CutClip,
  CutStyle,
  Drama,
  Episode,
  GenerateCutParams,
  ModelCfg,
  PromoCut
} from '../../src/shared/types'
import { CUT_STYLES } from '../../src/shared/types'
import { readGlobalScript } from './global'
import { extractJson, isGoogleNative, streamChat, streamNative, type StreamResult } from './llm'

// 推理模型的思考 token 与正文共享输出预算：16384 会被长思考耗尽（正文 0 token 被截断），
// 与全局分析路径对齐到 65536；仍耗尽时自动降推理强度重试。
const DIRECTOR_MAX_TOKENS = 65536

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function snapBoundary(
  t: number,
  shots: number[],
  segments: AsrSegment[],
  isStart: boolean,
  prePad: number,
  postPad: number
): number {
  let best = t
  let bestDist = 0.65
  for (const b of shots) {
    const d = Math.abs(b - t)
    if (d < bestDist) {
      best = b
      bestDist = d
    }
  }
  // 如果吸附点落在台词中间（前后 >0.12s），放弃镜头吸附，优先保证台词完整并按角色留白
  for (const sg of segments) {
    if (best > sg.start + 0.12 && best < sg.end - 0.12) {
      return isStart ? Math.max(0, sg.start - prePad) : sg.end + postPad
    }
  }
  return Math.round(best * 10) / 10
}

function snapClipToEvidence(clip: CutClip, ep: Episode, isFirst: boolean, isLast: boolean): CutClip {
  const dur = ep.duration ?? clip.out
  const shots = ep.shots ?? []
  const segs = ep.segments ?? []
  let tin = clamp(clip.in, 0, Math.max(0, dur - 1))
  let tout = clamp(clip.out, tin + 1, dur)

  // 角色感知边界留白：
  // 1) 开场钩子（首段）：极速切入（0.08s 前导），拒绝静音废戏
  // 2) 反击/高潮/反转：尾端多留 0.4s 反应镜头，保留反派震惊表情
  // 3) 结尾悬念：尾端干脆收刀（0.12s），制造卡点断头感
  const prePad = isFirst || clip.role.includes('钩子') ? 0.08 : 0.15
  const isClimax = /反击|高潮|反转|打脸/.test(clip.role)
  const isCliffhanger = isLast && clip.role.includes('悬念')
  const postPad = isCliffhanger ? 0.12 : isClimax ? 0.4 : 0.22

  tin = snapBoundary(tin, shots, segs, true, prePad, postPad)
  tout = snapBoundary(tout, shots, segs, false, prePad, postPad)
  tin = clamp(tin, 0, Math.max(0, dur - 1))
  tout = clamp(tout, tin + 1.5, dur)

  return {
    ...clip,
    in: Math.round(tin * 10) / 10,
    out: Math.round(tout * 10) / 10
  }
}

function computeViralHookScore(c: Candidate): number {
  const hook = c.hook ?? c.score
  const conflict = c.bd?.['冲突'] ?? c.score
  const emotion = c.bd?.['情绪'] ?? c.score
  return Math.round(hook * 0.45 + c.score * 0.35 + conflict * 0.12 + emotion * 0.08)
}

function buildTopHookAnchors(drama: Drama, existingCuts: PromoCut[]): string {
  const usedKeys = new Set<string>()
  for (const cut of existingCuts) {
    const first = cut.clips[0]
    if (first) usedKeys.add(`${first.epN}:${Math.round(first.in / 5)}`)
  }

  const scored: { epN: number; cand: Candidate; viral: number; used: boolean }[] = []
  for (const ep of drama.episodes) {
    for (const c of ep.candidates ?? []) {
      const used = usedKeys.has(`${ep.n}:${Math.round(c.in / 5)}`)
      const base = computeViralHookScore(c)
      scored.push({ epN: ep.n, cand: c, viral: used ? base - 25 : base, used })
    }
  }
  scored.sort((a, b) => b.viral - a.viral)
  const top = scored.slice(0, 6)
  if (top.length === 0) return ''

  const lines = top.map(({ epN, cand, viral, used }, idx) => {
    const tagStr = cand.conflict ? `[${cand.conflict}]` : ''
    const quoteStr = cand.quote ? ` 金句:"${cand.quote}"` : ''
    const statusStr = used ? '（已用过，尽量换新）' : '（推荐未用）'
    return `${idx + 1}. 第${epN}集 ${cand.in.toFixed(1)}-${cand.out.toFixed(1)}s | 爆款指数:${viral} ${statusStr} ${tagStr} ${cand.title}${quoteStr} —— ${cand.reason}`
  })
  return `\n=== 算法预筛：全剧 Top 6 黄金 3 秒钩子锚点（按爆款指数与去重排序）===\n${lines.join('\n')}\n`
}

function buildEvidenceDigest(drama: Drama): string {
  const syn = drama.synthesis
  const script = readGlobalScript(drama.id)
  const lines: string[] = []
  lines.push(`剧名：《${drama.title}》`)
  if (syn?.logline) lines.push(`故事主线：${syn.logline}`)
  if (syn?.arcs) lines.push(`叙事地图：${syn.arcs}`)
  if (syn?.characters?.length) {
    lines.push(
      `核心人物：${syn.characters
        .slice(0, 12)
        .map((c) => `${c.name}(${c.role}${c.desc ? `·${c.desc}` : ''})`)
        .join('；')}`
    )
  }
  lines.push('\n=== 分集剧情、高光候选与台词时间轴 ===')
  for (const ep of [...drama.episodes].sort((a, b) => a.n - b.n)) {
    const durStr = ep.duration ? `${ep.duration.toFixed(1)}s` : '未知'
    const se = script?.episodes.find((x) => x.n === ep.n)
    const summary = ep.summary || se?.summary || ''
    const cands = ep.candidates ?? []
    const segs = ep.segments ?? se?.transcript ?? []
    if (!summary && cands.length === 0 && segs.length === 0) continue

    lines.push(`\n## 第 ${ep.n} 集（总长 ${durStr}）`)
    if (summary) lines.push(`梗概：${summary}`)
    if (cands.length > 0) {
      lines.push('高光候选：')
      for (const c of cands) {
        const quote = c.quote ? ` 金句:"${c.quote}"` : ''
        const conflict = c.conflict ? ` [${c.conflict}]` : ''
        const chars = c.characters?.length ? ` 人物:${c.characters.join('/')}` : ''
        lines.push(
          `- ${c.in.toFixed(1)}-${c.out.toFixed(1)}s | 爆款分${computeViralHookScore(c)}(高光${c.score}/钩子${c.hook ?? c.score})${conflict}${chars} | ${c.title}${quote} | ${c.reason}`
        )
      }
    }
    if (segs.length > 0) {
      const compactSegs = segs
        .slice(0, 180)
        .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}]${s.text}`)
        .join(' ')
      lines.push(`台词：${compactSegs}`)
    }
  }
  return lines.join('\n')
}

async function callDirectorModel(
  cfg: ModelCfg,
  system: string,
  user: string,
  signal?: AbortSignal
): Promise<{ text: string; tokens: number }> {
  if (!cfg.apiKey.trim()) throw new Error('请先在「设置」里填写模型 API Key')
  if (!cfg.baseUrl.trim() || !cfg.model.trim()) throw new Error('请先在「设置」里配置模型 Base URL 和模型名')

  if (isGoogleNative(cfg)) {
    const r = await streamNative(
      cfg,
      [{ text: user }],
      { maxOutputTokens: DIRECTOR_MAX_TOKENS, thinkingConfig: { thinkingLevel: 'low' }, responseMimeType: 'application/json' },
      '剪辑大师模型',
      system,
      signal
    )
    return { text: r.text, tokens: r.tokens }
  }
  const body = {
    model: cfg.model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: DIRECTOR_MAX_TOKENS,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  }
  let r: StreamResult
  try {
    r = await streamChat(cfg, body, '剪辑大师模型', signal)
  } catch (err) {
    // 思考烧光输出预算（finish_reason=length 且正文为空）：降低推理强度重试一次
    if ((err as { finishReason?: string | null }).finishReason !== 'length' || signal?.aborted) throw err
    try {
      r = await streamChat(cfg, { ...body, reasoning_effort: 'low' }, '剪辑大师模型', signal)
    } catch {
      ;(err as Error).message += '（已尝试降低推理强度重试，仍失败）'
      throw err
    }
  }
  return { text: r.text, tokens: r.tokens }
}

const SYSTEM_PROMPT = `你是顶尖的短剧引流剪辑大师与爆款复刻专家，专为抖音/快手/视频号打造高转化引流切片（爽剧/反转/强冲突为主）。
你的产出交付给用户直接拖入剪映做简单配乐和字幕微调即可发布，因此必须严格遵循以下爆款复刻铁律：
1. 黄金 3 秒强钩子（Zero-Delay Hook）：开场第一段（4-8秒）必须直接抛出最极致的情绪刺激（当众羞辱、逼签协议、捉奸对峙、天价赌注或巴掌名场面），严禁任何平淡寒暄与背景介绍。
2. 因果闭环与单主线一致性（Causal Thread Unity）：整条切片的所有片段必须围绕【同一组核心人物与同一条矛盾主线】展开（例如开场是“婆婆逼女主净身出户”，后续片段必须是同一事件的隐忍、加码与亮明身份反击），严禁把毫无因果关联的不同支线硬拼在一起导致观众看懵。
3. 情绪差值最大化与节奏递进（Emotional Contrast）：遵循“极致施压（反派嚣张/主角受辱）→ 筹码加倍（旁人嘲讽/倒计时逼迫）→ 亮牌反转/爽点爆发 → 悬念断头（在关键结果揭晓或大招落地的瞬间戛然而止）”的爆款节拍。
4. 真实时间码与台词完整：每段 clip 的 epN、in、out 必须严格来自剧集真实时间轴；单段时长建议 4-16 秒，严禁在半句话中间切断。
5. 配套剪映花字与发布文案：开场花字标题（hookHeadline）必须直击痛点或反差（≤14字）；发布文案（publishCopy）口语化、有强烈追剧悬念、带 2-3 个精准话题标签，且绝不编造剧中没有的情节。
只输出严格 JSON，不要任何 markdown 包裹或解释文字。`

function parseCutPayload(
  raw: Record<string, unknown>,
  drama: Drama,
  style: CutStyle,
  targetSec: number,
  ratio: '9:16' | '16:9',
  existing?: PromoCut,
  instruction?: string
): PromoCut {
  const rawClips = Array.isArray(raw.clips) ? (raw.clips as unknown[]) : []
  const clips: CutClip[] = []
  for (let i = 0; i < rawClips.length; i++) {
    const o = (rawClips[i] ?? {}) as Record<string, unknown>
    const epN = Math.round(Number(o.epN ?? o.ep))
    const ep = drama.episodes.find((e) => e.n === epN)
    if (!ep) continue
    const tin = Number(o.in ?? o.start)
    const tout = Number(o.out ?? o.end)
    if (!Number.isFinite(tin) || !Number.isFinite(tout) || tout <= tin) continue
    const snapped = snapClipToEvidence(
      {
        epId: ep.id,
        epN: ep.n,
        in: tin,
        out: tout,
        role: String(o.role ?? '冲突').slice(0, 12),
        why: String(o.why ?? '').slice(0, 80),
        quote: typeof o.quote === 'string' ? o.quote.slice(0, 60) : undefined
      },
      ep,
      clips.length === 0,
      i === rawClips.length - 1
    )
    if (snapped.out - snapped.in >= 1.5) clips.push(snapped)
  }
  if (clips.length === 0) throw new Error('剪辑方案未命中有效剧集时间段，请重试')

  // 合并同集内重叠或间隔小于 1 秒的相邻片段，避免同一场景生硬跳帧闪切
  const mergedClips: CutClip[] = []
  for (const c of clips) {
    const prev = mergedClips[mergedClips.length - 1]
    if (prev && prev.epN === c.epN && c.in >= prev.in && c.in - prev.out < 1.0) {
      prev.out = Math.max(prev.out, c.out)
      if (!prev.role.includes(c.role)) prev.role = `${prev.role}/${c.role}`.slice(0, 12)
      if (c.why && !prev.why.includes(c.why)) prev.why = `${prev.why}；${c.why}`.slice(0, 80)
      if (!prev.quote && c.quote) prev.quote = c.quote
    } else {
      mergedClips.push({ ...c })
    }
  }

  const actualSec = Math.round(mergedClips.reduce((s, c) => s + (c.out - c.in), 0) * 10) / 10
  const now = Date.now()
  return {
    id: existing?.id ?? `cut-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: String(raw.title ?? `${drama.title} · ${CUT_STYLES[style].name}`).slice(0, 40),
    style,
    ratio,
    targetSec,
    actualSec,
    hookHeadline: String(raw.hookHeadline ?? raw.title ?? '').slice(0, 24),
    publishCopy: String(raw.publishCopy ?? '').slice(0, 300),
    conflictSummary: String(raw.conflictSummary ?? '').slice(0, 140),
    directorNote: String(raw.directorNote ?? '').slice(0, 180),
    clips: mergedClips,
    status: 'draft',
    revision: (existing?.revision ?? 0) + 1,
    lastInstruction: instruction,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
}

export async function generatePromoCut(
  drama: Drama,
  params: GenerateCutParams,
  cfg: ModelCfg,
  variantIndex = 1,
  totalVariants = 1,
  signal?: AbortSignal
): Promise<{ cut: PromoCut; tokens: number }> {
  const evidence = buildEvidenceDigest(drama)
  const meta = CUT_STYLES[params.style]
  const existingCuts = drama.cuts ?? []
  const topAnchors = buildTopHookAnchors(drama, existingCuts)
  const usedHooks =
    existingCuts.length > 0
      ? `\n=== 已有切片方案（请务必避开以下已用过的开场钩子与完全雷同的选段组合，寻找新的冲突切入点）===\n` +
        existingCuts
          .slice(0, 10)
          .map(
            (c, i) =>
              `${i + 1}. 「${c.title}」开场花字:${c.hookHeadline} | 开场片段:第${c.clips[0]?.epN ?? '?'}集 ${c.clips[0]?.in ?? 0}-${c.clips[0]?.out ?? 0}s`
          )
          .join('\n')
      : ''
  const batchHint =
    totalVariants > 1
      ? `\n注意：当前是批量裂变的第 ${variantIndex}/${totalVariants} 条方案，请优先从上方「未使用的黄金钩子锚点」中挑选第 ${variantIndex} 顺位或不同矛盾主线的开场！`
      : ''

  const userPrompt = `${evidence}${topAnchors}${usedHooks}

=== 本次剪辑任务 ===
剪辑风格：【${meta.name}】${meta.desc}
推荐叙事角色序列：${meta.roles.join(' → ')}
目标成片总时长：约 ${params.targetSec} 秒（允许 ±8 秒以保证台词完整，建议控制在 4-8 个精选片段内，避免碎片化闪切），画幅：${params.ratio}${batchHint}
${params.prompt ? `用户爆款复刻/额外要求：${params.prompt}` : ''}

请输出一个 JSON 对象：
{
  "title": "切片方案名称（15字以内）",
  "hookHeadline": "开场3秒花字大字标题（14字以内，直击冲突或悬念）",
  "publishCopy": "适合发抖音/快手的引流文案（50-100字，口语化+引导看全集+2个#标签）",
  "conflictSummary": "一句话概括本片核心冲突主线与爽点（40字以内）",
  "directorNote": "剪辑师自检：开场钩子为什么抓人、因果主线如何闭环、结尾停在何处（60字以内）",
  "clips": [
    {
      "epN": 集数整数,
      "in": 起始秒(小数1位),
      "out": 结束秒(小数1位),
      "role": "钩子/铺垫/升级/冲突/反击/反转/悬念",
      "why": "选用该段的原因及与前后的因果衔接（30字以内）",
      "quote": "该段核心金句原话（可选）"
    }
  ]
}`

  const { text, tokens } = await callDirectorModel(cfg, SYSTEM_PROMPT, userPrompt, signal)
  const parsed = extractJson(text) as Record<string, unknown>
  const cut = parseCutPayload(parsed, drama, params.style, params.targetSec, params.ratio, undefined, params.prompt)
  return { cut, tokens }
}

export async function regeneratePromoCut(
  drama: Drama,
  existing: PromoCut,
  instruction: string,
  cfg: ModelCfg,
  nextStyle?: CutStyle,
  nextTargetSec?: number,
  signal?: AbortSignal
): Promise<{ cut: PromoCut; tokens: number }> {
  const evidence = buildEvidenceDigest(drama)
  const topAnchors = buildTopHookAnchors(drama, drama.cuts ?? [])
  const style = nextStyle ?? existing.style
  const targetSec = nextTargetSec ?? existing.targetSec
  const meta = CUT_STYLES[style]

  const prevClips = existing.clips
    .map((c, i) => `${i + 1}. 第${c.epN}集 ${c.in.toFixed(1)}-${c.out.toFixed(1)}s [${c.role}] ${c.why}`)
    .join('\n')

  const userPrompt = `${evidence}${topAnchors}

=== 当前待重剪的切片方案（v${existing.revision}）===
方案名称：${existing.title}
风格：${meta.name}（${meta.desc}）
目标时长：约 ${targetSec} 秒
当前开场花字：${existing.hookHeadline}
当前片段编排：
${prevClips}

=== 用户/主理人修改指令 ===
${instruction.trim() || '对当前版本不满意，请从全剧高光中换一个更有冲击力的开场钩子和更紧凑的同主线冲突剪辑思路重新生成！'}

请严格按照上述修改指令重新编排切片（保持同一冲突主线因果连贯，控制在 4-8 个精选片段内），输出完整 JSON（结构同标准格式：title, hookHeadline, publishCopy, conflictSummary, directorNote, clips）。`

  const { text, tokens } = await callDirectorModel(cfg, SYSTEM_PROMPT, userPrompt, signal)
  const parsed = extractJson(text) as Record<string, unknown>
  const cut = parseCutPayload(parsed, drama, style, targetSec, existing.ratio, existing, instruction)
  return { cut, tokens }
}
