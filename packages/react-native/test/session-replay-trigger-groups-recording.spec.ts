import { PostHog, PostHogCustomStorage, PostHogPersistedProperty } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { Linking, AppState } from 'react-native'
import { waitForExpect, wait, waitForNativePluginEvaluation } from './test-utils'
import * as uuidModule from '../../core/src/vendor/uuidv7'
import { sampleOnTriggerProperty } from '../src/session-replay/triggerGroups'

// Mock the native plugin bridge so we can assert which native calls happen. No `setup`
// key, so the SDK takes the legacy start() path (same surface as the standalone
// posthog-react-native-session-replay package), mirroring the v1 event-trigger spec.
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

const v2Config = (triggerGroups: any[]): any => ({
  version: 2,
  triggerGroups,
  endpoint: '/s/',
})

describe('PostHog RN session replay v2 trigger groups', () => {
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

  const newPostHog = (options: Record<string, any> = {}): PostHog =>
    new PostHog('test-token', {
      customStorage: mockStorage,
      enableSessionReplay: true,
      flushInterval: 0,
      ...options,
    })

  // First launch caches the recording config (incl. triggerGroups) so the *next* launch
  // evaluates the v2 gate at bootstrap, mirroring the warm-start pattern of the v1 spec.
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

  it('does not start recording until an event condition matches, honoring property filters', async () => {
    currentSessionRecording = v2Config([
      {
        id: 'g1',
        name: 'Big purchases',
        sampleRate: 1,
        conditions: {
          matchType: 'any',
          events: [{ name: 'purchase', properties: [{ key: 'amount', operator: 'gt', value: 100 }] }],
        },
      },
    ])
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)
    expect(replay.start).not.toHaveBeenCalled()

    // Matching name, non-matching properties.
    posthog.capture('purchase', { amount: 50 })
    await wait(50)
    expect(replay.start).not.toHaveBeenCalled()

    // Matching name and properties activates the group and starts recording.
    posthog.capture('purchase', { amount: 500 })
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
  })

  it('records immediately for empty conditions when the group samples in, and never at rate 0', async () => {
    currentSessionRecording = v2Config([
      { id: 'g1', name: 'Everyone', sampleRate: 1, conditions: { matchType: 'all' } },
    ])
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    await posthog.shutdown()

    // A zero sample rate excludes every session id deterministically.
    currentSessionRecording = v2Config([{ id: 'g1', name: 'No one', sampleRate: 0, conditions: { matchType: 'all' } }])
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(100)
    expect(replay.start).not.toHaveBeenCalled()
    expect(replay.startRecording).not.toHaveBeenCalled()
  })

  it('activates a screen (url) condition on a matching $screen_name', async () => {
    currentSessionRecording = v2Config([
      {
        id: 'g1',
        name: 'Checkout screens',
        sampleRate: 1,
        conditions: { matchType: 'any', urls: [{ url: '^checkout', matching: 'regex' }] },
      },
    ])
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)
    expect(replay.start).not.toHaveBeenCalled()

    await posthog.screen('Home')
    await wait(50)
    expect(replay.start).not.toHaveBeenCalled()

    await posthog.screen('checkout-step-2')
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
  })

  it('activates a flag condition once the flag turns on', async () => {
    currentSessionRecording = v2Config([
      {
        id: 'g1',
        name: 'Flagged users',
        sampleRate: 1,
        conditions: { matchType: 'any', flag: { flag: 'replay-flag', variant: 'beta' } },
      },
    ])
    currentFlags = { 'replay-flag': 'alpha' }
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)
    expect(replay.start).not.toHaveBeenCalled()

    currentFlags = { 'replay-flag': 'beta' }
    await posthog.reloadFeatureFlagsAsync()
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
  })

  it('registers the v2 debug session properties', async () => {
    currentSessionRecording = v2Config([
      { id: 'g1', name: 'Everyone', sampleRate: 1, conditions: { matchType: 'all' } },
    ])
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))

    const sessionProps = (posthog as any).sessionProps
    expect(sessionProps.$sdk_debug_replay_remote_trigger_matching_config).toBe('v2_trigger_groups')
    expect(sessionProps.$sdk_debug_replay_trigger_groups_count).toBe(1)
    expect(sessionProps.$sdk_debug_replay_matched_recording_trigger_groups).toEqual([
      { id: 'g1', name: 'Everyone', matched: true, sampled: true },
    ])
  })

  it('re-arms on session rotation: recording stops and needs a fresh matching event', async () => {
    currentSessionRecording = v2Config([
      {
        id: 'g1',
        name: 'Purchases',
        sampleRate: 1,
        conditions: { matchType: 'any', events: [{ name: 'purchase' }] },
      },
    ])
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)

    posthog.capture('purchase')
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    replay.isEnabled.mockImplementation(async () => true)

    posthog.setPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp, Date.now() - 31 * 60 * 1000)
    posthog.getSessionId()
    await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalledTimes(1))

    // A fresh matching event in the new session re-activates recording (resume, not re-init).
    posthog.capture('purchase')
    await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalledTimes(1))
    expect(replay.start).toHaveBeenCalledTimes(1)
  })

  describe('a new session on a screen that matches a group', () => {
    const checkoutGroup = {
      id: 'g1',
      name: 'Checkout screens',
      sampleRate: 1,
      conditions: { matchType: 'any', urls: [{ url: '^checkout', matching: 'regex' }] },
    }
    const activation = (): any =>
      posthog.getPersistedProperty(PostHogPersistedProperty.SessionReplayTriggerGroupsActivation)
    const expireSession = (): void => {
      posthog.setPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp, Date.now() - 31 * 60 * 1000)
    }

    it('keeps recording after a rotation, without a new $screen event', async () => {
      currentSessionRecording = v2Config([checkoutGroup])
      await warmup()

      posthog = newPostHog()
      await posthog.ready()
      await wait(50)
      await posthog.screen('checkout-step-2')
      await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
      replay.isEnabled.mockImplementation(async () => true)
      const firstSessionId = posthog.getSessionId()

      expireSession()
      const newSessionId = posthog.getSessionId()
      expect(newSessionId).not.toEqual(firstSessionId)
      await waitForNativePluginEvaluation(posthog)
      await wait(50)

      expect(activation()).toEqual({ sessionId: newSessionId, eventGroupIds: [], screenGroupIds: ['g1'] })
      expect(replay.stopRecording).not.toHaveBeenCalled()
    })

    it('starts recording when the first event of the new session is not a $screen event', async () => {
      currentSessionRecording = v2Config([
        { ...checkoutGroup, conditions: { ...checkoutGroup.conditions, matchType: 'all', flag: 'replay-flag' } },
      ])
      currentFlags = { 'replay-flag': false }
      await warmup()

      posthog = newPostHog()
      await posthog.ready()
      await wait(50)
      await posthog.screen('checkout-step-2')
      await wait(50)
      expect(replay.start).not.toHaveBeenCalled()

      expireSession()
      posthog.capture('other')
      await wait(50)
      expect(activation()).toEqual({ sessionId: posthog.getSessionId(), eventGroupIds: [], screenGroupIds: ['g1'] })

      currentFlags = { 'replay-flag': true }
      await posthog.reloadFeatureFlagsAsync()
      await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    })

    it('re-arms after a rotation on a screen the app has left', async () => {
      currentSessionRecording = v2Config([checkoutGroup])
      await warmup()

      posthog = newPostHog()
      await posthog.ready()
      await wait(50)
      await posthog.screen('checkout-step-2')
      await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
      replay.isEnabled.mockImplementation(async () => true)
      await posthog.screen('Home')

      expireSession()
      posthog.getSessionId()
      await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalledTimes(1))
    })

    it('activates the group for the session reset() starts', async () => {
      currentSessionRecording = v2Config([checkoutGroup])
      await warmup()

      posthog = newPostHog()
      await posthog.ready()
      await wait(50)
      await posthog.screen('checkout-step-2')
      await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
      const firstSessionId = posthog.getSessionId()

      posthog.reset()
      await waitForExpect(2000, () => expect(activation()?.screenGroupIds).toEqual(['g1']))
      expect(activation().sessionId).toEqual(posthog.getSessionId())
      expect(activation().sessionId).not.toEqual(firstSessionId)
    })

    it('starts a new-session startSessionRecording() on the screen seen while replay was off', async () => {
      currentSessionRecording = v2Config([checkoutGroup])
      await warmup()
      replay.isEnabled.mockImplementation(async () => true)

      posthog = newPostHog({ enableSessionReplay: false })
      await posthog.ready()
      await posthog.screen('checkout-step-2')
      await wait(50)
      expect(replay.startRecording).not.toHaveBeenCalled()

      await posthog.startSessionRecording(false)
      expect(replay.startRecording).toHaveBeenCalledTimes(1)
      expect(activation()).toEqual({ sessionId: posthog.getSessionId(), eventGroupIds: [], screenGroupIds: ['g1'] })
    })

    it('does not activate on a config load in the session of the $screen event', async () => {
      currentSessionRecording = v2Config([checkoutGroup])

      posthog = newPostHog()
      await posthog.ready()
      await posthog.screen('checkout-step-2')
      await posthog.reloadFeatureFlagsAsync()
      await wait(50)
      await waitForNativePluginEvaluation(posthog)

      expect(activation()).toBeFalsy()
      expect(replay.start).not.toHaveBeenCalled()
    })
  })

  const purchaseGroup = {
    id: 'g1',
    name: 'Purchases',
    sampleRate: 1,
    conditions: { matchType: 'any', events: [{ name: 'purchase' }] },
  }

  it('retries the native start on a later matching event when the first start failed', async () => {
    currentSessionRecording = v2Config([purchaseGroup])
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)

    replay.start.mockImplementationOnce(async () => {
      throw new Error('native start failed')
    })

    posthog.capture('purchase')
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))

    // The group is already activated, but the next match still re-kicks the failed start.
    posthog.capture('purchase')
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(2))
  })

  it('warns once that trigger groups need the setup() plugin, and still follows the group decision', async () => {
    currentSessionRecording = v2Config([purchaseGroup])
    await warmup()

    posthog = newPostHog()
    const warn = vi.spyOn((posthog as any)._logger, 'warn')
    const legacyWarnings = (): number =>
      warn.mock.calls.filter(([message]) => String(message).includes('@posthog/react-native-plugin for PostHog')).length
    await posthog.ready()
    await wait(50)
    expect(replay.start).not.toHaveBeenCalled()
    expect(legacyWarnings()).toBe(0)

    replay.start.mockImplementationOnce(async () => {
      throw new Error('native start failed')
    })
    posthog.capture('purchase')
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    posthog.capture('purchase')
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(2))

    expect(legacyWarnings()).toBe(1)
  })

  it('does not re-evaluate replay on every match while a group is sampled out', async () => {
    currentSessionRecording = v2Config([{ ...purchaseGroup, sampleRate: 0 }])
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)
    const evaluate = vi.spyOn(posthog as any, '_evaluateAndStartSessionReplay')

    posthog.capture('purchase')
    posthog.capture('purchase')
    posthog.capture('purchase')
    await wait(50)

    // only the activating match re-evaluates; later ones can't change a sampled-out decision
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(replay.start).not.toHaveBeenCalled()
  })

  it('keeps the activated groups when the session survives an app restart', async () => {
    currentSessionRecording = v2Config([purchaseGroup])
    await warmup()

    posthog = newPostHog({ enablePersistSessionIdAcrossRestart: true })
    await posthog.ready()
    await wait(50)
    const sessionId = posthog.getSessionId()

    posthog.capture('purchase')
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    await posthog.shutdown()
    replay.start.mockClear()

    posthog = newPostHog({ enablePersistSessionIdAcrossRestart: true })
    await posthog.ready()
    expect(posthog.getSessionId()).toBe(sessionId)
    // No new purchase: the restored activation starts recording on its own.
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
  })

  it('reset() clears the in-memory trigger groups activation even when the session id is kept', async () => {
    currentSessionRecording = v2Config([purchaseGroup])
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)
    posthog.capture('purchase')
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))

    // Identity change keeping the session id: the persisted activation is wiped, so the
    // in-memory evaluator must drop its copy too or the next user stays activated.
    const stopsBeforeReset = replay.stopRecording.mock.calls.length
    posthog.reset([
      PostHogPersistedProperty.SessionId,
      PostHogPersistedProperty.SessionLastTimestamp,
      PostHogPersistedProperty.SessionStartTimestamp,
    ])
    const sessionId = posthog.getSessionId()

    const evaluator = (posthog as any)._triggerGroupsEvaluator
    expect(evaluator.getActivation()).toBeNull()
    expect(evaluator.evaluate(sessionId, posthog.getKnownFeatureFlags(), undefined).shouldRecord).toBe(false)
    // The flags reload reset() triggers re-evaluates the gate and stops the recorder.
    await waitForExpect(2000, () => expect(replay.stopRecording.mock.calls.length).toBeGreaterThan(stopsBeforeReset))
  })

  it('pins the persisted activation key (renaming it would orphan activation across app upgrades)', () => {
    expect(PostHogPersistedProperty.SessionReplayTriggerGroupsActivation).toBe(
      'session_replay_trigger_groups_activation'
    )
  })

  it('keeps v1 behaviour when version is missing or 1', async () => {
    // version 1 + v1 eventTriggers must go through the v1 gate exactly as before.
    currentSessionRecording = { version: 1, eventTriggers: ['$pageview'], endpoint: '/s/' }
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)
    expect(replay.start).not.toHaveBeenCalled()
    expect((posthog as any).sessionProps.$sdk_debug_replay_remote_trigger_matching_config).toBeUndefined()

    posthog.capture('$pageview')
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))

    // A v2 config that loses its groups on a later reload falls back to v1 and records normally.
    currentSessionRecording = { version: 2, triggerGroups: [], endpoint: '/s/' }
    await posthog.reloadFeatureFlagsAsync()
    await wait(50)
    expect(replay.stopRecording).not.toHaveBeenCalled()
    expect((posthog as any).sessionProps.$sdk_debug_replay_remote_trigger_matching_config).toBeUndefined()
  })

  it('records nothing under a v2 config whose every group is unusable, whatever the v1 fields say', async () => {
    currentSessionRecording = {
      ...v2Config([{ id: '', name: 'No id', sampleRate: 0, conditions: { matchType: 'all' } }]),
      sampleRate: '1.0',
      linkedFlag: null,
      eventTriggers: [],
    }
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await posthog.reloadFeatureFlagsAsync()
    await wait(50)
    await waitForNativePluginEvaluation(posthog)

    expect(replay.start).not.toHaveBeenCalled()
    expect((posthog as any)._sessionReplayTriggerGroups).toEqual([])
    expect((posthog as any).sessionProps.$sdk_debug_replay_remote_trigger_matching_config).toEqual('v2_trigger_groups')
    expect((posthog as any).sessionProps.$sdk_debug_replay_trigger_groups_count).toEqual(0)

    await posthog.startSessionRecording()
    expect(replay.start).not.toHaveBeenCalled()
    expect(replay.startRecording).not.toHaveBeenCalled()
  })

  it('restores a recording the app started on opt-in without waiting on a legacy eventTriggers key in a v2 config', async () => {
    // v2 replaces the v1 event triggers even when the config still carries them, so with replay
    // not enabled the restore must not hold the app's recording until a v1 trigger fires.
    currentSessionRecording = {
      ...v2Config([{ id: 'g1', name: 'Everyone', sampleRate: 1, conditions: { matchType: 'all' } }]),
      eventTriggers: ['$pageview'],
    }
    await warmup()
    replay.isEnabled.mockImplementation(async () => true)

    posthog = newPostHog({ enableSessionReplay: false })
    await posthog.ready()
    await posthog.startSessionRecording()
    expect(replay.startRecording).toHaveBeenCalledTimes(1)

    await posthog.optOut()
    await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalledTimes(1))

    await posthog.optIn()
    await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalledTimes(2))
  })

  describe('an explicit startSessionRecording()', () => {
    const flagGroup = {
      id: 'g1',
      name: 'Flagged',
      sampleRate: 1,
      conditions: { matchType: 'any', flag: { flag: 'replay-flag' } },
    }

    it('waits for a pending group with replay off, and a matching event starts it', async () => {
      currentSessionRecording = v2Config([purchaseGroup])
      await warmup()
      replay.isEnabled.mockImplementation(async () => true)

      posthog = newPostHog({ enableSessionReplay: false })
      await posthog.ready()
      await posthog.startSessionRecording()
      expect(replay.startRecording).not.toHaveBeenCalled()

      posthog.capture('purchase')
      await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalledTimes(1))
    })

    it('waits for a pending group with replay on, and a matching event starts it', async () => {
      currentSessionRecording = v2Config([purchaseGroup])
      await warmup()

      posthog = newPostHog()
      await posthog.ready()
      await wait(50)
      await posthog.startSessionRecording()
      expect(replay.start).not.toHaveBeenCalled()
      expect(replay.startRecording).not.toHaveBeenCalled()

      posthog.capture('purchase')
      await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    })

    it('waits for a pending flag leg, and a flags load that turns the flag on starts it', async () => {
      currentSessionRecording = v2Config([flagGroup])
      currentFlags = { 'replay-flag': false }
      await warmup()
      replay.isEnabled.mockImplementation(async () => true)

      posthog = newPostHog({ enableSessionReplay: false })
      await posthog.ready()
      await posthog.reloadFeatureFlagsAsync()
      await posthog.startSessionRecording()
      expect(replay.startRecording).not.toHaveBeenCalled()

      currentFlags = { 'replay-flag': true }
      await posthog.reloadFeatureFlagsAsync()
      await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalledTimes(1))
    })

    it('does not record a session the groups sample out', async () => {
      currentSessionRecording = v2Config([{ id: 'g1', name: 'None', sampleRate: 0, conditions: { matchType: 'all' } }])
      await warmup()
      replay.isEnabled.mockImplementation(async () => true)

      posthog = newPostHog({ enableSessionReplay: false })
      await posthog.ready()
      await posthog.startSessionRecording()
      await posthog.reloadFeatureFlagsAsync()
      posthog.capture('purchase')
      await wait(50)
      await waitForNativePluginEvaluation(posthog)
      expect(replay.startRecording).not.toHaveBeenCalled()
      expect(replay.start).not.toHaveBeenCalled()
    })

    it('records when a group already records the session', async () => {
      currentSessionRecording = v2Config([
        purchaseGroup,
        { id: 'g2', name: 'Always', sampleRate: 1, conditions: { matchType: 'all' } },
      ])
      await warmup()
      replay.isEnabled.mockImplementation(async () => true)

      posthog = newPostHog({ enableSessionReplay: false })
      await posthog.ready()
      await posthog.startSessionRecording()
      expect(replay.startRecording).toHaveBeenCalledTimes(1)
    })

    it('holds a new-session start in the session it rotated into, and a matching event starts it there', async () => {
      currentSessionRecording = v2Config([purchaseGroup])
      await warmup()
      replay.isEnabled.mockImplementation(async () => true)

      posthog = newPostHog({ enableSessionReplay: false })
      await posthog.ready()
      const originalSessionId = posthog.getSessionId()
      await posthog.startSessionRecording(false)
      expect(replay.startRecording).not.toHaveBeenCalled()
      const newSessionId = posthog.getSessionId()
      expect(newSessionId).not.toEqual(originalSessionId)

      posthog.capture('purchase')
      await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalledTimes(1))
      expect(replay.startRecording).toHaveBeenCalledWith(true)
      expect(posthog.getSessionId()).toEqual(newSessionId)
      expect(
        posthog.getPersistedProperty<any>(PostHogPersistedProperty.SessionReplayTriggerGroupsActivation)?.sessionId
      ).toEqual(newSessionId)
      expect(replay.startSession.mock.calls.map(([id]) => id)).toEqual([newSessionId])
    })

    it('rotates once and starts a new-session start that a group already records', async () => {
      currentSessionRecording = v2Config([
        { id: 'g2', name: 'Always', sampleRate: 1, conditions: { matchType: 'all' } },
      ])
      await warmup()
      replay.isEnabled.mockImplementation(async () => true)

      posthog = newPostHog({ enableSessionReplay: false })
      await posthog.ready()
      const originalSessionId = posthog.getSessionId()
      await posthog.startSessionRecording(false)
      const newSessionId = posthog.getSessionId()
      expect(newSessionId).not.toEqual(originalSessionId)
      expect(replay.startRecording).toHaveBeenCalledTimes(1)
      expect(replay.startRecording).toHaveBeenCalledWith(true)
      expect(replay.startSession.mock.calls.map(([id]) => id)).toEqual([newSessionId])
      expect(replay.endSession).toHaveBeenCalledTimes(1)
    })

    it('keeps the v1 new-session start rotating after native setup', async () => {
      currentSessionRecording = { endpoint: '/s/' }
      await warmup()
      replay.isEnabled.mockImplementation(async () => true)

      posthog = newPostHog({ enableSessionReplay: false })
      await posthog.ready()
      const originalSessionId = posthog.getSessionId()
      await posthog.startSessionRecording(false)
      const newSessionId = posthog.getSessionId()
      expect(newSessionId).not.toEqual(originalSessionId)
      expect(replay.startRecording).toHaveBeenCalledTimes(1)
      expect(replay.startRecording).toHaveBeenCalledWith(false)
      expect(replay.startSession.mock.calls.map(([id]) => id)).toEqual([originalSessionId, newSessionId])
    })

    it('keeps the v1 explicit start ungated by v1 event triggers', async () => {
      currentSessionRecording = { eventTriggers: ['purchase'], endpoint: '/s/' }
      await warmup()
      replay.isEnabled.mockImplementation(async () => true)

      posthog = newPostHog({ enableSessionReplay: false })
      await posthog.ready()
      await posthog.startSessionRecording()
      expect(replay.startRecording).toHaveBeenCalledTimes(1)
    })
  })

  const rotateSession = (): void => {
    posthog.setPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp, Date.now() - 31 * 60 * 1000)
    posthog.getSessionId()
  }

  it('stops native when an earlier start it refused is followed by an off decision', async () => {
    currentSessionRecording = v2Config([purchaseGroup])
    await warmup()

    posthog = newPostHog()
    await posthog.ready()
    await wait(50)
    posthog.capture('purchase')
    await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    replay.isEnabled.mockImplementation(async () => true)
    rotateSession()
    await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalledTimes(1))

    // Native refuses the next start (e.g. its own flags aren't loaded), but that start still lifts
    // its stop hold, so native may resume by itself once its flags arrive.
    replay.isEnabled.mockImplementation(async () => false)
    posthog.capture('purchase')
    await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalledTimes(1))
    await wait(50)

    rotateSession()
    await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalledTimes(2))
  })
  describe('an explicit stopSessionRecording()', () => {
    const flagGroup = {
      id: 'g1',
      name: 'Flagged',
      sampleRate: 1,
      conditions: { matchType: 'any', flag: { flag: 'replay-flag' } },
    }

    const reloadFlags = async (flags: Record<string, any>): Promise<void> => {
      currentFlags = flags
      await posthog.reloadFeatureFlagsAsync()
      await wait(50)
      await waitForNativePluginEvaluation(posthog)
    }

    const startsCount = (): number => replay.start.mock.calls.length + replay.startRecording.mock.calls.length

    beforeEach(async () => {
      currentSessionRecording = v2Config([flagGroup])
      currentFlags = { 'replay-flag': false }
      await warmup()
      posthog = newPostHog()
      await posthog.ready()
      await wait(50)
      expect(startsCount()).toBe(0)

      await reloadFlags({ 'replay-flag': true })
      expect(replay.start).toHaveBeenCalledTimes(1)
      replay.isEnabled.mockImplementation(async () => true)
    })

    it('holds across flags reloads that make the group eligible again', async () => {
      await posthog.stopSessionRecording()
      await reloadFlags({ 'replay-flag': false })
      await reloadFlags({ 'replay-flag': true })
      expect(startsCount()).toBe(1)
    })

    it('holds when made while an ineligible group had already paused the recorder', async () => {
      await reloadFlags({ 'replay-flag': false })
      expect(replay.stopRecording).toHaveBeenCalled()
      expect((posthog as any)._sessionReplayRecordingActive).toBe(false)

      await posthog.stopSessionRecording()
      await reloadFlags({ 'replay-flag': true })
      expect(startsCount()).toBe(1)
    })

    it('holds across a session rotation and a matching event in the new session', async () => {
      currentSessionRecording = v2Config([purchaseGroup])
      await reloadFlags({})
      await posthog.stopSessionRecording()

      rotateSession()
      posthog.capture('purchase')
      await wait(50)
      await waitForNativePluginEvaluation(posthog)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionReplayTriggerGroupsActivation)).toBeFalsy()
      expect(startsCount()).toBe(1)
    })

    it('activates no group on a matching event', async () => {
      currentSessionRecording = v2Config([purchaseGroup])
      await reloadFlags({})
      await posthog.stopSessionRecording()
      const evaluate = vi.spyOn(posthog as any, '_evaluateAndStartSessionReplay')

      posthog.capture('purchase')
      await wait(50)
      await waitForNativePluginEvaluation(posthog)
      expect(posthog.getPersistedProperty(PostHogPersistedProperty.SessionReplayTriggerGroupsActivation)).toBeFalsy()
      expect((posthog as any)._triggerGroupsEvaluator.getActivation()?.eventGroupIds ?? []).toEqual([])
      expect(evaluate).not.toHaveBeenCalled()
      expect(startsCount()).toBe(1)
    })

    it('is lifted by startSessionRecording()', async () => {
      await posthog.stopSessionRecording()
      await reloadFlags({ 'replay-flag': true })
      expect(startsCount()).toBe(1)

      await posthog.startSessionRecording()
      expect(startsCount()).toBe(2)
    })

    it('is lifted by a startSessionRecording() native refuses, so a later eligible reload starts', async () => {
      await posthog.stopSessionRecording()
      await reloadFlags({ 'replay-flag': true })

      replay.isEnabled.mockImplementation(async () => false)
      await posthog.startSessionRecording()
      expect(startsCount()).toBe(2)

      replay.isEnabled.mockImplementation(async () => true)
      await reloadFlags({ 'replay-flag': true })
      expect(startsCount()).toBe(3)
      expect((posthog as any)._sessionReplayRecordingActive).toBe(true)
    })

    describe('then a startSessionRecording() in the same session', () => {
      const checkoutGroup = (properties: any[] = []): any => ({
        id: 'g1',
        name: 'Checkout screens',
        sampleRate: 1,
        conditions: { matchType: 'any', urls: [{ url: '^checkout', matching: 'regex' }], properties },
      })
      const activation = (): any =>
        posthog.getPersistedProperty(PostHogPersistedProperty.SessionReplayTriggerGroupsActivation)

      it('activates the group of the screen opened while stopped', async () => {
        currentSessionRecording = v2Config([checkoutGroup()])
        await reloadFlags({})
        await posthog.stopSessionRecording()
        const sessionId = posthog.getSessionId()

        await posthog.screen('checkout-step-2')
        await wait(50)
        expect(activation()).toBeFalsy()

        await posthog.startSessionRecording()
        expect(posthog.getSessionId()).toEqual(sessionId)
        expect(activation()).toEqual({ sessionId, eventGroupIds: [], screenGroupIds: ['g1'] })
        expect(startsCount()).toBe(2)
      })

      it('leaves the group pending when the screen opened while stopped does not match', async () => {
        currentSessionRecording = v2Config([checkoutGroup()])
        await reloadFlags({})
        await posthog.stopSessionRecording()

        await posthog.screen('Home')
        await posthog.startSessionRecording()
        expect(activation()).toBeFalsy()
        expect(startsCount()).toBe(1)
      })

      it('does not check a screen again that was checked live and did not match', async () => {
        currentSessionRecording = v2Config([
          checkoutGroup([{ key: 'plan', type: 'person', operator: 'exact', value: 'pro' }]),
        ])
        await reloadFlags({})
        await posthog.screen('checkout-step-2')
        await wait(50)
        expect(activation()).toBeFalsy()

        posthog.setPersistedProperty(PostHogPersistedProperty.PersonProperties, { plan: 'pro' })
        await posthog.stopSessionRecording()
        await posthog.startSessionRecording()
        expect(activation()).toBeFalsy()
        expect(startsCount()).toBe(1)
      })
    })
  })

  // A session id the given group samples in (or out), picked through the SDK's own sampling hash.
  const sessionIdSampled = (groupId: string, rate: number, sampledIn: boolean): string => {
    for (let i = 0; i < 1000; i++) {
      const id = `01934000-0000-7000-8000-${i.toString(16).padStart(12, '0')}`
      if (sampleOnTriggerProperty(id + groupId, rate) === sampledIn) {
        return id
      }
    }
    throw new Error('no session id found')
  }

  it('re-evaluates a new session when the first one sampled out before native initialized', async () => {
    currentSessionRecording = v2Config([{ id: 'g1', sampleRate: 0.5, conditions: {} }])
    await warmup()

    const outId = sessionIdSampled('g1', 0.5, false)
    const inId = sessionIdSampled('g1', 0.5, true)
    const uuid = vi.spyOn(uuidModule, 'uuidv7').mockReturnValue(outId)
    try {
      posthog = newPostHog({
        preloadFeatureFlags: false,
        capturePushNotificationSubscriptions: false,
        capturePushNotificationOpened: false,
        errorTracking: { autocapture: false },
      })
      await posthog.ready()
      await wait(50)
      await waitForNativePluginEvaluation(posthog)
      expect(posthog.getSessionId()).toBe(outId)
      expect(replay.start).not.toHaveBeenCalled()

      uuid.mockReturnValue(inId)
      rotateSession()
      posthog.capture('ordinary_event_after_inactivity')
      expect(posthog.getSessionId()).toBe(inId)

      await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    } finally {
      uuid.mockRestore()
    }
  })

  const configOnlyFetch = (configResponses: any[]): string[] => {
    const requests: string[] = []
    ;(globalThis as any).window.fetch = vi.fn(async (url: string) => {
      requests.push(String(url))
      const res = String(url).includes('/config') ? (configResponses.shift() ?? { status: 'ok' }) : { status: 'ok' }
      return { status: 200, json: () => Promise.resolve(res) }
    })
    return requests
  }

  it.each([{ preloadFeatureFlags: false }, { disableRemoteFeatureFlags: true }])(
    'applies a fresh /config replay config without a flags load (%o)',
    async (flagsOption) => {
      currentSessionRecording = v2Config([{ id: 'g1', sampleRate: 1, conditions: {} }])
      await warmup()

      configOnlyFetch([])
      posthog = newPostHog({
        ...flagsOption,
        capturePushNotificationSubscriptions: false,
        capturePushNotificationOpened: false,
        errorTracking: { autocapture: false },
      })
      await posthog.ready()
      await wait(50)
      await waitForNativePluginEvaluation(posthog)
      expect(replay.start).toHaveBeenCalledTimes(1)
      replay.isEnabled.mockImplementation(async () => true)

      const requests = configOnlyFetch([
        {
          hasFeatureFlags: true,
          sessionRecording: v2Config([{ id: 'g1', sampleRate: 0, conditions: {} }]),
        },
      ])
      await posthog.reloadRemoteConfigAsync()
      await waitForExpect(2000, () => expect(replay.stopRecording).toHaveBeenCalledTimes(1))
      expect(requests.some((url) => url.includes('/flags'))).toBe(false)
    }
  )

  it.each([{ preloadFeatureFlags: false }, { disableRemoteFeatureFlags: true }])(
    'keeps replay off when a fresh /config disables recording for the project (%o)',
    async (flagsOption) => {
      currentSessionRecording = v2Config([{ id: 'g1', sampleRate: 0, conditions: {} }])
      await warmup()

      configOnlyFetch([])
      posthog = newPostHog({
        ...flagsOption,
        capturePushNotificationSubscriptions: false,
        capturePushNotificationOpened: false,
        errorTracking: { autocapture: false },
      })
      await posthog.ready()
      await wait(50)
      await waitForNativePluginEvaluation(posthog)
      expect(replay.start).not.toHaveBeenCalled()

      // Core drops the cached replay config for an explicit `false`; that must not read as
      // "no restrictions" and start the native recorder.
      const requests = configOnlyFetch([{ hasFeatureFlags: true, sessionRecording: false }])
      await posthog.reloadRemoteConfigAsync()
      await wait(50)
      await waitForNativePluginEvaluation(posthog)

      expect(replay.start).not.toHaveBeenCalled()
      expect(replay.startRecording).not.toHaveBeenCalled()
      expect(requests.some((url) => url.includes('/flags'))).toBe(false)

      // The groups armed before the disable must not re-evaluate the next session as unrestricted.
      rotateSession()
      posthog.capture('ordinary_event_after_inactivity')
      await wait(50)
      await waitForNativePluginEvaluation(posthog)

      expect(replay.start).not.toHaveBeenCalled()
      expect(replay.startRecording).not.toHaveBeenCalled()

      // Nor may a later flags evaluation read the dropped config as unrestricted.
      posthog.updateFlags({})
      await wait(50)
      await waitForNativePluginEvaluation(posthog)
      expect(replay.start).not.toHaveBeenCalled()
      expect(replay.startRecording).not.toHaveBeenCalled()

      // Nor an app restart with the disabled /config cached.
      await posthog.shutdown()
      configOnlyFetch([{ hasFeatureFlags: true, sessionRecording: false }])
      posthog = newPostHog({
        ...flagsOption,
        capturePushNotificationSubscriptions: false,
        capturePushNotificationOpened: false,
        errorTracking: { autocapture: false },
      })
      await posthog.ready()
      await wait(50)
      await waitForNativePluginEvaluation(posthog)
      expect(replay.start).not.toHaveBeenCalled()
      expect(replay.startRecording).not.toHaveBeenCalled()

      // Re-enabling the project with a recording group applies again.
      configOnlyFetch([
        { hasFeatureFlags: true, sessionRecording: v2Config([{ id: 'g1', sampleRate: 1, conditions: {} }]) },
      ])
      await posthog.reloadRemoteConfigAsync()
      await waitForExpect(2000, () => expect(replay.start).toHaveBeenCalledTimes(1))
    }
  )

  describe('with the setup() plugin', () => {
    // Models the native recorder: setup() starts it only when asked to, and startRecording() only
    // when native accepts (it refuses until its remote config loads).
    let nativeAccepts = true
    let nativeRecording = false
    const setup = vi.fn(async (_sessionId: string, _sdkOptions: any, pluginConfig: any) => {
      nativeRecording = pluginConfig.sessionReplay.enabled && nativeAccepts
    })
    const replayEnabledAtSetup = (): boolean[] => setup.mock.calls.map(([, , config]) => config.sessionReplay.enabled)
    const setMinimumDuration = vi.fn(async (_minimumDurationMs: number | null) => {})

    beforeEach(() => {
      nativeAccepts = true
      nativeRecording = false
      setup.mockClear()
      ;(replay as any).setup = setup
      ;(replay as any).setOptOut = vi.fn(async () => {})
      setMinimumDuration.mockReset()
      ;(replay as any).setSessionReplayMinimumDuration = setMinimumDuration
      replay.isEnabled.mockImplementation(async () => nativeRecording)
      replay.startRecording.mockImplementation(async () => {
        nativeRecording = nativeAccepts
      })
      replay.stopRecording.mockImplementation(async () => {
        nativeRecording = false
      })
    })

    afterEach(() => {
      vi.useRealTimers()
      delete (replay as any).setup
      delete (replay as any).setOptOut
      delete (replay as any).setSessionReplayMinimumDuration
      replay.startRecording.mockImplementation(async () => {})
      replay.stopRecording.mockImplementation(async () => {})
    })

    const settle = async (): Promise<void> => {
      await wait(50)
      await waitForNativePluginEvaluation(posthog)
    }

    const flagGroup = {
      id: 'g1',
      name: 'Flagged',
      sampleRate: 1,
      conditions: { matchType: 'any', flag: { flag: 'replay-flag' } },
    }

    // Nothing else brings native up early, so the group's activation is what sets native up.
    const replayOnlyOptions = {
      capturePushNotificationSubscriptions: false,
      capturePushNotificationOpened: false,
      errorTracking: { autocapture: false },
    }

    it('sets native up with replay off and starts the recorder explicitly', async () => {
      currentSessionRecording = v2Config([{ id: 'g1', name: 'Everyone', sampleRate: 1, conditions: {} }])
      await warmup()
      setup.mockClear()

      posthog = newPostHog()
      await posthog.ready()
      await settle()

      expect(replayEnabledAtSetup()).toEqual([false])
      expect(replay.startRecording.mock.calls).toEqual([[true]])
      expect(nativeRecording).toBe(true)
      expect(replay.start).not.toHaveBeenCalled()
    })

    it('stops native on a JS pause without ever setting it up to start on its own', async () => {
      currentSessionRecording = v2Config([flagGroup])
      currentFlags = { 'replay-flag': true }
      await warmup()
      setup.mockClear()

      posthog = newPostHog()
      await posthog.ready()
      await settle()
      expect(nativeRecording).toBe(true)

      currentFlags = { 'replay-flag': false }
      await posthog.reloadFeatureFlagsAsync()
      await settle()

      expect(replay.stopRecording).toHaveBeenCalled()
      expect(nativeRecording).toBe(false)
      expect(replayEnabledAtSetup()).not.toContain(true)
    })

    it('keeps native automatic replay on for a v1 config', async () => {
      currentSessionRecording = { endpoint: '/s/' }
      await warmup()
      setup.mockClear()

      posthog = newPostHog()
      await posthog.ready()
      await settle()

      expect(replayEnabledAtSetup()).toEqual([true])
      expect(replay.startRecording).not.toHaveBeenCalled()
    })

    it('retries a refused start on a timer and on flags reloads, and stops once started', async () => {
      currentSessionRecording = v2Config([flagGroup])
      currentFlags = { 'replay-flag': false }
      await warmup()

      posthog = newPostHog(replayOnlyOptions)
      await posthog.ready()
      await settle()
      expect(replay.startRecording).not.toHaveBeenCalled()

      vi.useFakeTimers()
      nativeAccepts = false
      currentFlags = { 'replay-flag': true }
      await posthog.reloadFeatureFlagsAsync()
      await vi.advanceTimersByTimeAsync(0)
      expect(replay.startRecording).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1000)
      expect(replay.startRecording).toHaveBeenCalledTimes(2)

      await posthog.reloadFeatureFlagsAsync()
      await vi.advanceTimersByTimeAsync(0)
      expect(replay.startRecording).toHaveBeenCalledTimes(3)

      nativeAccepts = true
      await vi.advanceTimersByTimeAsync(4000)
      expect(replay.startRecording).toHaveBeenCalledTimes(4)
      expect(nativeRecording).toBe(true)

      await vi.advanceTimersByTimeAsync(60000)
      await posthog.reloadFeatureFlagsAsync()
      await vi.advanceTimersByTimeAsync(0)
      expect(replay.startRecording).toHaveBeenCalledTimes(4)
    })

    it('gives up retrying on the timer after the bounded delays', async () => {
      currentSessionRecording = v2Config([flagGroup])
      currentFlags = { 'replay-flag': false }
      await warmup()

      posthog = newPostHog(replayOnlyOptions)
      await posthog.ready()
      await settle()

      vi.useFakeTimers()
      nativeAccepts = false
      currentFlags = { 'replay-flag': true }
      await posthog.reloadFeatureFlagsAsync()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(120000)
      expect(replay.startRecording).toHaveBeenCalledTimes(6)
    })

    it('does not spend the timer retry budget on event-driven retries', async () => {
      currentSessionRecording = v2Config([
        { id: 'g1', name: 'Taps', sampleRate: 1, conditions: { matchType: 'any', events: [{ name: 'tap' }] } },
      ])
      await warmup()

      posthog = newPostHog(replayOnlyOptions)
      await posthog.ready()
      await settle()
      expect(replay.startRecording).not.toHaveBeenCalled()

      vi.useFakeTimers()
      nativeAccepts = false
      for (let i = 0; i < 6; i++) {
        posthog.capture('tap')
        await vi.advanceTimersByTimeAsync(0)
        await waitForNativePluginEvaluation(posthog)
        await vi.advanceTimersByTimeAsync(0)
      }
      expect(replay.startRecording).toHaveBeenCalledTimes(6)

      nativeAccepts = true
      await vi.advanceTimersByTimeAsync(1000)
      expect(nativeRecording).toBe(true)
    })

    it('gives a later wanted start a fresh timer retry budget after an off decision', async () => {
      currentSessionRecording = v2Config([flagGroup])
      currentFlags = { 'replay-flag': false }
      await warmup()

      posthog = newPostHog(replayOnlyOptions)
      await posthog.ready()
      await settle()

      vi.useFakeTimers()
      nativeAccepts = false
      currentFlags = { 'replay-flag': true }
      await posthog.reloadFeatureFlagsAsync()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(120000)
      expect(replay.startRecording).toHaveBeenCalledTimes(6)

      currentFlags = { 'replay-flag': false }
      await posthog.reloadFeatureFlagsAsync()
      await vi.advanceTimersByTimeAsync(0)
      await waitForNativePluginEvaluation(posthog)

      rotateSession()
      await vi.advanceTimersByTimeAsync(0)
      await waitForNativePluginEvaluation(posthog)
      currentFlags = { 'replay-flag': true }
      await posthog.reloadFeatureFlagsAsync()
      await vi.advanceTimersByTimeAsync(0)
      await waitForNativePluginEvaluation(posthog)
      expect(replay.startRecording).toHaveBeenCalledTimes(7)
      expect(nativeRecording).toBe(false)

      nativeAccepts = true
      await vi.advanceTimersByTimeAsync(1000)
      expect(nativeRecording).toBe(true)
    })

    it('does not re-arm the timer retry from an evaluation in flight at shutdown', async () => {
      currentSessionRecording = v2Config([flagGroup])
      currentFlags = { 'replay-flag': false }
      await warmup()

      posthog = newPostHog(replayOnlyOptions)
      await posthog.ready()
      await settle()
      expect(replay.startRecording).not.toHaveBeenCalled()

      vi.useFakeTimers()
      nativeAccepts = false
      let release!: () => void
      replay.startRecording.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = () => {
              nativeRecording = nativeAccepts
              resolve()
            }
          })
      )
      currentFlags = { 'replay-flag': true }
      await posthog.reloadFeatureFlagsAsync()
      await vi.advanceTimersByTimeAsync(0)
      expect(replay.startRecording).toHaveBeenCalledTimes(1)

      void posthog.shutdown()
      release()
      await vi.advanceTimersByTimeAsync(1500)
      nativeAccepts = true
      await vi.advanceTimersByTimeAsync(60000)
      expect(replay.startRecording).toHaveBeenCalledTimes(1)
    })

    it('cancels the timer retry on stop', async () => {
      currentSessionRecording = v2Config([flagGroup])
      currentFlags = { 'replay-flag': false }
      await warmup()

      posthog = newPostHog(replayOnlyOptions)
      await posthog.ready()
      await settle()

      vi.useFakeTimers()
      nativeAccepts = false
      currentFlags = { 'replay-flag': true }
      await posthog.reloadFeatureFlagsAsync()
      await vi.advanceTimersByTimeAsync(0)
      expect(replay.startRecording).toHaveBeenCalledTimes(1)

      await posthog.stopSessionRecording()
      await vi.advanceTimersByTimeAsync(0)
      const attempts = replay.startRecording.mock.calls.length
      expect((posthog as any)._triggerGroupsStartRetry?.timer).toBeUndefined()
      await vi.advanceTimersByTimeAsync(60000)
      expect(replay.startRecording).toHaveBeenCalledTimes(attempts)
    })

    describe('the sampleRate sent to native', () => {
      const sampleRateAtSetup = (): number | undefined =>
        setup.mock.calls[0][2].sessionReplay.sdkReplayConfig.sampleRate

      const launchWithCachedConfig = async (
        sessionRecording: any,
        options: Record<string, any> = {}
      ): Promise<void> => {
        currentSessionRecording = sessionRecording
        // The remote rate comes from the cached /config, so serve the config there too.
        ;(globalThis as any).window.fetch = vi.fn(async (url: string) => {
          const res = url.includes('flags')
            ? { featureFlags: currentFlags, sessionRecording }
            : { status: 'ok', sessionRecording }
          return { status: 200, json: () => Promise.resolve(res) }
        })
        await warmup()
        setup.mockClear()
        posthog = newPostHog({ ...replayOnlyOptions, ...options })
        await posthog.ready()
        await settle()
      }

      const everyone = { id: 'g1', name: 'Everyone', sampleRate: 1, conditions: {} }

      it('is 1 under v2 without a local rate, ignoring the leftover v1 project rate', async () => {
        await launchWithCachedConfig({ ...v2Config([everyone]), sampleRate: 0.2 })

        expect(sampleRateAtSetup()).toBe(1)
      })

      it('is the local rate under v2', async () => {
        await launchWithCachedConfig(
          { ...v2Config([everyone]), sampleRate: 0.2 },
          { sessionReplayConfig: { sampleRate: 0.3 } }
        )

        expect(sampleRateAtSetup()).toBe(0.3)
      })

      it.each([2, -1])('is 1 under v2 when the local rate %s is invalid', async (invalidRate) => {
        await launchWithCachedConfig(v2Config([everyone]), { sessionReplayConfig: { sampleRate: invalidRate } })

        expect(sampleRateAtSetup()).toBe(1)
      })

      it('is the remote rate under v1 without a local rate', async () => {
        await launchWithCachedConfig({ endpoint: '/s/', sampleRate: 0.5 })

        expect(sampleRateAtSetup()).toBe(0.5)
      })

      it('is the local rate under v1 when both are set', async () => {
        await launchWithCachedConfig({ endpoint: '/s/', sampleRate: 0.5 }, { sessionReplayConfig: { sampleRate: 0.3 } })

        expect(sampleRateAtSetup()).toBe(0.3)
      })
    })

    describe('the minimum duration sent to native', () => {
      const minimumDurations = (): (number | null)[] => setMinimumDuration.mock.calls.map(([ms]) => ms)

      const launch = async (sessionRecording: any): Promise<void> => {
        currentSessionRecording = sessionRecording
        await warmup()
        setup.mockClear()
        setMinimumDuration.mockClear()
        posthog = newPostHog(replayOnlyOptions)
        await posthog.ready()
        await settle()
      }

      const slowGroup = { ...flagGroup, minDurationMs: 5000 }
      const fastGroup = {
        id: 'g2',
        name: 'Other flag',
        sampleRate: 1,
        minDurationMs: 2000,
        conditions: { matchType: 'any', flag: { flag: 'other-flag' } },
      }

      it('is the activated group minimum', async () => {
        currentFlags = { 'replay-flag': true }
        await launch(v2Config([slowGroup]))

        expect(minimumDurations()).toEqual([5000])
      })

      it('lowers to the minimum of a second activated group', async () => {
        currentFlags = { 'replay-flag': true }
        await launch(v2Config([slowGroup, fastGroup]))
        expect(minimumDurations()).toEqual([5000])

        currentFlags = { 'replay-flag': true, 'other-flag': true }
        await posthog.reloadFeatureFlagsAsync()
        await settle()

        expect(minimumDurations()).toEqual([5000, 2000])
      })

      it('is 0 when the activated group sets none', async () => {
        await launch(v2Config([{ id: 'g1', name: 'Everyone', sampleRate: 1, conditions: {} }]))

        expect(minimumDurations()).toEqual([0])
      })

      it('is cleared when the config drops the groups', async () => {
        currentFlags = { 'replay-flag': true }
        await launch(v2Config([slowGroup]))

        currentSessionRecording = { endpoint: '/s/' }
        await posthog.reloadFeatureFlagsAsync()
        await settle()

        expect(minimumDurations()).toEqual([5000, null])
      })

      it('reaches native after setup and before the first start', async () => {
        currentFlags = { 'replay-flag': true }
        await launch(v2Config([slowGroup]))

        const [sentAt] = setMinimumDuration.mock.invocationCallOrder
        expect(sentAt).toBeGreaterThan(setup.mock.invocationCallOrder[0])
        expect(sentAt).toBeLessThan(replay.startRecording.mock.invocationCallOrder[0])
      })

      it('is not sent again for an unchanged value', async () => {
        currentFlags = { 'replay-flag': true }
        await launch(v2Config([slowGroup]))

        await posthog.reloadFeatureFlagsAsync()
        await settle()
        await posthog.reloadFeatureFlagsAsync()
        await settle()

        expect(minimumDurations()).toEqual([5000])
      })

      it('is sent again to a new native instance', async () => {
        currentFlags = { 'replay-flag': true }
        await launch(v2Config([slowGroup]))
        await posthog.shutdown()

        setup.mockClear()
        posthog = newPostHog(replayOnlyOptions)
        await posthog.ready()
        await settle()

        expect(setup).toHaveBeenCalledTimes(1)
        expect(minimumDurations()).toEqual([5000, 5000])
      })

      it('is cleared on opt-out', async () => {
        currentFlags = { 'replay-flag': true }
        await launch(v2Config([slowGroup]))

        await posthog.optOut()
        await settle()

        expect(minimumDurations()).toEqual([5000, null])
      })

      it('is cleared on reset()', async () => {
        currentFlags = { 'replay-flag': true }
        await launch(v2Config([slowGroup]))

        posthog.reset()

        expect(minimumDurations()).toEqual([5000, null])
      })

      it('is skipped with one warning when the plugin lacks the method', async () => {
        delete (replay as any).setSessionReplayMinimumDuration
        currentFlags = { 'replay-flag': true }
        currentSessionRecording = v2Config([slowGroup])
        await warmup()

        posthog = newPostHog(replayOnlyOptions)
        const warn = vi.spyOn((posthog as any)._logger, 'warn')
        const minimumDurationWarnings = (): number =>
          warn.mock.calls.filter(([message]) => String(message).includes('minimum duration')).length
        await posthog.ready()
        await settle()
        await posthog.reloadFeatureFlagsAsync()
        await settle()

        expect(replay.startRecording).toHaveBeenCalled()
        expect(setMinimumDuration).not.toHaveBeenCalled()
        expect(minimumDurationWarnings()).toBe(1)
      })
    })

    describe('on a first launch with nothing cached', () => {
      let releaseConfig: () => void

      // Holds every response so the pre-config state can be observed, then delivers the config.
      const holdConfig = (): void => {
        const gate = new Promise<void>((resolve) => {
          releaseConfig = resolve
        })
        const respond = (window.fetch as any).getMockImplementation() as (url: string) => Promise<unknown>
        ;(globalThis as any).window.fetch = vi.fn(async (url: string) => {
          await gate
          return respond(url)
        })
      }

      it('never sets native up to record when the only v2 group is ineligible', async () => {
        currentSessionRecording = v2Config([flagGroup])
        currentFlags = { 'replay-flag': false }
        holdConfig()

        posthog = newPostHog(replayOnlyOptions)
        await posthog.ready()
        await settle()
        expect(setup).not.toHaveBeenCalled()

        releaseConfig()
        await posthog.reloadFeatureFlagsAsync()
        await settle()

        expect(replayEnabledAtSetup()).not.toContain(true)
        expect(replay.startRecording).not.toHaveBeenCalled()
      })

      it('sets native up with replay off and starts the recorder once for an eligible v2 group', async () => {
        currentSessionRecording = v2Config([{ id: 'g1', name: 'Everyone', sampleRate: 1, conditions: {} }])
        holdConfig()

        posthog = newPostHog(replayOnlyOptions)
        await posthog.ready()
        await settle()
        expect(setup).not.toHaveBeenCalled()
        expect(replay.startRecording).not.toHaveBeenCalled()

        releaseConfig()
        await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalledTimes(1))
        await settle()

        expect(replayEnabledAtSetup()).toEqual([false])
        expect(replay.startRecording.mock.calls).toEqual([[true]])
      })

      it('sets native up with automatic replay only once a v1 config arrives', async () => {
        currentSessionRecording = { endpoint: '/s/' }
        holdConfig()

        posthog = newPostHog(replayOnlyOptions)
        await posthog.ready()
        await settle()
        expect(setup).not.toHaveBeenCalled()

        releaseConfig()
        await waitForExpect(2000, () => expect(replayEnabledAtSetup()).toEqual([true]))
        expect(replay.startRecording).not.toHaveBeenCalled()
      })

      it('retries a start native refused on the instance push already brought up', async () => {
        currentSessionRecording = v2Config([{ id: 'g1', name: 'Everyone', sampleRate: 1, conditions: {} }])
        nativeAccepts = false
        holdConfig()

        posthog = newPostHog()
        await posthog.ready()
        await waitForExpect(2000, () => expect(setup).toHaveBeenCalled())

        releaseConfig()
        await waitForExpect(2000, () => expect(replay.startRecording).toHaveBeenCalled())
        await settle()
        expect(nativeRecording).toBe(false)
        expect(setup).toHaveBeenCalledTimes(1)

        const refusedStarts = replay.startRecording.mock.calls.length
        nativeAccepts = true
        await waitForExpect(3000, () => expect(replay.startRecording.mock.calls.length).toBeGreaterThan(refusedStarts))
        expect(nativeRecording).toBe(true)
        expect(setup).toHaveBeenCalledTimes(1)
      })

      it('does not set native up or start it when the config arrives after shutdown', async () => {
        currentSessionRecording = v2Config([{ id: 'g1', name: 'Everyone', sampleRate: 1, conditions: {} }])
        holdConfig()

        posthog = newPostHog(replayOnlyOptions)
        await posthog.ready()
        await settle()

        const shutdown = posthog.shutdown()
        releaseConfig()
        await shutdown
        await settle()

        expect(setup).not.toHaveBeenCalled()
        expect(replay.startRecording).not.toHaveBeenCalled()
      })

      it('still brings native up for push with replay off before the config arrives', async () => {
        currentSessionRecording = { endpoint: '/s/' }
        holdConfig()

        posthog = newPostHog()
        await posthog.ready()
        await waitForExpect(2000, () => expect(setup).toHaveBeenCalled())

        expect(replayEnabledAtSetup()).toEqual([false])
        expect(nativeRecording).toBe(false)
        releaseConfig()
      })
    })
  })
})
