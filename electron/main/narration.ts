import crypto from 'crypto'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { Drama, GenerateNarrationParams, GlobalScript, ModelCfg, NarrationCut, NarrationSegment, TtsCfg } from '../../src/shared/types'
import { withPublishTags } from '../../src/shared/types'
import { cacheDir } from './db'
import { readGlobalScript } from './global'
import { extractJson, isGoogleNative, streamChat, streamNative, type StreamResult } from './llm'
import { ffmpegBin, fileExists, probe, run } from './media'
import { synthesizeSpeech, ttsCacheKey } from './tts'

const CHARS_PER_SEC = 4.5

// 推理模型的思考 token 与正文共享 max_tokens 预算，预算太小会整段烧在思考上（finish_reason=length、正文 0 token）
const NARRATION_MAX_TOKENS = 65536

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
    const cands = [...(e.candidates || [])].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 4)
    for (const c of cands) {
      lines.push(`  画面[${c.in.toFixed(1)}-${c.out.toFixed(1)}s] 分${c.score}《${c.title}》 场景:${c.scene || ''} 金句:${c.quote || ''} 人物:${(c.characters || []).join('/')}`)
    }
  }
  return lines.join('\n')
}

function buildPrompt(digest: string, targetSec: number, rate: number, userPrompt?: string): string {
  const effectiveRate = Math.max(0.5, Math.min(2, rate || 1))
  const charsPerSec = CHARS_PER_SEC * effectiveRate
  const budget = Math.round(targetSec * charsPerSec)
  const segMin = Math.max(5, Math.round(targetSec / 14))
  const segMax = Math.max(segMin + 4, Math.round(targetSec / 7))
  const perSegMin = Math.max(25, Math.round((budget / segMax) * 0.8))
  const perSegMax = Math.min(95, Math.max(perSegMin + 15, Math.round((budget / segMin) * 1.15)))
  const parts = [
    digest,
    '\n=== 任务 ===',
    '为这部短剧写一条「主线解说」短视频文案（连贯的第三人称解说旁白，不是混剪标题），锁定故事主线所述的那条冲突线，按剧情时间顺序讲清楚。',
    `目标成片总时长约 ${targetSec} 秒；当前配音语速约 ${charsPerSec.toFixed(1)} 字/秒，所以解说词总字数约 ${budget} 字（允许 ±15%）。`,
    '结构：钩子（开场3秒抓人）→ 剧情（起因/升级）→ 高潮 → 悬念/引导（结尾留钩子引导看正片，不要把结局彻底讲死）。',
    `分成 ${segMin}-${segMax} 段，每段解说词约 ${perSegMin}-${perSegMax} 字，口语化、有节奏感和悬念感，像抖音影视解说那样讲故事。`,
    '解说词必须是纯口播文本：严禁出现【】（）等舞台提示或动作标注，不要用省略号（……）或特殊符号；数字、金额、比例请写成中文口语（如“一百万”而非“100w”）。',
    `每段必须绑定一个画面：优先从上面「高光画面库」里选 epN + in/out（可微调起止），尽量让画面时长接近该段口播时长（约 字数 ÷ ${charsPerSec.toFixed(1)} 秒），且 in/out 必须落在该集时长内、out>in。`,
    '只依据给出的剧情写作，不要编造人物或情节；人物用真实姓名，epN 必须来自上方分集列表。',
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
  rate = 1,
  signal?: AbortSignal
): Promise<NarrationScriptResult> {
  const script = readGlobalScript(drama.id)
  if (!script) throw new Error('缺少全局剧本，请先在「剧集」里跑全局分析')
  const digest = buildDigest(drama, script, params.eps)
  const prompt = buildPrompt(digest, params.targetSec, params.rate ?? rate, params.prompt)
  const system = '你是短剧解说文案高手，只输出 JSON，不输出其它内容。'
  let r: StreamResult
  if (isGoogleNative(cfg)) {
    r = await streamNative(
      cfg,
      [{ text: prompt }],
      { maxOutputTokens: NARRATION_MAX_TOKENS, thinkingConfig: { thinkingLevel: 'low' }, responseMimeType: 'application/json' },
      '解说文案',
      system,
      signal
    )
  } else {
    const body = {
      model: cfg.model,
      temperature: 0.7,
      max_tokens: NARRATION_MAX_TOKENS,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ]
    }
    try {
      r = await streamChat(cfg, body, '解说文案', signal)
    } catch (err) {
      // 思考烧光输出预算（finish_reason=length 且正文为空）：降低推理强度重试一次
      if ((err as { finishReason?: string | null }).finishReason !== 'length' || signal?.aborted) throw err
      try {
        r = await streamChat(cfg, { ...body, reasoning_effort: 'low' }, '解说文案', signal)
      } catch {
        ;(err as Error).message += '（已尝试降低推理强度重试，仍失败）'
        throw err
      }
    }
  }
  const parsed = extractJson(r.text) as Record<string, unknown>
  const raw = Array.isArray(parsed.segments) ? (parsed.segments as Record<string, unknown>[]) : []
  const durByN = new Map(drama.episodes.map((e) => [e.n, e.duration || 0]))
  const idByN = new Map(drama.episodes.map((e) => [e.n, e.id]))
  const stamp = Date.now().toString(36)
  const segments: NarrationSegment[] = []
  raw.forEach((o, i) => {
    const text = String(o.text ?? '').trim()
    const epN = Math.round(Number(o.epN))
    const epId = idByN.get(epN)
    const dur = durByN.get(epN) || 0
    if (!text || !Number.isFinite(epN) || !epId || dur <= 1) return
    let tin = Math.max(0, Math.min(Number(o.in) || 0, dur - 1))
    let tout = Math.max(tin + 1, Math.min(Number(o.out) || tin + 5, dur))
    tin = Math.round(tin * 10) / 10
    tout = Math.round(tout * 10) / 10
    segments.push({
      id: `ns-${stamp}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      text: text.slice(0, 200),
      epN,
      epId,
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

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || '解说成片'
}

function stamp(): string {
  const d = new Date()
  const p = (x: number): string => String(x).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function fmtSrtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const rem = ms % 1000
  const p2 = (n: number): string => String(n).padStart(2, '0')
  const p3 = (n: number): string => String(n).padStart(3, '0')
  return `${p2(h)}:${p2(m)}:${p2(s)},${p3(rem)}`
}

/** 按标点拆分解说词并按字符数等比分配时间轴，生成可直接导入剪映的 .srt 字幕 */
export function buildNarrationSrt(segments: NarrationSegment[]): string {
  const entries: { start: number; end: number; text: string }[] = []
  let offset = 0
  for (const seg of segments) {
    if (seg.status !== 'ready' || !seg.audioFile) continue
    const dur = Math.max(0.2, seg.durationSec || 0)
    const rawText = seg.text.trim()
    if (!rawText) {
      offset += dur
      continue
    }
    const clauses = rawText
      .split(/(?<=[，。！？；：、,.!?;:])/)
      .map((s) => s.replace(/[，。！？；：、,.!?;:]+$/g, '').trim())
      .filter(Boolean)
    const parts = clauses.length > 0 ? clauses : [rawText]
    const totalChars = parts.reduce((a, p) => a + p.length, 0) || 1
    let cur = offset
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const span = i === parts.length - 1 ? offset + dur - cur : (dur * part.length) / totalChars
      const end = Math.max(cur + 0.15, cur + span)
      entries.push({ start: cur, end, text: part })
      cur = end
    }
    offset += dur
  }
  return entries
    .map((item, idx) => `${idx + 1}\n${fmtSrtTime(item.start)} --> ${fmtSrtTime(item.end)}\n${item.text}\n`)
    .join('\n')
}

export function buildNarrationCopyText(drama: Drama, cut: NarrationCut): string {
  const segLines = cut.segments.map(
    (s, i) => `${i + 1}. [${s.role}] 第${s.epN}集 ${s.in.toFixed(1)}-${s.out.toFixed(1)}s (${(s.durationSec ?? 0).toFixed(1)}s)\n${s.text}`
  )
  return [
    `【解说标题】${cut.title} (v${cut.revision})`,
    `【开场花字标题】${cut.hookHeadline}`,
    `【引流发布文案】\n${withPublishTags(cut.publishCopy, drama.publishTags)}`,
    `【配音参数】音色 ${cut.voice} · 语速 ${cut.rate}x · 画幅 ${cut.ratio ?? '9:16'}`,
    `【分段解说词】\n${segLines.join('\n\n')}`
  ].join('\n\n')
}

function narrationSegCacheFile(
  epFile: string,
  epSize: number,
  clipIn: number,
  audioDur: number,
  audioFile: string,
  ratio: string,
  speedFactor: number
): string {
  const dir = path.join(cacheDir(), 'narration-seg-cache')
  fs.mkdirSync(dir, { recursive: true })
  let audioSig = ''
  try {
    const st = fs.statSync(audioFile)
    audioSig = `${st.size}:${st.mtimeMs}`
  } catch {
    audioSig = '0'
  }
  const key = `${epFile}|${epSize}|${clipIn.toFixed(3)}|${audioDur.toFixed(3)}|${audioFile}|${audioSig}|${ratio}|${speedFactor.toFixed(4)}`
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 20)
  return path.join(dir, `nseg-${hash}.mp4`)
}

/** 将已配音的解说分段与对应剧集画面对齐合成为纯净 MP4（无硬字幕/无 BGM），并同步输出 .srt 与 _文案.txt。 */
export async function renderNarrationCut(
  drama: Drama,
  cut: NarrationCut,
  onProgress: (pct: number) => void,
  onLog?: (msg: string) => void,
  signal?: AbortSignal
): Promise<{ output: string; srtPath: string }> {
  const readySegs = cut.segments.filter((s) => s.status === 'ready' && s.audioFile && fileExists(s.audioFile))
  if (readySegs.length === 0) throw new Error('没有已配音的解说段，无法渲染视频')

  const ratio = cut.ratio ?? '9:16'
  const target = ratio === '9:16' ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 }
  const baseVf = `scale=${target.w}:${target.h}:force_original_aspect_ratio=decrease,pad=${target.w}:${target.h}:(ow-iw)/2:(oh-ih)/2,setsar=1`
  const workDir = path.join(cacheDir(), 'narration-render', `${cut.id}-${Date.now()}`)
  fs.mkdirSync(workDir, { recursive: true })
  const segFiles: string[] = []

  try {
    for (let i = 0; i < readySegs.length; i++) {
      if (signal?.aborted) throw new Error('已取消')
      const seg = readySegs[i]
      const ep = drama.episodes.find((e) => e.id === seg.epId || e.n === seg.epN)
      if (!ep) throw new Error(`第 ${i + 1} 段找不到第 ${seg.epN} 集`)
      if (!fileExists(ep.file)) throw new Error(`第 ${seg.epN} 集原文件不存在：${ep.file}`)

      let audioDur = seg.durationSec && seg.durationSec > 0.1 ? seg.durationSec : 0
      if (!audioDur) {
        const info = await probe(seg.audioFile!).catch(() => null)
        audioDur = info?.duration ? Math.round(info.duration * 100) / 100 : 3
        seg.durationSec = audioDur
      }

      const epDur = ep.duration && ep.duration > 0 ? ep.duration : seg.out
      let clipIn = Math.max(0, seg.in)
      let speedFactor = 1
      let vf = baseVf
      if (epDur - clipIn < audioDur) {
        if (epDur >= audioDur) {
          clipIn = Math.max(0, epDur - audioDur)
        } else {
          clipIn = 0
          speedFactor = Math.min(4, audioDur / Math.max(0.5, epDur))
          vf = `setpts=${speedFactor.toFixed(4)}*PTS,${baseVf}`
        }
      }

      const cachedSeg = narrationSegCacheFile(ep.file, ep.size, clipIn, audioDur, seg.audioFile!, ratio, speedFactor)
      if (fileExists(cachedSeg) && fs.statSync(cachedSeg).size > 1024) {
        segFiles.push(cachedSeg)
        onProgress(Math.round(((i + 1) / readySegs.length) * 90))
        onLog?.(`复用解说片段缓存 ${i + 1}/${readySegs.length}（第 ${seg.epN} 集 ${clipIn.toFixed(1)}s + ${audioDur.toFixed(1)}s）`)
        continue
      }

      const fadeOutStart = Math.max(0, audioDur - 0.04).toFixed(3)
      const af = `loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:st=0:d=0.02,afade=t=out:st=${fadeOutStart}:d=0.04`
      const tmpSeg = path.join(workDir, `seg-${i}.mp4`)

      await run(
        ffmpegBin(),
        [
          '-y',
          '-ss',
          clipIn.toFixed(3),
          '-i',
          ep.file,
          '-i',
          seg.audioFile!,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-t',
          audioDur.toFixed(3),
          '-vf',
          vf,
          '-af',
          af,
          '-r',
          '30',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '19',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '160k',
          '-ar',
          '48000',
          '-ac',
          '2',
          tmpSeg
        ],
        10 * 60_000,
        8000,
        signal
      )
      try {
        fs.copyFileSync(tmpSeg, cachedSeg)
        segFiles.push(cachedSeg)
      } catch {
        segFiles.push(tmpSeg)
      }
      onProgress(Math.round(((i + 1) / readySegs.length) * 90))
      onLog?.(`渲染解说片段 ${i + 1}/${readySegs.length}（第 ${seg.epN} 集 ${clipIn.toFixed(1)}s + ${audioDur.toFixed(1)}s）`)
    }

    cut.totalAudioSec = Math.round(readySegs.reduce((a, s) => a + (s.durationSec || 0), 0) * 10) / 10

    const listFile = path.join(workDir, 'list.txt')
    fs.writeFileSync(listFile, segFiles.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))

    let outDir = path.join(drama.dir, '成片')
    try {
      fs.mkdirSync(outDir, { recursive: true })
    } catch {
      outDir = path.join(app.getPath('userData'), 'renders', drama.id)
      fs.mkdirSync(outDir, { recursive: true })
    }
    const baseName = `${safeName(cut.title)}_解说_v${cut.revision}_${stamp()}`
    const output = path.join(outDir, `${baseName}.mp4`)
    const srtPath = path.join(outDir, `${baseName}.srt`)

    await run(
      ffmpegBin(),
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', output],
      10 * 60_000,
      8000,
      signal
    )

    fs.writeFileSync(srtPath, buildNarrationSrt(readySegs), 'utf8')
    fs.writeFileSync(path.join(outDir, `${baseName}_文案.txt`), buildNarrationCopyText(drama, cut), 'utf8')

    onProgress(100)
    onLog?.(`解说成片渲染完成：${output}`)
    return { output, srtPath }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}