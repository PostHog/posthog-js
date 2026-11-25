import { AppState, Linking, Platform } from 'react-native'
import { PostHog, PostHogSessionReplayConfig } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { waitForExpect } from './test-utils'

const pluginVersion = vi.hoisted(() => ({ value: undefined as string | undefined }))

vi.mock('../src/optional/OptionalPlugin', () => ({
  get OptionalReactNativePluginVersion() {
    return pluginVersion.value
  },
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

const replay = OptionalReactNativePlugin as unknown as { setup: vi.Mock }
const screenshotKeys = ['screenshotScale', 'screenshotCompressionQuality', 'screenshotColorMode'] as const

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()

describe('screenshot configuration through native setup', () => {
  vi.useRealTimers()
  let posthog: PostHog

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await posthog?.shutdown()
  })

  async function initialize(sessionReplayConfig?: PostHogSessionReplayConfig) {
    posthog = new PostHog('test-token', {
      persistence: 'memory',
      enableSessionReplay: true,
      flushInterval: 0,
      sessionReplayConfig,
    })
    await posthog.ready()
    await waitForExpect(2000, () => expect(replay.setup).toHaveBeenCalledTimes(1))
    const config = replay.setup.mock.calls[0][2]
    return config.sessionReplay.sdkReplayConfig
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

  it.each<[PostHogSessionReplayConfig | undefined, string]>([
    [undefined, 'standard'],
    [{ iOSCaptureMethod: 'gpu' }, 'gpu'],
    [{ iOSCaptureMethod: 'GPU' as 'gpu' }, 'standard'],
    [{ iOSCaptureMethod: 'background' as 'gpu' }, 'standard'],
  ])('forwards the iOS capture method from %j', async (options, method) => {
    const config = await initialize(options)

    expect(config.iOSCaptureMethod).toBe(method)
    expect(config).not.toHaveProperty('screenshotModeBackgroundCapture')
  })
})

describe('iOS capture method compatibility warning', () => {
  vi.useRealTimers()
  let posthog: PostHog
  let warnSpy: vi.SpyInstance
  let logSpy: vi.SpyInstance
  let fetchSpy: vi.SpyInstance
  const previousOS = Platform.OS

  beforeEach(() => {
    vi.clearAllMocks()
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 200, json: async () => ({}) } as Response)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    await posthog?.shutdown()
    warnSpy.mockRestore()
    logSpy.mockRestore()
    fetchSpy.mockRestore()
    pluginVersion.value = undefined
    Platform.OS = previousOS
  })

  async function warningsFor(
    os: string,
    version: string | undefined,
    sessionReplayConfig?: PostHogSessionReplayConfig
  ) {
    Platform.OS = os as typeof Platform.OS
    pluginVersion.value = version
    posthog = new PostHog('test-token', {
      persistence: 'memory',
      enableSessionReplay: true,
      flushInterval: 0,
      sessionReplayConfig,
    })
    posthog.debug(true)
    await posthog.ready()
    await waitForExpect(2000, () => expect(replay.setup).toHaveBeenCalledTimes(1))
    return warnSpy.mock.calls.map((args) => args.join(' ')).filter((message) => message.includes('iOSCaptureMethod'))
  }

  it.each([undefined, '2.12.7', '3.0.0-beta.1'])('warns on iOS for gpu with plugin version %s', async (version) => {
    const warnings = await warningsFor('ios', version, { iOSCaptureMethod: 'gpu' })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('@posthog/react-native-plugin 3.0.0 or later')
  })

  it.each<[string, string | undefined, PostHogSessionReplayConfig | undefined]>([
    ['ios', '3.0.0', { iOSCaptureMethod: 'gpu' }],
    ['android', undefined, { iOSCaptureMethod: 'gpu' }],
    ['ios', undefined, { iOSCaptureMethod: 'standard' }],
    ['ios', undefined, undefined],
    ['ios', undefined, { iOSCaptureMethod: 'GPU' as 'gpu' }],
  ])('does not warn on %s with plugin version %s for %j', async (os, version, options) => {
    expect(await warningsFor(os, version, options)).toEqual([])
  })
})

describe('screenshot configuration before replay starts', () => {
  vi.useRealTimers()
  let posthog: PostHog

  afterEach(async () => {
    await posthog?.shutdown()
  })

  it('configures screenshots when native error tracking initializes the plugin first', async () => {
    posthog = new PostHog('test-token', {
      persistence: 'memory',
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
