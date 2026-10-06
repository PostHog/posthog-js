import { PostHog, PostHogCustomStorage, PostHogPersistedProperty } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { Linking, AppState, Platform } from 'react-native'
import { wait, waitForNativeChain, waitForNativePluginEvaluation } from './test-utils'

// The native plugin bridge, mocked with the legacy start() surface (no `setup`). The
// getter lets a test remove the plugin altogether to model an app without it installed.
let nativeRecording = false
// The native replay debug map returned by `getSessionReplayDebugProperties`; mutable so a
// test can shape it, reset to `{}` (no integration) between tests.
let nativeDebugMap: Record<string, any> = {}

const modules = vi.hoisted(() => ({ plugin: undefined as any }))

vi.mock('../src/optional/OptionalPlugin', () => ({
  OptionalReactNativePluginVersion: '2.9.3',
  get OptionalReactNativePlugin() {
    return modules.plugin
  },
}))

const pluginMock = {
  start: vi.fn(async () => {}),
  startSession: vi.fn(async () => {}),
  endSession: vi.fn(async () => {}),
  isEnabled: vi.fn(async () => nativeRecording),
  identify: vi.fn(async () => {}),
  startRecording: vi.fn(async () => {}),
  stopRecording: vi.fn(async () => {}),
  getSessionReplayDebugProperties: vi.fn(async () => nativeDebugMap),
}

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()

type CapturedEvent = { event: string; properties: Record<string, any>; timestamp?: string }

const OPTIONAL_KEYS = [
  '$sdk_debug_session_start',
  '$sdk_debug_replay_capture_mode',
  '$sdk_debug_replay_flush_hold_reason',
  '$sdk_debug_replay_pending_trigger_conditions',
]
const REQUIRED_KEYS = [
  '$recording_status',
  '$sdk_debug_replay_event_trigger_status',
  '$sdk_debug_replay_linked_flag_trigger_status',
  '$sdk_debug_replay_internal_buffer_length',
]
const REMOVED_KEYS = ['$sdk_debug_current_session_duration', '$sdk_debug_replay_throttle_delay_ms']
const DEBUG_KEYS = [
  ...REQUIRED_KEYS,
  ...OPTIONAL_KEYS,
  '$sdk_debug_pending_queue_size',
  '$sdk_debug_error_capturing_properties',
]
const WINDOW_MS = 30_000

const debugKeysOf = (properties: Record<string, any>): string[] =>
  Object.keys(properties).filter(
    (key) => (key === '$recording_status' || key.startsWith('$sdk_debug_')) && properties[key] !== undefined
  )

const bundleKeysOf = (properties: Record<string, any>): string[] =>
  OPTIONAL_KEYS.filter((key) => properties[key] !== undefined)

const advanceClock = (ms: number): void => {
  vi.setSystemTime(Date.now() + ms)
}

