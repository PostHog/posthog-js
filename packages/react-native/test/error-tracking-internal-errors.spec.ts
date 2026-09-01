import { ErrorTracking } from '../src/error-tracking'

// Mock the utils to prevent actual global handler registration
vi.mock('../src/error-tracking/utils', () => ({
  trackUncaughtExceptions: vi.fn(),
  trackUnhandledRejections: vi.fn(),
  trackConsole: vi.fn(),
}))

vi.mock('../src/utils', () => ({
  isHermes: vi.fn(() => false),
  getRemoteConfigBool: vi.requireActual('../src/utils').getRemoteConfigBool,
}))

// Mock core's guard so handler tests can simulate "this is a network error" without
// spinning up a real PostHog to produce a genuine instance. The guard itself is
// verified against a real core instance in error-tracking-internal-errors.integration.spec.ts.
vi.mock('@posthog/core', () => ({
  ...vi.requireActual('@posthog/core'),
  isPostHogFetchNetworkError: vi.fn(),
}))

import { isPostHogFetchNetworkError } from '@posthog/core'
import { trackUncaughtExceptions, trackUnhandledRejections, trackConsole } from '../src/error-tracking/utils'
import { createMockLogger, createMockPostHog } from './test-utils'

const mockPostHog = createMockPostHog()
const mockLogger = createMockLogger()

describe('ErrorTracking filters PostHog internal network errors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(isPostHogFetchNetworkError as vi.Mock).mockReturnValue(false)
  })

  it('does not capture a network error from the uncaught exception handler', () => {
    ;(isPostHogFetchNetworkError as vi.Mock).mockReturnValue(true)
    new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
    const handler = (trackUncaughtExceptions as vi.Mock).mock.calls[0][0]

    handler(new Error('network'), false)

    expect(mockPostHog.captureException).not.toHaveBeenCalled()
  })

  it('does not capture a network error from the unhandled rejection handler', () => {
    ;(isPostHogFetchNetworkError as vi.Mock).mockReturnValue(true)
    new ErrorTracking(mockPostHog, { autocapture: { unhandledRejections: true } }, mockLogger as any)
    const handler = (trackUnhandledRejections as vi.Mock).mock.calls[0][0]

    handler(new Error('network'))

    expect(mockPostHog.captureException).not.toHaveBeenCalled()
  })

  it('still captures ordinary application errors from the uncaught exception handler', () => {
    new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
    const handler = (trackUncaughtExceptions as vi.Mock).mock.calls[0][0]

    handler(new Error('boom'), false)

    expect(mockPostHog.captureException).toHaveBeenCalledTimes(1)
  })

  it('tags a fatal uncaught exception with $exception_level so captureException flushes to disk', () => {
    new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
    const handler = (trackUncaughtExceptions as vi.Mock).mock.calls[0][0]

    handler(new Error('boom'), true)

    // captureException drains storage to disk when the exception is fatal, so
    // the handler must mark fatal crashes via $exception_level.
    const [, additionalProperties] = (mockPostHog.captureException as vi.Mock).mock.calls[0]
    expect(additionalProperties.$exception_level).toBe('fatal')
  })

  it('does not tag a non-fatal uncaught exception as fatal', () => {
    new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
    const handler = (trackUncaughtExceptions as vi.Mock).mock.calls[0][0]

    handler(new Error('boom'), false)

    const [, additionalProperties] = (mockPostHog.captureException as vi.Mock).mock.calls[0]
    expect(additionalProperties.$exception_level).toBeUndefined()
  })

  it('does not filter the console handler (console is left untouched)', () => {
    ;(isPostHogFetchNetworkError as vi.Mock).mockReturnValue(true)
    new ErrorTracking(mockPostHog, { autocapture: { console: ['error'] } }, mockLogger as any)
    const consoleHandler = (trackConsole as vi.Mock).mock.calls[0][1]

    consoleHandler(new Error('network'), false)

    expect(mockPostHog.captureException).toHaveBeenCalledTimes(1)
  })
})
