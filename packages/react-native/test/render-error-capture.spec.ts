import { trackUncaughtExceptions } from '../src/error-tracking/utils'
import { ErrorTracking } from '../src/error-tracking'
import { createMockLogger, createMockPostHog } from './test-utils'

type Handler = (error: unknown, isFatal?: boolean) => void
type ExceptionsManager = { handleException?: (error: unknown, isFatal: boolean) => void }

const holder = vi.hoisted(() => ({ exceptionsManager: undefined as ExceptionsManager | undefined }))

vi.mock('../src/optional/OptionalReactNativeExceptionsManager', () => ({
  get OptionalReactNativeExceptionsManager() {
    return holder.exceptionsManager
  },
}))

describe('React render error capture through ExceptionsManager.handleException', () => {
  let handleException: ReturnType<typeof vi.fn>
  let exceptionsManager: { handleException: (error: unknown, isFatal: boolean) => void }
  let current: Handler
  let previous: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    handleException = vi.fn()
    exceptionsManager = { handleException }
    holder.exceptionsManager = exceptionsManager
    // React Native's default global handler reports through ExceptionsManager.
    previous = vi.fn((error: unknown, isFatal?: boolean) => exceptionsManager.handleException(error, !!isFatal))
    current = previous
    vi.stubGlobal('ErrorUtils', {
      getGlobalHandler: () => current,
      setGlobalHandler: (handler: Handler) => {
        current = handler
      },
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.unstubAllGlobals()
  })

  it('captures a fatal render error once and reports it to React Native after persistence', async () => {
    let persist!: () => void
    const tracker = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          persist = resolve
        })
    )
    trackUncaughtExceptions(tracker)
    const error = new Error('render crash')

    exceptionsManager.handleException(error, true)

    expect(tracker.mock.calls).toEqual([[error, true]])
    expect(handleException).not.toHaveBeenCalled()
    persist()
    await vi.advanceTimersByTimeAsync(0)
    expect(handleException.mock.calls).toEqual([[error, true]])
  })

  it('passes errors caught by an error boundary straight through without capturing them', () => {
    const tracker = vi.fn()
    trackUncaughtExceptions(tracker)
    const error = new Error('caught by boundary')

    exceptionsManager.handleException(error, false)

    expect(tracker).not.toHaveBeenCalled()
    expect(handleException.mock.calls).toEqual([[error, false]])
  })

  it('captures an ErrorUtils fatal once when the default handler reports it through ExceptionsManager', async () => {
    const tracker = vi.fn(() => Promise.resolve())
    trackUncaughtExceptions(tracker)
    const error = new Error('handler crash')

    current(error, true)
    await vi.advanceTimersByTimeAsync(0)

    expect(tracker.mock.calls).toEqual([[error, true]])
    expect(previous).toHaveBeenCalledTimes(1)
    expect(handleException.mock.calls).toEqual([[error, true]])
  })

  it('restores the original handleException after the last subscriber is removed', () => {
    const remove = trackUncaughtExceptions(vi.fn())
    expect(exceptionsManager.handleException).not.toBe(handleException)
    remove()
    expect(exceptionsManager.handleException).toBe(handleException)
  })

  it.each([
    ['missing', () => undefined],
    ['without handleException', () => ({})],
    [
      'not writable',
      () =>
        Object.defineProperty({}, 'handleException', {
          get: () => vi.fn(),
          set: () => {
            throw new Error('read-only')
          },
        }),
    ],
  ])('keeps ErrorUtils capture working when ExceptionsManager is %s', (_, create) => {
    holder.exceptionsManager = create() as ExceptionsManager | undefined
    const tracker = vi.fn()
    let remove!: () => void
    expect(() => {
      remove = trackUncaughtExceptions(tracker)
    }).not.toThrow()
    const error = new Error('handler crash')
    current(error, true)
    expect(tracker.mock.calls).toEqual([[error, true]])
    expect(() => remove()).not.toThrow()
  })

  it('routes a fatal render error through the fatal capture path', async () => {
    const posthog = createMockPostHog()
    const errorTracking = new ErrorTracking(posthog, { autocapture: { uncaughtExceptions: true } }, createMockLogger())
    const error = new Error('render crash')

    exceptionsManager.handleException(error, true)
    await vi.advanceTimersByTimeAsync(0)

    expect(posthog.captureException.mock.calls).toEqual([
      [error, { $exception_level: 'fatal' }, { mechanism: { type: 'onuncaughtexception', handled: false } }],
    ])
    expect(handleException.mock.calls).toEqual([[error, true]])
    errorTracking.shutdown()
  })

  it('leaves handleException untouched when uncaught exception autocapture is off', () => {
    const posthog = createMockPostHog()
    new ErrorTracking(posthog, { autocapture: { uncaughtExceptions: false } }, createMockLogger())

    expect(exceptionsManager.handleException).toBe(handleException)
    exceptionsManager.handleException(new Error('render crash'), true)
    expect(posthog.captureException).not.toHaveBeenCalled()
  })
})
