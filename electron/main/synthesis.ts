import type { Character, Drama, DramaSynthesis, ModelCfg } from '../../src/shared/types'
import { chatText, extractJson } from './llm'

function buildCorpus(drama: Drama): { text: string; epCount: number } {
  const lines: string[] = [`《${drama.title}》共 ${drama.episodes.length} 集。以下是各集物料：`]
  let epCount = 0
  for (const ep of drama.episodes) {
    const hasData = (ep.candidates?.length ?? 0) > 0 || (ep.segments?.length ?? 0) > 0 || Boolean(ep.summary)
    if (!hasData) continue
    epCount++
    lines.push(`\n## 第 ${ep.n} 集`)
    if (ep.summary) lines.push(`梗概：${ep.summary}`)
    for (const c of ep.candidates ?? []) {
      const chars = c.characters?.length ? ` 人物:${c.characters.join('/')}` : ''
      const quote = c.quote ? ` 金句:${c.quote}` : ''
      lines.push(
        `- [${c.score}|钩子${c.hook ?? '-'}] ${c.title} (${c.in}-${c.out}s) 标签:${c.tags.join('/')}${chars}${quote}`
      )
    }
    if (ep.segments?.length) {
      lines.push('台词：' + ep.segments.map((s) => s.text).join(' / '))
    }
  }
  return { text: lines.join('\n'), epCount }
}

export async function buildSynthesis(
  drama: Drama,
  cfg: ModelCfg,
  onProgress: (pct: number) => void,
  onLog?: (msg: string) => void
): Promise<{ synthesis: DramaSynthesis; tokens: number }> {
  const { text: corpus, epCount } = buildCorpus(drama)
  if (epCount === 0) throw new Error('还没有已分析的剧集，先对剧集执行「视频理解」再统筹')
  onLog?.(`统筹 ${epCount} 集物料，调用 ${cfg.model}…`)
  onProgress(10)
  const user = `${corpus}\n\n请基于以上物料统筹全剧，输出一个 JSON 对象：\n{"logline":"一句话故事，不超过50字","characters":[{"name":"人物姓名","role":"男主/女主/反派/配角等","desc":"不超过30字的身份描述"}],"arcs":"主线叙事地图：开端/发展/高潮/反转/结局分别集中在哪几集，不超过200字"}\n要求：人物用剧中真实姓名（没有姓名用称谓如"男主"），合并同一人物的不同称呼；characters 按重要度排序；只输出 JSON。`
  const { text, tokens } = await chatText(cfg, [
    { role: 'system', content: '你是短剧剧本统筹助手，只输出 JSON，不输出其它内容。' },
    { role: 'user', content: user }
  ])
  onProgress(90)
  const parsed = extractJson(text) as Record<string, unknown>
  const characters: Character[] = Array.isArray(parsed.characters)
    ? (parsed.characters as unknown[])
        .map((it) => {
          const o = (it ?? {}) as Record<string, unknown>
          return {
            name: String(o.name ?? '').trim().slice(0, 20),
            role: String(o.role ?? '').trim().slice(0, 20),
            desc: String(o.desc ?? '').trim().slice(0, 60)
          }
        })
        .filter((c) => c.name)
        .slice(0, 30)
    : []
  const synthesis: DramaSynthesis = {
    characters,
    logline: String(parsed.logline ?? '').slice(0, 100),
    arcs: String(parsed.arcs ?? '').slice(0, 500),
    updatedAt: Date.now()
  }
  return { synthesis, tokens }
}