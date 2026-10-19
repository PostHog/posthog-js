import { PostHog, PostHogCustomStorage, PostHogPersistedProperty } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { Linking, AppState } from 'react-native'
import { waitForExpect, wait } from './test-utils'

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

  const newPostHog = (): PostHog =>
    new PostHog('test-token', {
      customStorage: mockStorage,
      enableSessionReplay: true,
      flushInterval: 0,
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
})
