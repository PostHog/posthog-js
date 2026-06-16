import { waitForExpect } from './test-utils'

jest.useRealTimers()

const mockPlugin = {
  start: jest.fn(() => Promise.resolve()),
  setup: jest.fn(() => Promise.resolve()),
  startSession: jest.fn(() => Promise.resolve()),
  endSession: jest.fn(() => Promise.resolve()),
  isEnabled: jest.fn(() => Promise.resolve(false)),
  identify: jest.fn(() => Promise.resolve()),
  startRecording: jest.fn(() => Promise.resolve()),
  stopRecording: jest.fn(() => Promise.resolve()),
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
    jest.resetModules()
    jest.clearAllMocks()
    setupFetch()
    jest.doMock('../src/optional/OptionalPlugin', () => ({
      OptionalReactNativePlugin: mockPlugin,
    }))
  })

  afterEach(() => {
    jest.dontMock('../src/optional/OptionalPlugin')
  })

  it('does not initialize the native plugin by default', async () => {
    const { PostHog } = await import('../src/posthog-rn')
    const posthog = new PostHog('test-token', { persistence: 'memory', flushInterval: 0 })

    await posthog.ready()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockPlugin.setup).not.toHaveBeenCalled()
    expect(mockPlugin.start).not.toHaveBeenCalled()

    await posthog.shutdown()
  })

  it('initializes native error tracking without enabling session replay', async () => {
    const { PostHog } = await import('../src/posthog-rn')
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
    const { PostHog } = await import('../src/posthog-rn')
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
    jest.resetModules()
    const legacyPlugin = {
      start: jest.fn(() => Promise.resolve()),
      isEnabled: jest.fn(() => Promise.resolve(false)),
      identify: jest.fn(() => Promise.resolve()),
      startSession: jest.fn(() => Promise.resolve()),
      endSession: jest.fn(() => Promise.resolve()),
      startRecording: jest.fn(() => Promise.resolve()),
      stopRecording: jest.fn(() => Promise.resolve()),
      // intentionally no setup() — emulates posthog-react-native-session-replay
    }
    jest.doMock('../src/optional/OptionalPlugin', () => ({ OptionalReactNativePlugin: legacyPlugin }))
    // _logger only emits when debug is on (isDebug = whether debug() was called), so spy on the
    // console and enable debug before init runs.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    const { PostHog } = await import('../src/posthog-rn')
    const posthog = new PostHog('test-token', {
      persistence: 'memory',
      flushInterval: 0,
      enableSessionReplay: true,
      errorTracking: { autocapture: { nativeCrashes: true } },
    })
    posthog.debug(true)

    await posthog.ready()

    await waitForExpect(100, () => {
      expect(legacyPlugin.start).toHaveBeenCalledTimes(1)
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
    jest.resetModules()
    jest.doMock('../src/optional/OptionalPlugin', () => ({ OptionalReactNativePlugin: mockPlugin }))

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

    const { PostHog } = await import('../src/posthog-rn')
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
    const { PostHog } = await import('../src/posthog-rn')
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

    const { PostHog } = await import('../src/posthog-rn')
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
})
