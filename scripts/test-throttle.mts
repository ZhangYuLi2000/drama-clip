// 节流/合并工具的单元测试：node scripts/test-throttle.mts
import assert from 'node:assert/strict'
import { debounceFixed, throttle } from '../electron/main/throttle.ts'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

{
  let n = 0
  const t = throttle(() => n++, 40)
  t()
  assert.equal(n, 1, 'throttle 首次调用立即执行')
  for (let i = 0; i < 20; i++) t()
  assert.equal(n, 1, 'throttle 窗口期内不重复执行')
  await sleep(70)
  assert.equal(n, 2, 'throttle 窗口结束后补发一次')
  await sleep(70)
  assert.equal(n, 2, 'throttle 没有新调用时不再执行')
  t()
  t()
  t.flush()
  assert.equal(n, 4, 'throttle flush 立即补发挂起的调用')
  await sleep(70)
  assert.equal(n, 4, 'throttle flush 后不残留定时器')
}

{
  let n = 0
  const d = debounceFixed(() => n++, 40)
  for (let i = 0; i < 20; i++) d()
  assert.equal(n, 0, 'debounceFixed 不立即执行')
  await sleep(70)
  assert.equal(n, 1, 'debounceFixed 窗口结束执行一次')
  d.flush()
  assert.equal(n, 1, 'debounceFixed 无挂起时 flush 不执行')
  d()
  d.flush()
  assert.equal(n, 2, 'debounceFixed flush 立即执行挂起的调用')
  await sleep(70)
  assert.equal(n, 2, 'debounceFixed flush 后不残留定时器')
}

console.log('throttle: all passed')
