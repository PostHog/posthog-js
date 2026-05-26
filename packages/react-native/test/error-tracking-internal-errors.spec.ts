import { ErrorTracking } from '../src/error-tracking'

// Mock the utils to prevent actual global handler registration
jest.mock('../src/error-tracking/utils', () => ({
  trackUncaughtExceptions: jest.fn(),
  trackUnhandledRejections: jest.fn(),
  trackConsole: jest.fn(),
}))

jest.mock('../src/utils', () => ({
  isHermes: jest.fn(() => false),
  getRemoteConfigBool: jest.requireActual('../src/utils').getRemoteConfigBool,
}))

// Mock core's guard so handler tests can simulate "this is a network error" without
// spinning up a real PostHog to produce a genuine instance. The guard itself is
// verified against a real core instance in error-tracking-internal-errors.integration.spec.ts.
jest.mock('@posthog/core', () => ({
  ...jest.requireActual('@posthog/core'),
  isPostHogFetchNetworkError: jest.fn(),
}))

import { isPostHogFetchNetworkError } from '@posthog/core'
import { trackUncaughtExceptions, trackUnhandledRejections, trackConsole } from '../src/error-tracking/utils'
import { createMockLogger, createMockPostHog } from './test-utils'

const mockPostHog = createMockPostHog()
const mockLogger = createMockLogger()

describe('ErrorTracking filters PostHog internal network errors', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(isPostHogFetchNetworkError as jest.Mock).mockReturnValue(false)
  })

  it('does not capture a network error from the uncaught exception handler', () => {
    ;(isPostHogFetchNetworkError as jest.Mock).mockReturnValue(true)
    new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
    const handler = (trackUncaughtExceptions as jest.Mock).mock.calls[0][0]

    handler(new Error('network'), false)

    expect(mockPostHog.capture).not.toHaveBeenCalled()
  })

  it('does not capture a network error from the unhandled rejection handler', () => {
    ;(isPostHogFetchNetworkError as jest.Mock).mockReturnValue(true)
    new ErrorTracking(mockPostHog, { autocapture: { unhandledRejections: true } }, mockLogger as any)
    const handler = (trackUnhandledRejections as jest.Mock).mock.calls[0][0]

    handler(new Error('network'))

    expect(mockPostHog.capture).not.toHaveBeenCalled()
  })

  it('still captures ordinary application errors from the uncaught exception handler', () => {
    new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
    const handler = (trackUncaughtExceptions as jest.Mock).mock.calls[0][0]

    handler(new Error('boom'), false)

    expect(mockPostHog.capture).toHaveBeenCalledTimes(1)
  })

  it('does not filter the console handler (console is left untouched)', () => {
    ;(isPostHogFetchNetworkError as jest.Mock).mockReturnValue(true)
    new ErrorTracking(mockPostHog, { autocapture: { console: ['error'] } }, mockLogger as any)
    const consoleHandler = (trackConsole as jest.Mock).mock.calls[0][1]

    consoleHandler(new Error('network'), false)

    expect(mockPostHog.capture).toHaveBeenCalledTimes(1)
  })
})
