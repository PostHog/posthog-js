import { PostHog } from '../src'
import { isPostHogFetchNetworkError } from '@posthog/core'

// Proves the exported instanceof guard recognizes a genuine PostHogFetchNetworkError
// produced by core's real fetch path.
describe('isPostHogFetchNetworkError recognizes real core errors', () => {
  const originalFetch = (globalThis as any).window.fetch

  beforeAll(() => {
    // The SDK flush/shutdown lifecycle is timer-driven; the suite's global fake timers
    // would deadlock awaited async operations, so use real timers here.
    jest.useRealTimers()
  })

  afterAll(() => {
    ;(globalThis as any).window.fetch = originalFetch
    jest.useFakeTimers()
  })

  it('returns true for the error core throws when fetch fails', async () => {
    ;(globalThis as any).window.fetch = jest.fn(() => {
      throw new Error('offline')
    })

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      const posthog = new PostHog('test-token', {
        persistence: 'memory',
        flushInterval: 0,
        fetchRetryCount: 0,
      })
      await posthog.ready()
      posthog.capture('event')

      let caught: unknown
      try {
        await posthog.flush()
      } catch (err) {
        caught = err
      }
      await posthog.shutdown()

      expect(caught).toBeDefined()
      expect(isPostHogFetchNetworkError(caught)).toBe(true)
      // ordinary errors must not be mistaken for network errors
      expect(isPostHogFetchNetworkError(new Error('boom'))).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error while flushing PostHog',
        expect.objectContaining({ name: 'PostHogFetchNetworkError' })
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  }, 15000)
})
