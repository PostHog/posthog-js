import { PostHog } from '../src/posthog-rn'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { setupFetch, waitForExpect } from './test-utils'

vi.mock('../src/optional/OptionalPlugin', () => ({
  OptionalReactNativePluginVersion: undefined,
  OptionalReactNativePlugin: {
    start: vi.fn(() => Promise.resolve()),
    setup: vi.fn(() => Promise.resolve()),
    startSession: vi.fn(() => Promise.resolve()),
    endSession: vi.fn(() => Promise.resolve()),
    isEnabled: vi.fn(() => Promise.resolve(false)),
    identify: vi.fn(() => Promise.resolve()),
    startRecording: vi.fn(() => Promise.resolve()),
    stopRecording: vi.fn(() => Promise.resolve()),
    addExceptionStep: vi.fn(() => Promise.resolve()),
  },
}))

vi.useRealTimers()

const mockPlugin = OptionalReactNativePlugin as unknown as {
  setup: vi.Mock
}

describe('rageClickConfig', () => {
  beforeEach(() => {
    mockPlugin.setup = mockPlugin.setup ?? vi.fn()
    mockPlugin.setup.mockImplementation(() => Promise.resolve())
    vi.clearAllMocks()
    setupFetch()
  })

  it('passes rageClickConfig through pluginConfig when provided', async () => {
    const posthog = new PostHog('test-token', {
      persistence: 'memory',
      flushInterval: 0,
      errorTracking: { autocapture: { nativeCrashes: true } },
      rageClickConfig: { enabled: false },
    })

    await posthog.ready()

    await waitForExpect(100, () => {
      expect(mockPlugin.setup).toHaveBeenCalledTimes(1)
    })

    const [, , pluginConfig] = mockPlugin.setup.mock.calls[0]
    expect(pluginConfig.rageClick).toEqual({ enabled: false })

    await posthog.shutdown()
  })

  it('passes all rageClickConfig fields through pluginConfig', async () => {
    const posthog = new PostHog('test-token', {
      persistence: 'memory',
      flushInterval: 0,
      errorTracking: { autocapture: { nativeCrashes: true } },
      rageClickConfig: {
        enabled: true,
        minimumTapCount: 5,
        thresholdPoints: 50,
        timeoutInterval: 2.0,
      },
    })

    await posthog.ready()

    await waitForExpect(100, () => {
      expect(mockPlugin.setup).toHaveBeenCalledTimes(1)
    })

    const [, , pluginConfig] = mockPlugin.setup.mock.calls[0]
    expect(pluginConfig.rageClick).toEqual({
      enabled: true,
      minimumTapCount: 5,
      thresholdPoints: 50,
      timeoutInterval: 2.0,
    })

    await posthog.shutdown()
  })

  it('does not include rageClick in pluginConfig when rageClickConfig is not set', async () => {
    const posthog = new PostHog('test-token', {
      persistence: 'memory',
      flushInterval: 0,
      errorTracking: { autocapture: { nativeCrashes: true } },
    })

    await posthog.ready()

    await waitForExpect(100, () => {
      expect(mockPlugin.setup).toHaveBeenCalledTimes(1)
    })

    const [, , pluginConfig] = mockPlugin.setup.mock.calls[0]
    expect(pluginConfig.rageClick).toBeUndefined()

    await posthog.shutdown()
  })
})
