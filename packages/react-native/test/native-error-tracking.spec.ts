import { PostHog } from '../src/posthog-rn'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { waitForExpect } from './test-utils'

jest.mock('../src/optional/OptionalPlugin', () => ({
  OptionalReactNativePlugin: {
    start: jest.fn(() => Promise.resolve()),
    setup: jest.fn(() => Promise.resolve()),
    startSession: jest.fn(() => Promise.resolve()),
    endSession: jest.fn(() => Promise.resolve()),
    isEnabled: jest.fn(() => Promise.resolve(false)),
    identify: jest.fn(() => Promise.resolve()),
    startRecording: jest.fn(() => Promise.resolve()),
    stopRecording: jest.fn(() => Promise.resolve()),
    addExceptionStep: jest.fn(() => Promise.resolve()),
  },
}))

jest.useRealTimers()

const mockPlugin = OptionalReactNativePlugin as unknown as {
  start: jest.Mock
  setup: jest.Mock
  startSession: jest.Mock
  endSession: jest.Mock
  isEnabled: jest.Mock
  identify: jest.Mock
  startRecording: jest.Mock
  stopRecording: jest.Mock
  addExceptionStep: jest.Mock
}

const resetMockPlugin = (): void => {
  mockPlugin.start.mockImplementation(() => Promise.resolve())
  // `setup` may have been deleted by the legacy-plugin test; restore it if so.
  mockPlugin.setup = mockPlugin.setup ?? jest.fn()
  mockPlugin.setup.mockImplementation(() => Promise.resolve())
  mockPlugin.startSession.mockImplementation(() => Promise.resolve())
  mockPlugin.endSession.mockImplementation(() => Promise.resolve())
  mockPlugin.isEnabled.mockImplementation(() => Promise.resolve(false))
  mockPlugin.identify.mockImplementation(() => Promise.resolve())
  mockPlugin.startRecording.mockImplementation(() => Promise.resolve())
  mockPlugin.stopRecording.mockImplementation(() => Promise.resolve())
  mockPlugin.addExceptionStep.mockImplementation(() => Promise.resolve())
}

const setupFetch = (): void => {
  ;(globalThis as any).window = (globalThis as any).window ?? {}
  ;(globalThis as any).window.fetch = jest.fn(async (url: unknown) => {
    const res = String(url).includes('flags') ? { featureFlags: {} } : { status: 'ok' }
    return {
      status: 200,
      json: () => Promise.resolve(res),
    }
  })
}

