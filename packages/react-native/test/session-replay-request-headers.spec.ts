import { PostHog, PostHogCustomStorage } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { Linking, AppState } from 'react-native'
import { waitForExpect } from './test-utils'

// Mock the native plugin bridge so we can assert which native calls happen. No `setup`
// key, so the SDK takes the legacy start() path (same surface as the standalone
// posthog-react-native-session-replay package).
jest.mock('../src/optional/OptionalPlugin', () => ({
  OptionalReactNativePlugin: {
    start: jest.fn(async () => {}),
    startSession: jest.fn(async () => {}),
    endSession: jest.fn(async () => {}),
    isEnabled: jest.fn(async () => false),
    identify: jest.fn(async () => {}),
    startRecording: jest.fn(async () => {}),
    stopRecording: jest.fn(async () => {}),
  },
}))

const replay = OptionalReactNativePlugin as unknown as {
  start: jest.Mock
  isEnabled: jest.Mock
  setup?: jest.Mock
}

Linking.getInitialURL = jest.fn(() => Promise.resolve(null))
AppState.addEventListener = jest.fn()

describe('PostHog RN session replay request headers', () => {
  jest.useRealTimers()

  let posthog: PostHog
  let cache: any = {}
  let mockStorage: PostHogCustomStorage

  beforeEach(() => {
    replay.start.mockClear()
    replay.isEnabled.mockImplementation(async () => false)
    replay.start.mockImplementation(async () => {})
    ;(globalThis as any).window.fetch = jest.fn(async (url: string) => {
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
    delete replay.setup
  })

  it('snapshots the complete legacy native start envelope', async () => {
    posthog = new PostHog('test-token', {
      customStorage: mockStorage,
      enableSessionReplay: true,
      flushInterval: 0,
      requestHeaders: { Authorization: 'Bearer test-jwt' },
    })
    await posthog.ready()

    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))

    const [sessionId, sdkOptions, pluginConfig, cachedConfig] = replay.start.mock.calls[0]
    expect(typeof sessionId).toBe('string')
    expect(sessionId).not.toBe('')
    expect(sessionId).toBe(posthog.getSessionId())
    expect(typeof sdkOptions.sdkVersion).toBe('string')
    expect(sdkOptions.sdkVersion).not.toBe('')
    expect(typeof sdkOptions.distinctId).toBe('string')
    expect(sdkOptions.distinctId).not.toBe('')
    expect(typeof sdkOptions.anonymousId).toBe('string')
    expect(sdkOptions.anonymousId).not.toBe('')
    expect(sdkOptions.distinctId).toBe(sdkOptions.anonymousId)
    expect(sdkOptions.requestHeaders).toEqual({ Authorization: 'Bearer test-jwt' })

    expect({
      sessionId: '<session-id>',
      sdkOptions: {
        ...sdkOptions,
        anonymousId: '<anonymous-id>',
        distinctId: '<anonymous-id>',
        sdkVersion: '<sdk-version>',
      },
      pluginConfig,
      cachedConfig,
    }).toMatchSnapshot()
  })

  it('snapshots the complete native setup envelope used by session replay', async () => {
    // Adding a `setup` mock switches the SDK to the modern setup() dispatch path.
    replay.setup = jest.fn(async () => {})

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
        screenshotModeBackgroundCapture: true,
        throttleDelayMs: 250,
      },
    })
    await posthog.ready()

    await waitForExpect(2000, () => expect(replay.setup).toHaveBeenCalledTimes(1))
    expect(replay.start).not.toHaveBeenCalled()

    const [sessionId, sdkOptions, pluginConfig] = replay.setup.mock.calls[0]
    expect(typeof sessionId).toBe('string')
    expect(sessionId).not.toBe('')
    expect(sessionId).toBe(posthog.getSessionId())
    expect(typeof sdkOptions.sdkVersion).toBe('string')
    expect(sdkOptions.sdkVersion).not.toBe('')
    expect(sdkOptions.requestHeaders).toEqual({ Authorization: 'Bearer test-jwt' })

    expect({
      sessionId: '<session-id>',
      sdkOptions: { ...sdkOptions, sdkVersion: '<sdk-version>' },
      pluginConfig,
    }).toMatchSnapshot()
  })
})
