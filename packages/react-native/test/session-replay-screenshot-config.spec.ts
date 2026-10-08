import { AppState, Linking } from 'react-native'
import { PostHog, PostHogSessionReplayConfig } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { waitForExpect } from './test-utils'

vi.mock('../src/optional/OptionalPlugin', () => ({
  OptionalReactNativePluginVersion: undefined,
  OptionalReactNativePlugin: {
    start: vi.fn(async () => {}),
    startSession: vi.fn(async () => {}),
    endSession: vi.fn(async () => {}),
    isEnabled: vi.fn(async () => false),
    identify: vi.fn(async () => {}),
    startRecording: vi.fn(async () => {}),
    stopRecording: vi.fn(async () => {}),
  },
}))

const replay = OptionalReactNativePlugin as unknown as { start: vi.Mock; setup?: vi.Mock }
const screenshotKeys = ['screenshotScale', 'screenshotCompressionQuality', 'screenshotColorMode'] as const

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()

describe.each(['setup', 'start'] as const)('screenshot configuration through native %s', (method) => {
  vi.useRealTimers()
  let posthog: PostHog

  beforeEach(() => {
    vi.clearAllMocks()
    if (method === 'setup') {
      replay.setup = vi.fn(async () => {})
    }
  })

  afterEach(async () => {
    await posthog?.shutdown()
    delete replay.setup
  })

  async function initialize(sessionReplayConfig?: PostHogSessionReplayConfig) {
    posthog = new PostHog('test-token', {
      persistence: 'memory',
      disableRemoteConfig: true,
      enableSessionReplay: true,
      flushInterval: 0,
      sessionReplayConfig,
    })
    await posthog.ready()
    await waitForExpect(2000, () => expect(replay[method]).toHaveBeenCalledTimes(1))
    const config = replay[method]!.mock.calls[0][2]
    return method === 'setup' ? config.sessionReplay.sdkReplayConfig : config
  }

  it('leaves screenshot settings to native defaults when omitted', async () => {
    const config = await initialize()

    for (const key of screenshotKeys) {
      expect(config).not.toHaveProperty(key)
    }
    expect(config).toMatchObject({ maskAllTextInputs: true, maskAllImages: true, throttleDelayMs: 1000 })
  })

  it.each<PostHogSessionReplayConfig>([
    { screenshotScale: 0.5 },
    { screenshotCompressionQuality: 0 },
    { screenshotColorMode: 'RGB_565' },
    { screenshotScale: 1, screenshotCompressionQuality: 30, screenshotColorMode: 'ARGB_8888' },
    { screenshotScale: 0.25, screenshotCompressionQuality: 80, screenshotColorMode: 'RGB_565' },
  ])('forwards independent screenshot settings: %j', async (options) => {
    const config = await initialize(options)

    expect(config).toMatchObject(options)
    for (const key of screenshotKeys) {
      if (!(key in options)) {
        expect(config).not.toHaveProperty(key)
      }
    }
  })

  it.each([NaN, Infinity, -Infinity])('uses native defaults for non-finite numeric settings: %s', async (value) => {
    const config = await initialize({
      screenshotScale: value,
      screenshotCompressionQuality: value,
      screenshotColorMode: 'RGB_565',
    })

    expect(config).not.toHaveProperty('screenshotScale')
    expect(config).not.toHaveProperty('screenshotCompressionQuality')
    expect(config.screenshotColorMode).toBe('RGB_565')
  })
})

describe('screenshot configuration before replay starts', () => {
  vi.useRealTimers()
  let posthog: PostHog

  afterEach(async () => {
    await posthog?.shutdown()
    delete replay.setup
  })

  it('configures screenshots when native error tracking initializes the plugin first', async () => {
    replay.setup = vi.fn(async () => {})
    posthog = new PostHog('test-token', {
      persistence: 'memory',
      disableRemoteConfig: true,
      enableSessionReplay: false,
      errorTracking: { autocapture: { nativeCrashes: true } },
      flushInterval: 0,
      sessionReplayConfig: { screenshotScale: 0.5, screenshotCompressionQuality: 50, screenshotColorMode: 'RGB_565' },
    })
    await posthog.ready()
    await waitForExpect(2000, () => expect(replay.setup).toHaveBeenCalledTimes(1))

    expect(replay.setup.mock.calls[0][2].sessionReplay).toMatchObject({
      enabled: false,
      sdkReplayConfig: { screenshotScale: 0.5, screenshotCompressionQuality: 50, screenshotColorMode: 'RGB_565' },
    })
  })
})
