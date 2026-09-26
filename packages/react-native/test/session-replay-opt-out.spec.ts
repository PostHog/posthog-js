import { PostHog, PostHogCustomStorage } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { Linking, AppState } from 'react-native'
import { waitForExpect } from './test-utils'

// Same native bridge mock as the manual recording spec: isEnabled() reports whether the
// recorder is actually running, which is how the SDK confirms a start or a stop.
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

describe('PostHog RN session replay follows consent', () => {
  vi.useRealTimers()

  let posthog: PostHog
  let cache: any = {}
  let mockStorage: PostHogCustomStorage
  let warnSpy: vi.SpyInstance
  let logSpy: vi.SpyInstance
  let errorSpy: vi.SpyInstance

  beforeEach(() => {
    nativeRecording = false

    replay.start.mockReset()
    replay.startSession.mockClear()
    replay.endSession.mockClear()
    replay.stopRecording.mockReset()
    replay.startRecording.mockReset()
    replay.isEnabled.mockReset()
    // The legacy start() path begins recording, like the standalone replay plugin does.
    replay.start.mockImplementation(async () => {
      nativeRecording = true
    })
    replay.startRecording.mockImplementation(async () => {
      nativeRecording = true
    })
    replay.stopRecording.mockImplementation(async () => {
      nativeRecording = false
    })
    replay.isEnabled.mockImplementation(async () => nativeRecording)

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

  const newPostHog = (options: { enableSessionReplay: boolean; defaultOptIn?: boolean }): PostHog => {
    const client = new PostHog('test-token', {
      customStorage: mockStorage,
      flushInterval: 0,
      ...options,
    })
    client.debug(true)
    return client
  }

  it('stops a recording that replay started when the user opts out', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))

    await posthog.optOut()

    await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalled())
    expect(nativeRecording).toBe(false)
    expect(await posthog.isSessionReplayActive()).toBe(false)
  })

  it('stops a recording the app started by hand when the user opts out', async () => {
    posthog = newPostHog({ enableSessionReplay: false })
    await posthog.ready()
    await posthog.startSessionRecording()
    expect(nativeRecording).toBe(true)

    await posthog.optOut()

    await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalled())
    expect(nativeRecording).toBe(false)
  })

  it('starts replay again under a new session when the user opts back in', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    const sessionBeforeOptOut = posthog.getSessionId()

    await posthog.optOut()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(false))
    replay.stopRecording.mockClear()

    await posthog.optIn()

    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    expect(posthog.getSessionId()).not.toBe(sessionBeforeOptOut)
    expect(replay.stopRecording).not.toHaveBeenCalled()
  })

  it('does not record while opted out, and starts once the user opts in', async () => {
    posthog = newPostHog({ enableSessionReplay: true, defaultOptIn: false })
    await posthog.ready()

    // Give the startup evaluation time to run; nothing may start.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(nativeRecording).toBe(false)
    expect(replay.startRecording).not.toHaveBeenCalled()

    await posthog.optIn()

    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
  })

  it('leaves a recording running when the user was never opted out', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))

    // A flags reload re-evaluates replay; consent is intact, so recording must continue.
    await posthog.reloadFeatureFlagsAsync()

    expect(nativeRecording).toBe(true)
    expect(replay.stopRecording).not.toHaveBeenCalled()
  })
})
