// 节流/合并工具的单元测试：node scripts/test-throttle.mts
import assert from 'node:assert/strict'
import { deferredWriter, throttle } from '../electron/main/throttle.ts'

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
  const w = deferredWriter(() => void n++, 40, 40, () => assert.fail('不应失败'))
  for (let i = 0; i < 20; i++) w()
  assert.equal(n, 0, 'deferredWriter 不立即写入')
  await sleep(70)
  assert.equal(n, 1, 'deferredWriter 窗口结束写入一次')
  w.flush()
  assert.equal(n, 1, 'deferredWriter 无待写内容时 flush 不写入')
  w()
  w.flush()
  assert.equal(n, 2, 'deferredWriter flush 立即写入待写内容')
  await sleep(70)
  assert.equal(n, 2, 'deferredWriter flush 后不残留定时器')
}

{
  // 写入失败后不再有新的保存请求，存储恢复后 flush 仍要把内容写下去
  let broken = true
  let written = 0
  let errors = 0
  const w = deferredWriter(
    () => {
      if (broken) throw new Error('ENOSPC')
      written++
    },
    20,
    10_000,
    () => errors++
  )
  w()
  await sleep(50)
  assert.equal(written, 0)
  assert.equal(errors, 1, 'deferredWriter 写入失败时回调 onError')
  broken = false
  w.flush()
  assert.equal(written, 1, 'deferredWriter 失败后 flush 补写')
}

{
  // 写入失败后按 retryMs 自动重试，直到成功
  let broken = true
  let written = 0
  const w = deferredWriter(
    () => {
      if (broken) throw new Error('ENOSPC')
      written++
    },
    20,
    20,
    () => {}
  )
  w()
  await sleep(50)
  assert.equal(written, 0)
  broken = false
  await sleep(50)
  assert.equal(written, 1, 'deferredWriter 存储恢复后自动重试成功')
  await sleep(50)
  assert.equal(written, 1, 'deferredWriter 成功后停止重试')
}

console.log('throttle: all passed')
