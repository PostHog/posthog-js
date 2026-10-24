import { resolveCaptureSettings } from '@/capture-lane/settings'
import type { PostHogOptions } from '@/entrypoints/index.node'

import { ANALYTICS_CAPTURE_PATH } from '../utils'
import { V1WiringHarness } from '../utils/v1-wiring'

vi.mock('../../version', () => ({ version: '1.2.3' }))

function resolve(options: PostHogOptions): { settings: ReturnType<typeof resolveCaptureSettings>; logged: string[] } {
  const logged: string[] = []
  const settings = resolveCaptureSettings(options, (message) => logged.push(message))
  return { settings, logged }
}

describe('resolveCaptureSettings', () => {
  describe('maxRetries', () => {
    it.each<[string, PostHogOptions, number]>([
      ['the default', {}, 3],
      ['fetchRetryCount when captureMaxRetries is unset', { fetchRetryCount: 5 }, 5],
      ['fetchRetryCount 0 as no retries', { fetchRetryCount: 0 }, 0],
      ['fetchRetryCount above 9 clamped to 9', { fetchRetryCount: 20 }, 9],
      ['fetchRetryCount below 0 clamped to 0', { fetchRetryCount: -1 }, 0],
      ['captureMaxRetries over fetchRetryCount', { captureMaxRetries: 1, fetchRetryCount: 0 }, 1],
      ['captureMaxRetries 0 over fetchRetryCount', { captureMaxRetries: 0, fetchRetryCount: 5 }, 0],
      ['captureMaxRetries at its maximum', { captureMaxRetries: 9 }, 9],
    ])('uses %s', (_label, options, expected) => {
      const { settings, logged } = resolve(options)

      expect(settings.maxRetries).toBe(expected)
      expect(logged).toEqual([])
    })

    it.each<[unknown]>([[-1], [10], [1.5], ['3'], [Number.NaN]])(
      'logs one error for captureMaxRetries %s and falls back as if it were unset',
      (captureMaxRetries) => {
        const withFallback = resolve({ captureMaxRetries: captureMaxRetries as number, fetchRetryCount: 1 })
        const withDefault = resolve({ captureMaxRetries: captureMaxRetries as number })

        expect(withFallback.settings.maxRetries).toBe(1)
        expect(withDefault.settings.maxRetries).toBe(3)
        expect(withFallback.logged).toEqual(['captureMaxRetries must be an integer from 0 to 9; using the default.'])
      }
    )
  })
})

describe('capture settings on the client', () => {
  const harness = new V1WiringHarness()
  const unavailable = (): any => ({ status: 503, text: () => Promise.resolve(''), headers: { get: () => null } })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    harness.fetch.mockImplementation(() => Promise.resolve(unavailable()))
  })

  afterEach(async () => {
    harness.useDefaultRouting()
    await harness.cleanup()
    vi.clearAllMocks()
  })

  async function attemptsFor(options: PostHogOptions): Promise<number> {
    const posthog = harness.makeClient(options)
    posthog.capture({ distinctId: 'u', event: 'e', properties: {} })
    const flush = posthog.flush()
    // Longer than the longest three retry waits (125 + 250 + 500 ms).
    await vi.advanceTimersByTimeAsync(1000)
    await flush
    return harness.callsTo(ANALYTICS_CAPTURE_PATH).length
  }

  it.each<[string, PostHogOptions, number]>([
    ['3 retries by default', { fetchRetryCount: undefined }, 4],
    ['no retries with fetchRetryCount 0', { fetchRetryCount: 0 }, 1],
    ['captureMaxRetries over fetchRetryCount', { fetchRetryCount: 0, captureMaxRetries: 2 }, 3],
  ])('makes %s', async (_label, options, expected) => {
    expect(await attemptsFor(options)).toBe(expected)
  })

  it('logs one error for an invalid captureMaxRetries and does not throw', async () => {
    expect(await attemptsFor({ fetchRetryCount: undefined, captureMaxRetries: 42 })).toBe(4)
    expect(console.error).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledWith(
      '[PostHog] captureMaxRetries must be an integer from 0 to 9; using the default.'
    )
  })
})
