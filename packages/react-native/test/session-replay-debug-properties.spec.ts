import { PostHog, PostHogCustomStorage, PostHogPersistedProperty } from '../src'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'
import { Linking, AppState, Platform } from 'react-native'
import { wait, waitForNativePluginEvaluation } from './test-utils'

// The native plugin bridge, mocked with the legacy start() surface (no `setup`). The
// getter lets a test remove the plugin altogether to model an app without it installed.
let nativeRecording = false

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
}

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()

type CapturedEvent = { event: string; properties: Record<string, any>; timestamp?: string }

const DEBUG_KEYS = [
  '$recording_status',
  '$sdk_debug_session_start',
  '$sdk_debug_current_session_duration',
  '$sdk_debug_pending_queue_size',
  '$sdk_debug_replay_capture_mode',
  '$sdk_debug_replay_throttle_delay_ms',
  '$sdk_debug_replay_event_trigger_status',
  '$sdk_debug_replay_linked_flag_trigger_status',
  '$sdk_debug_replay_pending_trigger_conditions',
  '$sdk_debug_error_capturing_properties',
]

const debugKeysOf = (properties: Record<string, any>): string[] =>
  Object.keys(properties).filter(
    (key) => (key === '$recording_status' || key.startsWith('$sdk_debug_')) && properties[key] !== undefined
  )

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

  // Caches the remote replay config so the next launch evaluates its gates at startup instead
  // of starting optimistically before /flags returns.
  const warmup = async (): Promise<void> => {
    const w = new PostHog('test-token', { customStorage: mockStorage, enableSessionReplay: true, flushInterval: 0 })
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
    const { properties } = captureOne(client, 'second')
    const start = client.getPersistedProperty<number>(PostHogPersistedProperty.SessionStartTimestamp)

    expect(properties.$sdk_debug_session_start).toBe(start)
    expect(Number.isInteger(properties.$sdk_debug_session_start)).toBe(true)
    expect(typeof properties.$sdk_debug_current_session_duration).toBe('number')
    expect(properties.$sdk_debug_current_session_duration).toBeGreaterThanOrEqual(0)
    expect(properties.$sdk_debug_pending_queue_size).toBe(1)
    expect(properties).not.toHaveProperty('$sdk_debug_retry_queue_size')
  })

  it('Session keys are present without session replay (mobile)', async () => {
    const client = await readyClient({ enableSessionReplay: false })
    const { properties } = captureOne(client)
    expect(typeof properties.$sdk_debug_session_start).toBe('number')
    expect(typeof properties.$sdk_debug_current_session_duration).toBe('number')
    expect(properties.$recording_status).toBe('disabled')
  })

  it('Session keys follow a caller-supplied session id (mobile)', async () => {
    const client = await readyClient()
    const { properties } = captureOne(client, 'custom event', { $session_id: '0190a0a0-0000-7000-8000-000000000000' })
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

    const { properties } = captureOne(client)
    const newStart = client.getPersistedProperty<number>(PostHogPersistedProperty.SessionStartTimestamp)!
    expect(properties.$session_id).not.toBe(previousSessionId)
    expect(properties.$session_id).toBe(client.getPersistedProperty(PostHogPersistedProperty.SessionId))
    expect(newStart).toBeGreaterThanOrEqual(previousStart)
    expect(properties.$sdk_debug_session_start).toBe(newStart)
    expect(properties.$sdk_debug_current_session_duration).toBeLessThan(1000)
  })

  it('Linked-flag trigger status reflects current state on every capture', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': false }
    await warmup()

    const client = await readyClient({ enableSessionReplay: true })
    const sessionId = client.getSessionId()
    const pending = captureOne(client).properties
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
    const pending = captureOne(client, 'unrelated').properties
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
    const { properties } = captureOne(client, 'custom event', {
      $recording_status: 'caller',
      $sdk_debug_session_start: 'caller',
    })
    expect(properties.$recording_status).toBe('disabled')
    expect(properties.$sdk_debug_session_start).toBe(
      client.getPersistedProperty(PostHogPersistedProperty.SessionStartTimestamp)
    )
  })

  it('Capture mode is screenshot when screenshot recording is on', async () => {
    const client = await readyClient({ sessionReplayConfig: { throttleDelayMs: 250 } })
    const { properties } = captureOne(client)
    expect(properties.$sdk_debug_replay_capture_mode).toBe('screenshot')
    expect(properties.$sdk_debug_replay_throttle_delay_ms).toBe(250)
    expect(properties).not.toHaveProperty('$sdk_debug_replay_capture_mode', 'wireframe')

    Platform.OS = 'macos'
    const onMacOS = captureOne(client).properties
    expect(onMacOS.$sdk_debug_replay_capture_mode).toBeUndefined()
    expect(onMacOS.$sdk_debug_replay_throttle_delay_ms).toBeUndefined()
  })

  it('reports the default and deprecated throttle delays without native init', async () => {
    const byDefault = await readyClient()
    expect(captureOne(byDefault).properties.$sdk_debug_replay_throttle_delay_ms).toBe(1000)
    await byDefault.shutdown()

    const deprecated = await readyClient({
      sessionReplayConfig: { iOSdebouncerDelayMs: 500, androidDebouncerDelayMs: 2000 },
    })
    expect(captureOne(deprecated).properties.$sdk_debug_replay_throttle_delay_ms).toBe(2000)
    expect(pluginMock.start).not.toHaveBeenCalled()
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
    expect(racing).not.toHaveProperty('$sdk_debug_replay_flush_hold_reason')
    await stopping

    const after = captureOne(client).properties
    expect(after.$recording_status).toBe('disabled')
    expect(after).not.toHaveProperty('$sdk_debug_replay_flush_hold_reason')
  })

  it('A build failure attaches the stringified error and nothing else from the debug map', async () => {
    const client = await readyClient()
    vi.spyOn(client as any, '_resolveThrottleDelayMs').mockImplementation(() => {
      throw new Error('boom')
    })

    const { properties } = captureOne(client)
    expect(properties.$sdk_debug_error_capturing_properties).toBe('Error: boom')
    expect(debugKeysOf(properties)).toEqual(['$sdk_debug_error_capturing_properties'])
    for (const key of DEBUG_KEYS.filter((k) => k !== '$sdk_debug_error_capturing_properties')) {
      expect(properties[key]).toBeUndefined()
    }
  })

  it('A successful build never attaches the error key', async () => {
    const client = await readyClient()
    const throttle = vi.spyOn(client as any, '_resolveThrottleDelayMs')
    throttle.mockImplementationOnce(() => {
      throw new Error('first call only')
    })

    // The build runs twice per capture; a failure on the first call must not leak into the event.
    const { properties } = captureOne(client)
    expect(throttle).toHaveBeenCalledTimes(2)
    expect(properties.$sdk_debug_error_capturing_properties).toBeUndefined()
    expect(properties.$recording_status).toBe('disabled')
    expect(properties.$sdk_debug_replay_throttle_delay_ms).toBe(1000)

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

    const { properties } = captureOne(client)
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
    expect(properties.$sdk_debug_replay_capture_mode).toBeUndefined()
    expect(properties.$sdk_debug_replay_throttle_delay_ms).toBeUndefined()
    await client.shutdown()

    Platform.OS = 'macos'
    modules.plugin = pluginMock
    const onMacOS = await readyClient({ enableSessionReplay: true })
    const macProperties = captureOne(onMacOS).properties
    expect(macProperties.$recording_status).toBe('disabled')
    expect(macProperties.$sdk_debug_replay_capture_mode).toBeUndefined()
    expect(macProperties.$sdk_debug_replay_throttle_delay_ms).toBeUndefined()
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
    const { properties } = captureOne(client)
    expect(properties.$recording_status).toBe('disabled')
    expect(properties).not.toHaveProperty('$sdk_debug_replay_flush_hold_reason')
  })

  it('Config-derived keys remain present after stop/uninstall while status is disabled', async () => {
    currentSessionRecording = { linkedFlag: 'replay-flag', endpoint: '/s/' }
    currentFlags = { 'replay-flag': true }
    await warmup()
    const client = await readyClient({ enableSessionReplay: true })
    await pauseViaLinkedFlag(client)
    const { properties } = captureOne(client)
    expect(properties.$recording_status).toBe('disabled')
    expect(properties.$sdk_debug_replay_capture_mode).toBe('screenshot')
    expect(properties.$sdk_debug_replay_throttle_delay_ms).toBe(1000)

    const neverEnabled = captureOne(await readyClient({ enableSessionReplay: false })).properties
    expect(neverEnabled.$sdk_debug_replay_capture_mode).toBe('screenshot')
    expect(neverEnabled.$sdk_debug_replay_throttle_delay_ms).toBe(1000)
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

  it('A backdated event within the current session keeps the keys', async () => {
    const client = await readyClient({ enableSessionReplay: true })
    const start = client.getPersistedProperty<number>(PostHogPersistedProperty.SessionStartTimestamp)!
    const seen = observe(client)
    client.capture('inside session', {}, { timestamp: new Date(start + 1000) })
    client.capture('at session start', {}, { timestamp: new Date(start) })

    expect(seen).toHaveLength(2)
    for (const event of seen) {
      expect(event.properties.$recording_status).toBe('active')
      expect(event.properties.$sdk_debug_session_start).toBe(start)
    }
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
})
