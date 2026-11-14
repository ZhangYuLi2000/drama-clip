import fs from 'fs'
import type { AsrSegment } from '../../src/shared/types'

const BASE = 'https://member.bilibili.com/x/bcut/rubick-interface'
const HEADERS = {
  'User-Agent': 'Bilibili/1.0.0 (https://www.bilibili.com)',
  'Content-Type': 'application/json',
  Referer: 'https://member.bilibili.com/',
  Origin: 'https://member.bilibili.com'
}

interface BcutResp<T> {
  code: number
  message?: string
  data?: T
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  })
  if (res.status === 412) throw new Error('bcut 风控拦截（412），请稍后重试')
  if (!res.ok) throw new Error(`bcut 接口 HTTP ${res.status}`)
  const json = (await res.json()) as BcutResp<T>
  if (json.code !== 0 || !json.data) throw new Error(`bcut 接口错误 ${json.code}：${json.message ?? '未知'}`)
  return json.data
}

interface CreateResp {
  in_boss_key: string
  resource_id: string
  upload_id: string
  upload_urls: string[]
  per_size: number
}

export async function transcribe(
  audioFile: string,
  onProgress: (pct: number) => void
): Promise<AsrSegment[]> {
  const buf = fs.readFileSync(audioFile)
  if (buf.length === 0) throw new Error('提取的音频为空')
  onProgress(10)

  const created = await post<CreateResp>(`${BASE}/resource/create`, {
    type: 2,
    name: 'audio.mp3',
    size: buf.length,
    ResourceFileType: 'mp3',
    model_id: '8'
  })
  const perSize = created.per_size > 0 ? created.per_size : buf.length
  const chunks = Math.ceil(buf.length / perSize)
  if (created.upload_urls.length < chunks) throw new Error('bcut 返回的上传分片数不足')

  const etags: string[] = []
  for (let i = 0; i < chunks; i++) {
    const part = buf.subarray(i * perSize, Math.min(buf.length, (i + 1) * perSize))
    const res = await fetch(created.upload_urls[i], {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(part),
      signal: AbortSignal.timeout(120_000)
    })
    if (!res.ok) throw new Error(`音频分片上传失败 HTTP ${res.status}`)
    etags.push((res.headers.get('etag') ?? '').replace(/"/g, ''))
    onProgress(10 + Math.round(((i + 1) / chunks) * 30))
  }

  const completed = await post<{ download_url: string }>(`${BASE}/resource/create/complete`, {
    InBossKey: created.in_boss_key,
    ResourceId: created.resource_id,
    Etags: etags.join(','),
    UploadId: created.upload_id,
    model_id: '8'
  })
  const task = await post<{ task_id: string }>(`${BASE}/task`, {
    resource: completed.download_url,
    model_id: '8'
  })
  onProgress(45)

  const startedAt = Date.now()
  const deadline = startedAt + 10 * 60_000
  let riskHits = 0
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000))
    if (Date.now() > deadline) throw new Error('bcut 转写超时（10 分钟）')
    const res = await fetch(
      `${BASE}/task/result?model_id=7&task_id=${encodeURIComponent(task.task_id)}`,
      { headers: HEADERS, signal: AbortSignal.timeout(30_000) }
    )
    if (res.status === 412) {
      // 412 是 B 站风控拦截，多为临时性：退避重试而不是直接失败
      riskHits++
      if (riskHits >= 3) throw new Error('bcut 风控拦截（412）：结果查询连续被拒，请几分钟后再重试')
      await new Promise((r) => setTimeout(r, 10_000))
      continue
    }
    riskHits = 0
    if (!res.ok) throw new Error(`bcut 结果查询 HTTP ${res.status}`)
    const json = (await res.json()) as BcutResp<{ state: number; result?: string }>
    if (json.code !== 0 || !json.data) throw new Error(`bcut 结果查询错误 ${json.code}`)
    const { state, result } = json.data
    if (state === 4) {
      const parsed = JSON.parse(result ?? '{}') as {
        utterances?: { start_time: number; end_time: number; transcript: string }[]
      }
      const segments = (parsed.utterances ?? [])
        .map((u) => ({ start: u.start_time / 1000, end: u.end_time / 1000, text: u.transcript.trim() }))
        .filter((s) => s.text.length > 0 && s.end > s.start)
        .sort((a, b) => a.start - b.start)
      onProgress(100)
      return segments
    }
    if (state !== 0 && state !== 1 && state !== 2) {
      throw new Error(`bcut 转写失败（状态 ${state}）`)
    }
    onProgress(Math.min(95, 45 + Math.floor((Date.now() - startedAt) / 3000)))
  }
}