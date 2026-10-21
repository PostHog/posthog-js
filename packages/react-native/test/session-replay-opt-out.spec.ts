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

  it('waits for the replay stop before optOut() resolves', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    replay.stopRecording.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      nativeRecording = false
    })

    await posthog.optOut()

    expect(nativeRecording).toBe(false)
  })

  it('captures on the new session right after an unawaited optIn()', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    const sessionBeforeOptOut = posthog.getSessionId()
    await posthog.optOut()

    const optIn = posthog.optIn()
    posthog.capture('consent given')
    await optIn

    const queue = posthog.getPersistedProperty(PostHogPersistedProperty.Queue) as any[]
    const sessionId = queue.at(-1).message.properties.$session_id
    expect(sessionId).not.toBe(sessionBeforeOptOut)
    expect(posthog.getSessionId()).toBe(sessionId)
    expect(nativeRecording).toBe(true)
  })

  it('starts a new session when optIn() runs while native setup is still in flight', async () => {
    const sessionStorage = { enablePersistSessionIdAcrossRestart: true }
    const previous = new PostHog('test-token', { customStorage: mockStorage, flushInterval: 0, ...sessionStorage })
    await previous.ready()
    const sessionBeforeOptOut = previous.getSessionId()
    await previous.optOut()
    await previous.shutdown()
    // Hold the isEnabled() round trip that precedes start(), so optIn() rotates before native starts.
    let releaseSetup: () => void = () => {}
    replay.isEnabled.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          releaseSetup = () => resolve(false)
        })
    )

    posthog = new PostHog('test-token', {
      customStorage: mockStorage,
      flushInterval: 0,
      enableSessionReplay: true,
      ...sessionStorage,
    })
    await posthog.ready()
    await waitForExpect(2000, () => expect(replay.isEnabled).toHaveBeenCalled())
    expect(replay.start).not.toHaveBeenCalled()

    const optIn = posthog.optIn()
    const sessionId = posthog.getPersistedProperty(PostHogPersistedProperty.SessionId)
    releaseSetup()
    await optIn

    // Nothing captured since, so native must have been moved onto the new session by setup itself.
    expect(sessionId).not.toBe(sessionBeforeOptOut)
    expect(replay.startSession).toHaveBeenLastCalledWith(sessionId)
    expect(replay.start.mock.invocationCallOrder[0]).toBeLessThan(replay.startSession.mock.invocationCallOrder.at(-1)!)
  })

  it('still opts in when rotating the native session throws', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    await posthog.optOut()
    replay.endSession.mockImplementationOnce(() => {
      throw new Error('LINKING_ERROR')
    })

    await posthog.optIn()

    expect(posthog.optedOut).toBe(false)
    expect(nativeOptedOut).toBe(false)
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
    // A later flags reload must not restart it either.
    await posthog.reloadFeatureFlagsAsync()
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(nativeRecording).toBe(false)
    expect(replay.startRecording).not.toHaveBeenCalled()
  })

  it('restarts replay in a new session on opt-in when a linked flag held it off at opt-out', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': false }
    await warmCache()

    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    // Give the startup evaluation time to run; the linked flag keeps replay off.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(nativeRecording).toBe(false)
    const sessionBeforeOptOut = posthog.getSessionId()

    await posthog.optOut()
    currentFlags = { 'replay-flag': true }
    await posthog.reloadFeatureFlagsAsync()
    expect(nativeRecording).toBe(false)
    await posthog.optIn()

    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    expect(posthog.getSessionId()).not.toBe(sessionBeforeOptOut)
  })

  it('restarts replay on opt-in when the app started it and it was waiting for an event trigger at opt-out', async () => {
    currentSessionRecording = { eventTriggers: ['$pageview'], endpoint: '/s/' }
    await warmCache()
    // Native holds the start until the trigger fires.
    replay.start.mockImplementation(async () => {})
    replay.startRecording.mockImplementation(async () => {})

    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await posthog.startSessionRecording()
    expect(nativeRecording).toBe(false)
    const sessionBeforeOptOut = posthog.getSessionId()

    await posthog.optOut()
    replay.startRecording.mockImplementation(async () => {
      if (!nativeOptedOut) {
        nativeRecording = true
      }
    })
    await posthog.optIn()
    expect(posthog.getSessionId()).not.toBe(sessionBeforeOptOut)
    expect(nativeRecording).toBe(false)

    posthog.capture('$pageview')
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
  })

  it('restarts replay on opt-in when an evaluation queued before optOut() stopped it', async () => {
    let releaseStart: () => void = () => {}
    replay.start.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseStart = () => {
            nativeRecording = true
            resolve()
          }
        })
    )
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    // The startup evaluation is held in native setup, so the flags evaluation queues behind it.
    const reload = posthog.reloadFeatureFlagsAsync()
    await reload
    const optOut = posthog.optOut()
    releaseStart()
    await optOut
    expect(nativeRecording).toBe(false)

    await posthog.optIn()

    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
  })

  it('keeps replay stopped when the app stops it while an unawaited optIn() is in flight', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    await posthog.optOut()
    mockNativeOptInRestartsRecorder()

    const optIn = posthog.optIn()
    await posthog.stopSessionRecording()
    await optIn
    // Give the opt-in evaluation time to run; nothing may start.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(nativeRecording).toBe(false)
  })

  it('keeps replay stopped on a flags reload after the app stops it during an unawaited optIn()', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    await posthog.optOut()

    const optIn = posthog.optIn()
    await posthog.stopSessionRecording()
    await optIn
    await posthog.reloadFeatureFlagsAsync()
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(nativeRecording).toBe(false)
  })

  it('starts a new session on an immediate opt-in after an unawaited optOut() when the app restarted replay', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    await posthog.stopSessionRecording()
    await posthog.startSessionRecording()
    expect(nativeRecording).toBe(true)
    const sessionBeforeOptOut = posthog.getSessionId()

    void posthog.optOut()
    await posthog.optIn()

    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    expect(posthog.getSessionId()).not.toBe(sessionBeforeOptOut)
  })

  it('re-evaluates replay in a new session on opt-in when native held it off at opt-out', async () => {
    // Native leaves the recorder off, as when the session is sampled out.
    replay.start.mockImplementation(async () => {})
    replay.startRecording.mockImplementation(async () => {})
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    // Give the startup evaluation time to run; the recorder doesn't start.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(nativeRecording).toBe(false)
    const sessionBeforeOptOut = posthog.getSessionId()

    await posthog.optOut()
    await posthog.optIn()

    await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalledWith(true))
    expect(nativeRecording).toBe(false)
    expect(posthog.getSessionId()).not.toBe(sessionBeforeOptOut)
  })

  it.each([true, false])(
    'keeps replay stopped when optOut() follows an unawaited optIn(), across a flags reload (enableSessionReplay: %s)',
    async (enableSessionReplay) => {
      posthog = newPostHog({ enableSessionReplay })
      await posthog.ready()
      if (!enableSessionReplay) {
        await posthog.startSessionRecording()
      }
      await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
      await posthog.optOut()
      mockNativeOptInRestartsRecorder()

      void posthog.optIn()
      await posthog.optOut()
      await posthog.reloadFeatureFlagsAsync()
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(nativeRecording).toBe(false)
    }
  )

  it.each([true, false])(
    'restarts replay on opt-in after an optOut() made before an unawaited optIn() restored it (enableSessionReplay: %s)',
    async (enableSessionReplay) => {
      posthog = newPostHog({ enableSessionReplay })
      await posthog.ready()
      if (!enableSessionReplay) {
        await posthog.startSessionRecording()
      }
      await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
      await posthog.optOut()

      void posthog.optIn()
      await posthog.optOut()
      await posthog.optIn()

      await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    }
  )

  it('restarts replay on opt-in when optOut() cancels a manual start still in flight', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    const sessionBeforeOptOut = posthog.getSessionId()
    let releaseStart: () => void = () => {}
    replay.startRecording.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseStart = () => {
            if (!nativeOptedOut) {
              nativeRecording = true
            }
            resolve()
          }
        })
    )
    const start = posthog.startSessionRecording()
    await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalled())
    const optOut = posthog.optOut()
    releaseStart()
    await start
    await optOut
    expect(nativeRecording).toBe(false)
    replay.startRecording.mockImplementation(async () => {
      if (!nativeOptedOut) {
        nativeRecording = true
      }
    })

    await posthog.optIn()

    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    expect(posthog.getSessionId()).not.toBe(sessionBeforeOptOut)
  })

  it('keeps replay stopped on opt-in when the app stopped it right before an unawaited optOut()', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    const sessionBeforeOptOut = posthog.getSessionId()

    void posthog.stopSessionRecording()
    await posthog.optOut()
    await posthog.optIn()
    // Give the opt-in evaluation time to run; nothing may start.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(nativeRecording).toBe(false)
    expect(posthog.getSessionId()).toBe(sessionBeforeOptOut)
  })

  it('keeps replay stopped on opt-in when the app stopped an in-flight start right before optOut()', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    await posthog.stopSessionRecording()
    const sessionBeforeOptOut = posthog.getSessionId()
    let releaseStart: () => void = () => {}
    replay.startRecording.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseStart = () => {
            nativeRecording = true
            resolve()
          }
        })
    )
    const start = posthog.startSessionRecording()
    await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalled())
    void posthog.stopSessionRecording()
    const optOut = posthog.optOut()
    releaseStart()
    await start
    await optOut
    replay.startRecording.mockImplementation(async () => {
      if (!nativeOptedOut) {
        nativeRecording = true
      }
    })
    await posthog.optIn()
    // Give the opt-in evaluation time to run; nothing may start.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(nativeRecording).toBe(false)
    expect(posthog.getSessionId()).toBe(sessionBeforeOptOut)
  })

  it('restarts replay on opt-in when the app stopped it while opted out', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    const sessionBeforeOptOut = posthog.getSessionId()

    await posthog.optOut()
    await posthog.stopSessionRecording()
    await posthog.optIn()

    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    expect(posthog.getSessionId()).not.toBe(sessionBeforeOptOut)
  })

  it('keeps replay stopped when the app stops it during an immediate opt-in after an unawaited optOut()', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    mockNativeOptInRestartsRecorder()

    void posthog.optOut()
    const optIn = posthog.optIn()
    await posthog.stopSessionRecording()
    await optIn
    // Give the opt-in evaluation time to run; nothing may start.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(nativeRecording).toBe(false)
  })

  it('leaves replay the app stopped off on opt-in even after a linked flag restarted it', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': true }
    await warmCache()

    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    await posthog.stopSessionRecording()
    currentFlags = { 'replay-flag': false }
    await posthog.reloadFeatureFlagsAsync()
    currentFlags = { 'replay-flag': true }
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    mockNativeOptInRestartsRecorder()

    await posthog.optOut()
    await posthog.optIn()

    expect(nativeRecording).toBe(false)
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

  it('restarts a manual recording under a new session on opt-in when replay is disabled', async () => {
    posthog = newPostHog({ enableSessionReplay: false })
    await posthog.ready()
    await posthog.startSessionRecording()
    const sessionBeforeOptOut = posthog.getSessionId()

    await posthog.optOut()
    expect(nativeRecording).toBe(false)
    await posthog.optIn()

    expect(nativeRecording).toBe(true)
    expect(posthog.getSessionId()).not.toBe(sessionBeforeOptOut)
  })

  it('restarts a manual recording waiting for an event trigger once it fires after opt-in, with replay disabled', async () => {
    currentSessionRecording = { eventTriggers: ['$pageview'], endpoint: '/s/' }
    await warmCache()
    // Native holds the start until the trigger has fired in the current session.
    replay.start.mockImplementation(async () => {})
    replay.startRecording.mockImplementation(async () => {
      const activated = posthog.getPersistedProperty(PostHogPersistedProperty.SessionReplayEventTriggerActivatedSession)
      if (!nativeOptedOut && activated === posthog.getSessionId()) {
        nativeRecording = true
      }
    })
    posthog = newPostHog({ enableSessionReplay: false })
    await posthog.ready()
    await posthog.startSessionRecording()
    expect(nativeRecording).toBe(false)
    const sessionBeforeOptOut = posthog.getSessionId()

    await posthog.optOut()
    await posthog.optIn()
    expect(posthog.getSessionId()).not.toBe(sessionBeforeOptOut)
    expect(nativeRecording).toBe(false)

    posthog.capture('$pageview')
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
  })

  it('retries a manual recording native refuses to restart on opt-in, on the opt-in session', async () => {
    posthog = newPostHog({ enableSessionReplay: false })
    await posthog.ready()
    await posthog.startSessionRecording()
    await posthog.optOut()
    replay.startRecording.mockImplementationOnce(async () => {})

    await posthog.optIn()
    expect(nativeRecording).toBe(false)
    const sessionAfterOptIn = posthog.getSessionId()

    await waitForExpect(3000, () => expect(nativeRecording).toBe(true))
    expect(posthog.getSessionId()).toBe(sessionAfterOptIn)
  })

  it('leaves replay off on opt-in when replay is disabled and the app never started it', async () => {
    posthog = newPostHog({ enableSessionReplay: false })
    await posthog.ready()

    await posthog.optOut()
    await posthog.optIn()
    // Give the opt-in evaluation time to run; nothing may start.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(replay.startRecording).not.toHaveBeenCalled()
    expect(nativeRecording).toBe(false)
  })

  it('leaves replay off on opt-in when replay is disabled and the app launched opted out', async () => {
    posthog = newPostHog({ enableSessionReplay: false, defaultOptIn: false })
    await posthog.ready()

    await posthog.optIn()
    // Give the opt-in evaluation time to run; nothing may start.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(replay.startRecording).not.toHaveBeenCalled()
    expect(nativeRecording).toBe(false)
  })

  it('leaves a manual recording the app stopped before opt-out stopped on opt-in when replay is disabled', async () => {
    posthog = newPostHog({ enableSessionReplay: false })
    await posthog.ready()
    await posthog.startSessionRecording()
    await posthog.stopSessionRecording()
    mockNativeOptInRestartsRecorder()

    await posthog.optOut()
    await posthog.optIn()

    expect(nativeRecording).toBe(false)
  })

  it('leaves replay off on opt-in when replay is disabled and native is up only for push', async () => {
    // Only the unified plugin's setup() brings native up for push.
    const plugin = OptionalReactNativePlugin as unknown as { setup?: vi.Mock }
    plugin.setup = vi.fn(async () => {})
    try {
      posthog = newPostHog({ enableSessionReplay: false })
      await posthog.ready()
      await waitForExpect(2000, () => expect(plugin.setup).toHaveBeenCalled())
      const sessionBeforeOptOut = posthog.getSessionId()

      await posthog.optOut()
      await posthog.optIn()
      // Give the opt-in evaluation time to run; nothing may start.
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(replay.startRecording).not.toHaveBeenCalled()
      expect(nativeRecording).toBe(false)
      expect(posthog.getSessionId()).toBe(sessionBeforeOptOut)
    } finally {
      delete plugin.setup
    }
  })

  it('restarts a manual recording when reset() clears the opt-out with replay disabled', async () => {
    posthog = newPostHog({ enableSessionReplay: false })
    await posthog.ready()
    await posthog.startSessionRecording()
    await posthog.optOut()
    expect(nativeRecording).toBe(false)

    posthog.reset()

    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
  })

  it('leaves a manual recording the app stopped stopped when reset() clears the opt-out with replay disabled', async () => {
    posthog = newPostHog({ enableSessionReplay: false })
    await posthog.ready()
    await posthog.startSessionRecording()
    await posthog.stopSessionRecording()
    mockNativeOptInRestartsRecorder()
    await posthog.optOut()

    posthog.reset()

    // Give the opt-in evaluation time to run.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(nativeRecording).toBe(false)
  })

  it('leaves a recording the app stopped stopped when reset() clears the opt-out', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    await posthog.stopSessionRecording()
    mockNativeOptInRestartsRecorder()
    await posthog.optOut()

    posthog.reset()

    // Give the opt-in evaluation time to run.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(nativeRecording).toBe(false)
  })

  it('does not restore a manual recording on opt-in when a linked flag blocks replay', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': false }
    await warmCache()

    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await posthog.startSessionRecording()
    expect(nativeRecording).toBe(true)
    mockNativeOptInRestartsRecorder()

    await posthog.optOut()
    replay.startRecording.mockClear()
    await posthog.optIn()

    expect(replay.startRecording).not.toHaveBeenCalled()
    expect(nativeRecording).toBe(false)
  })

  it('does not restart a manual recording the linked flag held off at opt-in on a later flags reload', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': false }
    await warmCache()

    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await posthog.startSessionRecording()
    await posthog.optOut()
    // Native refuses to start while its own linked-flag check fails.
    replay.startRecording.mockImplementation(async () => {})
    replay.startRecording.mockClear()
    await posthog.optIn()

    await posthog.reloadFeatureFlagsAsync()
    // Longer than the first manual-start retry delay.
    await new Promise((resolve) => setTimeout(resolve, 1500))

    expect(replay.startRecording).not.toHaveBeenCalled()
    expect(nativeRecording).toBe(false)
  })

  it('waits for an event trigger in the new session before restoring a manual recording on opt-in', async () => {
    currentSessionRecording = { eventTriggers: ['$pageview'], endpoint: '/s/' }
    await warmCache()

    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await posthog.startSessionRecording()
    expect(nativeRecording).toBe(true)
    mockNativeOptInRestartsRecorder()

    await posthog.optOut()
    await posthog.optIn()
    expect(nativeRecording).toBe(false)

    posthog.capture('$pageview')
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
  })

  it('keeps replay stopped when the app stops it while the opt-in restore is starting', async () => {
    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(true))
    await posthog.startSessionRecording()
    await posthog.optOut()

    let releaseStart: () => void = () => {}
    replay.startRecording.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseStart = () => {
            nativeRecording = true
            resolve()
          }
        })
    )
    replay.startRecording.mockClear()
    const optIn = posthog.optIn()
    await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalled())
    const stop = posthog.stopSessionRecording()
    releaseStart()
    await Promise.all([optIn, stop])
    expect(nativeRecording).toBe(false)

    await posthog.reloadFeatureFlagsAsync()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(nativeRecording).toBe(false)
  })

  it('leaves a manual recording the app stopped stopped on opt-in when a linked flag blocks replay', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': false }
    await warmCache()

    posthog = newPostHog({ enableSessionReplay: true })
    await posthog.ready()
    await posthog.startSessionRecording()
    await posthog.stopSessionRecording()
    mockNativeOptInRestartsRecorder()

    await posthog.optOut()
    await posthog.optIn()

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
    // Give the flags-triggered evaluation time to run.
    await new Promise((resolve) => setTimeout(resolve, 100))

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

    const optIn = posthog.optIn()
    const session = posthog.getSessionId()
    await posthog.startSessionRecording(true)
    await optIn
    // Give the opt-in evaluation time to run.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(nativeRecording).toBe(true)
    expect(posthog.getSessionId()).toBe(session)
  })

  it('restarts a manual recording on opt-in when the app also tried to start one while opted out', async () => {
    posthog = newPostHog({ enableSessionReplay: false })
    await posthog.ready()
    await posthog.startSessionRecording()
    await posthog.optOut()
    await waitForExpect(2000, () => expect(nativeRecording).toBe(false))

    await posthog.startSessionRecording()
    expect(nativeRecording).toBe(false)
    await posthog.optIn()

    expect(nativeRecording).toBe(true)
  })
})
