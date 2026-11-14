import fs from 'fs'
import path from 'path'
import type {
  AsrSegment,
  Candidate,
  Character,
  Drama,
  DramaSynthesis,
  GlobalMapEntry,
  GlobalScript,
  GlobalScriptEpisode,
  ModelCfg
} from '../../src/shared/types'
import { cacheDir } from './db'
import { extractJson, isGoogleNative, streamChat, streamNative } from './llm'
import { ffmpegBin, fileExists, probe, run } from './media'

const TAGS = ['冲突', '反转', '爽点', '打脸', '甜宠', '哭戏', '悬念']
// base64 内联受 20MB 请求上限约束：视频 ≤13MB（base64 后 ~17.8MB）+ prompt 余量
const MAX_VIDEO_BYTES = 13 * 1024 * 1024
const TARGET_VIDEO_BYTES = 11 * 1024 * 1024
const MAX_ACT_SEC = 800
const EST_RATE = 8000 // 360p@2fps crf32 aac24k 的保守字节/秒估算

export interface GlobalRange {
  from: number
  to: number
}

export interface GlobalResult {
  synthesis: DramaSynthesis
  script: GlobalScript
  candidates: Map<string, Candidate[]>
  segments: Map<string, AsrSegment[]>
  map: GlobalMapEntry[]
  acts: number
  tokens: number
  cachedTokens: number
}

interface Act {
  file: string
  sig: string
  eps: Drama['episodes']
  map: GlobalMapEntry[]
}

interface ActCheckpoint {
  sig: string
  text: string
  tokens: number
  cached: number
}

export function globalDir(dramaId: string): string {
  return path.join(cacheDir(), 'global', dramaId)
}

export function readGlobalScript(dramaId: string): GlobalScript | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(globalDir(dramaId), 'script.json'), 'utf8')) as GlobalScript
  } catch {
    return null
  }
}

export function estimateTokens(eps: { duration: number | null }[]): number {
  return Math.round(eps.reduce((s, e) => s + (e.duration ?? 0), 0) * 108)
}

export function estimateActs(eps: { duration: number | null }[]): number {
  const total = eps.reduce((s, e) => s + (e.duration ?? 0), 0)
  return Math.max(1, Math.ceil(total / MAX_ACT_SEC))
}

function buildMap(eps: Drama['episodes']): GlobalMapEntry[] {
  let acc = 0
  return eps.map((ep) => {
    const m = { epId: ep.id, n: ep.n, globalStart: acc, globalEnd: acc + ep.duration!, duration: ep.duration! }
    acc += ep.duration!
    return m
  })
}

function groupSig(eps: Drama['episodes']): string {
  return eps.map((e) => `${e.n}:${e.size}:${(e.duration ?? 0).toFixed(1)}`).join('|')
}

async function encodeProxy(
  eps: Drama['episodes'],
  out: string,
  low: boolean,
  signal?: AbortSignal
): Promise<void> {
  const inputs = eps.flatMap((ep) => ['-i', ep.file])
  const height = low ? 240 : 360
  const fps = low ? 1 : 2
  const crf = low ? '36' : '32'
  const audio = low ? '16k' : '24k'
  const sr = low ? 16000 : 24000
  const scale = `scale=-2:${height},setsar=1,format=yuv420p,fps=${fps}`
  const vnorm = eps.map((_, i) => `[${i}:v]${scale}[v${i}]`).join(';')
  const anorm = eps.map((_, i) => `[${i}:a]aresample=${sr},aformat=sample_fmts=fltp:channel_layouts=mono[a${i}]`).join(';')
  const concatIn = eps.map((_, i) => `[v${i}][a${i}]`).join('')
  const filter = `${vnorm};${anorm};${concatIn}concat=n=${eps.length}:v=1:a=1[vout][a]`
  await run(
    ffmpegBin(),
    [
      '-y',
      ...inputs,
      '-filter_complex',
      filter,
      '-map',
      '[vout]',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-crf',
      crf,
      '-preset',
      'veryfast',
      '-c:a',
      'aac',
      '-b:a',
      audio,
      '-ac',
      '1',
      out
    ],
    30 * 60_000,
    8000,
    signal
  )
}

