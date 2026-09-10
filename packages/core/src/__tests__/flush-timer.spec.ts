import { FlushTimer } from '../utils/flush-timer'

describe('FlushTimer', () => {
  it('fires once, after the delay', async () => {
    const onFire = vi.fn()
    const timer = new FlushTimer(onFire)
    timer.arm(1000)

    await vi.advanceTimersByTimeAsync(999)
    expect(onFire).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onFire).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('releases the handle before firing, so the callback can arm again', async () => {
    const timer: FlushTimer = new FlushTimer(() => {
      pendingInsideCallback = timer.pending
    })
    let pendingInsideCallback: boolean | undefined
    timer.arm(1000)
    expect(timer.pending).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)
    expect(pendingInsideCallback).toBe(false)
    expect(timer.pending).toBe(false)
  })

  it('arm replaces a pending timer outright, in either direction', async () => {
    const onFire = vi.fn()
    const timer = new FlushTimer(onFire)
    timer.arm(10_000)
    timer.arm(1000)

    await vi.advanceTimersByTimeAsync(1000)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  // The reason the deadline lives next to the handle: every capture reaches the
  // arming path, and none of them may pull a flush in front of a longer wait.
  it('armNoEarlierThan does not shorten a pending timer', async () => {
    const onFire = vi.fn()
    const timer = new FlushTimer(onFire)
    timer.arm(10_000)
    timer.armNoEarlierThan(1000)

    await vi.advanceTimersByTimeAsync(9999)
    expect(onFire).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('armNoEarlierThan lengthens a pending timer', async () => {
    const onFire = vi.fn()
    const timer = new FlushTimer(onFire)
    timer.arm(1000)
    timer.armNoEarlierThan(10_000)

    await vi.advanceTimersByTimeAsync(1000)
    expect(onFire).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(9000)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('armNoEarlierThan counts down the remainder, not the whole delay', async () => {
    const onFire = vi.fn()
    const timer = new FlushTimer(onFire)
    timer.arm(10_000)
    await vi.advanceTimersByTimeAsync(6000)
    // 4s left, so a 4s request is not longer and must not restart the wait.
    timer.armNoEarlierThan(4000)

    await vi.advanceTimersByTimeAsync(4000)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('armNoEarlierThan arms when nothing is pending', async () => {
    const onFire = vi.fn()
    const timer = new FlushTimer(onFire)
    timer.armNoEarlierThan(1000)
    expect(timer.pending).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('clear stops a pending timer and is safe to repeat', async () => {
    const onFire = vi.fn()
    const timer = new FlushTimer(onFire)
    timer.arm(1000)
    timer.clear()
    timer.clear()
    expect(timer.pending).toBe(false)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(onFire).not.toHaveBeenCalled()
  })
})
