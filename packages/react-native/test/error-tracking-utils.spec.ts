import { trackUncaughtExceptions } from '../src/error-tracking/utils'
import { ErrorTracking } from '../src/error-tracking'
import { createMockLogger, createMockPostHog } from './test-utils'

type Handler = (error: Error, isFatal?: boolean) => void

describe('uncaught exception subscriptions', () => {
  let previous: ReturnType<typeof vi.fn>
  let current: Handler
  let errorUtils: { getGlobalHandler: () => Handler; setGlobalHandler: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.useFakeTimers()
    previous = vi.fn()
    current = previous
    errorUtils = {
      getGlobalHandler: () => current,
      setGlobalHandler: vi.fn((handler: Handler) => {
        current = handler
      }),
    }
    vi.stubGlobal('ErrorUtils', errorUtils)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.unstubAllGlobals()
  })

  it('always calls the previous handler even when a subscriber throws', () => {
    const error = new Error('app failed')
    trackUncaughtExceptions(() => {
      throw new Error('capture failed')
    })
    expect(() => current(error, true)).not.toThrow()
    expect(previous.mock.calls).toEqual([[error, true]])
  })

  it('preserves the previous handler error', () => {
    const previousError = new Error('native fatal handler')
    previous.mockImplementation(() => {
      throw previousError
    })
    trackUncaughtExceptions(vi.fn())
    expect(() => current(new Error('app failed'), true)).toThrow(previousError)
  })

  it('normalizes missing fatal flags only for subscribers', () => {
    const tracker = vi.fn()
    const error = new Error('app failed')
    trackUncaughtExceptions(tracker)
    current(error)
    expect(tracker).toHaveBeenCalledWith(error, false)
    expect(previous).toHaveBeenCalledWith(error, undefined)
  })

  it('uses one wrapper for multiple subscribers and isolates their failures', () => {
    const first = vi.fn(() => {
      throw new Error('first reporter failed')
    })
    const second = vi.fn()
    trackUncaughtExceptions(first)
    const wrapper = current
    trackUncaughtExceptions(second)
    expect(current).toBe(wrapper)
    expect(errorUtils.setGlobalHandler).toHaveBeenCalledTimes(1)
    const error = new Error('app failed')
    expect(() => current(error, true)).not.toThrow()
    expect(first.mock.calls).toEqual([[error, true]])
    expect(second.mock.calls).toEqual([[error, true]])
    expect(previous.mock.calls).toEqual([[error, true]])
  })

  it('does not capture twice when the same tracker is registered again', () => {
    const tracker = vi.fn()
    trackUncaughtExceptions(tracker)
    trackUncaughtExceptions(tracker)
    current(new Error('app failed'), false)
    expect(tracker).toHaveBeenCalledTimes(1)
    expect(previous).toHaveBeenCalledTimes(1)
    expect(errorUtils.setGlobalHandler).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes independently and restores the previous handler after the last subscriber', () => {
    const first = vi.fn()
    const second = vi.fn()
    const removeFirst = trackUncaughtExceptions(first)
    const removeSecond = trackUncaughtExceptions(second)
    removeFirst()
    removeFirst()
    current(new Error('app failed'), false)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    removeSecond()
    expect(current).toBe(previous)
    const third = vi.fn()
    const removeThird = trackUncaughtExceptions(third)
    current(new Error('next error'), false)
    expect(third).toHaveBeenCalledTimes(1)
    removeThird()
    expect(current).toBe(previous)
  })

  it('does not overwrite another SDK handler on unsubscribe or wrap it again on resubscribe', () => {
    const remove = trackUncaughtExceptions(vi.fn())
    const wrapper = current
    const otherSdk = vi.fn((error: Error, isFatal?: boolean) => wrapper(error, isFatal))
    errorUtils.setGlobalHandler(otherSdk)
    remove()
    expect(current).toBe(otherSdk)
    const tracker = vi.fn()
    const removeNext = trackUncaughtExceptions(tracker)
    expect(current).toBe(otherSdk)
    current(new Error('app failed'), true)
    expect(tracker).toHaveBeenCalledTimes(1)
    expect(otherSdk).toHaveBeenCalledTimes(1)
    expect(previous).toHaveBeenCalledTimes(1)
    removeNext()
  })

  it('removes only the shutting-down ErrorTracking instance', () => {
    const firstClient = createMockPostHog()
    const secondClient = createMockPostHog()
    const options = { autocapture: { uncaughtExceptions: true } }
    const first = new ErrorTracking(firstClient, options, createMockLogger() as any)
    const second = new ErrorTracking(secondClient, options, createMockLogger() as any)
    first.shutdown()
    current(new Error('app failed'), false)
    expect(firstClient.captureException).not.toHaveBeenCalled()
    expect(secondClient.captureException).toHaveBeenCalledTimes(1)
    second.shutdown()
    expect(current).toBe(previous)
  })

  it('waits for fatal persistence before forwarding and clears its deadline', async () => {
    let persist!: () => void
    trackUncaughtExceptions(
      () =>
        new Promise<void>((resolve) => {
          persist = resolve
        })
    )
    const error = new Error('fatal')
    current(error, true)
    expect(previous).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(previous).not.toHaveBeenCalled()
    persist()
    await vi.advanceTimersByTimeAsync(0)
    expect(previous.mock.calls).toEqual([[error, true]])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds all subscribers by one two-second deadline and never forwards twice', async () => {
    let persist!: () => void
    trackUncaughtExceptions(
      () =>
        new Promise<void>((resolve) => {
          persist = resolve
        })
    )
    trackUncaughtExceptions(() => new Promise<void>(() => {}))
    const error = new Error('fatal')
    current(error, true)
    await vi.advanceTimersByTimeAsync(1999)
    expect(previous).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(previous.mock.calls).toEqual([[error, true]])
    persist()
    await vi.advanceTimersByTimeAsync(10000)
    expect(previous).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not let a rejected subscriber skip another instance's persistence", async () => {
    let persist!: () => void
    trackUncaughtExceptions(() => Promise.reject(new Error('storage failed')))
    trackUncaughtExceptions(
      () =>
        new Promise<void>((resolve) => {
          persist = resolve
        })
    )
    current(new Error('fatal'), true)
    await vi.advanceTimersByTimeAsync(100)
    expect(previous).not.toHaveBeenCalled()
    persist()
    await vi.advanceTimersByTimeAsync(0)
    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('forwards promptly after rejected persistence without an unhandled rejection', async () => {
    trackUncaughtExceptions(() => Promise.reject(new Error('storage failed')))
    current(new Error('fatal'), true)
    await vi.advanceTimersByTimeAsync(0)
    expect(previous).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('forwards non-fatal errors synchronously even if a subscriber returns a rejected promise', async () => {
    trackUncaughtExceptions(() => Promise.reject(new Error('storage failed')))
    const error = new Error('non-fatal')
    current(error, false)
    expect(previous.mock.calls).toEqual([[error, false]])
    await vi.advanceTimersByTimeAsync(0)
    expect(previous).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves errors thrown by the previous handler after async persistence', async () => {
    const previousError = new Error('native handler failed')
    previous.mockImplementation(() => {
      throw previousError
    })
    trackUncaughtExceptions(() => Promise.resolve())
    current(new Error('fatal'), true)
    await expect(vi.advanceTimersByTimeAsync(0)).rejects.toBe(previousError)
    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('reports missing ErrorUtils without preventing a later installation', () => {
    vi.stubGlobal('ErrorUtils', undefined)
    expect(() => trackUncaughtExceptions(vi.fn())).toThrow('ErrorUtils globalHandlers are not defined')
    vi.stubGlobal('ErrorUtils', errorUtils)
    const tracker = vi.fn()
    trackUncaughtExceptions(tracker)
    current(new Error('app failed'), false)
    expect(tracker).toHaveBeenCalledTimes(1)
  })
})
