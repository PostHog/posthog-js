import { PostHog, PostHogCustomStorage, PostHogPersistedProperty } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { Linking, AppState } from 'react-native'
import { waitForExpect, wait } from './test-utils'

// Mock the native plugin bridge so we can assert which native calls happen. No `setup`
// key, so the SDK takes the legacy start() path (same surface as the standalone
// posthog-react-native-session-replay package).
// NOTE: the factory must be self-contained (vi hoists it above any const), so we
// build the vi.fn()s inline and reach them through the imported module handle below.
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

describe('PostHog RN session replay re-arm after flags reload', () => {
  vi.useRealTimers()

  let posthog: PostHog
  let cache: any = {}
  let mockStorage: PostHogCustomStorage

  // Controls what the mocked /flags response returns.
  let currentFlags: Record<string, any> = {}
  let currentSessionRecording: any = {}

  beforeEach(() => {
    replay.start.mockClear()
    replay.startSession.mockClear()
    replay.endSession.mockClear()
    replay.startRecording.mockClear()
    replay.stopRecording.mockClear()
    replay.identify.mockClear()
    replay.isEnabled.mockClear()
    replay.isEnabled.mockImplementation(async () => false)
    replay.start.mockImplementation(async () => {})

    currentFlags = {}
    currentSessionRecording = {}
    ;(globalThis as any).window.fetch = vi.fn(async (url: string) => {
      let res: any = { status: 'ok' }
      if (url.includes('flags')) {
        res = {
          featureFlags: currentFlags,
          sessionRecording: currentSessionRecording,
        }
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
  })

  const newPostHog = (): PostHog =>
    new PostHog('test-token', {
      customStorage: mockStorage,
      enableSessionReplay: true,
      flushInterval: 0,
    })

  it('common case: replay with no linked flag starts at bootstrap and is not double-started on identify', async () => {
    currentSessionRecording = { endpoint: '/s/' } // no linkedFlag => active
    posthog = newPostHog()
    await posthog.ready()

    // Native recording starts once at bootstrap.
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))

    // Native is now enabled; the subsequent identify path should rotate, not re-init.
    replay.isEnabled.mockImplementation(async () => true)

    posthog.identify('user-1')
    await posthog.reloadFeatureFlagsAsync()

    // Should not start a second native session (no double-init).
    await new Promise((r) => setTimeout(r, 50))
    expect(replay.start).toHaveBeenCalledTimes(1)
  })

  it('warm start: linked-flag off -> on after identify re-arms recording (matches native auto re-arm)', async () => {
    // Phase 1 (first launch): cache the linkedFlag recording config and a FALSE flag value,
    // so the next launch evaluates the linked flag from cache at bootstrap.
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': false }
    const warmup = newPostHog()
    await warmup.ready()
    await warmup.reloadFeatureFlagsAsync()
    await wait(50)
    await warmup.shutdown()
    replay.start.mockClear()

    // Phase 2 (next launch): bootstrap respects the cached linked flag (false) -> no recording.
    posthog = newPostHog()
    await posthog.ready()
    await wait(50)
    expect(replay.start).not.toHaveBeenCalled()

    // User logs in; the linked flag now evaluates TRUE on the next flags reload.
    currentFlags = { 'replay-flag': true }
    posthog.identify('user-1')
    await posthog.reloadFeatureFlagsAsync()

    // The linked flag now evaluates true on reload, so replay re-arms and native start is called.
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
  })

  it('reset() keeps the project-level recording config (not user data) so replay survives an identity change', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': true }

    posthog = newPostHog()
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()

    // Armed for the first user, and the project-level recording config is cached.
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    expect(posthog.getPersistedProperty(PostHogPersistedProperty.RemoteConfig)).toBeTruthy()

    // Native is now enabled; the post-reset reload should re-evaluate, not start a second session.
    replay.isEnabled.mockImplementation(async () => true)

    // User logs out. reset() keeps the recording config (project-level, not user data) so it stays
    // available for the next user's flags to be re-evaluated against. The /flags reload after reset()
    // does not carry the remote config, so only the cache makes it available before the next launch.
    posthog.reset()
    await posthog.reloadFeatureFlagsAsync()
    await wait(50)

    expect(posthog.getPersistedProperty(PostHogPersistedProperty.RemoteConfig)).toBeTruthy()
    expect(replay.start).toHaveBeenCalledTimes(1)
  })

  it('pauses recording when the linked flag turns off and resumes when it turns back on', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': true }

    posthog = newPostHog()
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()

    // Linked flag is active -> recording starts.
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    replay.isEnabled.mockImplementation(async () => true)

    // Linked flag turns off (e.g. the identified user is outside the rollout) -> recording pauses.
    currentFlags = { 'replay-flag': false }
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalledTimes(1))

    // Linked flag turns back on -> recording resumes without starting a second native session.
    currentFlags = { 'replay-flag': true }
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalledTimes(1))
    expect(replay.start).toHaveBeenCalledTimes(1)
  })

  it('retries resume on the next flags reload when startRecording fails', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': true }

    posthog = newPostHog()
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    replay.isEnabled.mockImplementation(async () => true)

    // Pause via flag off.
    currentFlags = { 'replay-flag': false }
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalledTimes(1))

    // Flag back on, but the native resume call fails once -> must roll back.
    replay.startRecording.mockRejectedValueOnce(new Error('native resume failed'))
    currentFlags = { 'replay-flag': true }
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalledTimes(1))

    // Next reload retries the resume instead of early-returning.
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalledTimes(2))
  })

  it('retries pause on the next flags reload when stopRecording fails', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': true }

    posthog = newPostHog()
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    replay.isEnabled.mockImplementation(async () => true)

    // Flag turns off, but the native stop call fails once -> recording state must NOT clear.
    replay.stopRecording.mockRejectedValueOnce(new Error('native stop failed'))
    currentFlags = { 'replay-flag': false }
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalledTimes(1))

    // Flag still off on the next reload: since the stop failed, the pause is retried
    // instead of being treated as already-paused.
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalledTimes(2))
  })

  it('retries the start after a refused start is followed by a failed stop', { timeout: 30000 }, async () => {
    // isEnabled mirrors the native recorder state; start() brings it up, stopRecording() stops it.
    let enabled = false
    replay.isEnabled.mockImplementation(async () => enabled)
    replay.start.mockImplementation(async () => {
      enabled = true
    })
    replay.stopRecording.mockImplementation(async () => {
      enabled = false
    })

    // Warm-up launch caches the linkedFlag config so the next launch evaluates it at bootstrap.
    currentSessionRecording = { linkedFlag: 'f', endpoint: '/s/' }
    currentFlags = { f: false }
    const warmup = newPostHog()
    await warmup.ready()
    await warmup.reloadFeatureFlagsAsync()
    await wait(50)
    await warmup.shutdown()
    // The warm-up's own bootstrap start + flag-off stop must not count in the phases below.
    replay.start.mockClear()
    replay.startRecording.mockClear()
    replay.stopRecording.mockClear()

    // Launch with the flag on: recording starts.
    currentFlags = { f: true }
    posthog = newPostHog()
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    await wait(50)

    // Flag off with a clean stop: paused, recorder off.
    currentFlags = { f: false }
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalledTimes(1))
    expect(enabled).toBe(false)

    // Flag on, but the recorder refuses the resume (isEnabled stays false).
    currentFlags = { f: true }
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalledTimes(1))
    await wait(50)
    expect(enabled).toBe(false)
    expect((posthog as any)._sessionReplayStartFailed).toBe(true)

    // Flag off, but this stop throws: recording was never active, so it must stay off with the
    // start-failed hold intact (a stale "active" would dedup the next flag-on into no-op).
    replay.stopRecording.mockRejectedValueOnce(new Error('native stop failed'))
    currentFlags = { f: false }
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalledTimes(2))
    await wait(50)
    expect((posthog as any)._sessionReplayRecordingActive).toBe(false)
    expect((posthog as any)._sessionReplayStartFailed).toBe(true)

    // Flag on: the start is retried, and this time the recorder accepts it.
    replay.startRecording.mockImplementation(async () => {
      enabled = true
    })
    currentFlags = { f: true }
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalledTimes(2))
  })

  // Warm-up launch caches the linkedFlag config so the next launch evaluates it at bootstrap.
  const warmUpLinkedFlag = async (): Promise<void> => {
    currentSessionRecording = { linkedFlag: 'f', endpoint: '/s/' }
    currentFlags = { f: false }
    const warmup = newPostHog()
    await warmup.ready()
    await warmup.reloadFeatureFlagsAsync()
    await wait(50)
    await warmup.shutdown()
    replay.start.mockClear()
    replay.startRecording.mockClear()
    replay.stopRecording.mockClear()
  }

  it('does not stop a native recorder that never started when the flag turns off', { timeout: 30000 }, async () => {
    await warmUpLinkedFlag()

    // Flag on, but the native plugin fails to start: replay was never initialized.
    replay.start.mockRejectedValue(new Error('native start failed'))
    currentFlags = { f: true }
    posthog = newPostHog()
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalled())
    await wait(50)
    expect((posthog as any)._sessionReplayNativeInitialized).toBe(false)
    expect((posthog as any)._sessionReplayStartFailed).toBe(true)

    // Flag off: there is no native recorder to stop.
    currentFlags = { f: false }
    await posthog.reloadFeatureFlagsAsync()
    await wait(100)
    expect(replay.stopRecording).not.toHaveBeenCalled()
    expect((posthog as any)._sessionReplayStartFailed).toBe(false)
  })

  it(
    'a failed stop of an active recording keeps it active without flagging a failed start',
    { timeout: 30000 },
    async () => {
      await warmUpLinkedFlag()

      currentFlags = { f: true }
      posthog = newPostHog()
      await posthog.ready()
      await posthog.reloadFeatureFlagsAsync()
      await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
      await wait(50)

      // Flag off, but the stop throws: still recording, so the next reload retries the stop. The
      // start never failed, so a matching trigger event must not re-run the start path.
      replay.stopRecording.mockRejectedValueOnce(new Error('native stop failed'))
      currentFlags = { f: false }
      await posthog.reloadFeatureFlagsAsync()
      await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalledTimes(1))
      await wait(50)
      expect((posthog as any)._sessionReplayRecordingActive).toBe(true)
      expect((posthog as any)._sessionReplayStartFailed).toBe(false)
    }
  )

  it('arms recording from updateFlags when the SDK never fetches flags (disableRemoteFeatureFlags)', async () => {
    // Warm-up launch (flag fetching enabled) caches the linkedFlag recording config and a
    // FALSE flag value, so the next launch evaluates the linked flag from cache at bootstrap.
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': false }
    const warmup = newPostHog()
    await warmup.ready()
    await warmup.reloadFeatureFlagsAsync()
    await wait(50)
    await warmup.shutdown()
    replay.start.mockClear()
    ;((globalThis as any).window.fetch as vi.Mock).mockClear()

    // Next launch never evaluates flags itself: the cached linked flag (false) gates bootstrap.
    posthog = new PostHog('test-token', {
      customStorage: mockStorage,
      enableSessionReplay: true,
      flushInterval: 0,
      disableRemoteFeatureFlags: true,
    })
    await posthog.ready()
    await wait(50)
    expect(replay.start).not.toHaveBeenCalled()

    // The app pushes its locally evaluated flags -> the featureflags emit re-arms replay.
    posthog.updateFlags({ 'replay-flag': true })
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))

    // The SDK never hits the flags endpoint when remote feature flags are disabled.
    const flagsCalls = ((globalThis as any).window.fetch as vi.Mock).mock.calls.filter(([url]: [string]) =>
      String(url).includes('/flags')
    )
    expect(flagsCalls).toHaveLength(0)
  })

  it('retries native init on the next flags reload when the first attempt fails', async () => {
    currentSessionRecording = { endpoint: '/s/' } // no linkedFlag => recording active

    // First native start throws -> init fails and the armed state must roll back.
    replay.start.mockRejectedValueOnce(new Error('native start failed'))

    posthog = newPostHog()
    await posthog.ready()

    // The bootstrap arm fails and rolls back; the flags load re-arms and retries.
    // Without the rollback the failed attempt would suppress every later attempt.
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(2))
  })

  it('does not stop again on a later reload once the flag is already off', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': true }

    posthog = newPostHog()
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    replay.isEnabled.mockImplementation(async () => true)

    // Flag off -> one pause.
    currentFlags = { 'replay-flag': false }
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalledTimes(1))

    // Still off on subsequent reloads -> already paused, must not stop again.
    await posthog.reloadFeatureFlagsAsync()
    await posthog.reloadFeatureFlagsAsync()
    await wait(50)
    expect(replay.stopRecording).toHaveBeenCalledTimes(1)
  })

  it('serializes overlapping reloads so an off->on pair ends recording, not stuck off', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': true }

    posthog = newPostHog()
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    replay.isEnabled.mockImplementation(async () => true)

    // Hold the native stop open so the next evaluation runs while the pause is in flight.
    let releaseStop: () => void = () => {}
    replay.stopRecording.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseStop = resolve
        })
    )

    // Flag off: the pause evaluation reaches the (held) native stop.
    currentFlags = { 'replay-flag': false }
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalledTimes(1))

    // Flag back on while the stop is still blocked. The resume evaluation is queued behind
    // the in-flight pause (serialized), so it has not resumed yet.
    currentFlags = { 'replay-flag': true }
    await posthog.reloadFeatureFlagsAsync()
    await wait(20)
    expect(replay.startRecording).not.toHaveBeenCalled()

    // Once the stop completes, the queued resume runs and recording ends on (not stuck off).
    releaseStop()
    await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalledTimes(1))
    expect(replay.start).toHaveBeenCalledTimes(1)
  })
})