describe('PostHog RN session replay debug properties', () => {
  vi.useRealTimers()

  let posthog: PostHog | undefined
  let cache: Record<string, any> = {}
  let mockStorage: PostHogCustomStorage
  let currentFlags: Record<string, any> = {}
  let currentFlagDetails: Record<string, any> | undefined
  let currentSessionRecording: any = { endpoint: '/s/' }
  let minimalFlagCalledEvents = false

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    modules.plugin = pluginMock
    nativeRecording = false
    Platform.OS = 'ios'
    for (const fn of Object.values(pluginMock)) {
      fn.mockClear()
    }
    pluginMock.isEnabled.mockImplementation(async () => nativeRecording)
    pluginMock.start.mockImplementation(async () => {
      nativeRecording = true
    })
    pluginMock.startRecording.mockImplementation(async () => {
      nativeRecording = true
    })
    pluginMock.stopRecording.mockImplementation(async () => {
      nativeRecording = false
    })
    nativeDebugMap = {}
    // `mockReset` (not `mockClear`), so a `mockImplementationOnce` a test queued but the SDK
    // never consumed (e.g. because a refresh site no-op'd) can't leak into the next test.
    pluginMock.getSessionReplayDebugProperties.mockReset()
    pluginMock.getSessionReplayDebugProperties.mockImplementation(async () => nativeDebugMap)

    currentFlags = {}
    currentFlagDetails = undefined
    currentSessionRecording = { endpoint: '/s/' }
    minimalFlagCalledEvents = false
    ;(globalThis as any).window.fetch = vi.fn(async (url: string) => {
      let res: any = { status: 'ok' }
      if (url.includes('flags')) {
        res = {
          featureFlags: currentFlags,
          ...(currentFlagDetails ? { flags: currentFlagDetails } : {}),
          sessionRecording: currentSessionRecording,
          minimalFlagCalledEvents,
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
    await posthog?.shutdown()
    posthog = undefined
    Platform.OS = 'ios'
    vi.useRealTimers()
  })

  const newPostHog = (options: Record<string, unknown> = {}): PostHog => {
    const client = new PostHog('test-token', {
      customStorage: mockStorage,
      enableSessionReplay: false,
      flushInterval: 0,
      flushAt: 100,
      captureAppLifecycleEvents: false,
      ...options,
    })
    posthog = client
    return client
  }

  const readyClient = async (options: Record<string, unknown> = {}): Promise<PostHog> => {
    const client = newPostHog(options)
    await client.ready()
    await waitForNativePluginEvaluation(client)
    return client
  }

  const observe = (client: PostHog): CapturedEvent[] => {
    const seen: CapturedEvent[] = []
    client.on('capture', (message: any) => seen.push(message))
    return seen
  }

  const captureOne = (client: PostHog, event = 'custom event', properties?: Record<string, any>): CapturedEvent => {
    const seen = observe(client)
    client.capture(event, properties)
    expect(seen).toHaveLength(1)
    return seen[0]
  }

  const reloadAndSettle = async (client: PostHog): Promise<void> => {
    await client.reloadFeatureFlagsAsync()
    await waitForNativePluginEvaluation(client)
    await waitForNativeChain(client)
  }

  // Caches the remote replay config so the next launch evaluates its gates at startup instead
  // of starting optimistically before /flags returns.
  const warmup = async (): Promise<void> => {
    const w = newPostHog({ enableSessionReplay: true })
    await w.ready()
    await w.reloadFeatureFlagsAsync()
    await waitForNativePluginEvaluation(w)
    await w.shutdown()
    nativeRecording = false
    pluginMock.start.mockClear()
  }

  it('Custom event carries debug properties', async () => {
    const client = await readyClient()
    const { properties } = captureOne(client)
    expect(properties.$recording_status).toBe('disabled')
  })

  it('A custom event carries the required keys and queue depth but none of the optional bundle', async () => {
    nativeDebugMap = {
      $recording_status: 'buffering',
      $sdk_debug_replay_flush_hold_reason: 'awaiting_remote_config',
      $sdk_debug_replay_internal_buffer_length: 2,
    }
    const client = await readyClient({ enableSessionReplay: true })
    await waitForNativeChain(client)

    const { properties } = captureOne(client)
    expect(properties.$recording_status).toBe('buffering')
    expect(properties.$sdk_debug_replay_event_trigger_status).toBe('trigger_disabled')
    expect(properties.$sdk_debug_replay_linked_flag_trigger_status).toBe('trigger_disabled')
    expect(properties.$sdk_debug_replay_internal_buffer_length).toBe(2)
    expect(properties.$sdk_debug_pending_queue_size).toBe(0)
    expect(bundleKeysOf(properties)).toEqual([])
  })

  it('Snapshot event carries none of the debug properties when nothing was dropped', async () => {
    const client = await readyClient({ enableSessionReplay: true })
    const { properties } = captureOne(client, '$snapshot', { $snapshot_data: [] })
    expect(debugKeysOf(properties)).toEqual([])
    expect(captureOne(client, '$screen').properties.$sdk_debug_session_start).toBeDefined()
  })

  it('Minimal feature-flag-called event strips debug properties', async () => {
    minimalFlagCalledEvents = true
    currentFlags = { 'plain-flag': true }
    currentFlagDetails = {
      'plain-flag': { key: 'plain-flag', enabled: true, metadata: { id: 1, version: 1, has_experiment: false } },
    }
    const client = await readyClient()
    await client.reloadFeatureFlagsAsync()

    const seen = observe(client)
    client.getFeatureFlag('plain-flag')
    const flagCalled = seen.find((e) => e.event === '$feature_flag_called')
    expect(flagCalled).toBeDefined()
    expect(debugKeysOf(flagCalled!.properties)).toEqual([])
  })

  it('Full feature-flag-called event carries debug properties', async () => {
    minimalFlagCalledEvents = true
    currentFlags = { 'experiment-flag': 'test' }
    currentFlagDetails = {
      'experiment-flag': {
        key: 'experiment-flag',
        enabled: true,
        variant: 'test',
        metadata: { id: 2, version: 1, has_experiment: true },
      },
    }
    const client = await readyClient()
    await client.reloadFeatureFlagsAsync()

    const seen = observe(client)
    client.getFeatureFlag('experiment-flag')
    const flagCalled = seen.find((e) => e.event === '$feature_flag_called')
    expect(flagCalled?.properties.$recording_status).toBe('disabled')
  })

  it('A full-envelope feature-flag-called event carries the required keys only and does not start the window', async () => {
    minimalFlagCalledEvents = true
    currentFlags = { 'experiment-flag': 'test' }
    currentFlagDetails = {
      'experiment-flag': {
        key: 'experiment-flag',
        enabled: true,
        variant: 'test',
        metadata: { id: 2, version: 1, has_experiment: true },
      },
    }
    const client = await readyClient()
    await client.reloadFeatureFlagsAsync()

    const seen = observe(client)
    client.getFeatureFlag('experiment-flag')
    const flagCalled = seen.find((e) => e.event === '$feature_flag_called')
    expect(flagCalled?.properties.$recording_status).toBe('disabled')
    expect(bundleKeysOf(flagCalled!.properties)).toEqual([])

    expect(bundleKeysOf(captureOne(client, '$screen').properties)).toContain('$sdk_debug_session_start')
  })

  it('Replay not configured reports disabled', async () => {
    const client = await readyClient({ enableSessionReplay: undefined })
    expect(captureOne(client).properties.$recording_status).toBe('disabled')
  })

  it('Neither holding nor disabled reports active', async () => {
    const client = await readyClient({ enableSessionReplay: true })
    expect(captureOne(client).properties.$recording_status).toBe('active')
  })

  it('Session and queue keys are present when a session exists (mobile)', async () => {
    const client = await readyClient()
    client.capture('first')
    const { properties } = captureOne(client, '$screen')
    const start = client.getPersistedProperty<number>(PostHogPersistedProperty.SessionStartTimestamp)

    expect(properties.$sdk_debug_session_start).toBe(start)
    expect(Number.isInteger(properties.$sdk_debug_session_start)).toBe(true)
    expect(properties.$sdk_debug_pending_queue_size).toBe(1)
    expect(properties).not.toHaveProperty('$sdk_debug_retry_queue_size')
    for (const key of REMOVED_KEYS) {
      expect(properties).not.toHaveProperty(key)
    }
  })

  it('Session keys are present without session replay (mobile)', async () => {
    const client = await readyClient({ enableSessionReplay: false })
    const { properties } = captureOne(client, '$screen')
    expect(typeof properties.$sdk_debug_session_start).toBe('number')
    expect(properties.$recording_status).toBe('disabled')
  })

  it('Session keys follow a caller-supplied session id (mobile)', async () => {
    const client = await readyClient()
    const { properties } = captureOne(client, '$screen', { $session_id: '0190a0a0-0000-7000-8000-000000000000' })
    // Core always sets $session_id last, so a JS-built event never keeps a caller id.
    expect(properties.$session_id).toBe(client.getPersistedProperty(PostHogPersistedProperty.SessionId))
    expect(properties.$sdk_debug_session_start).toBe(
      client.getPersistedProperty(PostHogPersistedProperty.SessionStartTimestamp)
    )
  })

  it('session keys describe the rotated session when the previous one expired during capture', async () => {
    const client = await readyClient()
    const previousSessionId = client.getSessionId()
    const previousStart = client.getPersistedProperty<number>(PostHogPersistedProperty.SessionStartTimestamp)!
    // Push the last activity past the expiry so the capture itself rotates the session.
    client.setPersistedProperty(PostHogPersistedProperty.SessionLastTimestamp, Date.now() - 3600 * 1000)

    const { properties } = captureOne(client, '$screen')
    const newStart = client.getPersistedProperty<number>(PostHogPersistedProperty.SessionStartTimestamp)!
    expect(properties.$session_id).not.toBe(previousSessionId)
    expect(properties.$session_id).toBe(client.getPersistedProperty(PostHogPersistedProperty.SessionId))
    expect(newStart).toBeGreaterThanOrEqual(previousStart)
    expect(properties.$sdk_debug_session_start).toBe(newStart)
  })

  it('Linked-flag trigger status reflects current state on every capture', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': false }
    await warmup()

    const client = await readyClient({ enableSessionReplay: true })
    const sessionId = client.getSessionId()
    const pending = captureOne(client, '$screen').properties
    expect(pending.$recording_status).toBe('disabled')
    expect(pending.$sdk_debug_replay_linked_flag_trigger_status).toBe('trigger_pending')
    expect(pending.$sdk_debug_replay_pending_trigger_conditions).toEqual(['linked_flag'])

    currentFlags = { 'replay-flag': true }
    await client.reloadFeatureFlagsAsync()
    await waitForNativePluginEvaluation(client)

    const activated = captureOne(client).properties
    expect(activated.$session_id).toBe(sessionId)
    expect(activated.$sdk_debug_replay_linked_flag_trigger_status).toBe('trigger_activated')
    expect(activated.$sdk_debug_replay_pending_trigger_conditions).toBeUndefined()
    expect(activated.$recording_status).toBe('active')
  })

  it('Event trigger status reflects current state on every capture', async () => {
    currentSessionRecording = { eventTriggers: ['$pageview'], endpoint: '/s/' }
    await warmup()

    const client = await readyClient({ enableSessionReplay: true })
    const sessionId = client.getSessionId()
    const pending = captureOne(client, '$screen').properties
    expect(pending.$sdk_debug_replay_event_trigger_status).toBe('trigger_pending')
    expect(pending.$sdk_debug_replay_pending_trigger_conditions).toEqual(['event_trigger'])
    expect(pending.$recording_status).toBe('disabled')

    client.capture('$pageview')
    await wait(50)
    await waitForNativePluginEvaluation(client)

    const activated = captureOne(client, 'after trigger').properties
    expect(activated.$session_id).toBe(sessionId)
    expect(activated.$sdk_debug_replay_event_trigger_status).toBe('trigger_activated')
    expect(activated.$sdk_debug_replay_pending_trigger_conditions).toBeUndefined()
    expect(activated.$recording_status).toBe('active')
  })

  it('Debug values win over same-named caller or registered properties', async () => {
    const client = await readyClient()
    client.register({ $recording_status: 'registered', $sdk_debug_session_start: 'registered' })
    const { properties } = captureOne(client, '$screen', {
      $recording_status: 'caller',
      $sdk_debug_session_start: 'caller',
    })
    expect(properties.$recording_status).toBe('disabled')
    expect(properties.$sdk_debug_session_start).toBe(
      client.getPersistedProperty(PostHogPersistedProperty.SessionStartTimestamp)
    )
  })

  it('Capture mode is screenshot when screenshot recording is on', async () => {
    const client = await readyClient()
    const { properties } = captureOne(client, '$screen')
    expect(properties.$sdk_debug_replay_capture_mode).toBe('screenshot')

    advanceClock(WINDOW_MS)
    Platform.OS = 'macos'
    const onMacOS = captureOne(client, '$screen').properties
    expect(onMacOS.$sdk_debug_replay_capture_mode).toBeUndefined()
  })

  it('Capture mode is never a required key (mobile)', async () => {
    const client = await readyClient()
    expect(captureOne(client).properties.$sdk_debug_replay_capture_mode).toBeUndefined()
  })

  it('Capture racing stop() yields a consistent status, never a torn read', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': true }
    await warmup()
    const client = await readyClient({ enableSessionReplay: true })
    expect(captureOne(client).properties.$recording_status).toBe('active')

    currentFlags = { 'replay-flag': false }
    const stopping = client.reloadFeatureFlagsAsync().then(() => waitForNativePluginEvaluation(client))
    const racing = captureOne(client).properties
    expect(['disabled', 'active']).toContain(racing.$recording_status)
    expect(racing.$sdk_debug_replay_flush_hold_reason).toBeUndefined()
    await stopping

    const after = captureOne(client).properties
    expect(after.$recording_status).toBe('disabled')
    expect(after.$sdk_debug_replay_flush_hold_reason).toBeUndefined()
  })

  it('A build failure attaches the stringified error and nothing else from the debug map', async () => {
    const client = await readyClient({ enableSessionReplay: true })
    vi.spyOn(client, 'getKnownFeatureFlags').mockImplementation(() => {
      throw new Error('boom')
    })

    for (const event of ['custom event', '$screen']) {
      const { properties } = captureOne(client, event)
      expect(properties.$sdk_debug_error_capturing_properties).toBe('Error: boom')
      expect(debugKeysOf(properties).sort()).toEqual([
        '$sdk_debug_error_capturing_properties',
        '$sdk_debug_pending_queue_size',
      ])
      const survivingKeys = ['$sdk_debug_error_capturing_properties', '$sdk_debug_pending_queue_size']
      for (const key of DEBUG_KEYS.filter((k) => !survivingKeys.includes(k))) {
        expect(properties[key]).toBeUndefined()
      }
    }
  })

  it('A successful build never attaches the error key', async () => {
    const client = await readyClient()
    const replayEnabled = vi.spyOn(client, '_isEnableSessionReplay')
    replayEnabled.mockImplementationOnce(() => {
      throw new Error('first call only')
    })

    // The build runs twice per capture; a failure on the first call must not leak into the event.
    const { properties } = captureOne(client)
    expect(replayEnabled.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(properties.$sdk_debug_error_capturing_properties).toBeUndefined()
    expect(properties.$recording_status).toBe('disabled')
    expect(properties.$sdk_debug_pending_queue_size).toBe(0)

    expect(captureOne(client).properties.$sdk_debug_error_capturing_properties).toBeUndefined()
  })

  it('does not leak a key from the first of the two per-capture calls', async () => {
    const client = await readyClient()
    const original = (client as any)._sessionReplayDebugProperties.bind(client)
    let calls = 0
    vi.spyOn(client as any, '_sessionReplayDebugProperties').mockImplementation(() => {
      calls += 1
      const built = original()
      return calls === 1
        ? { ...built, $sdk_debug_replay_capture_mode: 'screenshot' }
        : { ...built, $sdk_debug_replay_capture_mode: undefined }
    })

    const { properties } = captureOne(client, '$screen')
    expect(calls).toBe(2)
    expect(properties.$sdk_debug_replay_capture_mode).toBeUndefined()
  })

  it('Exception event carries recording status', async () => {
    const client = await readyClient()
    const seen = observe(client)
    client.captureException(new Error('non-fatal'))
    const exception = seen.find((e) => e.event === '$exception')
    expect(exception?.properties.$recording_status).toBe('disabled')
  })

  it('Identify and set events carry recording status', async () => {
    const client = await readyClient()
    const seen = observe(client)
    client.on('identify', (message: any) => seen.push(message))
    client.identify('user-1', { plan: 'pro' })
    client.setPersonProperties({ seat: 2 })
    await wait(50)

    const identify = seen.find((e) => e.event === '$identify')
    const set = seen.find((e) => e.event === '$set')
    expect(identify?.properties.$recording_status).toBe('disabled')
    expect(set?.properties.$recording_status).toBe('disabled')
  })

  it('No replay integration installed still reports disabled', async () => {
    modules.plugin = undefined
    const client = await readyClient({ enableSessionReplay: true })
    const { properties } = captureOne(client)
    expect(properties.$recording_status).toBe('disabled')
    expect(bundleKeysOf(properties)).toEqual([])
    await client.shutdown()

    Platform.OS = 'macos'
    modules.plugin = pluginMock
    const onMacOS = await readyClient({ enableSessionReplay: true })
    const macProperties = captureOne(onMacOS).properties
    expect(macProperties.$recording_status).toBe('disabled')
    expect(bundleKeysOf(macProperties)).toEqual([])
  })

  it('No replay integration installed adds the fallback bundle to an eligible event (mobile)', async () => {
    modules.plugin = undefined
    const client = await readyClient({ enableSessionReplay: true })
    const { properties } = captureOne(client, '$screen')
    expect(properties.$recording_status).toBe('disabled')
    expect(typeof properties.$sdk_debug_session_start).toBe('number')
    expect(properties.$sdk_debug_replay_capture_mode).toBeUndefined()
    expect(properties.$sdk_debug_replay_event_trigger_status).toBeUndefined()
    expect(properties.$sdk_debug_replay_linked_flag_trigger_status).toBeUndefined()
    expect(properties.$sdk_debug_replay_pending_trigger_conditions).toBeUndefined()
  })

  it('omits the trigger keys while session replay is off', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', eventTriggers: ['$pageview'], endpoint: '/s/' }
    await warmup()

    const client = await readyClient({ enableSessionReplay: false })
    const { properties } = captureOne(client)
    expect(properties.$sdk_debug_replay_event_trigger_status).toBeUndefined()
    expect(properties.$sdk_debug_replay_linked_flag_trigger_status).toBeUndefined()
    expect(properties.$sdk_debug_replay_pending_trigger_conditions).toBeUndefined()
  })

  it('reports both triggers as disabled when replay is on without any configured', async () => {
    const client = await readyClient({ enableSessionReplay: true })
    const { properties } = captureOne(client)
    expect(properties.$sdk_debug_replay_event_trigger_status).toBe('trigger_disabled')
    expect(properties.$sdk_debug_replay_linked_flag_trigger_status).toBe('trigger_disabled')
    expect(properties.$sdk_debug_replay_pending_trigger_conditions).toBeUndefined()
  })

  // The flags-driven pause is the stop path that owns the JS recording flag; the manual
  // stopSessionRecording() leaves it untouched so a later flags reload cannot restart it.
  const pauseViaLinkedFlag = async (client: PostHog): Promise<void> => {
    currentFlags = { 'replay-flag': false }
    await client.reloadFeatureFlagsAsync()
    await waitForNativePluginEvaluation(client)
    expect(pluginMock.stopRecording).toHaveBeenCalled()
  }

  it('Stopping recording clears the hold reason', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': true }
    await warmup()
    const client = await readyClient({ enableSessionReplay: true })
    expect(captureOne(client).properties.$recording_status).toBe('active')

    await pauseViaLinkedFlag(client)
    const { properties } = captureOne(client, '$screen')
    expect(properties.$recording_status).toBe('disabled')
    expect(properties.$sdk_debug_replay_flush_hold_reason).toBeUndefined()
  })

  it('Config-derived keys remain present after stop/uninstall while status is disabled', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': true }
    await warmup()
    const client = await readyClient({ enableSessionReplay: true })
    await pauseViaLinkedFlag(client)
    const { properties } = captureOne(client, '$screen')
    expect(properties.$recording_status).toBe('disabled')
    expect(properties.$sdk_debug_replay_capture_mode).toBe('screenshot')

    const neverEnabled = captureOne(await readyClient({ enableSessionReplay: false }), '$screen').properties
    expect(neverEnabled.$sdk_debug_replay_capture_mode).toBe('screenshot')
  })

  it('A previous-process crash carries no live debug state', async () => {
    const client = await readyClient({ enableSessionReplay: true })
    const start = client.getPersistedProperty<number>(PostHogPersistedProperty.SessionStartTimestamp)!
    const seen = observe(client)
    client.capture('$exception', { $exception_list: [] }, { timestamp: new Date(start - 1000) })
    client.capture('backdated custom', {}, { timestamp: new Date(start - 1).toISOString() })

    expect(seen).toHaveLength(2)
    for (const event of seen) {
      expect(debugKeysOf(event.properties)).toEqual([])
      expect(Object.keys(event.properties).some((key) => key.startsWith('$sdk_debug_'))).toBe(false)
      expect(event.properties).not.toHaveProperty('$recording_status')
    }
  })

  it('A previous-process crash does not claim or start the window', async () => {
    const client = await readyClient({ enableSessionReplay: true })
    const start = client.getPersistedProperty<number>(PostHogPersistedProperty.SessionStartTimestamp)!
    client.capture('$exception', { $exception_list: [] }, { timestamp: new Date(start - 1000) })

    expect(bundleKeysOf(captureOne(client, '$screen').properties)).toContain('$sdk_debug_session_start')
  })

  it('A backdated event within the current session keeps the keys', async () => {
    const client = await readyClient({ enableSessionReplay: true })
    const start = client.getPersistedProperty<number>(PostHogPersistedProperty.SessionStartTimestamp)!
    const seen = observe(client)
    client.capture('$screen', {}, { timestamp: new Date(start + 1000) })
    client.capture('at session start', {}, { timestamp: new Date(start) })

    expect(seen).toHaveLength(2)
    for (const event of seen) {
      expect(event.properties.$recording_status).toBe('active')
    }
    expect(seen[0].properties.$sdk_debug_session_start).toBe(start)
    expect(bundleKeysOf(seen[1].properties)).toEqual([])
  })

  it('Active recording status implies the boolean getter is true', async () => {
    const client = await readyClient({ enableSessionReplay: true })
    expect(captureOne(client).properties.$recording_status).toBe('active')
    expect(await client.isSessionReplayActive()).toBe(true)
  })

  it('Disabled recording status implies the boolean getter is false', async () => {
    modules.plugin = undefined
    const client = await readyClient({ enableSessionReplay: true })
    expect(captureOne(client).properties.$recording_status).toBe('disabled')
    expect(await client.isSessionReplayActive()).toBe(false)
  })

  it('Holding for remote config or minimum duration reports buffering', async () => {
    nativeDebugMap = {
      $recording_status: 'buffering',
      $sdk_debug_replay_flush_hold_reason: 'awaiting_remote_config',
      $sdk_debug_replay_internal_buffer_length: 3,
    }
    const client = await readyClient({ enableSessionReplay: true })
    await waitForNativeChain(client)

    const { properties } = captureOne(client, '$screen')
    expect(properties.$recording_status).toBe('buffering')
    expect(properties.$sdk_debug_replay_flush_hold_reason).toBe('awaiting_remote_config')
    expect(properties.$sdk_debug_replay_internal_buffer_length).toBe(3)
  })

  it('Neither holding nor disabled reports active (native)', async () => {
    const client = await readyClient({ enableSessionReplay: true })
    nativeDebugMap = { $recording_status: 'active' }
    await reloadAndSettle(client)

    const { properties } = captureOne(client)
    expect(properties.$recording_status).toBe('active')
    expect(properties.$sdk_debug_replay_flush_hold_reason).toBeUndefined()
  })

  it('Mobile hold reason is present only while buffering', async () => {
    const client = await readyClient({ enableSessionReplay: true })
    nativeDebugMap = {
      $recording_status: 'buffering',
      $sdk_debug_replay_flush_hold_reason: 'awaiting_remote_config',
    }
    await reloadAndSettle(client)
    const buffering = captureOne(client, '$screen').properties
    expect(buffering.$sdk_debug_replay_flush_hold_reason).toBe('awaiting_remote_config')

    nativeDebugMap = { $recording_status: 'active' }
    await reloadAndSettle(client)

    advanceClock(WINDOW_MS)
    const active = captureOne(client, '$screen').properties
    expect(active.$recording_status).toBe('active')
    expect(active.$sdk_debug_replay_flush_hold_reason).toBeUndefined()
  })

  it('Capture racing stop() yields a consistent status, never a torn read (native)', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': true }
    await warmup()
    const client = await readyClient({ enableSessionReplay: true })
    nativeDebugMap = {
      $recording_status: 'buffering',
      $sdk_debug_replay_flush_hold_reason: 'awaiting_remote_config',
    }
    await reloadAndSettle(client)
    expect(captureOne(client).properties.$recording_status).toBe('buffering')

    // The reload queues two refreshes (onFeatureFlags and the stop it triggers); gate both so
    // neither lands before the capture below races the stop.
    currentFlags = { 'replay-flag': false }
    nativeDebugMap = { $recording_status: 'disabled' }
    let releaseGetter: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseGetter = resolve
    })
    pluginMock.getSessionReplayDebugProperties.mockImplementation(async () => {
      await gate
      return nativeDebugMap
    })

    const reloading = client.reloadFeatureFlagsAsync().then(() => waitForNativePluginEvaluation(client))
    await wait(10)

    // Neither refresh has landed (their getters are gated above); the cache was cleared
    // synchronously in `_stopSessionRecording`, so JS's own disabled status stands rather than
    // the stale buffering map.
    const racing = captureOne(client).properties
    expect(racing.$recording_status).toBe('disabled')
    expect(racing.$sdk_debug_replay_flush_hold_reason).toBeUndefined()

    releaseGetter?.()
    await reloading
    await waitForNativeChain(client)

    const after = captureOne(client).properties
    expect(after.$recording_status).toBe('disabled')
    expect(after.$sdk_debug_replay_flush_hold_reason).toBeUndefined()
  })

  it('Active recording status implies the boolean getter is true (native)', async () => {
    nativeRecording = true
    const client = await readyClient({ enableSessionReplay: true })
    nativeDebugMap = { $recording_status: 'active' }
    await reloadAndSettle(client)

    expect(captureOne(client).properties.$recording_status).toBe('active')
    expect(await client.isSessionReplayActive()).toBe(true)
  })

  it("native trigger keys never override JS's", async () => {
    currentSessionRecording = { eventTriggers: ['$pageview'], endpoint: '/s/' }
    await warmup()
    nativeDebugMap = {
      $sdk_debug_replay_event_trigger_status: 'trigger_disabled',
      $sdk_debug_replay_linked_flag_trigger_status: 'trigger_disabled',
      $sdk_debug_replay_pending_trigger_conditions: ['event_trigger'],
      $sdk_debug_replay_capture_mode: 'wireframe',
    }
    const client = await readyClient({ enableSessionReplay: true })
    await waitForNativeChain(client)

    const { properties } = captureOne(client, '$screen')
    expect(properties.$sdk_debug_replay_event_trigger_status).toBe('trigger_pending')
    expect(properties.$sdk_debug_replay_pending_trigger_conditions).toEqual(['event_trigger'])
    expect(properties.$sdk_debug_replay_capture_mode).toBe('screenshot')
  })

  it('native disabled wins over a JS active', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': true }
    await warmup()
    const client = await readyClient({ enableSessionReplay: true })
    await waitForNativeChain(client)
    expect(captureOne(client).properties.$recording_status).toBe('active')

    nativeDebugMap = { $recording_status: 'disabled' }
    await reloadAndSettle(client)

    const { properties } = captureOne(client)
    expect(properties.$recording_status).toBe('disabled')
  })

  it('refreshes native debug properties on AppState becoming active', async () => {
    const client = await readyClient({ enableSessionReplay: true })
    await waitForNativeChain(client)
    pluginMock.getSessionReplayDebugProperties.mockClear()

    const changeCalls = (AppState.addEventListener as any).mock.calls.filter(([event]: [string]) => event === 'change')
    const listener = changeCalls[changeCalls.length - 1][1]
    listener('active')
    await waitForNativeChain(client)

    expect(pluginMock.getSessionReplayDebugProperties).toHaveBeenCalled()
  })

  it('refreshes native debug properties on a feature-flags reload', async () => {
    const client = await readyClient({ enableSessionReplay: true })
    await reloadAndSettle(client)
    pluginMock.getSessionReplayDebugProperties.mockClear()

    await reloadAndSettle(client)

    expect(pluginMock.getSessionReplayDebugProperties).toHaveBeenCalled()
  })

  it('a flags reload that stops recording refreshes no more often than one that changes nothing', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': true }
    await warmup()
    const client = await readyClient({ enableSessionReplay: true })
    await waitForNativeChain(client)
    pluginMock.getSessionReplayDebugProperties.mockClear()
    await reloadAndSettle(client)
    const unchangedReloadCalls = pluginMock.getSessionReplayDebugProperties.mock.calls.length
    pluginMock.getSessionReplayDebugProperties.mockClear()

    await pauseViaLinkedFlag(client)
    await waitForNativeChain(client)

    const stopReloadCalls = pluginMock.getSessionReplayDebugProperties.mock.calls.length
    expect(stopReloadCalls).toBeGreaterThanOrEqual(1)
    expect(stopReloadCalls).toBeLessThanOrEqual(unchangedReloadCalls)
  })

  it('refreshes native debug properties after starting session recording', async () => {
    const client = await readyClient()
    pluginMock.getSessionReplayDebugProperties.mockClear()

    await client.startSessionRecording()
    await waitForNativeChain(client)

    expect(pluginMock.getSessionReplayDebugProperties).toHaveBeenCalled()
  })

  it('refreshes native debug properties after stopping session recording', async () => {
    const client = await readyClient({ enableSessionReplay: true })
    pluginMock.getSessionReplayDebugProperties.mockClear()

    await client.stopSessionRecording()
    await waitForNativeChain(client)

    expect(pluginMock.getSessionReplayDebugProperties).toHaveBeenCalled()
  })

  it('refreshes native debug properties after an event-trigger activation', async () => {
    currentSessionRecording = { eventTriggers: ['$pageview'], endpoint: '/s/' }
    await warmup()
    const client = await readyClient({ enableSessionReplay: true })
    pluginMock.getSessionReplayDebugProperties.mockClear()

    client.capture('$pageview')
    await wait(50)
    await waitForNativeChain(client)

    expect(pluginMock.getSessionReplayDebugProperties).toHaveBeenCalled()
  })

  it('Old-plugin fallback: no getSessionReplayDebugProperties leaves JS values standing', async () => {
    const { getSessionReplayDebugProperties: _omit, ...legacyPlugin } = pluginMock
    modules.plugin = legacyPlugin
    const client = await readyClient({ enableSessionReplay: true })
    await waitForNativeChain(client)

    const { properties } = captureOne(client)
    expect(properties.$recording_status).toBe('active')
    expect(properties.$sdk_debug_replay_flush_hold_reason).toBeUndefined()
    expect(properties.$sdk_debug_replay_internal_buffer_length).toBeUndefined()
  })

  it('Empty native map (no integration) leaves JS status standing', async () => {
    nativeDebugMap = {}
    const client = await readyClient({ enableSessionReplay: true })
    await waitForNativeChain(client)

    const { properties } = captureOne(client)
    expect(properties.$recording_status).toBe('active')
    expect(properties.$sdk_debug_replay_flush_hold_reason).toBeUndefined()
    expect(properties.$sdk_debug_replay_internal_buffer_length).toBeUndefined()
  })

  it('a capture re-reads a buffering map once the refresh interval has passed', async () => {
    nativeDebugMap = { $recording_status: 'buffering', $sdk_debug_replay_flush_hold_reason: 'below_minimum_duration' }
    const client = await readyClient({ enableSessionReplay: true })
    await waitForNativeChain(client)
    expect(captureOne(client).properties.$recording_status).toBe('buffering')
    pluginMock.getSessionReplayDebugProperties.mockClear()

    nativeDebugMap = { $recording_status: 'active' }
    captureOne(client, 'inside the interval')
    await waitForNativeChain(client)
    expect(pluginMock.getSessionReplayDebugProperties).not.toHaveBeenCalled()

    ;(client as any)._nativeSessionReplayDebugRefreshedAt = 0
    captureOne(client, 'after the interval')
    await waitForNativeChain(client)
    expect(pluginMock.getSessionReplayDebugProperties).toHaveBeenCalledTimes(1)

    const { properties } = captureOne(client, 'refreshed')
    expect(properties.$recording_status).toBe('active')
    expect(properties.$sdk_debug_replay_flush_hold_reason).toBeUndefined()
  })

  it('a refresh that was in flight when recording stopped cannot write its stale map back', async () => {
    const client = await readyClient({ enableSessionReplay: true })
    await waitForNativeChain(client)
    expect(captureOne(client).properties.$recording_status).toBe('active')

    // Park one refresh on the bridge holding a pre-stop `buffering` map, then park the refresh
    // the stop enqueues behind it, so a capture can land after the stale map returns but before
    // the post-stop one does.
    const gates: Array<() => void> = []
    pluginMock.getSessionReplayDebugProperties
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => gates.push(resolve))
        return { $recording_status: 'buffering', $sdk_debug_replay_flush_hold_reason: 'below_minimum_duration' }
      })
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => gates.push(resolve))
        return { $recording_status: 'disabled' }
      })
    ;(client as any)._nativeSessionReplayDebugRefreshedAt = 0
    ;(client as any)._nativeSessionReplayDebugProperties = { $recording_status: 'buffering' }
    captureOne(client, 'kicks the stale re-read')
    await wait(10)
    expect(gates).toHaveLength(1)

    const stopping = client.stopSessionRecording()
    await wait(10)
    gates[0]()
    await wait(10)

    const racing = captureOne(client, 'after the stale map returned').properties
    expect(racing.$recording_status).not.toBe('buffering')
    expect(racing.$sdk_debug_replay_flush_hold_reason).toBeUndefined()

    expect(gates).toHaveLength(2)
    gates[1]()
    await stopping
    await waitForNativeChain(client)
    expect(captureOne(client, 'settled').properties.$recording_status).toBe('disabled')
  })

  it('a manual stop reports disabled before the native refresh lands', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': true }
    await warmup()
    const client = await readyClient({ enableSessionReplay: true })
    await waitForNativeChain(client)
    expect(captureOne(client).properties.$recording_status).toBe('active')

    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    nativeDebugMap = { $recording_status: 'disabled' }
    pluginMock.getSessionReplayDebugProperties.mockImplementation(async () => {
      await gate
      return nativeDebugMap
    })
    await client.stopSessionRecording()

    // The post-stop refresh is still parked on the bridge; the JS recording flag is untouched
    // by a manual stop, so only the provisional map keeps this from reading `active`.
    expect(captureOne(client, 'after stop').properties.$recording_status).toBe('disabled')

    release?.()
    await waitForNativeChain(client)
    expect(captureOne(client, 'settled').properties.$recording_status).toBe('disabled')
  })

  it('a manual start reports active before the native refresh lands', async () => {
    const client = await readyClient()
    await waitForNativeChain(client)
    expect(captureOne(client).properties.$recording_status).toBe('disabled')

    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    nativeDebugMap = { $recording_status: 'buffering', $sdk_debug_replay_flush_hold_reason: 'below_minimum_duration' }
    pluginMock.getSessionReplayDebugProperties.mockImplementation(async () => {
      await gate
      return nativeDebugMap
    })
    pluginMock.isEnabled.mockResolvedValue(true)
    await client.startSessionRecording()

    // A manual start never sets the JS recording flag, so only the provisional map keeps this
    // from reading `disabled` while `isSessionReplayActive()` is already true.
    expect(captureOne(client, 'after start').properties.$recording_status).toBe('active')
    expect(await client.isSessionReplayActive()).toBe(true)

    release?.()
    await waitForNativeChain(client)
    expect(captureOne(client, 'settled').properties.$recording_status).toBe('buffering')
  })

  it('Stopping recording clears the hold reason (native)', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': true }
    nativeDebugMap = {
      $recording_status: 'buffering',
      $sdk_debug_replay_flush_hold_reason: 'awaiting_remote_config',
    }
    await warmup()
    const client = await readyClient({ enableSessionReplay: true })
    await waitForNativeChain(client)
    expect(captureOne(client, '$screen').properties.$sdk_debug_replay_flush_hold_reason).toBe('awaiting_remote_config')

    nativeDebugMap = { $recording_status: 'disabled' }
    await pauseViaLinkedFlag(client)
    await waitForNativeChain(client)

    advanceClock(WINDOW_MS)
    const { properties } = captureOne(client, '$screen')
    expect(properties.$recording_status).toBe('disabled')
    expect(properties.$sdk_debug_replay_flush_hold_reason).toBeUndefined()
  })
  describe('optional bundle window', () => {
    const observeAll = (client: PostHog): CapturedEvent[] => {
      const seen: CapturedEvent[] = []
      client.on('*', (_type: string, message: any) => {
        if (message && typeof message === 'object' && typeof message.event === 'string') {
          seen.push(message)
        }
      })
      return seen
    }

    const carriesBundle = (event: CapturedEvent | undefined): boolean => bundleKeysOf(event!.properties).length > 0

    it('Only the first eligible event in a burst carries the optional bundle', async () => {
      const client = await readyClient()
      const seen = observe(client)
      client.capture('$screen')
      client.capture('$pageview')
      client.capture('$autocapture')

      expect(seen.map(carriesBundle)).toEqual([true, false, false])
      for (const event of seen) {
        expect(event.properties.$recording_status).toBe('disabled')
      }
      expect(seen[0].properties.$sdk_debug_session_start).toEqual(expect.any(Number))
    })

    it('The window reopens 30 seconds after the carrying event was accepted', async () => {
      const client = await readyClient()
      expect(carriesBundle(captureOne(client, '$screen'))).toBe(true)

      advanceClock(WINDOW_MS - 1)
      const early = captureOne(client, '$screen')
      expect(early.properties.$recording_status).toBe('disabled')
      expect(carriesBundle(early)).toBe(false)

      advanceClock(1)
      expect(carriesBundle(captureOne(client, '$screen'))).toBe(true)
    })

    it('The window starts at acceptance, not at property build', async () => {
      const client = await readyClient({
        before_send: (event: any) => {
          if (event.event === '$slow') {
            advanceClock(10_000)
          }
          return event
        },
      })
      expect(carriesBundle(captureOne(client, '$slow'))).toBe(true)

      advanceClock(25_000)
      expect(carriesBundle(captureOne(client, '$screen'))).toBe(false)

      advanceClock(5_000)
      expect(carriesBundle(captureOne(client, '$screen'))).toBe(true)
    })

    it('An event dropped by before_send does not start the window', async () => {
      const client = await readyClient({ before_send: (event: any) => (event.event === '$discarded' ? null : event) })
      const seen = observe(client)
      client.capture('$discarded')
      client.capture('$screen')

      expect(seen.map((e) => e.event)).toEqual(['$screen'])
      expect(carriesBundle(seen[0])).toBe(true)
    })

    it('A deduplicated $set does not start the window', async () => {
      const client = await readyClient()
      const seen = observeAll(client)
      client.setPersonProperties({ plan: 'pro' })
      expect(seen.filter((e) => e.event === '$set')).toHaveLength(1)
      expect(carriesBundle(seen[0])).toBe(true)

      advanceClock(WINDOW_MS - 1_000)
      client.setPersonProperties({ plan: 'pro' })
      expect(seen.filter((e) => e.event === '$set')).toHaveLength(1)

      advanceClock(1_000)
      expect(carriesBundle(captureOne(client, '$screen'))).toBe(true)
    })

    it('An event without the bundle does not start or move the window, even when the interval elapses in before_send', async () => {
      const client = await readyClient({
        before_send: (event: any) => {
          if (event.event === '$inside' || event.event === 'custom') {
            advanceClock(25_000)
          }
          return event
        },
      })
      expect(carriesBundle(captureOne(client, '$screen'))).toBe(true)

      advanceClock(10_000)
      expect(carriesBundle(captureOne(client, '$inside'))).toBe(false)
      expect(carriesBundle(captureOne(client, '$screen'))).toBe(true)

      advanceClock(5_000)
      expect(carriesBundle(captureOne(client, 'custom'))).toBe(false)
      advanceClock(WINDOW_MS - 20_000)
      expect(carriesBundle(captureOne(client, '$screen'))).toBe(true)
    })

    it('The window follows the wall clock, not the event timestamp', async () => {
      const client = await readyClient()
      const seen = observe(client)
      client.capture('$screen', {}, { timestamp: new Date(Date.now() + 3600 * 1000) })
      advanceClock(WINDOW_MS)
      client.capture('$screen')

      expect(seen.map(carriesBundle)).toEqual([true, true])
    })

    it('A property build that is not a capture never starts the window', async () => {
      const client = await readyClient()
      const built = client.getCommonEventProperties()
      expect(built.$sdk_debug_session_start).toEqual(expect.any(Number))
      expect(built.$sdk_debug_replay_capture_mode).toBe('screenshot')
      expect(built.$recording_status).toBe('disabled')

      expect(carriesBundle(captureOne(client, '$screen'))).toBe(true)
      expect(client.getCommonEventProperties().$sdk_debug_session_start).toEqual(expect.any(Number))
    })

    it('A capture inside before_send does not also carry the bundle', async () => {
      const ref: { client?: PostHog } = {}
      const client = await readyClient({
        before_send: (event: any) => {
          if (event.event === '$outer') {
            ref.client?.capture('$inner')
          }
          return event
        },
      })
      ref.client = client
      const seen = observe(client)
      client.capture('$outer')

      expect(seen.map((e) => e.event)).toEqual(['$inner', '$outer'])
      expect(carriesBundle(seen[0])).toBe(false)
      expect(carriesBundle(seen[1])).toBe(true)
    })

    it('An outstanding claim does not expire while before_send runs', async () => {
      const ref: { client?: PostHog } = {}
      const client = await readyClient({
        before_send: (event: any) => {
          if (event.event === '$slow') {
            advanceClock(WINDOW_MS + 1_000)
            ref.client?.capture('$inner')
          }
          return event
        },
      })
      ref.client = client
      const seen = observe(client)
      client.capture('$slow')

      expect(seen.map((e) => e.event)).toEqual(['$inner', '$slow'])
      expect(carriesBundle(seen[0])).toBe(false)
      expect(carriesBundle(seen[1])).toBe(true)
    })

    it('Eligibility is decided before before_send', async () => {
      const client = await readyClient({
        before_send: (event: any) => {
          if (event.event === '$renamed') {
            event.event = 'custom name'
          } else if (event.event === 'custom') {
            event.event = '$custom'
          }
          return event
        },
      })
      const seen = observe(client)
      client.capture('$renamed')
      expect(seen[0].event).toBe('custom name')
      expect(carriesBundle(seen[0])).toBe(true)

      advanceClock(WINDOW_MS)
      client.capture('custom')
      expect(seen[1].event).toBe('$custom')
      expect(carriesBundle(seen[1])).toBe(false)

      client.capture('$screen')
      expect(carriesBundle(seen[2])).toBe(true)
    })

    it('$exception, $identify, $set, $create_alias and $groupidentify inside the window carry the required keys only', async () => {
      const client = await readyClient()
      expect(carriesBundle(captureOne(client, '$screen'))).toBe(true)

      const seen = observeAll(client)
      client.captureException(new Error('inside window'))
      client.identify('user-1', { plan: 'pro' })
      client.setPersonProperties({ seat: 2 })
      client.alias('user-1-alias')
      client.group('company', 'acme')
      await wait(50)

      const names = seen.map((e) => e.event)
      for (const name of ['$exception', '$identify', '$set', '$create_alias', '$groupidentify']) {
        expect(names).toContain(name)
      }
      for (const event of seen) {
        expect(event.properties.$recording_status).toBe('disabled')
        expect(event.properties.$sdk_debug_pending_queue_size).toEqual(expect.any(Number))
        expect(bundleKeysOf(event.properties)).toEqual([])
      }
    })

    it('Closing the SDK instance clears the window', async () => {
      const client = await readyClient()
      expect(carriesBundle(captureOne(client, '$screen'))).toBe(true)
      expect(carriesBundle(captureOne(client, '$screen'))).toBe(false)

      await client.shutdown()
      expect(carriesBundle(captureOne(client, '$screen'))).toBe(true)
    })

    it('Removed keys never appear on any event', async () => {
      nativeDebugMap = {
        $recording_status: 'active',
        $sdk_debug_current_session_duration: 5,
        $sdk_debug_replay_throttle_delay_ms: 42,
      }
      const client = await readyClient({ enableSessionReplay: true })
      await reloadAndSettle(client)
      const seen = observeAll(client)
      client.capture('custom event')
      client.capture('$screen')
      client.captureException(new Error('removed keys'))
      client.identify('user-1')
      await wait(50)

      expect(seen.length).toBeGreaterThanOrEqual(4)
      for (const event of seen) {
        for (const key of REMOVED_KEYS) {
          expect(event.properties).not.toHaveProperty(key)
        }
      }
      for (const key of REMOVED_KEYS) {
        expect(client.getCommonEventProperties()).not.toHaveProperty(key)
      }
    })
  })
})