describe('native error tracking', () => {
  beforeEach(() => {
    resetMockPlugin()
    jest.clearAllMocks()
    setupFetch()
  })

  it('does not initialize the native plugin by default', async () => {
    const posthog = new PostHog('test-token', { persistence: 'memory', flushInterval: 0 })

    await posthog.ready()
    await posthog._drainNativePluginEvaluationForTesting()

    expect(mockPlugin.setup).not.toHaveBeenCalled()
    expect(mockPlugin.start).not.toHaveBeenCalled()

    await posthog.shutdown()
  })

  it('initializes native error tracking without enabling session replay', async () => {
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
    expect(pluginConfig.sessionReplay.enabled).toBe(false)
    expect(pluginConfig.errorTracking.nativeAutocapture).toBe(true)

    await posthog.shutdown()
  })

  it('starts recording on the existing native instance instead of re-running setup when replay is enabled later', async () => {
    const posthog = new PostHog('test-token', {
      persistence: 'memory',
      flushInterval: 0,
      errorTracking: { autocapture: { nativeCrashes: true } },
    })

    await posthog.ready()

    await waitForExpect(100, () => {
      expect(mockPlugin.setup).toHaveBeenCalledTimes(1)
    })
    // The native SDK was set up with replay disabled.
    expect(mockPlugin.setup.mock.calls[0][2].sessionReplay.enabled).toBe(false)

    // Enabling replay afterwards must not re-run setup() (which would reset the running
    // native instance) — it should start recording on the existing instance.
    await posthog.startSessionRecording()

    expect(mockPlugin.setup).toHaveBeenCalledTimes(1)
    expect(mockPlugin.startRecording).toHaveBeenCalled()

    await posthog.shutdown()
  })

  it('with the legacy plugin (no setup), starts replay via start() and does not report native crash capture as started', async () => {
    // Emulates posthog-react-native-session-replay: the legacy package has no setup().
    delete (mockPlugin as { setup?: jest.Mock }).setup
    // _logger only emits when debug is on (isDebug = whether debug() was called), so spy on the
    // console and enable debug before init runs.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    const posthog = new PostHog('test-token', {
      persistence: 'memory',
      flushInterval: 0,
      enableSessionReplay: true,
      errorTracking: { autocapture: { nativeCrashes: true } },
    })
    posthog.debug(true)

    await posthog.ready()

    await waitForExpect(100, () => {
      expect(mockPlugin.start).toHaveBeenCalledTimes(1)
    })

    // nativeCrashes was requested but the legacy plugin can't do it: we must warn AND must
    // not claim it started.
    expect(warnSpy.mock.calls.flat().join(' ')).toContain('Native error tracking is not available')
    expect(logSpy.mock.calls.flat().join(' ')).not.toContain('Native error tracking started')

    warnSpy.mockRestore()
    logSpy.mockRestore()
    await posthog.shutdown()
  })

  it('routes to error-tracking-only setup() when session replay is gated off by a linked flag', async () => {
    // Seed the cached session-replay config with a linkedFlag that resolves off, so
    // recordingActive becomes false while native error tracking stays enabled.
    const seeded = JSON.stringify({
      content: {
        session_replay: { linkedFlag: 'rec-flag' },
        feature_flags: { 'rec-flag': false },
      },
    })
    const customStorage = {
      getItem: (_key: string) => seeded,
      setItem: (_key: string, _value: string) => {},
    }

    const posthog = new PostHog('test-token', {
      persistence: 'file',
      customStorage: customStorage as any,
      flushInterval: 0,
      enableSessionReplay: true,
      errorTracking: { autocapture: { nativeCrashes: true } },
    })

    await posthog.ready()

    await waitForExpect(100, () => {
      expect(mockPlugin.setup).toHaveBeenCalledTimes(1)
    })

    // Replay is gated off, but native crash capture still initializes — without recording.
    const [, , pluginConfig] = mockPlugin.setup.mock.calls[0]
    expect(pluginConfig.sessionReplay.enabled).toBe(false)
    expect(pluginConfig.errorTracking.nativeAutocapture).toBe(true)
    expect(mockPlugin.startRecording).not.toHaveBeenCalled()

    await posthog.shutdown()
  })

  it('passes both session replay and native error tracking config when both are enabled', async () => {
    const posthog = new PostHog('test-token', {
      persistence: 'memory',
      flushInterval: 0,
      enableSessionReplay: true,
      errorTracking: { autocapture: { nativeCrashes: true } },
    })

    await posthog.ready()

    await waitForExpect(100, () => {
      expect(mockPlugin.setup).toHaveBeenCalledTimes(1)
    })

    const [, , pluginConfig] = mockPlugin.setup.mock.calls[0]
    expect(pluginConfig.sessionReplay.enabled).toBe(true)
    expect(pluginConfig.errorTracking.nativeAutocapture).toBe(true)

    await posthog.shutdown()
  })

  it('pauses and resumes recording across linked-flag changes without re-running setup() when error tracking is on', async () => {
    // Controllable /flags response: the linked flag starts true, flips later.
    let recFlagValue = true
    ;(globalThis as any).window.fetch = jest.fn(async (url: unknown) => {
      const res = String(url).includes('flags')
        ? {
            featureFlags: { 'rec-flag': recFlagValue },
            sessionRecording: { linkedFlag: 'rec-flag', endpoint: '/s/' },
          }
        : { status: 'ok' }
      return { status: 200, json: () => Promise.resolve(res) }
    })

    const posthog = new PostHog('test-token', {
      persistence: 'memory',
      flushInterval: 0,
      enableSessionReplay: true,
      errorTracking: { autocapture: { nativeCrashes: true } },
    })

    await posthog.ready()

    // Linked flag is on: replay + error tracking arm in a single setup().
    await waitForExpect(2000, () => {
      expect(mockPlugin.setup).toHaveBeenCalledTimes(1)
    })
    expect(mockPlugin.setup.mock.calls[0][2].errorTracking.nativeAutocapture).toBe(true)

    // Linked flag turns off -> recording pauses; error tracking keeps the native
    // instance, so setup() must not run again.
    recFlagValue = false
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(mockPlugin.stopRecording).toHaveBeenCalledTimes(1))
    expect(mockPlugin.setup).toHaveBeenCalledTimes(1)

    // Linked flag flips back on -> recording resumes on the existing instance.
    recFlagValue = true
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(mockPlugin.startRecording).toHaveBeenCalledTimes(1))
    expect(mockPlugin.setup).toHaveBeenCalledTimes(1)

    await posthog.shutdown()
  })

  it('plumbs the exception-steps config to native and forwards both replayed and live steps', async () => {
    const posthog = new PostHog('test-token', {
      persistence: 'memory',
      flushInterval: 0,
      errorTracking: { autocapture: { nativeCrashes: true }, exceptionSteps: { maxBytes: 4096 } },
    })

    // Recorded before native init: buffered in JS only (native forwarding is a no-op until ready),
    // then replayed to native once native error tracking initializes.
    posthog.addExceptionStep('before-init', { screen: 'home' })

    await posthog.ready()

    await waitForExpect(100, () => {
      expect(mockPlugin.setup).toHaveBeenCalledTimes(1)
    })

    // The resolved config is forwarded so the native buffer shares the same enabled/budget.
    const [, , pluginConfig] = mockPlugin.setup.mock.calls[0]
    expect(pluginConfig.errorTracking.exceptionSteps).toEqual({ enabled: true, maxBytes: 4096 })

    // The pre-init step is replayed to native exactly once after init.
    await waitForExpect(100, () => {
      expect(mockPlugin.addExceptionStep).toHaveBeenCalledWith(
        'before-init',
        expect.objectContaining({ screen: 'home' })
      )
    })
    expect(mockPlugin.addExceptionStep).toHaveBeenCalledTimes(1)

    // A step recorded after init is forwarded live.
    mockPlugin.addExceptionStep.mockClear()
    posthog.addExceptionStep('after-init')
    expect(mockPlugin.addExceptionStep).toHaveBeenCalledWith('after-init', undefined)

    await posthog.shutdown()
  })

  it('does not forward exception steps to native when native error tracking is not enabled', async () => {
    const posthog = new PostHog('test-token', { persistence: 'memory', flushInterval: 0 })

    await posthog.ready()
    await posthog._drainNativePluginEvaluationForTesting()

    posthog.addExceptionStep('orphan')

    expect(mockPlugin.setup).not.toHaveBeenCalled()
    expect(mockPlugin.addExceptionStep).not.toHaveBeenCalled()

    await posthog.shutdown()
  })

  it('does not forward exception steps to native when exception steps are disabled', async () => {
    const posthog = new PostHog('test-token', {
      persistence: 'memory',
      flushInterval: 0,
      errorTracking: { autocapture: { nativeCrashes: true }, exceptionSteps: { enabled: false } },
    })

    await posthog.ready()
    await waitForExpect(100, () => {
      expect(mockPlugin.setup).toHaveBeenCalledTimes(1)
    })

    // Native is initialized, but disabled steps must not reach the bridge.
    posthog.addExceptionStep('ignored')
    expect(mockPlugin.addExceptionStep).not.toHaveBeenCalled()

    await posthog.shutdown()
  })
})