// 自动分幕：按时长/字节预算贪心分组；若本地已有同一幕签名且完好的代理视频则直接复用
async function buildActs(
  drama: Drama,
  eps: Drama['episodes'],
  onLog?: (msg: string) => void,
  signal?: AbortSignal
): Promise<Act[]> {
  const groups: Drama['episodes'][] = []
  let cur: Drama['episodes'] = []
  let curSec = 0
  let curBytes = 0
  for (const ep of eps) {
    const d = ep.duration!
    const b = d * EST_RATE
    if (cur.length > 0 && (curSec + d > MAX_ACT_SEC || curBytes + b > TARGET_VIDEO_BYTES)) {
      groups.push(cur)
      cur = []
      curSec = 0
      curBytes = 0
    }
    cur.push(ep)
    curSec += d
    curBytes += b
  }
  if (cur.length > 0) groups.push(cur)

  const dir = globalDir(drama.id)
  fs.mkdirSync(dir, { recursive: true })
  const acts: Act[] = []
  const pending = [...groups]
  let idx = 0
  while (pending.length > 0) {
    if (signal?.aborted) throw new Error('已取消')
    const group = pending.shift()!
    const sig = groupSig(group)
    const out = path.join(dir, `act-${idx}.mp4`)
    const sigFile = path.join(dir, `act-${idx}.sig`)
    const map = buildMap(group)

    let reused = false
    if (fileExists(out) && fileExists(sigFile)) {
      try {
        const savedSig = fs.readFileSync(sigFile, 'utf8').trim()
        const statSize = fs.statSync(out).size
        if (savedSig === sig && statSize > 0 && statSize <= MAX_VIDEO_BYTES) {
          const merged = await probe(out)
          if (Math.abs(merged.duration - map[map.length - 1].globalEnd) <= 2) {
            acts.push({ file: out, sig, eps: group, map })
            onLog?.(
              `第 ${acts.length} 幕复用本地代理缓存：第 ${group[0].n}-${group[group.length - 1].n} 集 · ${(statSize / 1048576).toFixed(1)}MB · ${merged.duration.toFixed(0)}s`
            )
            reused = true
            idx++
          }
        }
      } catch {
        reused = false
      }
    }
    if (reused) continue

    const estBytes = group.reduce((s, e) => s + e.duration! * EST_RATE, 0)
    await encodeProxy(group, out, estBytes > MAX_VIDEO_BYTES, signal)
    let size = fs.statSync(out).size
    if (size > MAX_VIDEO_BYTES) {
      onLog?.(`幕代理 ${(size / 1048576).toFixed(1)}MB 超限，降质重编码…`)
      await encodeProxy(group, out, true, signal)
      size = fs.statSync(out).size
    }
    if (size > MAX_VIDEO_BYTES) {
      if (group.length === 1) throw new Error(`第 ${group[0].n} 集单集代理仍超过 13MB，无法内联发送`)
      onLog?.(`降质后仍 ${(size / 1048576).toFixed(1)}MB，二分该幕…`)
      const mid = Math.ceil(group.length / 2)
      pending.unshift(group.slice(0, mid), group.slice(mid))
      fs.rmSync(out, { force: true })
      continue
    }
    const merged = await probe(out)
    const drift = Math.abs(merged.duration - map[map.length - 1].globalEnd)
    if (drift > 1) onLog?.(`警告：幕时长偏差 ${drift.toFixed(2)}s，高光时间可能有偏移`)
    fs.writeFileSync(sigFile, sig, 'utf8')
    acts.push({ file: out, sig, eps: group, map })
    onLog?.(`第 ${acts.length} 幕就绪：第 ${group[0].n}-${group[group.length - 1].n} 集 · ${(size / 1048576).toFixed(1)}MB · ${merged.duration.toFixed(0)}s`)
    idx++
  }
  return acts
}

