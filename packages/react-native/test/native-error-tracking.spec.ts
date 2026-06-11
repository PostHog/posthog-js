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
})
