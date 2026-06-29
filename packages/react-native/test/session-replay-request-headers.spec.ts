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
  })

  it('forwards requestHeaders to the native plugin sdkOptions via the legacy start() path', async () => {
    posthog = new PostHog('test-token', {
      customStorage: mockStorage,
      enableSessionReplay: true,
      flushInterval: 0,
      requestHeaders: { Authorization: 'Bearer test-jwt' },
    })
    await posthog.ready()

    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))

    const sdkOptions = replay.start.mock.calls[0][1]
    expect(sdkOptions).toEqual(expect.objectContaining({ requestHeaders: { Authorization: 'Bearer test-jwt' } }))
  })

  it('forwards requestHeaders to the native plugin sdkOptions via the setup() path', async () => {
    // Adding a `setup` mock switches the SDK to the modern setup() dispatch path.
    replay.setup = jest.fn(async () => {})

    posthog = new PostHog('test-token', {
      customStorage: mockStorage,
      enableSessionReplay: true,
      flushInterval: 0,
      requestHeaders: { Authorization: 'Bearer test-jwt' },
    })
    await posthog.ready()

    await waitForExpect(2000, () => expect(replay.setup).toHaveBeenCalledTimes(1))
    expect(replay.start).not.toHaveBeenCalled()

    const sdkOptions = replay.setup.mock.calls[0][1]
    expect(sdkOptions).toEqual(expect.objectContaining({ requestHeaders: { Authorization: 'Bearer test-jwt' } }))

    delete replay.setup
  })
})
