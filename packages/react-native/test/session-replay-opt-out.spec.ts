import { PostHog, PostHogCustomStorage } from '../src'
import { PostHogPersistedProperty } from '@posthog/core'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { Linking, AppState } from 'react-native'
import { waitForExpect } from './test-utils'

// Same native bridge mock as the manual recording spec: isEnabled() reports whether the
// recorder is actually running, which is how the SDK confirms a start or a stop.
let nativeRecording = false
// Native's own consent flag, set through setOptOut(). Like posthog-ios, startRecording() is
// ignored while it is set.
let nativeOptedOut = false

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
    setOptOut: vi.fn(async () => {}),
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
  setOptOut: vi.Mock
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
  let currentSessionRecording: any
  let currentFlags: Record<string, any>

  beforeEach(() => {
    nativeRecording = false
    nativeOptedOut = false
    currentSessionRecording = { endpoint: '/s/' }
    currentFlags = {}

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
      if (!nativeOptedOut) {
        nativeRecording = true
      }
    })
    replay.setOptOut.mockReset()
    replay.setOptOut.mockImplementation(async (optOut: boolean) => {
      nativeOptedOut = optOut
    })
    replay.stopRecording.mockImplementation(async () => {
      nativeRecording = false
    })
    replay.isEnabled.mockImplementation(async () => nativeRecording)

    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(globalThis as any).window.fetch = vi.fn(async (url: string) => {
      const res: any = { status: 'ok', sessionRecording: currentSessionRecording }
      if (url.includes('flags')) {
        res.featureFlags = currentFlags
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

  // posthog-ios optIn() reinstalls its integrations, which restarts the recorder by itself.
  const mockNativeOptInRestartsRecorder = (): void => {
    replay.setOptOut.mockImplementation(async (optOut: boolean) => {
      nativeOptedOut = optOut
      if (!optOut) {
        nativeRecording = true
      }
    })
  }

  // posthog-android starts recording while opted out; setOptOut() only records consent.
  const mockNativeRecordsWhileOptedOut = (): void => {
    replay.startRecording.mockImplementation(async () => {
      nativeRecording = true
    })
  }

  const newPostHog = (options: { enableSessionReplay: boolean; defaultOptIn?: boolean }): PostHog => {
    const client = new PostHog('test-token', {
      customStorage: mockStorage,
      flushInterval: 0,
      ...options,
    })
    client.debug(true)
    return client
  }

  // Warms the persisted cache with the current replay config and flags, so bootstrap evaluates them.
  const warmCache = async (): Promise<void> => {
    const warmup = newPostHog({ enableSessionReplay: true })
    await warmup.ready()
    await warmup.reloadFeatureFlagsAsync()
    await warmup.shutdown()
    replay.start.mockClear()
    replay.startRecording.mockClear()
    nativeRecording = false
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
    expect(nativeOptedOut).toBe(false)
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('refused to start session recording'))
  })

  it('has the new session in place once optIn() resolves', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    const sessionBeforeOptOut = posthog.getSessionId()
    await posthog.optOut()

    await posthog.optIn()
    const session = posthog.getSessionId()
    posthog.capture('after opt-in')

    expect(session).not.toBe(sessionBeforeOptOut)
    const queue = posthog.getPersistedProperty(PostHogPersistedProperty.Queue) as any[]
    expect(queue.at(-1).message).toMatchObject({ event: 'after opt-in', properties: { $session_id: session } })
  })

  it('leaves a recording the app stopped stopped when the user opts back in', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    await posthog.stopSessionRecording()
    mockNativeOptInRestartsRecorder()

    await posthog.optOut()
    await posthog.optIn()
    // Give the opt-in evaluation time to run; nothing may start.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(nativeRecording).toBe(false)
    expect(replay.startRecording).not.toHaveBeenCalled()
  })

  it('keeps a recording the app stopped stopped when a start was refused while opted out', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    await posthog.stopSessionRecording()
    mockNativeOptInRestartsRecorder()

    await posthog.optOut()
    await posthog.startSessionRecording()
    await posthog.optIn()
    // Give the opt-in evaluation time to run; nothing may start.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(nativeRecording).toBe(false)
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

  it('stops a manually-started recording on opt-out even when a linked flag would have blocked replay', async () => {
    // Warm the persisted cache with a linked flag evaluating false first, exactly like the
    // "warm start" pattern in session-replay-rearm.spec.ts. Without this, the *first* bootstrap
    // evaluation ever run for a token sees an empty cached config (no linkedFlag yet) and
    // defaults recordingActive to true before the real config arrives, which races ahead and
    // sets _sessionReplayRecordingActive itself — masking the bug this test is for.
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': false }
    const warmup = newPostHog({ enableSessionReplay: true })
    await warmup.ready()
    await warmup.reloadFeatureFlagsAsync()
    await warmup.shutdown()
    replay.start.mockClear()
    replay.startRecording.mockClear()
    nativeRecording = false

    // Real run: bootstrap now reads the cached linkedFlag=false config directly, so replay
    // never auto-starts and _sessionReplayRecordingActive is never set by the flags-driven path.
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    expect(nativeRecording).toBe(false)

    await posthog.startSessionRecording()
    expect(nativeRecording).toBe(true)

    await posthog.optOut()

    await waitForExpect(2000, () => expect(nativeRecording).toBe(false))
    expect(replay.stopRecording).toHaveBeenCalled()
  })

  it('requires event triggers to fire again in the new session after opt-in', async () => {
    // Warm the persisted cache so bootstrap evaluates the trigger gate (see the linked-flag test above).
    currentSessionRecording = { eventTriggers: ['$pageview'], endpoint: '/s/' }
    const warmup = newPostHog({ enableSessionReplay: true })
    await warmup.ready()
    await warmup.reloadFeatureFlagsAsync()
    await warmup.shutdown()
    replay.start.mockClear()
    replay.startRecording.mockClear()
    nativeRecording = false

    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    posthog.capture('$pageview')
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    await posthog.optOut()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(false))
    const sessionBeforeOptIn = posthog.getSessionId()
    replay.startRecording.mockClear()

    await posthog.optIn()
    await waitForExpect(2000, () => expect(posthog.getSessionId()).not.toBe(sessionBeforeOptIn))
    // Give the opt-in evaluation time to run; the trigger has not fired in the new session yet.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(replay.startRecording).not.toHaveBeenCalled()
    expect(nativeRecording).toBe(false)

    posthog.capture('$pageview')
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    expect(replay.startRecording).toHaveBeenCalledWith(true)
  })

  it('starts recording when a trigger fires right after optIn() resolves', async () => {
    currentSessionRecording = { eventTriggers: ['$pageview'], endpoint: '/s/' }
    await warmCache()

    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    posthog.capture('$pageview')
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    await posthog.optOut()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(false))

    await posthog.optIn()
    posthog.capture('$pageview')

    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
  })

  it('ends a manual recording on opt-in when replay is disabled, until the app starts it again', async () => {
    posthog = newPostHog({ enableSessionReplay: false })
    await posthog.ready()
    await posthog.startSessionRecording()
    mockNativeOptInRestartsRecorder()

    await posthog.optOut()
    replay.stopRecording.mockClear()
    await posthog.optIn()

    expect(replay.stopRecording).toHaveBeenCalled()
    expect(nativeRecording).toBe(false)

    await posthog.startSessionRecording()
    expect(nativeRecording).toBe(true)
  })

  it('ends a manual recording on opt-in when a linked flag blocks replay', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': false }
    await warmCache()

    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await posthog.startSessionRecording()
    expect(nativeRecording).toBe(true)
    mockNativeOptInRestartsRecorder()

    await posthog.optOut()
    replay.stopRecording.mockClear()
    await posthog.optIn()

    expect(replay.stopRecording).toHaveBeenCalled()
    expect(nativeRecording).toBe(false)
  })

  it('keeps the session when opting in without having opted out', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    const session = posthog.getSessionId()
    replay.startRecording.mockClear()

    await posthog.optIn()
    // Give a would-be opt-in evaluation time to run.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(posthog.getSessionId()).toBe(session)
    expect(replay.startRecording).not.toHaveBeenCalled()
    expect(nativeRecording).toBe(true)
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

  it('keeps a manual recording started while an unawaited optIn() is in flight, with replay disabled', async () => {
    posthog = newPostHog({ enableSessionReplay: false, defaultOptIn: false })
    await posthog.ready()
    mockNativeRecordsWhileOptedOut()

    const optIn = posthog.optIn()
    await posthog.startSessionRecording()
    await optIn
    // Give the opt-in evaluation time to run.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(nativeRecording).toBe(true)
  })

  it('keeps a manual recording started while an unawaited optIn() is in flight, with a linked flag blocking replay', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': false }
    await warmCache()

    posthog = newPostHog({ enableSessionReplay: true, defaultOptIn: false })
    await posthog.ready()
    mockNativeRecordsWhileOptedOut()

    const optIn = posthog.optIn()
    await posthog.startSessionRecording()
    await optIn
    // Give the opt-in evaluation time to run.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(nativeRecording).toBe(true)
  })

  it('keeps a manual recording requested just before optIn()', async () => {
    posthog = newPostHog({ enableSessionReplay: false, defaultOptIn: false })
    await posthog.ready()
    mockNativeRecordsWhileOptedOut()

    const start = posthog.startSessionRecording()
    await posthog.optIn()
    await start
    // Give the opt-in evaluation time to run.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(nativeRecording).toBe(true)
  })

  it('keeps the session of a manual recording started while an unawaited optIn() is in flight', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    await posthog.optOut()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(false))
    mockNativeRecordsWhileOptedOut()
    const session = posthog.getSessionId()

    const optIn = posthog.optIn()
    await posthog.startSessionRecording(true)
    await optIn
    // Give the opt-in evaluation time to run.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(nativeRecording).toBe(true)
    expect(posthog.getSessionId()).toBe(session)
  })

  it('ends the recorder optIn() restarts when the app only tried to start one while opted out', async () => {
    posthog = newPostHog({ enableSessionReplay: false })
    await posthog.ready()
    await posthog.startSessionRecording()
    mockNativeOptInRestartsRecorder()
    await posthog.optOut()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(false))

    await posthog.startSessionRecording()
    expect(nativeRecording).toBe(false)
    await posthog.optIn()

    expect(nativeRecording).toBe(false)
  })
})