function buildCombinedPrompt(map: GlobalMapEntry[], known: Character[]): string {
  const boundaries = map.map((m) => `第${m.n}集 ${m.globalStart.toFixed(1)}s–${m.globalEnd.toFixed(1)}s`).join('；')
  const anchor = known.length
    ? `前面剧集已确认的人物（同一人物沿用相同姓名，出现新人物再新增）：${known.map((c) => `${c.name}（${c.role}）`).join('、')}。`
    : ''
  return [
    `这是一部竖屏短剧的 ${map.length} 集按顺序拼接成的视频片段（含声音），各集边界：${boundaries}。`,
    anchor,
    '请通读后输出一个 JSON 对象（不要 markdown 包裹），highlights 放在 episodes 之前输出：',
    '{"logline":"一句话故事，不超过50字","characters":[{"name":"剧中真实姓名，无名用称谓如男主","role":"男主/女主/反派/配角等","desc":"不超过30字身份描述","relations":"不超过30字人物关系"}],"arcs":"本片段叙事地图：开端/发展/高潮/反转/结局分别集中在哪几集，不超过200字","highlights":[{"ep":集数,"title":"不超过20字的标题，尽量用金句原话","start":起始秒,"end":结束秒,"score":0到100,"hook":0到100,"quote":"片段中最有传播力的金句原话","conflict":"冲突类型，如打脸/逼婚/揭穿/反转","characters":["出场人物名"],"tags":["冲突","反转","爽点","打脸","甜宠","哭戏","悬念"],"bd":{"钩子":0到100,"冲突":0到100,"情绪":0到100,"金句":0到100},"reason":"不超过60字的理由","scene":"不超过60字的场景描述"}],"episodes":[{"n":集数,"summary":"本集梗概不超过80字","transcript":[{"start":起始秒,"end":结束秒,"text":"台词"}]}]}',
    '高光用于短视频引流切片，要求：',
    '- 数量按每集精彩程度差异化 3-8 条：冲突/反转/爽点/打脸密集的集多给、平淡的集少给，不要每集固定相同数量；',
    '- 起点放在冲突爆发前 1-2 秒，让开场 3 秒就有强钩子（冲突台词/强烈表情/动作）；终点停在情绪顶点或悬念处，不要切断半句台词；',
    '- 每段能独立看懂、不依赖前情；单段 5-30 秒；start/end 必须落在该集边界内；同集内互不重叠；',
    '- score 在本片段内拉开分布：最强的 90 以上，一般的 60-75，不要都给高分；hook 表示开场 3 秒钩子强度；按 score 降序。',
    '其他要求：characters 合并同一人物的不同称呼、按重要度排序；transcript 逐句转写全部台词；所有时间为相对本视频片段起点的全局秒数，精确到 0.1 不要取整；台词听不清就跳过，不要编造；只输出 JSON。'
  ]
    .filter(Boolean)
    .join('\n')
}

