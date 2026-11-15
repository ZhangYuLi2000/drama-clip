import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type {
  AsrSegment,
  Candidate,
  CutClip,
  CutMode,
  CutStyle,
  Drama,
  Episode,
  GenerateCutParams,
  ModelCfg,
  PromoCut,
  ViralBeat
} from '../../src/shared/types'
import { cacheDir } from './db'
import { readGlobalScript } from './global'
import { extractJson, isGoogleNative, streamChat, streamNative, type StreamResult } from './llm'
import { ffmpegBin, fileExists, run } from './media'
import { getCutStyleMeta } from './settings'

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
  postPad: number,
  allowMidSentenceCliffhanger = false
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
  for (const sg of segments) {
    if (best > sg.start + 0.12 && best < sg.end - 0.12) {
      if ( isStart) {
        return Math.max(0, sg.start - prePad)
      }
      // 悬念断头模式：若在揭秘长句的后半程（超过该句 55% 进度），允许在悬念点果断硬切而不必等整句讲完
      const ratioInSeg = (best - sg.start) / Math.max(0.5, sg.end - sg.start)
      if (allowMidSentenceCliffhanger && sg.end - sg.start >= 2.6 && ratioInSeg >= 0.55 && ratioInSeg <= 0.88) {
        return Math.round(best * 10) / 10
      }
      return sg.end + postPad
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

  const prePad = isFirst || clip.role.includes('钩子') ? 0.06 : 0.14
  const isClimax = /反击|高潮|反转|打脸/.test(clip.role)
  const isCliffhanger = isLast && clip.role.includes('悬念')
  const postPad = isCliffhanger ? 0.08 : isClimax ? 0.42 : 0.22

  tin = snapBoundary(tin, shots, segs, true, prePad, postPad, false)
  tout = snapBoundary(tout, shots, segs, false, prePad, postPad, isCliffhanger)

  // 若高潮段延长了反应镜头，避免越过下一个明显的镜头切换点造成闪帧
  if (isClimax && shots.length > 0) {
    const nextShot = shots.find((s) => s > clip.out + 0.05 && s <= tout + 0.1)
    if (nextShot) tout = Math.max(tin + 1.5, nextShot - 0.04)
  }

  tin = clamp(tin, 0, Math.max(0, dur - 1))
  tout = clamp(tout, tin + 1.5, dur)

  return {
    ...clip,
    in: Math.round(tin * 10) / 10,
    out: Math.round(tout * 10) / 10
  }
}

export function computeViralHookScore(c: Candidate): number {
  const hook = c.hook ?? c.score
  const conflict = c.bd?.['冲突'] ?? c.score
  const emotion = c.bd?.['情绪'] ?? c.score
  return Math.round(hook * 0.45 + c.score * 0.35 + conflict * 0.12 + emotion * 0.08)
}

interface ConflictThread {
  id: string
  label: string
  characters: string[]
  conflicts: string[]
  episodes: number[]
  peakViral: number
  avgViral: number
  items: { epN: number; cand: Candidate; viral: number }[]
}

/**
 * 升级 2：跨集因果冲突链聚类（Conflict Thread Clustering）
 * 按人物交集、冲突类型与集数连续性将散落在各集的高光候选聚类为因果闭环主线簇，防止跨支线乱拼。
 */
function buildConflictThreads(drama: Drama, existingCuts: PromoCut[]): ConflictThread[] {
  const usedHooks = new Set<string>()
  const usedEpCounts = new Map<number, number>()
  for (const cut of existingCuts) {
    const first = cut.clips[0]
    if (first) usedHooks.add(`${first.epN}:${Math.round(first.in / 5)}`)
    for (const cl of cut.clips) {
      usedEpCounts.set(cl.epN, (usedEpCounts.get(cl.epN) ?? 0) + 1)
    }
  }

  const rawItems: { epN: number; cand: Candidate; viral: number }[] = []
  for (const ep of [...drama.episodes].sort((a, b) => a.n - b.n)) {
    for (const c of ep.candidates ?? []) {
      const usedPenalty = usedHooks.has(`${ep.n}:${Math.round(c.in / 5)}`) ? 22 : 0
      const epPenalty = Math.min(12, (usedEpCounts.get(ep.n) ?? 0) * 3)
      const viral = computeViralHookScore(c) - usedPenalty - epPenalty
      rawItems.push({ epN: ep.n, cand: c, viral })
    }
  }
  if (rawItems.length === 0) return []

  const threads: ConflictThread[] = []
  for (const item of rawItems) {
    const chars = (item.cand.characters ?? []).filter(Boolean)
    const conflict = item.cand.conflict?.trim() || item.cand.tags?.[0] || '核心冲突'

    let bestThread: ConflictThread | null = null
    let bestSim = 0
    for (const th of threads) {
      const sharedChars = chars.filter((ch) => th.characters.includes(ch)).length
      const sameConflict = th.conflicts.includes(conflict) ? 1 : 0
      const minEpDist = Math.min(...th.episodes.map((e) => Math.abs(e - item.epN)))
      const epSim = minEpDist <= 2 ? 1.2 : minEpDist <= 5 ? 0.6 : 0
      const sim = sharedChars * 1.5 + sameConflict * 1.2 + epSim
      if (sim >= 1.8 && sim > bestSim) {
        bestSim = sim
        bestThread = th
      }
    }

    if (bestThread) {
      bestThread.items.push(item)
      for (const ch of chars) if (!bestThread.characters.includes(ch)) bestThread.characters.push(ch)
      if (!bestThread.conflicts.includes(conflict)) bestThread.conflicts.push(conflict)
      if (!bestThread.episodes.includes(item.epN)) bestThread.episodes.push(item.epN)
    } else {
      threads.push({
        id: `th-${threads.length + 1}`,
        label: '',
        characters: [...chars],
        conflicts: [conflict],
        episodes: [item.epN],
        peakViral: item.viral,
        avgViral: item.viral,
        items: [item]
      })
    }
  }

  for (const th of threads) {
    th.items.sort((a, b) => b.viral - a.viral)
    th.episodes.sort((a, b) => a - b)
    th.peakViral = th.items[0]?.viral ?? 0
    const top3 = th.items.slice(0, 3)
    th.avgViral = Math.round(top3.reduce((s, x) => s + x.viral, 0) / Math.max(1, top3.length))
    const charLabel = th.characters.slice(0, 3).join('×') || '主角团'
    const confLabel = th.conflicts.slice(0, 2).join('/')
    th.label = `【主线${th.id.replace('th-', '')}：${charLabel} · ${confLabel}】（跨第 ${th.episodes.join('、')} 集）`
  }

  threads.sort((a, b) => b.peakViral * 0.6 + b.avgViral * 0.4 - (a.peakViral * 0.6 + a.avgViral * 0.4))
  return threads
}

/**
 * 升级 3：两阶段漏斗检索（Two-Stage Funnel Context Retrieval）
 * 第一阶段通过因果主线簇与 MMR 选出核心关联集数窗口（focusedEps），
 * 第二阶段仅对窗口内剧集展開完整逐句台词，其余剧集仅保留梗概与高分高光，大幅提升长剧信噪比。
 */
function buildTwoStageEvidenceDigest(drama: Drama, existingCuts: PromoCut[], variantIndex = 1): string {
  const syn = drama.synthesis
  const script = readGlobalScript(drama.id)
  const threads = buildConflictThreads(drama, existingCuts)
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

  const focusedEps = new Set<number>()
  if (threads.length > 0) {
    const primaryIdx = (variantIndex - 1) % Math.min(threads.length, 4)
    const primaryThread = threads[primaryIdx]
    const secondaryThread = threads[(primaryIdx + 1) % threads.length]
    for (const epN of primaryThread.episodes) {
      focusedEps.add(epN)
      focusedEps.add(epN + 1)
    }
    if (secondaryThread) {
      for (const epN of secondaryThread.episodes.slice(0, 3)) focusedEps.add(epN)
    }

    lines.push('\n=== 第一阶段：算法聚类的因果冲突主线簇（请优先锁定同一条主线编排，确保挖坑与填坑闭环）===')
    threads.slice(0, 4).forEach((th, idx) => {
      const rec = idx === primaryIdx ? ' ★本次推荐锁定主线' : ''
      const topHooks = th.items
        .slice(0, 3)
        .map((x) => `第${x.epN}集(${x.cand.in.toFixed(1)}-${x.cand.out.toFixed(1)}s 爆款分${x.viral}:${x.cand.title})`)
        .join(' → ')
      lines.push(`${idx + 1}. ${th.label} | 峰值爆款分:${th.peakViral}${rec}\n   核心节点：${topHooks}`)
    })
  }

  const sortedEps = [...drama.episodes].sort((a, b) => a.n - b.n)
  const isLongDrama = sortedEps.length > 8
  lines.push(
    `\n=== 第二阶段：分集剧情、高光候选与台词时间轴${isLongDrama ? '（核心主线集已展开完整逐句台词）' : ''} ===`
  )

  for (const ep of sortedEps) {
    const durStr = ep.duration ? `${ep.duration.toFixed(1)}s` : '未知'
    const se = script?.episodes.find((x) => x.n === ep.n)
    const summary = ep.summary || se?.summary || ''
    const cands = ep.candidates ?? []
    const segs = ep.segments ?? se?.transcript ?? []
    if (!summary && cands.length === 0 && segs.length === 0) continue

    const isFocused = !isLongDrama || focusedEps.size === 0 || focusedEps.has(ep.n)
    lines.push(`\n## 第 ${ep.n} 集（总长 ${durStr}${isFocused && isLongDrama ? ' · ★核心因果集' : ''}）`)
    if (summary) lines.push(`梗概：${summary}`)
    if (cands.length > 0) {
      const filteredCands = isFocused ? cands : cands.filter((c) => computeViralHookScore(c) >= 75).slice(0, 3)
      if (filteredCands.length > 0) {
        lines.push('高光候选：')
        for (const c of filteredCands) {
          const quote = c.quote ? ` 金句:"${c.quote}"` : ''
          const conflict = c.conflict ? ` [${c.conflict}]` : ''
          const chars = c.characters?.length ? ` 人物:${c.characters.join('/')}` : ''
          lines.push(
            `- ${c.in.toFixed(1)}-${c.out.toFixed(1)}s | 爆款分${computeViralHookScore(c)}(高光${c.score}/钩子${c.hook ?? c.score})${conflict}${chars} | ${c.title}${quote} | ${c.reason}`
          )
        }
      }
    }
    if (segs.length > 0 && isFocused) {
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

/**
 * 升级 1：对标爆款视频 / 爆款文案 Beat Sheet 解构算法
 * 支持上传本地对标爆款视频或输入对标文案，提取其节拍时长、情绪极性与钩子套路（本地缓存避免重复扫参考视频）。
 */
export async function analyzeViralBenchmark(
  refVideoPath: string | undefined,
  refCopy: string | undefined,
  globalCfg: ModelCfg,
  textCfg: ModelCfg,
  onLog?: (msg: string) => void,
  signal?: AbortSignal
): Promise<{ beats: ViralBeat[]; hookPattern: string; pacingNote: string; tokens: number }> {
  const dir = path.join(cacheDir(), 'viral-ref')
  fs.mkdirSync(dir, { recursive: true })

  if (refVideoPath && fileExists(refVideoPath)) {
    const stat = fs.statSync(refVideoPath)
    const sig = `${refVideoPath}|${stat.size}|${stat.mtimeMs}`
    const hash = crypto.createHash('sha1').update(sig).digest('hex').slice(0, 16)
    const jsonCache = path.join(dir, `ref-${hash}.json`)
    if (fileExists(jsonCache)) {
      try {
        const cached = JSON.parse(fs.readFileSync(jsonCache, 'utf8')) as {
          beats: ViralBeat[]
          hookPattern: string
          pacingNote: string
        }
        if (Array.isArray(cached.beats) && cached.beats.length > 0) {
          onLog?.(`复用本地对标爆款视频 Beat Sheet 缓存（共 ${cached.beats.length} 个节拍）`)
          return { ...cached, tokens: 0 }
        }
      } catch {
        // ignore
      }
    }

    const proxyMp4 = path.join(dir, `ref-${hash}.mp4`)
    if (!fileExists(proxyMp4)) {
      onLog?.(`正在压缩对标爆款参考视频（提取声画节拍骨架）…`)
      await run(
        ffmpegBin(),
        [
          '-y',
          '-i',
          refVideoPath,
          '-t',
          '120',
          '-vf',
          'scale=-2:360,fps=2',
          '-c:v',
          'libx264',
          '-crf',
          '32',
          '-preset',
          'veryfast',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-c:a',
          'aac',
          '-b:a',
          '24k',
          proxyMp4
        ],
        180_000,
        8000,
        signal
      )
    }

    const b64 = fs.readFileSync(proxyMp4).toString('base64')
    onLog?.(`调用多模态模型拆解对标爆款视频 Beat Sheet…`)
    const prompt = [
      '请作为顶尖短剧投流拆片专家，深度解构这条对标爆款引流视频的叙事节拍骨架（Beat Sheet）。',
      refCopy ? `参考补充说明/文案：${refCopy}` : '',
      '请只输出严格 JSON 对象（不要 markdown）：',
      '{"hookPattern":"前3秒钩子抓人手法总结（30字内）","pacingNote":"整体情绪曲线与卡点手法总结（50字内）","beats":[{"role":"钩子/铺垫/冲突/升级/反击/反转/悬念","sec":该节拍持续秒数整数,"emotion":"情绪极性如 极度憋屈(-0.9) / 狂妄施压(-0.7) / 亮牌暴爽(+0.9) / 悬念拉满(0.8)","desc":"该节拍具体干了什么（不超过28字，抽象出可迁移到其他短剧的动作机制）"}]}'
    ]
      .filter(Boolean)
      .join('\n')

    const system = '你是短剧爆款结构拆解专家，只输出严格 JSON。'
    const resp = isGoogleNative(globalCfg)
      ? await streamNative(
          globalCfg,
          [{ inline_data: { mime_type: 'video/mp4', data: b64 } }, { text: prompt }],
          { maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'low' }, responseMimeType: 'application/json' },
          '对标拆解模型',
          system,
          signal
        )
      : await streamChat(
          globalCfg,
          {
            model: globalCfg.model,
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: 8192,
            messages: [
              { role: 'system', content: system },
              {
                role: 'user',
                content: [
                  { type: 'video_url', video_url: { url: `data:video/mp4;base64,${b64}` } },
                  { type: 'text', text: prompt }
                ]
              }
            ]
          },
          '对标拆解模型',
          signal
        )

    const parsed = extractJson(resp.text) as Record<string, unknown>
    const beats: ViralBeat[] = Array.isArray(parsed.beats)
      ? (parsed.beats as unknown[]).map((b) => {
          const o = (b ?? {}) as Record<string, unknown>
          return {
            role: String(o.role ?? '冲突').slice(0, 12),
            sec: Math.max(2, Math.min(30, Math.round(Number(o.sec) || 8))),
            emotion: String(o.emotion ?? '强冲突').slice(0, 20),
            desc: String(o.desc ?? '').slice(0, 48)
          }
        })
      : []
    const result = {
      beats,
      hookPattern: String(parsed.hookPattern ?? '0帧直入核心冲突').slice(0, 60),
      pacingNote: String(parsed.pacingNote ?? '情绪递进至高潮卡点').slice(0, 80)
    }
    if (beats.length > 0) {
      fs.writeFileSync(jsonCache, JSON.stringify(result, null, 2), 'utf8')
    }
    return { ...result, tokens: resp.tokens }
  }

  if (refCopy && refCopy.trim()) {
    onLog?.(`正在从对标爆款文案/脚本提取 Beat Sheet 节拍骨架…`)
    const prompt = `请将以下对标爆款文案/分镜要求拆解为可迁移的短剧引流切片节拍骨架（Beat Sheet）：\n${refCopy.trim()}\n\n请只输出 JSON：{"hookPattern":"前3秒钩子手法","pacingNote":"整体节奏与卡点","beats":[{"role":"钩子/铺垫/冲突/升级/反击/反转/悬念","sec":秒数,"emotion":"情绪极性","desc":"节拍机制描述"}]}`
    const resp = await callDirectorModel(textCfg, '你是短剧爆款结构拆解专家，只输出严格 JSON。', prompt, signal)
    const parsed = extractJson(resp.text) as Record<string, unknown>
    const beats: ViralBeat[] = Array.isArray(parsed.beats)
      ? (parsed.beats as unknown[]).map((b) => {
          const o = (b ?? {}) as Record<string, unknown>
          return {
            role: String(o.role ?? '冲突').slice(0, 12),
            sec: Math.max(2, Math.min(30, Math.round(Number(o.sec) || 8))),
            emotion: String(o.emotion ?? '强冲突').slice(0, 20),
            desc: String(o.desc ?? '').slice(0, 48)
          }
        })
      : []
    return {
      beats,
      hookPattern: String(parsed.hookPattern ?? '强冲突钩子开场').slice(0, 60),
      pacingNote: String(parsed.pacingNote ?? '对标爆款结构复刻').slice(0, 80),
      tokens: resp.tokens
    }
  }

  return { beats: [], hookPattern: '', pacingNote: '', tokens: 0 }
}

const SYSTEM_PROMPT = `你是顶尖的短剧引流剪辑大师与爆款复刻专家，专为抖音/快手/视频号打造高转化引流切片（爽剧/反转/强冲突为主）。
你的产出交付给用户直接拖入剪映做简单配乐和字幕微调即可发布，因此必须严格遵循以下爆款复刻铁律：
1. 黄金 3 秒强钩子（Zero-Delay Hook）：开场第一段（4-8秒）必须直接抛出最极致的情绪刺激（当众羞辱、逼签协议、捉奸对峙、天价赌注或巴掌名场面），严禁任何平淡寒暄与背景介绍。
2. 因果闭环与单主线一致性（Causal Thread Unity）：整条切片的所有片段必须围绕【同一组核心人物与同一条矛盾主线】展开（例如开场是“婆婆逼女主净身出户”，后续片段必须是同一事件的隐忍、加码与亮明身份反击），严禁把毫无因果关联的不同支线硬拼在一起导致观众看懵。
3. 情绪差值最大化与节奏递进（Emotional Contrast）：遵循“极致施压（反派嚣张/主角受辱）→ 筹码加倍（旁人嘲讽/倒计时逼迫）→ 亮牌反转/爽点爆发 → 悬念断头（在关键结果揭晓或大招落地的瞬间戛然而止）”的爆款节拍。
4. 真实时间码与台词完整：每段 clip 的 epN、in、out 必须严格来自剧集真实时间轴；单段时长建议 4-16 秒，严禁在半句话中间切断（除非是结尾悬念故意在揭秘词处断头）。
5. 配套剪映花字与发布文案：开场花字标题（hookHeadline）必须直击痛点或反差（≤14字）；发布文案（publishCopy）口语化、有强烈追剧悬念、带 2-3 个精准话题标签，且绝不编造剧中没有的情节。
只输出严格 JSON，不要任何 markdown 包裹或解释文字。`

function normalizeRawClips(rawClips: unknown[], drama: Drama): CutClip[] {
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
  return mergedClips
}

function parseCutPayload(
  raw: Record<string, unknown>,
  drama: Drama,
  style: CutStyle,
  targetSec: number,
  ratio: '9:16' | '16:9',
  existing?: PromoCut,
  instruction?: string,
  mode?: CutMode,
  beats?: ViralBeat[]
): PromoCut {
  const rawClips = Array.isArray(raw.clips) ? (raw.clips as unknown[]) : []
  const mergedClips = normalizeRawClips(rawClips, drama)
  if (mergedClips.length === 0) throw new Error('剪辑方案未命中有效剧集时间段，请重试')

  const actualSec = Math.round(mergedClips.reduce((s, c) => s + (c.out - c.in), 0) * 10) / 10
  const now = Date.now()
  const styleName = getCutStyleMeta(style)?.name ?? 'AI智剪'
  return {
    id: existing?.id ?? `cut-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: String(raw.title ?? `${drama.title} · ${styleName}`).slice(0, 40),
    style,
    mode: mode ?? existing?.mode ?? 'independent',
    beats: beats && beats.length > 0 ? beats : existing?.beats,
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
  signal?: AbortSignal,
  viralBenchmark?: { beats: ViralBeat[]; hookPattern: string; pacingNote: string }
): Promise<{ cut: PromoCut; tokens: number }> {
  const existingCuts = drama.cuts ?? []
  const evidence = buildTwoStageEvidenceDigest(drama, existingCuts, variantIndex)
  const meta = getCutStyleMeta(params.style)
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
      ? `\n注意：当前是批量裂变的第 ${variantIndex}/${totalVariants} 条方案，请优先锁定上方推荐的第 ${variantIndex} 条冲突主线或截然不同的开场钩子！`
      : ''

  const durationRule = (sec: number): string => {
    if (sec <= 0) {
      return '不限固定时长（由你根据剧情完整度、解说/全剧串联需要或用户要求自主决定最合适长度，不再受 4-8 个片段数量限制，可按需选取足够多的片段以讲清完整故事线）'
    }
    if (sec > 90) {
      return `约 ${sec} 秒（允许 ±15% 浮动以保证台词与叙事完整；这是中长篇剪辑/解说串联，请按需编排足够多的关键片段，不要强行压缩到 4-8 段）`
    }
    return `约 ${sec} 秒（允许 ±8 秒以保证台词完整，建议控制在 4-8 个精选片段内，避免碎片化闪切）`
  }

  const beatBlock =
    viralBenchmark && viralBenchmark.beats.length > 0
      ? `\n=== 【对标爆款 1:1 节拍骨架（Beat Sheet 强制对齐槽位）】===\n` +
        `对标开场手法：${viralBenchmark.hookPattern}\n` +
        `对标整体节奏：${viralBenchmark.pacingNote}\n` +
        `请严格按照以下 ${viralBenchmark.beats.length} 个节拍槽位的顺序、角色功能、情绪极性与时长比例，从本剧同一因果主线中挑选最匹配的真实时间段进行 1:1 复刻：\n` +
        viralBenchmark.beats
          .map((b, i) => `槽位 #${i + 1} [${b.role}] 约 ${b.sec}s | 情绪:${b.emotion} | 对标机制:${b.desc}`)
          .join('\n') +
        '\n'
      : ''

  const userPrompt = `${evidence}${usedHooks}${beatBlock}

=== 本次剪辑任务 ===
剪辑模式：${params.mode === 'viral-clone' ? '【对标爆款 1:1 节拍复刻】' : meta ? `【${meta.name}】${meta.desc}` : '【自由定调】由你根据剧集内容与用户要求自主选择最合适的叙事基调与节奏'}
推荐叙事角色序列：${
    viralBenchmark && viralBenchmark.beats.length > 0
      ? viralBenchmark.beats.map((b) => b.role).join(' → ')
      : meta ? meta.roles.join(' → ') : '由 AI 根据剧情自由编排'
  }
目标成片总时长：${durationRule(params.targetSec)}，画幅：${params.ratio}${batchHint}
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
      "why": "选用该段的原因及对应的节拍/因果衔接（30字以内）",
      "quote": "该段核心金句原话（可选）"
    }
  ]
}`

  const { text, tokens } = await callDirectorModel(cfg, SYSTEM_PROMPT, userPrompt, signal)
  const parsed = extractJson(text) as Record<string, unknown>
  const cut = parseCutPayload(
    parsed,
    drama,
    params.style,
    params.targetSec,
    params.ratio,
    undefined,
    params.prompt,
    params.mode ?? 'independent',
    viralBenchmark?.beats
  )
  return { cut, tokens }
}

/**
 * 升级 5：「1 主体 × N 钩子」黄金前 3 秒投流赛马矩阵（Hook Matrix AB-Testing）
 * 一次编排产出 1 套高转化同主线主体（Body Clips）+ N 个不同切入角度的黄金前 3-6 秒开场钩子（Hooks），
 * 渲染时自动复用主干片段缓存，仅重编开头钩子段即可秒级合成 N 条赛马成片。
 */
export async function generateHookMatrixCuts(
  drama: Drama,
  params: GenerateCutParams,
  cfg: ModelCfg,
  hookCount: number,
  signal?: AbortSignal
): Promise<{ cuts: PromoCut[]; tokens: number }> {
  const existingCuts = drama.cuts ?? []
  const evidence = buildTwoStageEvidenceDigest(drama, existingCuts, 1)
  const meta = getCutStyleMeta(params.style)
  const n = Math.max(2, Math.min(6, hookCount))

  const userPrompt = `${evidence}

=== 本次剪辑任务：「1 主体 × ${n} 钩子」黄金前 3 秒投流赛马矩阵 ===
剪辑风格：${meta ? `【${meta.name}】${meta.desc}` : '【自由定调】由你根据剧集最强冲突主线自主定调'}
目标单条总时长：${params.targetSec <= 0 ? '不限固定时长（其中开场钩子 4-7 秒，共享主干部分按剧情完整度自由编排）' : `约 ${params.targetSec} 秒（其中开场钩子 4-7 秒，共享主干部分约 ${Math.max(20, params.targetSec - 6)} 秒）`}，画幅：${params.ratio}
${params.prompt ? `用户额外要求：${params.prompt}` : ''}

请围绕本剧最强的【同一条核心矛盾主线】，设计：
1. 一套共用的主干叙事序列（bodyClips，包含 3-6 段从冲突升级到高潮反击/悬念卡点的片段）；
2. ${n} 个截然不同的黄金前 3-6 秒开场钩子变体（hooks 数组，长度必须为 ${n}），每个钩子从不同角度切入（例如：变体1用最狠羞辱台词开场、变体2用巴掌/冲突动作开场、变体3用亮底牌/反常举动悬念开场），并各自搭配专属的方案名（title）、开场花字（hookHeadline）与发布文案（publishCopy）。
注意：每个 hook 片段不能与 bodyClips 第一段完全重复！

请只输出严格 JSON 对象：
{
  "conflictSummary": "一句话概括共用主干的核心冲突主线与爽点（40字以内）",
  "directorNote": "说明主干叙事逻辑及 ${n} 个钩子变体的差异化赛马策略（60字以内）",
  "bodyClips": [
    {
      "epN": 集数整数,
      "in": 起始秒(小数1位),
      "out": 结束秒(小数1位),
      "role": "铺垫/冲突/升级/反击/反转/悬念",
      "why": "主干推进作用（30字以内）",
      "quote": "核心金句（可选）"
    }
  ],
  "hooks": [
    {
      "title": "钩子变体方案名（15字以内）",
      "hookHeadline": "配套开场3秒花字标题（14字以内）",
      "publishCopy": "配套抖音/快手引流发布文案（50-100字，含#标签）",
      "clip": {
        "epN": 集数整数,
        "in": 起始秒(小数1位),
        "out": 结束秒(小数1位),
        "role": "钩子",
        "why": "该钩子变体的抓人切入点（30字以内）",
        "quote": "开场金句原话（可选）"
      }
    }
  ]
}`

  const { text, tokens } = await callDirectorModel(cfg, SYSTEM_PROMPT, userPrompt, signal)
  const parsed = extractJson(text) as Record<string, unknown>
  const rawBody = Array.isArray(parsed.bodyClips) ? (parsed.bodyClips as unknown[]) : []
  const rawHooks = Array.isArray(parsed.hooks) ? (parsed.hooks as unknown[]) : []

  if (rawBody.length === 0 || rawHooks.length === 0) {
    throw new Error('钩子矩阵输出格式不完整，请重试')
  }

  const matrixGroupId = `mtx-${Date.now().toString(36)}`
  const conflictSummary = String(parsed.conflictSummary ?? '').slice(0, 140)
  const directorNote = String(parsed.directorNote ?? '').slice(0, 180)
  const cuts: PromoCut[] = []

  for (let i = 0; i < rawHooks.length; i++) {
    const h = (rawHooks[i] ?? {}) as Record<string, unknown>
    const hookClipRaw = h.clip ?? h
    const combinedRaw = [hookClipRaw, ...rawBody]
    const mergedClips = normalizeRawClips(combinedRaw, drama)
    if (mergedClips.length === 0) continue

    const actualSec = Math.round(mergedClips.reduce((s, c) => s + (c.out - c.in), 0) * 10) / 10
    const now = Date.now() + i
    cuts.push({
      id: `cut-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title: String(h.title ?? `钩子赛马 #${i + 1} · ${meta?.name ?? 'AI智剪'}`).slice(0, 40),
      style: params.style,
      mode: 'hook-matrix',
      matrixGroupId,
      ratio: params.ratio,
      targetSec: params.targetSec,
      actualSec,
      hookHeadline: String(h.hookHeadline ?? h.title ?? '').slice(0, 24),
      publishCopy: String(h.publishCopy ?? '').slice(0, 300),
      conflictSummary,
      directorNote: `[赛马钩子 ${i + 1}/${rawHooks.length}] ${directorNote}`.slice(0, 180),
      clips: mergedClips,
      status: 'draft',
      revision: 1,
      lastInstruction: params.prompt,
      createdAt: now,
      updatedAt: now
    })
  }

  if (cuts.length === 0) throw new Error('钩子赛马矩阵未命中有效剧集时间段，请重试')
  return { cuts, tokens }
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
  const evidence = buildTwoStageEvidenceDigest(drama, drama.cuts ?? [], 1)
  const style = nextStyle ?? existing.style
  const targetSec = nextTargetSec ?? existing.targetSec
  const meta = getCutStyleMeta(style)

  const prevClips = existing.clips
    .map((c, i) => `${i + 1}. 第${c.epN}集 ${c.in.toFixed(1)}-${c.out.toFixed(1)}s [${c.role}] ${c.why}`)
    .join('\n')

  const beatBlock =
    existing.beats && existing.beats.length > 0
      ? `\n=== 对标爆款节拍骨架（重剪时请继续保持该节拍槽位结构）===\n` +
        existing.beats.map((b, i) => `槽位 #${i + 1} [${b.role}] 约 ${b.sec}s | ${b.emotion} | ${b.desc}`).join('\n') +
        '\n'
      : ''

  const userPrompt = `${evidence}${beatBlock}

=== 当前待重剪的切片方案（v${existing.revision}）===
方案名称：${existing.title}
风格：${meta ? `${meta.name}（${meta.desc}）` : '自由定调（由 AI 根据修改指令决定）'}
目标时长：${targetSec <= 0 ? '不限固定时长（按剧情完整度与用户指令自由决定总时长与片段数量）' : targetSec > 90 ? `约 ${targetSec} 秒（中长篇串联，按需选取足够多关键片段）` : `约 ${targetSec} 秒`}
当前开场花字：${existing.hookHeadline}
当前片段编排：
${prevClips}

=== 用户/主理人修改指令 ===
${instruction.trim() || '对当前版本不满意，请从全剧高光中换一个更有冲击力的开场钩子和更紧凑的同主线冲突剪辑思路重新生成！'}

请严格按照上述修改指令重新编排切片（保持同一冲突主线因果连贯${targetSec <= 0 || targetSec > 90 ? '，按需选取足够多片段讲清完整脉络' : '，控制在 4-8 个精选片段内'}），输出完整 JSON（结构同标准格式：title, hookHeadline, publishCopy, conflictSummary, directorNote, clips）。`

  const { text, tokens } = await callDirectorModel(cfg, SYSTEM_PROMPT, userPrompt, signal)
  const parsed = extractJson(text) as Record<string, unknown>
  const cut = parseCutPayload(
    parsed,
    drama,
    style,
    targetSec,
    existing.ratio,
    existing,
    instruction,
    existing.mode,
    existing.beats
  )
  return { cut, tokens }
}
