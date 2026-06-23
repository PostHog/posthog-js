import { PostHog, PostHogCustomStorage, PostHogPersistedProperty } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { Linking, AppState } from 'react-native'
import { waitForExpect, wait } from './test-utils'

// Mock the native plugin bridge so we can assert which native calls happen. No `setup`
// key, so the SDK takes the legacy start() path (same surface as the standalone
// posthog-react-native-session-replay package).
jest.mock('../src/optional/OptionalPlugin', () => ({
  OptionalReactNativePlugin: {
    start: jest.fn(async () => {}),
    startSession: jest.fn(async () => {}),
    endSession: jest.fn(async () => {}),
    isEnabled: jest.fn(async () => false),
    identify: jest.fn(async () => {}),
    startRecording: jest.fn(async () => {}),
    stopRecording: jest.fn(async () => {}),
  },
}))

const replay = OptionalReactNativePlugin as unknown as {
  start: jest.Mock
  startSession: jest.Mock
  endSession: jest.Mock
  isEnabled: jest.Mock
  identify: jest.Mock
  startRecording: jest.Mock
  stopRecording: jest.Mock
}

Linking.getInitialURL = jest.fn(() => Promise.resolve(null))
AppState.addEventListener = jest.fn()

describe('PostHog RN session replay event triggers', () => {
  jest.useRealTimers()

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
    ;(globalThis as any).window.fetch = jest.fn(async (url: string) => {
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

  // First launch caches the recording config (incl. eventTriggers) so the *next* launch evaluates
  // the trigger gate at bootstrap. Mirrors the warm-start pattern used by the linked-flag tests —
  // a cold first launch starts replay optimistically before /flags returns, which the cache avoids.
  const warmup = async (): Promise<void> => {
    const w = newPostHog()
    await w.ready()
    await w.reloadFeatureFlagsAsync()
    await wait(50)
    await w.shutdown()
    replay.start.mockClear()
    replay.startRecording.mockClear()
    replay.stopRecording.mockClear()
  }

  it('does not start recording until a matching event is captured', async () => {
    currentSessionRecording = { eventTriggers: ['$pageview'], endpoint: '/s/' }
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)

    // Trigger configured but not fired -> no native recording.
    expect(replay.start).not.toHaveBeenCalled()

    // A non-matching event does not activate.
    posthog.capture('some_other_event')
    await wait(50)
    expect(replay.start).not.toHaveBeenCalled()

    // The matching event activates recording for the session.
    posthog.capture('$pageview')
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
  })

  it('activation persists for the rest of the session across flag reloads', async () => {
    currentSessionRecording = { eventTriggers: ['$pageview'], endpoint: '/s/' }
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)

    posthog.capture('$pageview')
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    replay.isEnabled.mockImplementation(async () => true)

    // Re-evaluating within the same session keeps recording active: no stop, no second init.
    await posthog.reloadFeatureFlagsAsync()
    await wait(50)
    expect(replay.stopRecording).not.toHaveBeenCalled()
    expect(replay.start).toHaveBeenCalledTimes(1)
  })

  it('matches a $screen event against an event trigger', async () => {
    currentSessionRecording = { eventTriggers: ['$screen'], endpoint: '/s/' }
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)
    expect(replay.start).not.toHaveBeenCalled()

    await posthog.screen('Home')
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
  })

  it('AND-combines with the linked flag: a fired trigger does not record while the flag is off', async () => {
    currentSessionRecording = { eventTriggers: ['$pageview'], linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': false }
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)

    // Trigger fires but the linked flag is off -> AND fails -> no recording.
    posthog.capture('$pageview')
    await wait(50)
    expect(replay.start).not.toHaveBeenCalled()

    // Linked flag turns on; the trigger is still activated for this session -> recording starts.
    currentFlags = { 'replay-flag': true }
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
  })

  it('re-arms on session rotation: recording stops and needs a fresh matching event', async () => {
    currentSessionRecording = { eventTriggers: ['$pageview'], endpoint: '/s/' }
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)

    // Activate recording for the first session.
    posthog.capture('$pageview')
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    replay.isEnabled.mockImplementation(async () => true)

    // Force the session to expire, then rotate it. The previous activation no longer matches the
    // new session id, so recording must pause until a fresh matching event fires.
    posthog.setPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp, Date.now() - 31 * 60 * 1000)
    posthog.getSessionId()
    await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalledTimes(1))

    // A fresh matching event in the new session re-activates recording (resume, not re-init).
    posthog.capture('$pageview')
    await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalledTimes(1))
    expect(replay.start).toHaveBeenCalledTimes(1)
  })

  it('clears trigger activation on reset() so a new user does not inherit it, then re-arms', async () => {
    currentSessionRecording = { eventTriggers: ['$pageview'], endpoint: '/s/' }
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)

    // User A activates the trigger for their session.
    posthog.capture('$pageview')
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    const activatedSession = posthog.getPersistedProperty(
      PostHogPersistedProperty.SessionReplayEventTriggerActivatedSession
    )
    expect(activatedSession).toBeTruthy()

    // Logout / identity change. The activation is user-session state, not project config, so it must
    // be cleared — user B must not inherit user A's activation.
    posthog.reset()
    expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionReplayEventTriggerActivatedSession)).toBeFalsy()

    // User B still re-arms normally: a fresh matching event activates for the new session.
    replay.isEnabled.mockImplementation(async () => true)
    posthog.capture('$pageview')
    await waitForExpect(2000, () => {
      const reArmed = posthog.getPersistedProperty(PostHogPersistedProperty.SessionReplayEventTriggerActivatedSession)
      expect(reArmed).toBeTruthy()
      expect(reArmed).not.toBe(activatedSession)
    })
  })

  it('activates on any of several configured triggers and ignores non-string entries', async () => {
    // Mixed-type array: only the string entries should arm. A malformed entry must not throw or match.
    currentSessionRecording = { eventTriggers: ['$pageview', 42, null, '$screen'], endpoint: '/s/' }
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)
    expect(replay.start).not.toHaveBeenCalled()

    // The second configured string trigger activates recording.
    await posthog.screen('Home')
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
  })

  it('treats a non-array eventTriggers config as no triggers (records normally)', async () => {
    // Malformed remote config (object instead of array) must not arm triggers nor block recording.
    currentSessionRecording = { eventTriggers: { not: 'an array' }, endpoint: '/s/' }
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    // No triggers configured -> replay records without waiting for a matching event.
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
  })

  it('does not activate when before_send drops the matching event', async () => {
    currentSessionRecording = { eventTriggers: ['$pageview'], endpoint: '/s/' }
    await warmup()

    posthog = new PostHog('test-token', {
      customStorage: mockStorage,
      enableSessionReplay: true,
      flushInterval: 0,
      // Drop the trigger event before it is enqueued.
      before_send: (event) => (event?.event === '$pageview' ? null : event),
    })
    await posthog.ready()
    await wait(50)

    // The matching event is dropped by before_send -> processBeforeEnqueue returns null -> no activation.
    posthog.capture('$pageview')
    await wait(50)
    expect(replay.start).not.toHaveBeenCalled()
  })

  it('does not arm event triggers when session replay is disabled locally', async () => {
    currentSessionRecording = { eventTriggers: ['$pageview'], endpoint: '/s/' }
    posthog = new PostHog('test-token', {
      customStorage: mockStorage,
      enableSessionReplay: false,
      flushInterval: 0,
    })
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
    await wait(50)

    posthog.capture('$pageview')
    await wait(50)
    expect(replay.start).not.toHaveBeenCalled()
    expect(replay.startRecording).not.toHaveBeenCalled()
  })

  it('pins the persisted-property key (renaming it would orphan activation across app upgrades)', () => {
    // This literal is the on-disk storage key for trigger activation. Changing it silently strands
    // every existing user's persisted activation on upgrade, so the value is part of the contract.
    expect(PostHogPersistedProperty.SessionReplayEventTriggerActivatedSession).toBe(
      'session_replay_event_trigger_activated_session'
    )
  })

  it('disarms when a later flag reload drops eventTriggers from config and records normally', async () => {
    // Launch 1 arms a trigger so recording is gated off (no matching event fired).
    currentSessionRecording = { eventTriggers: ['$pageview'], endpoint: '/s/' }
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)
    expect(replay.start).not.toHaveBeenCalled()

    // Server removes eventTriggers. The in-memory armed list must clear so the gate no longer
    // blocks: replay should now record without waiting for a matching event.
    currentSessionRecording = { endpoint: '/s/' }
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))

    // And a previously-configured trigger name is now inert (does not re-gate or re-activate).
    posthog.capture('$pageview')
    await wait(50)
    expect(replay.start).toHaveBeenCalledTimes(1)
  })

  it('is idempotent when the matching event is captured again while already recording', async () => {
    currentSessionRecording = { eventTriggers: ['$pageview'], endpoint: '/s/' }
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)

    posthog.capture('$pageview')
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    replay.isEnabled.mockImplementation(async () => true)

    // Re-firing the same trigger within the active session must not re-init or re-resume recording.
    posthog.capture('$pageview')
    posthog.capture('$pageview')
    await wait(50)
    expect(replay.start).toHaveBeenCalledTimes(1)
    expect(replay.startRecording).not.toHaveBeenCalled()
    expect(replay.stopRecording).not.toHaveBeenCalled()
  })
})