async function chatVideo(
  cfg: ModelCfg,
  b64: string,
  prompt: string,
  maxTokens: number,
  signal?: AbortSignal
): Promise<{ text: string; tokens: number; cached: number }> {
  const system = '你是短剧全局分析助手，只输出 JSON，不输出其它内容。'
  if (isGoogleNative(cfg)) {
    return streamNative(
      cfg,
      [{ inline_data: { mime_type: 'video/mp4', data: b64 } }, { text: prompt }],
      { maxOutputTokens: maxTokens, thinkingConfig: { thinkingLevel: 'low' }, responseMimeType: 'application/json' },
      '全局模型',
      system,
      signal
    )
  }
  return streamChat(
    cfg,
    {
      model: cfg.model,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: maxTokens,
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
    '全局模型',
    signal
  )
}

async function callText(
  cfg: ModelCfg,
  system: string,
  user: string,
  maxTokens: number,
  signal?: AbortSignal
): Promise<{ text: string; tokens: number; cached: number }> {
  if (isGoogleNative(cfg)) {
    return streamNative(
      cfg,
      [{ text: user }],
      { maxOutputTokens: maxTokens, thinkingConfig: { thinkingLevel: 'low' } },
      '全局模型',
      system,
      signal
    )
  }
  return streamChat(
    cfg,
    {
      model: cfg.model,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    },
    '全局模型',
    signal
  )
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function clampScore(v: unknown, fallback = 0): number {
  return Math.max(0, Math.min(100, Math.round(num(v, fallback))))
}

function parseScript(text: string): { synthesis: DramaSynthesis; episodes: GlobalScriptEpisode[] } {
  const parsed = extractJson(text) as Record<string, unknown>
  const characters: Character[] = Array.isArray(parsed.characters)
    ? (parsed.characters as unknown[])
        .map((it) => {
          const o = (it ?? {}) as Record<string, unknown>
          const desc = String(o.desc ?? '').trim()
          const relations = String(o.relations ?? '').trim()
          return {
            name: String(o.name ?? '').trim().slice(0, 20),
            role: String(o.role ?? '').trim().slice(0, 20),
            desc: [desc, relations].filter(Boolean).join('；').slice(0, 60)
          }
        })
        .filter((c) => c.name)
        .slice(0, 30)
    : []
  const episodes: GlobalScriptEpisode[] = Array.isArray(parsed.episodes)
    ? (parsed.episodes as unknown[]).map((it) => {
        const o = (it ?? {}) as Record<string, unknown>
        const transcript: AsrSegment[] = Array.isArray(o.transcript)
          ? (o.transcript as unknown[])
              .map((s) => {
                const x = (s ?? {}) as Record<string, unknown>
                return { start: num(x.start), end: num(x.end), text: String(x.text ?? '').trim() }
              })
              .filter((s) => s.end > s.start && s.text)
          : []
        return { n: num(o.n), summary: String(o.summary ?? '').slice(0, 200), transcript }
      })
    : []
  return {
    synthesis: {
      characters,
      logline: String(parsed.logline ?? '').slice(0, 100),
      arcs: String(parsed.arcs ?? '').slice(0, 500),
      updatedAt: Date.now()
    },
    episodes
  }
}

function parseHighlights(text: string, map: GlobalMapEntry[]): Map<string, Candidate[]> {
  const into = new Map<string, Candidate[]>()
  const parsed = extractJson(text) as Record<string, unknown>
  const raw = Array.isArray(parsed.highlights) ? (parsed.highlights as unknown[]) : []
  raw.forEach((it) => {
    const o = (it ?? {}) as Record<string, unknown>
    const start = num(o.start, NaN)
    const end = num(o.end, NaN)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return
    const entry = map.find((m) => m.n === num(o.ep)) ?? map.find((m) => start >= m.globalStart && start < m.globalEnd)
    if (!entry) return
    const tin = Math.round(Math.max(0, start - entry.globalStart) * 10) / 10
    const tout = Math.round(Math.min(entry.duration, end - entry.globalStart) * 10) / 10
    if (tout - tin < 1) return
    const score = clampScore(o.score)
    const hook = clampScore(o.hook, score)
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
    const list = into.get(entry.epId) ?? []
    const i = list.length
    const cand: Candidate = {
      id: `g-${entry.epId}-${i}`,
      score,
      title: String(o.title ?? '高光片段').slice(0, 40),
      tags: Array.isArray(o.tags) ? (o.tags as unknown[]).map(String).filter((t) => TAGS.includes(t)) : [],
      in: tin,
      out: tout,
      src: 'G',
      status: 'pending',
      reason: String(o.reason ?? '').slice(0, 200),
      bd,
      scene: String(o.scene ?? '').slice(0, 60),
      hook,
      quote: String(o.quote ?? '').slice(0, 80),
      conflict: String(o.conflict ?? '').slice(0, 20),
      characters: Array.isArray(o.characters) ? (o.characters as unknown[]).map(String).slice(0, 8) : []
    }
    list.push(cand)
    into.set(entry.epId, list)
  })
  return into
}

function loadActCheckpoint(dir: string, actIndex: number, act: Act): ActCheckpoint | null {
  const ckFile = path.join(dir, `act-${actIndex}-checkpoint.json`)
  if (fileExists(ckFile)) {
    try {
      const ck = JSON.parse(fs.readFileSync(ckFile, 'utf8')) as ActCheckpoint
      if (ck && ck.sig === act.sig && ck.text) return ck
    } catch {
      // ignore
    }
  }
  const rawFile = path.join(dir, `act-${actIndex}-raw.txt`)
  if (fileExists(rawFile)) {
    try {
      const rawText = fs.readFileSync(rawFile, 'utf8')
      const parsed = parseScript(rawText)
      const cands = parseHighlights(rawText, act.map)
      const covered = act.map.filter((m) => (cands.get(m.epId)?.length ?? 0) > 0).length
      if (parsed.episodes.length > 0 && covered > 0) {
        return { sig: act.sig, text: rawText, tokens: 0, cached: 0 }
      }
    } catch {
      // ignore
    }
  }
  return null
}

function saveActCheckpoint(dir: string, actIndex: number, ck: ActCheckpoint): void {
  const ckFile = path.join(dir, `act-${actIndex}-checkpoint.json`)
  fs.writeFileSync(ckFile, JSON.stringify(ck), 'utf8')
  fs.writeFileSync(path.join(dir, `act-${actIndex}-raw.txt`), ck.text, 'utf8')
}

export async function runGlobalAnalysis(
  drama: Drama,
  cfg: ModelCfg,
  range: GlobalRange,
  onProgress: (pct: number) => void,
  onLog?: (msg: string) => void,
  signal?: AbortSignal
): Promise<GlobalResult> {
  if (!cfg.apiKey.trim()) throw new Error('请先在「设置」里填写全局模型 API Key')
  if (!cfg.baseUrl.trim() || !cfg.model.trim()) throw new Error('请先在「设置」里配置全局模型 Base URL 和模型名')
  const eps = drama.episodes.filter((e) => e.n >= range.from && e.n <= range.to).sort((a, b) => a.n - b.n)
  if (eps.length === 0) throw new Error('范围内没有剧集')
  for (const ep of eps) {
    if (!ep.duration || ep.duration <= 0) throw new Error(`第 ${ep.n} 集缺少时长，请先等待元数据读取完成`)
    if (!fileExists(ep.file)) throw new Error(`第 ${ep.n} 集文件不存在：${ep.file}`)
  }
  const fullMap = buildMap(eps)
  const totalSec = fullMap[fullMap.length - 1].globalEnd
  onLog?.(`全局分析第 ${range.from}-${range.to} 集（${eps.length} 集 · ${totalSec.toFixed(0)}s · 预计输入 ~${Math.round((totalSec * 108) / 1000)}K tokens）`)
  onProgress(1)
  const acts = await buildActs(drama, eps, onLog, signal)
  onLog?.(`自动分为 ${acts.length} 幕，逐幕产出剧本 + 人物 + 高光（已完成幕自动断点续传）`)

  const dir = globalDir(drama.id)
  const candidates = new Map<string, Candidate[]>()
  const segments = new Map<string, AsrSegment[]>()
  const scriptEps: GlobalScriptEpisode[] = []
  const chars: Character[] = []
  const actSummaries: { from: number; to: number; logline: string; arcs: string }[] = []
  let tokens = 0
  let cachedTokens = 0

  for (let a = 0; a < acts.length; a++) {
    if (signal?.aborted) throw new Error('已取消')
    const act = acts[a]
    const base = (a / acts.length) * 100
    const span = 100 / acts.length
    onLog?.(`—— 第 ${a + 1}/${acts.length} 幕（第 ${act.eps[0].n}-${act.eps[act.eps.length - 1].n} 集）——`)

    let r: { text: string; tokens: number; cached: number } | null = null
    let synthesis: DramaSynthesis | null = null
    let episodes: GlobalScriptEpisode[] = []
    let actCands = new Map<string, Candidate[]>()

    const cachedAct = loadActCheckpoint(dir, a, act)
    if (cachedAct) {
      try {
        const parsed = parseScript(cachedAct.text)
        const cands = parseHighlights(cachedAct.text, act.map)
        r = { text: cachedAct.text, tokens: cachedAct.tokens, cached: cachedAct.cached }
        synthesis = parsed.synthesis
        episodes = parsed.episodes
        actCands = cands
        onLog?.(`第 ${a + 1} 幕命中本地断点缓存，直接跳过模型重算`)
      } catch {
        r = null
      }
    }

    if (!r || !synthesis) {
      const b64 = fs.readFileSync(act.file).toString('base64')
      onLog?.(`调用 ${cfg.model}：剧本 + 人物 + 高光一次产出（${(b64.length / 1048576).toFixed(1)}MB base64）…`)
      const maxAttempts = 4
      const needCovered = Math.ceil(act.map.length * 0.8)
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (signal?.aborted) throw new Error('已取消')
        try {
          const resp = await chatVideo(cfg, b64, buildCombinedPrompt(act.map, chars), 65536, signal)
          const parsed = parseScript(resp.text)
          const cands = parseHighlights(resp.text, act.map)
          const covered = act.map.filter((m) => (cands.get(m.epId)?.length ?? 0) > 0).length
          if (covered < needCovered) {
            if (attempt < maxAttempts) throw new Error(`高光覆盖不足 ${covered}/${act.map.length} 集（需≥${needCovered}），模型漏集`)
            onLog?.(`第 ${a + 1} 幕高光覆盖不足 ${covered}/${act.map.length}，已达最大重试，接受部分结果`)
          }
          r = resp
          synthesis = parsed.synthesis
          episodes = parsed.episodes
          actCands = cands
          saveActCheckpoint(dir, a, { sig: act.sig, text: resp.text, tokens: resp.tokens, cached: resp.cached })
          break
        } catch (err) {
          if (signal?.aborted) throw new Error('已取消')
          const msg = err instanceof Error ? err.message : String(err)
          if (attempt < maxAttempts) {
            const wait = /503|429|overload|unavailable/i.test(msg) ? attempt * 15 : attempt * 6
            onLog?.(`第 ${a + 1} 幕第 ${attempt} 次失败：${msg.slice(0, 300)} —— ${wait}s 后重试（${attempt + 1}/${maxAttempts}）`)
            await new Promise<void>((res, rej) => {
              const timer = setTimeout(res, wait * 1000)
              signal?.addEventListener(
                'abort',
                () => {
                  clearTimeout(timer)
                  rej(new Error('已取消'))
                },
                { once: true }
              )
            })
            continue
          }
          onLog?.(`第 ${a + 1} 幕 ${maxAttempts} 次均失败，放弃本幕：${msg.slice(0, 300)}`)
          throw err
        }
      }
    }

    if (!r || !synthesis) throw new Error(`第 ${act.eps[0].n}-${act.eps[act.eps.length - 1].n} 集幕：模型多次输出仍无法解析`)
    tokens += r.tokens
    cachedTokens += r.cached
    for (const c of synthesis.characters) {
      if (!chars.some((x) => x.name === c.name)) chars.push(c)
    }
    actSummaries.push({
      from: act.eps[0].n,
      to: act.eps[act.eps.length - 1].n,
      logline: synthesis.logline,
      arcs: synthesis.arcs
    })
    for (const m of act.map) {
      const se = episodes.find((e) => e.n === m.n)
      const local = (se?.transcript ?? [])
        .map((s) => ({
          start: Math.round(Math.max(0, s.start - m.globalStart) * 10) / 10,
          end: Math.round(Math.min(m.duration, s.end - m.globalStart) * 10) / 10,
          text: s.text
        }))
        .filter((s) => s.end > s.start)
        .sort((x, y) => x.start - y.start)
      if (local.length > 0) segments.set(m.epId, local)
      scriptEps.push({ n: m.n, summary: se?.summary ?? '', transcript: local })
    }
    for (const [epId, list] of actCands) {
      const arr = candidates.get(epId) ?? []
      arr.push(...list)
      candidates.set(epId, arr)
    }
    const actHl = act.map.reduce((s, m) => s + (candidates.get(m.epId)?.length ?? 0), 0)
    onLog?.(`本幕完成：人物 ${synthesis.characters.length} 个 · 剧本 ${episodes.length} 集 · 高光 ${actHl} 条 · ${r.tokens} tokens（缓存 ${r.cached}）`)
    onProgress(Math.round(base + span))
  }
  for (const list of candidates.values()) list.sort((x, y) => y.score - x.score)

  let logline = actSummaries[0]?.logline ?? ''
  let arcs = actSummaries.map((s) => s.arcs).filter(Boolean).join('；').slice(0, 500)
  if (acts.length > 1) {
    if (signal?.aborted) throw new Error('已取消')
    onLog?.('多幕统筹：合并全剧故事与叙事地图…')
    const actInfo = actSummaries.map((s) => `第${s.from}-${s.to}集：${s.logline}｜${s.arcs}`).join('\n')
    try {
      const u = await callText(
        cfg,
        '你是短剧剧本统筹助手，只输出 JSON，不输出其它内容。',
        `以下是同一部短剧分幕分析的各幕梗概与叙事地图：\n${actInfo}\n请合并为全剧统一的一句话故事与叙事地图，输出 JSON {"logline":"不超过50字","arcs":"不超过200字，标明开端/发展/高潮/反转/结局各在哪几集"}，只输出 JSON。`,
        4096,
        signal
      )
      tokens += u.tokens
      cachedTokens += u.cached
      const parsed = extractJson(u.text) as Record<string, unknown>
      if (typeof parsed.logline === 'string' && parsed.logline) logline = parsed.logline.slice(0, 100)
      if (typeof parsed.arcs === 'string' && parsed.arcs) arcs = parsed.arcs.slice(0, 500)
    } catch (err) {
      if (signal?.aborted) throw new Error('已取消')
      const msg = err instanceof Error ? err.message : String(err)
      onLog?.(`警告：多幕统筹请求失败（${msg.slice(0, 120)}），自动降级沿用各幕拼接结果，不影响高光与出片`)
    }
  }

  const prev = readGlobalScript(drama.id)
  const newNs = new Set(scriptEps.map((e) => e.n))
  const kept = (prev?.episodes ?? []).filter((e) => !newNs.has(e.n))
  const allEps = [...kept, ...scriptEps].sort((a, b) => a.n - b.n)
  for (const c of drama.synthesis?.characters ?? []) {
    if (!chars.some((x) => x.name === c.name)) chars.push(c)
  }
  const synthesis: DramaSynthesis = { characters: chars.slice(0, 30), logline, arcs, updatedAt: Date.now() }
  const script: GlobalScript = { logline, arcs, episodes: allEps }
  fs.writeFileSync(path.join(globalDir(drama.id), 'script.json'), JSON.stringify(script, null, 2))
  const hlTotal = [...candidates.values()].reduce((s, l) => s + l.length, 0)
  onLog?.(`全局分析完成：${acts.length} 幕 · 高光 ${hlTotal} 条 · 人物 ${synthesis.characters.length} 个 · ${tokens} tokens（缓存命中 ${cachedTokens}）`)
  onProgress(100)
  return { synthesis, script, candidates, segments, map: fullMap, acts: acts.length, tokens, cachedTokens }
}
