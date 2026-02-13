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

import { trackUncaughtExceptions, trackUnhandledRejections, trackConsole } from '../src/error-tracking/utils'

const mockPostHog = {
  capture: jest.fn(),
  flush: jest.fn(() => Promise.resolve()),
} as any

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  critical: jest.fn(),
  createLogger: jest.fn(() => mockLogger),
}

describe('ErrorTracking remote config', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('onRemoteConfig', () => {
    it('does not change state when errorTracking is undefined', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)

      // Get reference to the uncaught exception handler
      const handler = (trackUncaughtExceptions as jest.Mock).mock.calls[0][0]

      // Should capture before remote config
      handler(new Error('test'), false)
      expect(mockPostHog.capture).toHaveBeenCalledTimes(1)

      mockPostHog.capture.mockClear()

      // undefined should not change anything
      et.onRemoteConfig(undefined)
      handler(new Error('test2'), false)
      expect(mockPostHog.capture).toHaveBeenCalledTimes(1)
    })

    it('does not change state when errorTracking is null', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
      const handler = (trackUncaughtExceptions as jest.Mock).mock.calls[0][0]

      et.onRemoteConfig(null as any)
      handler(new Error('test'), false)
      expect(mockPostHog.capture).toHaveBeenCalledTimes(1)
    })

    it('disables autocapture when errorTracking is false', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
      const handler = (trackUncaughtExceptions as jest.Mock).mock.calls[0][0]

      et.onRemoteConfig(false)
      handler(new Error('test'), false)
      expect(mockPostHog.capture).not.toHaveBeenCalled()
    })

    it('enables autocapture when errorTracking is true', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
      const handler = (trackUncaughtExceptions as jest.Mock).mock.calls[0][0]

      // First disable
      et.onRemoteConfig(false)
      handler(new Error('test'), false)
      expect(mockPostHog.capture).not.toHaveBeenCalled()

      // Then re-enable
      et.onRemoteConfig(true)
      handler(new Error('test2'), false)
      expect(mockPostHog.capture).toHaveBeenCalledTimes(1)
    })

    it('enables autocapture when errorTracking map has autocaptureExceptions=true', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
      const handler = (trackUncaughtExceptions as jest.Mock).mock.calls[0][0]

      et.onRemoteConfig({ autocaptureExceptions: true })
      handler(new Error('test'), false)
      expect(mockPostHog.capture).toHaveBeenCalledTimes(1)
    })

    it('disables autocapture when errorTracking map has autocaptureExceptions=false', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
      const handler = (trackUncaughtExceptions as jest.Mock).mock.calls[0][0]

      et.onRemoteConfig({ autocaptureExceptions: false })
      handler(new Error('test'), false)
      expect(mockPostHog.capture).not.toHaveBeenCalled()
    })

    it('disables autocapture when errorTracking map is missing autocaptureExceptions key', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: true }, mockLogger as any)
      const handler = (trackUncaughtExceptions as jest.Mock).mock.calls[0][0]

      et.onRemoteConfig({ otherKey: 'value' })
      handler(new Error('test'), false)
      expect(mockPostHog.capture).not.toHaveBeenCalled()
    })

    it('gates unhandled rejection handler on remote config', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: { unhandledRejections: true } }, mockLogger as any)
      const handler = (trackUnhandledRejections as jest.Mock).mock.calls[0][0]

      // Enabled by default
      handler(new Error('test'))
      expect(mockPostHog.capture).toHaveBeenCalledTimes(1)
      mockPostHog.capture.mockClear()

      // Disable via remote config
      et.onRemoteConfig(false)
      handler(new Error('test2'))
      expect(mockPostHog.capture).not.toHaveBeenCalled()
    })

    it('gates console handler on remote config', () => {
      const et = new ErrorTracking(mockPostHog, { autocapture: { console: ['error'] } }, mockLogger as any)
      const handler = (trackConsole as jest.Mock).mock.calls[0][0]

      // trackConsole is called with (level, handler), get the handler
      const consoleHandler = (trackConsole as jest.Mock).mock.calls[0][1]

      // Enabled by default
      consoleHandler(new Error('test'), false)
      expect(mockPostHog.capture).toHaveBeenCalledTimes(1)
      mockPostHog.capture.mockClear()

      // Disable via remote config
      et.onRemoteConfig(false)
      consoleHandler(new Error('test2'), false)
      expect(mockPostHog.capture).not.toHaveBeenCalled()
    })
  })
})
