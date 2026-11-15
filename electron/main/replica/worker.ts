/** 复刻引擎计算 worker 入口（纯 Node，无 Electron API）。
 *
 * 主进程负责 FFmpeg IO，worker 只做数值计算；缓冲用 Transferable 零拷贝。
 * dev 态由 Node 原生 TS 直跑，打包态由 electron-vite 多入口构建为 replica-worker.js。
 */
import { parentPort } from 'node:worker_threads'
import { describe, describeVariants, topk, prepareVerify } from './fingerprint.ts'
import type { FlipVariant } from './fingerprint.ts'
import type { Band } from './types.ts'

interface Req {
  id: number
  kind: string
  payload: Record<string, unknown>
}

const port = parentPort
if (!port) throw new Error('replica worker 必须在 worker_threads 中运行')

port.on('message', (req: Req) => {
  try {
    const p = req.payload
    let result: Record<string, unknown>
    const transfer: ArrayBuffer[] = []
    switch (req.kind) {
      case 'describe': {
        const desc = describe(new Uint8Array(p.data as ArrayBuffer), p.n as number, p.h as number, p.w as number)
        result = { desc }
        transfer.push(desc.buffer as ArrayBuffer)
        break
      }
      case 'describeVariants': {
        const desc = describeVariants(
          new Uint8Array(p.data as ArrayBuffer), p.n as number, p.h as number, p.w as number,
          (p.variants as FlipVariant[] | undefined) ?? undefined
        )
        result = { desc }
        transfer.push(desc.buffer as ArrayBuffer)
        break
      }
      case 'topk': {
        const r = topk(
          new Float32Array(p.qdesc as ArrayBuffer), p.nq as number,
          new Float32Array(p.rdesc as ArrayBuffer), p.nr as number, p.nf as number,
          new Float32Array(p.weights as ArrayBuffer), p.k as number, (p.chunk as number | undefined) ?? 256
        )
        result = { d: r.d, r: r.r, f: r.f, kk: r.kk }
        transfer.push(r.d.buffer as ArrayBuffer, r.r.buffer as ArrayBuffer, r.f.buffer as ArrayBuffer)
        break
      }
      case 'prepareVerify': {
        const v = prepareVerify(
          new Uint8Array(p.data as ArrayBuffer), p.n as number, p.h as number, p.w as number,
          (p.maskBottom as number | undefined) ?? 0.25, (p.maskTop as number | undefined) ?? 0,
          (p.highpass as boolean | undefined) ?? true, (p.band as Band | null | undefined) ?? null,
          (p.pool as number | undefined) ?? 1
        )
        result = { v: v.v, n: v.n, m: v.m }
        transfer.push(v.v.buffer as ArrayBuffer)
        break
      }
      default:
        throw new Error(`未知计算任务：${req.kind}`)
    }
    port.postMessage({ id: req.id, ok: true, result }, transfer)
  } catch (e) {
    port.postMessage({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
})
