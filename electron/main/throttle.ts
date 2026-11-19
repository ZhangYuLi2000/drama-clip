export interface Throttled {
  (): void
  flush: () => void
}

// 首次调用立即执行，窗口期内的后续调用合并为窗口结束时的一次执行
export function throttle(fn: () => void, waitMs: number): Throttled {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false
  const fire = (): void => {
    pending = false
    fn()
    timer = setTimeout(() => {
      timer = null
      if (pending) fire()
    }, waitMs)
  }
  const call = (): void => {
    if (timer) pending = true
    else fire()
  }
  call.flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (pending) {
      pending = false
      fn()
    }
  }
  return call
}

// 延迟合并写入：窗口期内的多次请求合并为一次写入；写入失败时保留待写状态并定时重试，
// flush 会同步补写尚未成功落盘的内容
export function deferredWriter(
  write: () => void,
  waitMs: number,
  retryMs: number,
  onError: (err: unknown) => void
): Throttled {
  let timer: ReturnType<typeof setTimeout> | null = null
  let dirty = false
  const attempt = (): boolean => {
    try {
      write()
      dirty = false
      return true
    } catch (err) {
      onError(err)
      return false
    }
  }
  const arm = (ms: number): void => {
    timer = setTimeout(() => {
      timer = null
      if (dirty && !attempt()) arm(retryMs)
    }, ms)
  }
  const call = (): void => {
    dirty = true
    if (!timer) arm(waitMs)
  }
  call.flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (dirty) attempt()
  }
  return call
}
