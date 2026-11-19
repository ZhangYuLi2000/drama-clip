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

// 窗口期内的多次调用只在窗口结束时执行一次（不因后续调用而顺延）
export function debounceFixed(fn: () => void, waitMs: number): Throttled {
  let timer: ReturnType<typeof setTimeout> | null = null
  const call = (): void => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      fn()
    }, waitMs)
  }
  call.flush = (): void => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
    fn()
  }
  return call
}
