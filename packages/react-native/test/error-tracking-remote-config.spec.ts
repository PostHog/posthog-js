import { ErrorTracking } from '../src/error-tracking'

// Mock the utils to prevent actual global handler registration
vi.mock('../src/error-tracking/utils', () => ({
  trackUncaughtExceptions: vi.fn(),
  trackUnhandledRejections: vi.fn(),
  trackConsole: vi.fn(),
}))

vi.mock('../src/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils')>()
  return {
    ...actual,
    isHermes: vi.fn(() => false),
  }
})

import { trackUncaughtExceptions, trackUnhandledRejections, trackConsole } from '../src/error-tracking/utils'
import { createMockLogger, createMockPostHog } from './test-utils'

const mockPostHog = createMockPostHog()
const mockLogger = createMockLogger()

describe('ErrorTracking remote config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('onRemoteConfig', () => {
    it('does not change state when errorTracking is undefined', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)

      // Get reference to the uncaught exception handler
      const handler = (trackUncaughtExceptions as vi.Mock).mock.calls[0][0]

      // Should capture before remote config
      handler(new Error('test'), false)
      expect(mockPostHog.captureException).toHaveBeenCalledTimes(1)

      mockPostHog.captureException.mockClear()

      // undefined should not change anything
      et.onRemoteConfig(undefined)
      handler(new Error('test2'), false)
      expect(mockPostHog.captureException).toHaveBeenCalledTimes(1)
    })

    it('does not change state when errorTracking is null', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
      const handler = (trackUncaughtExceptions as vi.Mock).mock.calls[0][0]

      et.onRemoteConfig(null as any)
      handler(new Error('test'), false)
      expect(mockPostHog.captureException).toHaveBeenCalledTimes(1)
    })

    it('disables autocapture when errorTracking is false', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
      const handler = (trackUncaughtExceptions as vi.Mock).mock.calls[0][0]

      et.onRemoteConfig(false)
      handler(new Error('test'), false)
      expect(mockPostHog.captureException).not.toHaveBeenCalled()
    })

    it('enables autocapture when errorTracking is true', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
      const handler = (trackUncaughtExceptions as vi.Mock).mock.calls[0][0]

      // First disable
      et.onRemoteConfig(false)
      handler(new Error('test'), false)
      expect(mockPostHog.captureException).not.toHaveBeenCalled()

      // Then re-enable
      et.onRemoteConfig(true)
      handler(new Error('test2'), false)
      expect(mockPostHog.captureException).toHaveBeenCalledTimes(1)
    })

    it('enables autocapture when errorTracking map has autocaptureExceptions=true', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
      const handler = (trackUncaughtExceptions as vi.Mock).mock.calls[0][0]

      et.onRemoteConfig({ autocaptureExceptions: true })
      handler(new Error('test'), false)
      expect(mockPostHog.captureException).toHaveBeenCalledTimes(1)
    })

    it('disables autocapture when errorTracking map has autocaptureExceptions=false', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
      const handler = (trackUncaughtExceptions as vi.Mock).mock.calls[0][0]

      et.onRemoteConfig({ autocaptureExceptions: false })
      handler(new Error('test'), false)
      expect(mockPostHog.captureException).not.toHaveBeenCalled()
    })

    it('disables autocapture when errorTracking map is missing autocaptureExceptions key', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
      const handler = (trackUncaughtExceptions as vi.Mock).mock.calls[0][0]

      et.onRemoteConfig({ otherKey: 'value' })
      handler(new Error('test'), false)
      expect(mockPostHog.captureException).not.toHaveBeenCalled()
    })

    it('gates unhandled rejection handler on remote config', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: { unhandledRejections: true } }, mockLogger as any)
      const handler = (trackUnhandledRejections as vi.Mock).mock.calls[0][0]

      // Enabled by default
      handler(new Error('test'))
      expect(mockPostHog.captureException).toHaveBeenCalledTimes(1)
      mockPostHog.captureException.mockClear()

      // Disable via remote config
      et.onRemoteConfig(false)
      handler(new Error('test2'))
      expect(mockPostHog.captureException).not.toHaveBeenCalled()
    })

    it('gates console handler on remote config', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: { console: ['error'] } }, mockLogger as any)
      const handler = (trackConsole as vi.Mock).mock.calls[0][0]

      // trackConsole is called with (level, handler), get the handler
      const consoleHandler = (trackConsole as vi.Mock).mock.calls[0][1]

      // Enabled by default
      consoleHandler(new Error('test'), false)
      expect(mockPostHog.captureException).toHaveBeenCalledTimes(1)
      mockPostHog.captureException.mockClear()

      // Disable via remote config
      et.onRemoteConfig(false)
      consoleHandler(new Error('test2'), false)
      expect(mockPostHog.captureException).not.toHaveBeenCalled()
    })
  })
})
