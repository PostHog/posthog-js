import { PostHog, PostHogCustomStorage } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { Linking, AppState } from 'react-native'
import { waitForExpect } from './test-utils'

// Mock the native plugin bridge so we can assert which native calls happen.
vi.mock('../src/optional/OptionalPlugin', () => ({
  OptionalReactNativePluginVersion: undefined,
  OptionalReactNativePlugin: {
    setup: vi.fn(async () => {}),
    startSession: vi.fn(async () => {}),
    endSession: vi.fn(async () => {}),
    isEnabled: vi.fn(async () => false),
    identify: vi.fn(async () => {}),
    startRecording: vi.fn(async () => {}),
    stopRecording: vi.fn(async () => {}),
  },
}))

const replay = OptionalReactNativePlugin as unknown as {
  setup: vi.Mock
  isEnabled: vi.Mock
}

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()

describe('PostHog RN session replay request headers', () => {
  vi.useRealTimers()

  let posthog: PostHog
  let cache: any = {}
  let mockStorage: PostHogCustomStorage

  beforeEach(() => {
    replay.setup.mockClear()
    replay.isEnabled.mockImplementation(async () => false)
    replay.setup.mockImplementation(async () => {})
    ;(globalThis as any).window.fetch = vi.fn(async (url: string) => {
      const res = url.includes('flags') ? { featureFlags: {}, sessionRecording: { endpoint: '/s/' } } : { status: 'ok' }
      return { status: 200, json: () => Promise.resolve(res) }
    })

    cache = {}
    mockStorage = {
      getItem: async (key) => cache[key] || null,
      setItem: async (key, value) => {
        cache[key] = value
      },
    }
  })

  afterEach(async () => {
    if (posthog) {
      await posthog.shutdown()
    }
  })

  it('snapshots the complete native setup envelope used by session replay', async () => {
    posthog = new PostHog('test-token', {
      persistence: 'memory',
      bootstrap: { distinctId: 'replay-snapshot-id' },
      captureAppLifecycleEvents: false,
      capturePushNotificationSubscriptions: false,
      capturePushNotificationOpened: false,
      disableRemoteConfig: true,
      enableSessionReplay: true,
      flushInterval: 0,
      requestHeaders: { Authorization: 'Bearer test-jwt' },
      sessionReplayConfig: {
        captureLog: true,
        captureNetworkTelemetry: false,
        maskAllImages: false,
        maskAllTextInputs: true,
        verifyScreenshotMaskAlignment: true,
        screenshotModeBackgroundCapture: true,
        throttleDelayMs: 250,
      },
    })
    await posthog.ready()

    await waitForExpect(2000, () => expect(replay.setup).toHaveBeenCalledTimes(1))

    const [sessionId, sdkOptions, pluginConfig] = replay.setup.mock.calls[0]
    expect(typeof sessionId).toBe('string')
    expect(sessionId).not.toBe('')
    expect(sessionId).toBe(posthog.getSessionId())
    expect(typeof sdkOptions.sdkVersion).toBe('string')
    expect(sdkOptions.sdkVersion).not.toBe('')
    expect(sdkOptions.requestHeaders).toEqual({ Authorization: 'Bearer test-jwt' })
    expect(pluginConfig.sessionReplay.sdkReplayConfig.verifyScreenshotMaskAlignment).toBe(true)

    expect({
      sessionId: '<session-id>',
      sdkOptions: { ...sdkOptions, sdkVersion: '<sdk-version>' },
      pluginConfig,
    }).toMatchSnapshot()
  })
})
