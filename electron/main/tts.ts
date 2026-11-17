import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { TtsCfg } from '../../src/shared/types'
import { probe } from './media'

const DEFAULT_INSTRUCT = '请用影视解说的语气，节奏明快，吐字清晰，略带悬念感。'

export interface TtsResult {
  file: string
  durationSec: number
  cached: boolean
  characters?: number
}

export function ttsCacheKey(text: string, voice: string, rate: number, model: string): string {
  return crypto.createHash('sha1').update(`${text}|${voice}|${rate}|${model}`).digest('hex').slice(0, 16)
}

/** 百炼非实时语音合成（SpeechSynthesizer）：合成一段文本 → wav 落盘 → ffprobe 实测时长。outFile 已存在则直接复用。 */
export async function synthesizeSpeech(
  cfg: TtsCfg,
  text: string,
  outFile: string,
  opts: { voice?: string; rate?: number; instruction?: string } = {},
  signal?: AbortSignal
): Promise<TtsResult> {
  if (!cfg.apiKey.trim()) throw new Error('请先在「设置」里填写 TTS API Key')
  if (!cfg.baseUrl.trim() || !cfg.model.trim()) throw new Error('请先在「设置」里配置 TTS Base URL 和模型名')
  const voice = opts.voice || cfg.voice
  const rate = opts.rate ?? cfg.rate
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 1024) {
    const d = await probe(outFile).catch(() => null)
    return { file: outFile, durationSec: d ? Math.round(d.duration * 100) / 100 : 0, cached: true }
  }
  const timeout = AbortSignal.timeout(120000)
  const sig = signal ? AbortSignal.any([timeout, signal]) : timeout
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/api/v1/services/audio/tts/SpeechSynthesizer`
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      input: { text, voice, format: 'wav', sample_rate: 24000, rate, instruction: opts.instruction ?? DEFAULT_INSTRUCT }
    }),
    signal: sig
  })
  const j = (await r.json().catch(() => ({}))) as {
    code?: string
    message?: string
    output?: { audio?: { url?: string } }
    usage?: { characters?: number }
  }
  if (!r.ok || j.code) throw new Error(`TTS HTTP ${r.status} ${j.code || ''} ${j.message || ''}`.trim())
  const audioUrl = j.output?.audio?.url
  if (!audioUrl) throw new Error('TTS 响应无音频 URL')
  const ar = await fetch(audioUrl, { signal: sig })
  if (!ar.ok) throw new Error(`TTS 音频下载失败 HTTP ${ar.status}`)
  const buf = Buffer.from(await ar.arrayBuffer())
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, buf)
  const d = await probe(outFile).catch(() => null)
  return { file: outFile, durationSec: d ? Math.round(d.duration * 100) / 100 : 0, cached: false, characters: j.usage?.characters }
}