import { PostHog, PostHogCustomStorage } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { Linking, AppState } from 'react-native'
import { waitForExpect, wait } from './test-utils'

// Mock the native plugin bridge. No `setup` key, so the SDK takes the legacy start()
// path (same surface as the standalone posthog-react-native-session-replay package).
// The mock models the native recorder state: isEnabled() answers what start()/startRecording()
// actually did, which is how a real native SDK reports a start it refused.
let nativeAccepts = true
let nativeRecording = false

vi.mock('../src/optional/OptionalPlugin', () => ({
  OptionalReactNativePluginVersion: '1.4.0',
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

const replay = OptionalReactNativePlugin as unknown as {
  start: vi.Mock
  startSession: vi.Mock
  endSession: vi.Mock
  isEnabled: vi.Mock
  identify: vi.Mock
  startRecording: vi.Mock
  stopRecording: vi.Mock
}

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()

describe('PostHog RN manual session recording controls', () => {
  vi.useRealTimers()

  let posthog: PostHog
  let cache: any = {}
  let mockStorage: PostHogCustomStorage
  let warnSpy: vi.SpyInstance
  let logSpy: vi.SpyInstance
  let errorSpy: vi.SpyInstance

  const warnings = (): string[] => warnSpy.mock.calls.map((args) => args.join(' '))

  beforeEach(() => {
    nativeAccepts = true
    nativeRecording = false

    replay.start.mockClear()
    replay.startRecording.mockClear()
    replay.stopRecording.mockClear()
    replay.isEnabled.mockClear()
    replay.isEnabled.mockImplementation(async () => nativeRecording)
    replay.startRecording.mockImplementation(async () => {
      nativeRecording = nativeAccepts
    })
    replay.stopRecording.mockImplementation(async () => {
      nativeRecording = false
    })

    // Debug mode is on below, so every log level needs a sink; the test setup turns any
    // unexpected console output into a failure.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(globalThis as any).window.fetch = vi.fn(async (url: string) => {
      const res: any = { status: 'ok', sessionRecording: { endpoint: '/s/' } }
      if (url.includes('flags')) {
        res.featureFlags = {}
      }
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
    await posthog.shutdown()
    warnSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  // Recording only some sessions: replay stays off at setup, the app drives the recorder.
  const newPostHog = (): PostHog => {
    const client = new PostHog('test-token', {
      customStorage: mockStorage,
      enableSessionReplay: false,
      flushInterval: 0,
    })
    // The logger only reaches the console in debug mode.
    client.debug(true)
    return client
  }

  it('reports success when the native recorder starts', async () => {
    posthog = newPostHog()
    await posthog.ready()

    expect(await posthog.startSessionRecording()).toBe(true)
    expect(await posthog.isSessionReplayActive()).toBe(true)
  })

  it('reports failure and warns when the native SDK refuses the start', async () => {
    nativeAccepts = false
    posthog = newPostHog()
    await posthog.ready()

    expect(await posthog.startSessionRecording()).toBe(false)
    expect(await posthog.isSessionReplayActive()).toBe(false)
    expect(
      warnings().some(
        (line) =>
          line.includes('native SDK refused to start session recording') &&
          line.includes('next feature flags load retries the start')
      )
    ).toBe(true)
  })

  it('retries a refused start on the next flags load, even with replay disabled at setup', async () => {
    nativeAccepts = false
    posthog = newPostHog()
    await posthog.ready()

    expect(await posthog.startSessionRecording()).toBe(false)
    const attempts = replay.startRecording.mock.calls.length

    // Native has loaded its own remote config by the time the next flags load lands.
    nativeAccepts = true
    await posthog.reloadFeatureFlagsAsync()

    await waitForExpect(2000, () => expect(replay.startRecording.mock.calls.length).toBeGreaterThan(attempts))
    await waitForExpect(2000, async () => expect(await posthog.isSessionReplayActive()).toBe(true))
  })

  it('does not retry a refused start once the app stops recording', async () => {
    nativeAccepts = false
    posthog = newPostHog()
    await posthog.ready()

    await posthog.startSessionRecording()
    expect(await posthog.stopSessionRecording()).toBe(true)
    const attempts = replay.startRecording.mock.calls.length

    nativeAccepts = true
    await posthog.reloadFeatureFlagsAsync()
    await wait(50)

    expect(replay.startRecording).toHaveBeenCalledTimes(attempts)
    expect(await posthog.isSessionReplayActive()).toBe(false)
  })

  it('does not revive a refused start when the stop lands while a retry is in flight', async () => {
    nativeAccepts = false
    posthog = newPostHog()
    await posthog.ready()

    await posthog.startSessionRecording()

    // Hold the retry inside the native start, so the stop below overlaps it.
    let releaseRetry: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      releaseRetry = resolve
    })
    let retryStarted: () => void = () => {}
    const inFlight = new Promise<void>((resolve) => {
      retryStarted = resolve
    })
    replay.startRecording.mockImplementation(async () => {
      retryStarted()
      await held
      nativeRecording = nativeAccepts
    })

    void posthog.reloadFeatureFlagsAsync()
    await inFlight

    const stopping = posthog.stopSessionRecording()
    // Long enough for an unserialized stop to run to completion ahead of the retry.
    await wait(20)
    releaseRetry()
    expect(await stopping).toBe(true)

    // Native accepts now, so a revived pending start would record the flow the app excluded.
    nativeAccepts = true
    replay.startRecording.mockImplementation(async () => {
      nativeRecording = nativeAccepts
    })
    const attempts = replay.startRecording.mock.calls.length

    await posthog.reloadFeatureFlagsAsync()
    await wait(50)

    expect(replay.startRecording).toHaveBeenCalledTimes(attempts)
    expect(await posthog.isSessionReplayActive()).toBe(false)
  })

  it('does not retry a refused start for the next user after reset()', async () => {
    nativeAccepts = false
    posthog = newPostHog()
    await posthog.ready()

    expect(await posthog.startSessionRecording()).toBe(false)
    const attempts = replay.startRecording.mock.calls.length

    // Native has had its remote config for a while by logout, so a leaked pending start
    // would succeed here and record a session the new, anonymous user never asked for.
    nativeAccepts = true
    posthog.reset()
    await wait(50)

    expect(replay.startRecording).toHaveBeenCalledTimes(attempts)
    expect(await posthog.isSessionReplayActive()).toBe(false)
  })

  it('reports failure when the plugin is too old to control recording', async () => {
    const startRecording = replay.startRecording
    delete (replay as any).startRecording
    try {
      posthog = newPostHog()
      await posthog.ready()

      expect(await posthog.startSessionRecording()).toBe(false)
      expect(warnings().some((line) => line.includes('startRecording is not available'))).toBe(true)
    } finally {
      ;(replay as any).startRecording = startRecording
    }
  })
})
