/** 计算 worker 池：主进程 IO + worker 数值计算的调度层。 */
import { Worker } from 'node:worker_threads'

interface Task {
  kind: string
  payload: Record<string, unknown>
  transfer: ArrayBuffer[]
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

interface Slot {
  worker: Worker
  busy: boolean
  taskId: number
}

export class ComputePool {
  private slots: Slot[] = []
  private queue: Task[] = []
  private nextId = 1
  private pending = new Map<number, Task>()
  private destroyed = false

  constructor(workerScript: string, size: number) {
    for (let i = 0; i < Math.max(1, size); i++) {
      const worker = new Worker(workerScript)
      const slot: Slot = { worker, busy: false, taskId: -1 }
      worker.on('message', (msg: { id: number; ok: boolean; result?: unknown; error?: string }) => {
        const task = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        slot.busy = false
        slot.taskId = -1
        if (task) {
          if (msg.ok) task.resolve(msg.result)
          else task.reject(new Error(msg.error ?? 'worker 计算失败'))
        }
        this.dispatch()
      })
      worker.on('error', (e) => {
        const task = this.pending.get(slot.taskId)
        this.pending.delete(slot.taskId)
        slot.busy = false
        if (task) task.reject(e instanceof Error ? e : new Error(String(e)))
      })
      this.slots.push(slot)
    }
  }

  get size(): number {
    return this.slots.length
  }

  run<T>(kind: string, payload: Record<string, unknown>, transfer: ArrayBuffer[] = []): Promise<T> {
    if (this.destroyed) return Promise.reject(new Error('计算池已关闭'))
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ kind, payload, transfer, resolve: resolve as (v: unknown) => void, reject })
      this.dispatch()
    })
  }

  private dispatch(): void {
    while (this.queue.length > 0) {
      const slot = this.slots.find((s) => !s.busy)
      if (!slot) return
      const task = this.queue.shift()!
      const id = this.nextId++
      slot.busy = true
      slot.taskId = id
      this.pending.set(id, task)
      slot.worker.postMessage({ id, kind: task.kind, payload: task.payload }, task.transfer)
    }
  }

  destroy(): void {
    this.destroyed = true
    for (const t of this.queue.splice(0)) t.reject(new Error('已取消'))
    for (const [, t] of this.pending) t.reject(new Error('已取消'))
    this.pending.clear()
    for (const s of this.slots) void s.worker.terminate()
    this.slots = []
  }
}
