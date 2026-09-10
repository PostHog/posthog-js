import { trackUncaughtExceptions } from '../src/error-tracking/utils'
import { ErrorTracking } from '../src/error-tracking'
import { createMockLogger, createMockPostHog } from './test-utils'

type Handler = (error: Error, isFatal?: boolean) => void

describe('uncaught exception subscriptions', () => {
  let previous: ReturnType<typeof vi.fn>
  let current: Handler
  let errorUtils: { getGlobalHandler: () => Handler; setGlobalHandler: ReturnType<typeof vi.fn> }

  beforeEach(() => {
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

  it('preserves another SDK handler and captures once through a fresh subscription', () => {
    const oldTracker = vi.fn()
    const remove = trackUncaughtExceptions(oldTracker)
    const wrapper = current
    const otherSdk = vi.fn((error: Error, isFatal?: boolean) => wrapper(error, isFatal))
    errorUtils.setGlobalHandler(otherSdk)
    remove()
    expect(current).toBe(otherSdk)
    const tracker = vi.fn()
    const removeNext = trackUncaughtExceptions(tracker)
    expect(current).not.toBe(otherSdk)
    current(new Error('app failed'), true)
    expect(oldTracker).not.toHaveBeenCalled()
    expect(tracker).toHaveBeenCalledTimes(1)
    expect(otherSdk).toHaveBeenCalledTimes(1)
    expect(previous).toHaveBeenCalledTimes(1)
    removeNext()
    expect(current).toBe(otherSdk)
  })

  it('reinstalls capture after another SDK detaches an unsubscribed wrapper', () => {
    const oldTracker = vi.fn()
    const remove = trackUncaughtExceptions(oldTracker)
    const wrapper = current
    const otherSdk = vi.fn((error: Error, isFatal?: boolean) => wrapper(error, isFatal))
    errorUtils.setGlobalHandler(otherSdk)
    remove()
    expect(current).toBe(otherSdk)
    errorUtils.setGlobalHandler(previous)

    const tracker = vi.fn()
    const removeNext = trackUncaughtExceptions(tracker)
    const error = new Error('app failed')
    current(error, true)
    expect(tracker.mock.calls).toEqual([[error, true]])
    expect(oldTracker).not.toHaveBeenCalled()
    expect(otherSdk).not.toHaveBeenCalled()
    expect(previous.mock.calls).toEqual([[error, true]])
    removeNext()
    expect(current).toBe(previous)
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
