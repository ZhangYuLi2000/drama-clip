import type { ArrangeClip, ArrangeParams, ArrangeResult, Candidate, Drama, ModelCfg } from '../../src/shared/types'
import { STRUCTURES } from '../../src/shared/types'
import { chatText, extractJson } from './llm'

interface PoolItem {
  cand: Candidate
  epN: number
}

function buildPool(drama: Drama, basket: string[]): PoolItem[] {
  const byId = new Map<string, PoolItem>()
  for (const ep of drama.episodes) {
    for (const c of ep.candidates ?? []) {
      if (c.status === 'approved') byId.set(c.id, { cand: c, epN: ep.n })
    }
  }
  return basket.map((id) => byId.get(id)).filter((x): x is PoolItem => Boolean(x))
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export async function buildArrange(
  drama: Drama,
  params: ArrangeParams,
  cfg: ModelCfg
): Promise<ArrangeResult> {
  const pool = buildPool(drama, params.basket)
  if (pool.length === 0) throw new Error('素材篮里没有可用高光，先去高光管理选材')
  const meta = STRUCTURES[params.structure]
  const syn = drama.synthesis
  const chars = syn?.characters ?? []
  const storyLine = syn?.logline ? `全剧故事：${syn.logline}\n` : ''
  const arcsLine = syn?.arcs ? `叙事地图：${syn.arcs}\n` : ''
  const charLine = chars.length
    ? `全剧人物：${chars.map((c) => `${c.name}（${c.role}）`).join('、')}\n`
    : ''
  const poolLines = pool
    .map(({ cand: c, epN }) => {
      const quote = c.quote ? ` 金句:${c.quote}` : ''
      const hook = c.hook !== undefined ? ` 钩子${c.hook}` : ''
      return `[${c.id}] 第${epN}集 ${c.title} | 评分${c.score}${hook} | 标签:${c.tags.join('/')} | 可用${c.in}-${c.out}s(${(c.out - c.in).toFixed(1)}s)${quote}`
    })
    .join('\n')
  const capLine = meta.roles.map((r) => `${r}≤${meta.caps[r] ?? 10}s`).join('、')
  const user = `创作需求：${params.prompt || '剪一条高光引流合集'}\n目标时长：${params.target} 秒，画幅 ${params.ratio}。\n叙事结构：${meta.name} — ${meta.desc}。角色及单段上限：${capLine}。\n${storyLine}${arcsLine}${charLine}候选素材（按素材篮顺序）：\n${poolLines}\n\n请挑选并编排成引流混剪 EDL，输出一个 JSON 对象：\n{"clips":[{"candId":"候选id","in":起始秒,"out":结束秒,"role":"角色","why":"不超过30字的选用理由"}]}\n要求：总时长不超过 ${params.target} 秒且尽量接近；开场用钩子最强的素材；按结构角色顺序编排；每段 in/out 落在候选可用区间内、单段不超过角色上限；结尾留悬念引导看下集；candId 必须来自候选；只输出 JSON。`
  const { text, tokens } = await chatText(cfg, [
    { role: 'system', content: '你是短剧引流混剪编排助手，只输出 JSON，不输出其它内容。' },
    { role: 'user', content: user }
  ])
  const parsed = extractJson(text) as Record<string, unknown>
  const raw = Array.isArray(parsed.clips) ? (parsed.clips as unknown[]) : []
  const byId = new Map(pool.map((p) => [p.cand.id, p]))
  const clips: ArrangeClip[] = []
  let budget = params.target
  for (const it of raw) {
    const o = (it ?? {}) as Record<string, unknown>
    const item = byId.get(String(o.candId ?? ''))
    if (!item) continue
    const { cand } = item
    const role = meta.caps[String(o.role)] !== undefined ? String(o.role) : meta.roles[clips.length] ?? '高潮'
    const cap = meta.caps[role] ?? 10
    const tin = clamp(Number(o.in) || cand.in, cand.in, cand.out)
    let dur = clamp(Number(o.out) || cand.out, cand.in, cand.out) - tin
    dur = Math.min(dur, cap, budget)
    if (dur < 1) continue
    const tout = Math.round((tin + dur) * 10) / 10
    clips.push({
      candId: cand.id,
      in: Math.round(tin * 10) / 10,
      out: tout,
      role,
      why: String(o.why ?? '').slice(0, 60)
    })
    budget -= dur
    if (budget < 1) break
  }
  if (clips.length === 0) throw new Error('模型没有返回有效编排，请重试或调整创作需求')
  return { clips, tokens }
}