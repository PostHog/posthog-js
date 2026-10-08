import { AppState, Linking } from 'react-native'
import { PostHog, PostHogSessionReplayConfig } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { waitForExpect } from './test-utils'

const pluginVersion = vi.hoisted(() => ({ value: undefined as string | undefined }))

vi.mock('../src/optional/OptionalPlugin', () => ({
  get OptionalReactNativePluginVersion() {
    return pluginVersion.value
  },
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

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()

describe.each(['setup', 'start'] as const)('replay touch configuration through native %s', (method) => {
  vi.useRealTimers()
  let posthog: PostHog

  beforeEach(() => {
    vi.clearAllMocks()
    pluginVersion.value = undefined
    if (method === 'setup') {
      replay.setup = vi.fn(async () => {})
    }
  })

  afterEach(async () => {
    await posthog?.shutdown()
    delete replay.setup
  })

  it.each([undefined, true, false])(
    'forwards captureTouches=%s without disabling replay or masking',
    async (captureTouches) => {
      posthog = new PostHog('test-token', {
        persistence: 'memory',
        disableRemoteConfig: true,
        enableSessionReplay: true,
        flushInterval: 0,
        sessionReplayConfig: captureTouches === undefined ? undefined : { captureTouches },
      })
      await posthog.ready()
      await waitForExpect(2000, () => expect(replay[method]).toHaveBeenCalledTimes(1))

      const config = replay[method]!.mock.calls[0][2]
      const sdkReplayConfig = method === 'setup' ? config.sessionReplay.sdkReplayConfig : config
      expect(sdkReplayConfig).toMatchObject({
        captureTouches: captureTouches ?? true,
        maskAllTextInputs: true,
        maskAllImages: true,
        throttleDelayMs: 1000,
      })
      if (method === 'setup') {
        expect(config.sessionReplay.enabled).toBe(true)
      }
      expect(OptionalReactNativePlugin.stopRecording).not.toHaveBeenCalled()
    }
  )

  it('does not reconfigure touch capture when recording restarts', async () => {
    const sessionReplayConfig: PostHogSessionReplayConfig = { captureTouches: false }
    posthog = new PostHog('test-token', {
      persistence: 'memory',
      disableRemoteConfig: true,
      enableSessionReplay: true,
      flushInterval: 0,
      sessionReplayConfig,
    })
    await posthog.ready()
    await waitForExpect(2000, () => expect(replay[method]).toHaveBeenCalledTimes(1))

    sessionReplayConfig.captureTouches = true
    await posthog.stopSessionRecording()
    await posthog.startSessionRecording()

    expect(replay[method]).toHaveBeenCalledTimes(1)
    const config = replay[method]!.mock.calls[0][2]
    expect((method === 'setup' ? config.sessionReplay.sdkReplayConfig : config).captureTouches).toBe(false)
  })
})

describe.each(['setup', 'start'] as const)('replay touch compatibility warnings through native %s', (method) => {
  vi.useRealTimers()
  let posthog: PostHog
  let warnSpy: vi.SpyInstance
  let logSpy: vi.SpyInstance
  let fetchSpy: vi.SpyInstance

  beforeEach(() => {
    vi.clearAllMocks()
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      json: async () => ({}),
    } as Response)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    if (method === 'setup') {
      replay.setup = vi.fn(async () => {})
    }
  })

  afterEach(async () => {
    await posthog?.shutdown()
    warnSpy.mockRestore()
    logSpy.mockRestore()
    fetchSpy.mockRestore()
    pluginVersion.value = undefined
    delete replay.setup
  })

  async function initialize(version: string | undefined, captureTouches?: boolean) {
    pluginVersion.value = version
    posthog = new PostHog('test-token', {
      persistence: 'memory',
      disableRemoteConfig: true,
      enableSessionReplay: true,
      flushInterval: 0,
      sessionReplayConfig: { captureTouches },
    })
    posthog.debug(true)
    await posthog.ready()
    await waitForExpect(2000, () => expect(replay[method]).toHaveBeenCalledTimes(1))
    return warnSpy.mock.calls.map((args) => args.join(' ')).filter((message) => message.includes('captureTouches'))
  }

  it.each([undefined, '', 'unknown', '2.8.1', '2.8.99', '1.99.0', '2.9.0-beta.1'])(
    'warns when disabling touch capture with plugin version %s',
    async (version) => {
      const warnings = await initialize(version, false)

      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('@posthog/react-native-plugin 2.9.0 or later')
      expect(warnings[0]).toContain('may still record touch coordinates')
      expect(warnings[0]).toContain('rebuild')
      const config = replay[method]!.mock.calls[0][2]
      expect((method === 'setup' ? config.sessionReplay.sdkReplayConfig : config).captureTouches).toBe(false)
      expect(OptionalReactNativePlugin.stopRecording).not.toHaveBeenCalled()
    }
  )

  it.each(['2.9.0', '2.9.1', '2.10.0', '3.0.0', '2.9.0+build.1'])(
    'does not warn for supported plugin version %s',
    async (version) => {
      expect(await initialize(version, false)).toEqual([])
    }
  )

  it.each([undefined, true])('does not warn when captureTouches is %s', async (captureTouches) => {
    expect(await initialize('2.8.1', captureTouches)).toEqual([])
  })
})

describe('replay touch configuration before recording starts', () => {
  vi.useRealTimers()
  let posthog: PostHog

  afterEach(async () => {
    await posthog?.shutdown()
    delete replay.setup
  })

  it('configures touch capture when native error tracking initializes the plugin first', async () => {
    vi.clearAllMocks()
    replay.setup = vi.fn(async () => {})
    posthog = new PostHog('test-token', {
      persistence: 'memory',
      disableRemoteConfig: true,
      enableSessionReplay: false,
      errorTracking: { autocapture: { nativeCrashes: true } },
      flushInterval: 0,
      sessionReplayConfig: { captureTouches: false },
    })
    await posthog.ready()
    await waitForExpect(2000, () => expect(replay.setup).toHaveBeenCalledTimes(1))

    expect(replay.setup.mock.calls[0][2].sessionReplay).toMatchObject({
      enabled: false,
      sdkReplayConfig: { captureTouches: false },
    })

    await posthog.startSessionRecording()
    expect(replay.setup).toHaveBeenCalledTimes(1)
    expect(OptionalReactNativePlugin.startRecording).toHaveBeenCalledWith(true)
  })
})
