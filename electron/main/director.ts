import type {
  AsrSegment,
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
import { extractJson, isGoogleNative, streamChat, streamNative } from './llm'

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function snapBoundary(t: number, shots: number[], segments: AsrSegment[], isStart: boolean): number {
  let best = t
  let bestDist = 0.65
  for (const b of shots) {
    const d = Math.abs(b - t)
    if (d < bestDist) {
      best = b
      bestDist = d
    }
  }
  // 如果吸附点落在台词中间（前后 >0.15s），放弃吸附，优先保证台词完整
  for (const sg of segments) {
    if (best > sg.start + 0.15 && best < sg.end - 0.15) {
      return isStart ? Math.max(0, sg.start - 0.15) : sg.end + 0.2
    }
  }
  return Math.round(best * 10) / 10
}

function snapClipToEvidence(clip: CutClip, ep: Episode): CutClip {
  const dur = ep.duration ?? clip.out
  const shots = ep.shots ?? []
  const segs = ep.segments ?? []
  let tin = clamp(clip.in, 0, Math.max(0, dur - 1))
  let tout = clamp(clip.out, tin + 1, dur)

  tin = snapBoundary(tin, shots, segs, true)
  tout = snapBoundary(tout, shots, segs, false)
  tin = clamp(tin, 0, Math.max(0, dur - 1))
  tout = clamp(tout, tin + 1.5, dur)

  return {
    ...clip,
    in: Math.round(tin * 10) / 10,
    out: Math.round(tout * 10) / 10
  }
}

function buildEvidenceDigest(drama: Drama): string {
  const syn = drama.synthesis
  const script = readGlobalScript(drama.id)
  const lines: string[] = []
  lines.push(`剧名：《${drama.title}》`)
  if (syn?.logline) lines.push(`故事主线：${syn.logline}`)
  if (syn?.arcs) lines.push(`叙事地图：${syn.arcs}`)
  if (syn?.characters?.length) {
    lines.push(`核心人物：${syn.characters.slice(0, 12).map((c) => `${c.name}(${c.role}${c.desc ? `·${c.desc}` : ''})`).join('；')}`)
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
        lines.push(`- ${c.in.toFixed(1)}-${c.out.toFixed(1)}s | 评分${c.score}/钩子${c.hook ?? c.score}${conflict} | ${c.title}${quote} | ${c.reason}`)
      }
    }
    if (segs.length > 0) {
      const compactSegs = segs
        .slice(0, 40)
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
      { maxOutputTokens: 16384, thinkingConfig: { thinkingLevel: 'low' }, responseMimeType: 'application/json' },
      '剪辑大师模型',
      system,
      signal
    )
    return { text: r.text, tokens: r.tokens }
  }
  const r = await streamChat(
    cfg,
    {
      model: cfg.model,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 16384,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    },
    '剪辑大师模型',
    signal
  )
  return { text: r.text, tokens: r.tokens }
}

const SYSTEM_PROMPT = `你是顶尖的短剧引流剪辑大师，专为抖音/快手/视频号打造高转化引流切片（爽剧/反转/强冲突为主）。
你的产出交付给用户直接拖入剪映做简单配乐和字幕微调即可发布，因此必须做到：
1. 黄金 3 秒强钩子：开场第一帧/第一句就抛出最直接的冲突、羞辱、逼迫、质问或反常行动，绝不放铺垫废话和前情提要。
2. 冲突递进与完整爽点：只保留建立赌注、激化矛盾、亮明底牌或绝地反击的片段；单段台词必须完整，严禁在半句话中间切断，保留关键反应镜头。
3. 真实时间码约束：每段 clip 的 epN、in、out 必须严格来自提供的剧集真实时间轴，禁止编造不存在的集数或台词。
4. 配套剪映花字与发布文案：开场花字标题（hookHeadline）必须精准对应开场画面冲突（≤14字）；发布文案（publishCopy）口语化、有追剧悬念、带2-3个话题标签，且绝不编造剧中没有的情节。
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
  for (const item of rawClips) {
    const o = (item ?? {}) as Record<string, unknown>
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
      ep
    )
    if (snapped.out - snapped.in >= 1.5) clips.push(snapped)
  }
  if (clips.length === 0) throw new Error('剪辑方案未命中有效剧集时间段，请重试')

  const actualSec = Math.round(clips.reduce((s, c) => s + (c.out - c.in), 0) * 10) / 10
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
    clips,
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
      ? `\n注意：当前是批量裂变的第 ${variantIndex}/${totalVariants} 条方案，请确保本条切片的开场钩子和核心矛盾切入角度与前面方案截然不同！`
      : ''

  const userPrompt = `${evidence}${usedHooks}

=== 本次剪辑任务 ===
剪辑风格：【${meta.name}】${meta.desc}
推荐叙事角色序列：${meta.roles.join(' → ')}
目标成片总时长：约 ${params.targetSec} 秒（允许 ±8 秒以保证台词完整），画幅：${params.ratio}${batchHint}
${params.prompt ? `用户额外要求：${params.prompt}` : ''}

请输出一个 JSON 对象：
{
  "title": "切片方案名称（15字以内）",
  "hookHeadline": "开场3秒花字大字标题（14字以内，直击冲突或悬念）",
  "publishCopy": "适合发抖音/快手的引流文案（50-100字，口语化+引导看全集+2个#标签）",
  "conflictSummary": "一句话概括本片核心冲突与爽点（40字以内）",
  "directorNote": "剪辑师自检：开场钩子为什么抓人、节奏如何推进、结尾停在何处（60字以内）",
  "clips": [
    {
      "epN": 集数整数,
      "in": 起始秒(小数1位),
      "out": 结束秒(小数1位),
      "role": "钩子/铺垫/升级/冲突/反击/反转/悬念",
      "why": "选用该段的原因（30字以内）",
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
  const style = nextStyle ?? existing.style
  const targetSec = nextTargetSec ?? existing.targetSec
  const meta = CUT_STYLES[style]

  const prevClips = existing.clips
    .map((c, i) => `${i + 1}. 第${c.epN}集 ${c.in.toFixed(1)}-${c.out.toFixed(1)}s [${c.role}] ${c.why}`)
    .join('\n')

  const userPrompt = `${evidence}

=== 当前待重剪的切片方案（v${existing.revision}）===
方案名称：${existing.title}
风格：${meta.name}（${meta.desc}）
目标时长：约 ${targetSec} 秒
当前开场花字：${existing.hookHeadline}
当前片段编排：
${prevClips}

=== 用户/主理人修改指令 ===
${instruction.trim() || '对当前版本不满意，请换一个更有冲击力的开场钩子和更紧凑的冲突剪辑思路重新生成！'}

请严格按照上述修改指令重新编排切片（若用户要求换思路，请大幅调整开场或选段组合），输出完整 JSON（结构同标准格式：title, hookHeadline, publishCopy, conflictSummary, directorNote, clips）。`

  const { text, tokens } = await callDirectorModel(cfg, SYSTEM_PROMPT, userPrompt, signal)
  const parsed = extractJson(text) as Record<string, unknown>
  const cut = parseCutPayload(parsed, drama, style, targetSec, existing.ratio, existing, instruction)
  return { cut, tokens }
}
