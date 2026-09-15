import { Linking, AppState } from 'react-native'
import { PostHog } from '../src'
import {
  appendFatalJournalIngested,
  buildFatalJournalEntry,
  entryToEventProperties,
  FATAL_JOURNAL_INGESTED_MAX,
  hasFatalJournalIngested,
  parseFatalJournalEntry,
  serializeFatalJournalEntry,
} from '../src/error-tracking/journal'
import { OptionalReactNativePlugin } from '../src/optional/OptionalPlugin'

Linking.getInitialURL = vi.fn(() => Promise.resolve(null))
AppState.addEventListener = vi.fn()

vi.mock('../src/optional/OptionalPlugin', () => ({
  OptionalReactNativePluginVersion: undefined,
  OptionalReactNativePlugin: {
    start: vi.fn(() => Promise.resolve()),
    setup: vi.fn(() => Promise.resolve()),
    startSession: vi.fn(() => Promise.resolve()),
    endSession: vi.fn(() => Promise.resolve()),
    isEnabled: vi.fn(() => Promise.resolve(false)),
    identify: vi.fn(() => Promise.resolve()),
    startRecording: vi.fn(() => Promise.resolve()),
    stopRecording: vi.fn(() => Promise.resolve()),
    addExceptionStep: vi.fn(() => Promise.resolve()),
    persistFatalException: vi.fn(() => Promise.resolve()),
    getPendingFatalExceptions: vi.fn(() => Promise.resolve([])),
    removePendingFatalException: vi.fn(() => Promise.resolve()),
  },
}))

const mockPlugin = OptionalReactNativePlugin as unknown as {
  setup: vi.Mock
  persistFatalException: vi.Mock
  getPendingFatalExceptions: vi.Mock
  removePendingFatalException: vi.Mock
}

const extractExceptionCount = (raw: string | undefined): number => {
  if (!raw) return 0
  try {
    const parsed = JSON.parse(raw)
    const queue = parsed?.content?.queue || []
    return queue.filter((item: any) => item?.message?.event === '$exception').length
  } catch {
    return 0
  }
}

const resetMockPlugin = (): void => {
  // "no journal methods" test sets the spies to undefined; restore fresh spies each time.
  mockPlugin.persistFatalException = vi.fn(() => Promise.resolve())
  mockPlugin.getPendingFatalExceptions = vi.fn(() => Promise.resolve([]))
  mockPlugin.removePendingFatalException = vi.fn(() => Promise.resolve())
}

describe('fatal journal helper', () => {
  it('roundtrips a serialized entry preserving all fields', () => {
    const entry = buildFatalJournalEntry({
      id: '0192f1c2-1234-7abc-9def-0123456789ab',
      eventUuid: '0192f1c2-1234-7abc-9def-0123456789ac',
      timestamp: '2026-09-15T10:00:00.000Z',
      sessionId: 'session-1',
      distinctId: 'user-1',
      anonymousId: 'anon-1',
      deviceId: 'device-1',
      commonProperties: { $lib: 'posthog-react-native', $app_version: '1.2.3' },
      exceptionList: [{ type: 'Error', value: 'boom' }],
      exceptionLevel: 'fatal',
      exceptionSteps: undefined,
      optedOut: false,
    })
    const raw = serializeFatalJournalEntry(entry)
    const parsed = parseFatalJournalEntry(raw)
    expect(parsed).not.toBeNull()
    expect(parsed!.id).toBe(entry.id)
    expect(parsed!.eventUuid).toBe(entry.eventUuid)
    expect(parsed!.timestamp).toBe(entry.timestamp)
    expect(parsed!.sessionId).toBe(entry.sessionId)
    expect(parsed!.distinctId).toBe(entry.distinctId)
    expect(parsed!.anonymousId).toBe(entry.anonymousId)
    expect(parsed!.deviceId).toBe(entry.deviceId)
    expect(parsed!.exceptionLevel).toBe(entry.exceptionLevel)
    expect(parsed!.optedOut).toBe(false)
    expect(parsed!.commonProperties).toEqual({ $lib: 'posthog-react-native', $app_version: '1.2.3' })
    expect(parsed!.exceptionList).toEqual([{ type: 'Error', value: 'boom' }])
  })

  it('returns null and never throws on a corrupt payload', () => {
    expect(parseFatalJournalEntry('')).toBeNull()
    expect(parseFatalJournalEntry('not-json')).toBeNull()
    expect(parseFatalJournalEntry('{}')).toBeNull()
    expect(parseFatalJournalEntry('{"id":"a"}')).toBeNull()
    expect(parseFatalJournalEntry('{"id":"a","eventUuid":"b","timestamp":"c"}')).toBeNull()
    // exceptionList must be a non-empty array of objects
    expect(
      parseFatalJournalEntry(
        JSON.stringify({
          id: 'a',
          eventUuid: 'b',
          timestamp: 'c',
          sessionId: '',
          distinctId: '',
          anonymousId: '',
          deviceId: '',
          commonProperties: {},
          exceptionLevel: 'fatal',
          optedOut: false,
          exceptionList: 'not-an-array',
        })
      )
    ).toBeNull()
  })

  it('rebuilds the event properties for re-capture with the preserved uuid and timestamp', () => {
    const entry = buildFatalJournalEntry({
      id: 'journal-1',
      eventUuid: 'event-uuid-1',
      timestamp: '2026-09-15T10:00:00.000Z',
      sessionId: 's',
      distinctId: 'u',
      anonymousId: 'a',
      deviceId: 'd',
      commonProperties: { $lib: 'posthog-react-native', $app_version: '1.0.0' },
      exceptionList: [{ type: 'Error', value: 'recover me' }],
      exceptionLevel: 'fatal',
      optedOut: false,
    })
    const reconstructed = entryToEventProperties(entry)
    expect(reconstructed.uuid).toBe('event-uuid-1')
    expect(reconstructed.timestamp).toBe('2026-09-15T10:00:00.000Z')
    expect(reconstructed.properties.$exception_list).toEqual(entry.exceptionList)
    expect(reconstructed.properties.$exception_level).toBe('fatal')
    expect(reconstructed.properties.$lib).toBe('posthog-react-native')
    expect(reconstructed.properties.$app_version).toBe('1.0.0')
  })

  it('bounds the seenIds set and dedups', () => {
    let set: string[] | undefined = undefined
    for (let i = 0; i < FATAL_JOURNAL_INGESTED_MAX + 5; i++) {
      set = appendFatalJournalIngested(set, `id-${i}`)
    }
    expect(set!.length).toBe(FATAL_JOURNAL_INGESTED_MAX)
    // FIFO: oldest 5 were evicted, the last FATAL_JOURNAL_INGESTED_MAX entries survive.
    expect(set![0]).toBe('id-5')
    expect(set![set!.length - 1]).toBe(`id-${FATAL_JOURNAL_INGESTED_MAX + 4}`)
    // Adding the same id again is a no-op.
    const updated = appendFatalJournalIngested(set, 'id-5')
    expect(updated.length).toBe(FATAL_JOURNAL_INGESTED_MAX)
    expect(hasFatalJournalIngested(set, 'id-5')).toBe(true)
    expect(hasFatalJournalIngested(set, 'missing')).toBe(false)
    expect(hasFatalJournalIngested(undefined, 'anything')).toBe(false)
  })

  it('rejects empty exception lists at build time so a malformed snapshot never reaches the bridge', () => {
    expect(() =>
      buildFatalJournalEntry({
        id: 'a',
        eventUuid: 'b',
        timestamp: 'c',
        sessionId: '',
        distinctId: '',
        anonymousId: '',
        deviceId: '',
        commonProperties: {},
        exceptionList: [],
        exceptionLevel: 'fatal',
        optedOut: false,
      })
    ).toThrow()
  })
})

describe('native fatal-report journal recovery', () => {
  let posthog: PostHog
  let previous: ReturnType<typeof vi.fn>
  let handler: (error: Error, isFatal: boolean) => void
  let stored: Map<string, string>

  const createClient = (): PostHog =>
    new PostHog('test-token', {
      customStorage: {
        getItem: () => null,
        setItem: (key, value) => {
          stored.set(key, value)
        },
      },
      flushInterval: 0,
      flushAt: 100,
      fetchRetryCount: 0,
      remoteConfig: false,
      preloadFeatureFlags: false,
      captureAppLifecycleEvents: false,
      capturePushNotificationSubscriptions: false,
      capturePushNotificationOpened: false,
      errorTracking: { autocapture: { uncaughtExceptions: true, nativeCrashes: true } },
    } as any)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, json: () => Promise.resolve({}) })))
    previous = vi.fn()
    handler = previous
    vi.stubGlobal('ErrorUtils', {
      getGlobalHandler: () => handler,
      setGlobalHandler: (next: typeof handler) => {
        handler = next
      },
    })
    stored = new Map()
    resetMockPlugin()
  })

  afterEach(async () => {
    await posthog?.shutdown().catch(() => {})
    vi.clearAllTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not break existing fatal capture when the native plugin has no journal methods', async () => {
    // Older plugin: journal methods absent.
    mockPlugin.persistFatalException = undefined as any
    mockPlugin.getPendingFatalExceptions = undefined as any
    mockPlugin.removePendingFatalException = undefined as any
    posthog = createClient()
    await posthog.ready()
    await (posthog as any)._eventsStorage.waitForPersist()

    handler(new Error('old-plugin-fatal'), true)
    await vi.advanceTimersByTimeAsync(0)
    expect(previous).toHaveBeenCalledTimes(1)
    expect(stored.get('.posthog-rn.json')).toContain('old-plugin-fatal')
  })

  it('writes a journal entry on a fatal capture and waits for the bridge write before forwarding', async () => {
    posthog = createClient()
    await posthog.ready()
    await (posthog as any)._eventsStorage.waitForPersist()

    let resolveBridge!: () => void
    mockPlugin.persistFatalException.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveBridge = () => resolve()
        })
    )

    handler(new Error('journal-me'), true)
    await vi.advanceTimersByTimeAsync(0)
    expect(previous).not.toHaveBeenCalled()
    expect(mockPlugin.persistFatalException).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(mockPlugin.persistFatalException.mock.calls[0][0])
    expect(payload.exceptionList[0].value).toContain('journal-me')
    expect(payload.exceptionLevel).toBe('fatal')
    expect(payload.eventUuid).toMatch(/^[0-9a-f-]{36}$/)
    expect(payload.id).toMatch(/^[0-9a-f-]{36}$/)

    resolveBridge()
    await vi.advanceTimersByTimeAsync(0)
    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('forwards the previous handler after the 2s deadline even if the bridge write hangs', async () => {
    posthog = createClient()
    await posthog.ready()
    await (posthog as any)._eventsStorage.waitForPersist()

    mockPlugin.persistFatalException.mockImplementation(() => new Promise<void>(() => {}))

    handler(new Error('hangs'), true)
    await vi.advanceTimersByTimeAsync(1999)
    expect(previous).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('recovers a pending entry on the next launch and removes it after the re-captured event persists', async () => {
    // First launch's persistFatalException populates the closure; second launch's getPending
    // returns it until the SDK removes it.
    let pendingReport: { id: string; report: string } | null = null
    mockPlugin.persistFatalException.mockImplementation(async (report: string) => {
      pendingReport = { id: JSON.parse(report).id, report }
    })
    mockPlugin.getPendingFatalExceptions.mockImplementation(() =>
      Promise.resolve(pendingReport ? [pendingReport] : [])
    )

    posthog = createClient()
    await posthog.ready()
    // Yield so the init-time drain runs before the handler sets pendingReport (production
    // timing: the init-time drain ran long before any fatal throw).
    await vi.advanceTimersByTimeAsync(0)
    await (posthog as any)._eventsStorage.waitForPersist()
    handler(new Error('recover-me'), true)
    await vi.advanceTimersByTimeAsync(0)
    expect(pendingReport).not.toBeNull()
    const originalEventUuid = JSON.parse(pendingReport!.report).eventUuid as string
    const originalSessionId = JSON.parse(pendingReport!.report).sessionId as string
    const originalDeviceId = JSON.parse(pendingReport!.report).deviceId as string
    const originalDistinctId = JSON.parse(pendingReport!.report).distinctId as string
    await posthog.shutdown()

    stored = new Map()
    posthog = createClient()
    await posthog.ready()
    // Wait for the drain to complete. The drain runs in the background after native setup;
    // give microtasks a chance.
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }

    expect(mockPlugin.removePendingFatalException).toHaveBeenCalledTimes(1)
    const recoveredQueue = JSON.parse(stored.get('.posthog-rn.json') || '{}')
    const queue = (recoveredQueue.content && recoveredQueue.content.queue) || []
    expect(queue.length).toBe(1)
    expect(queue[0].message.event).toBe('$exception')
    expect(queue[0].message.properties.$exception_list[0].value).toContain('recover-me')
    expect(queue[0].message.properties.$exception_level).toBe('fatal')
    expect(queue[0].message.uuid).toBe(originalEventUuid)
    expect(queue[0].message.properties.$session_id).toBe(originalSessionId)
    expect(queue[0].message.properties.$device_id).toBe(originalDeviceId)
    expect(queue[0].message.distinct_id).toBe(originalDistinctId)

    const seenIds =
      (recoveredQueue.content && recoveredQueue.content['fatal_journal_ingested']) || []
    expect(seenIds.length).toBe(1)
  })

  it('retains the journal entry when JS durable handoff fails (waitForPersist rejects)', async () => {
    const journalId = '0192f1c2-aaaa-7bbb-cccc-dddddddddddd'
    const entry = buildFatalJournalEntry({
      id: journalId,
      eventUuid: 'event-uuid-handoff-fails',
      timestamp: new Date().toISOString(),
      sessionId: 's',
      distinctId: 'u',
      anonymousId: 'a',
      deviceId: 'd',
      commonProperties: {},
      exceptionList: [{ type: 'Error', value: 'persist-fails' }],
      exceptionLevel: 'fatal',
      optedOut: false,
    })
    mockPlugin.getPendingFatalExceptions.mockImplementation(() =>
      Promise.resolve([{ id: journalId, report: serializeFatalJournalEntry(entry) }])
    )

    // Sync storage rejection so the drain's persist() throws before waitForPersist even runs.
    const customStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('disk full')
      },
    }
    posthog = new PostHog('test-token', {
      customStorage: customStorage as any,
      flushInterval: 0,
      flushAt: 100,
      fetchRetryCount: 0,
      remoteConfig: false,
      preloadFeatureFlags: false,
      captureAppLifecycleEvents: false,
      capturePushNotificationSubscriptions: false,
      capturePushNotificationOpened: false,
      errorTracking: { autocapture: { uncaughtExceptions: true, nativeCrashes: true } },
    } as any)
    await posthog.ready()
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }

    expect(mockPlugin.removePendingFatalException).not.toHaveBeenCalled()
  })

  it('does not produce a duplicate when recovery is interrupted after persist but before native remove', async () => {
    // Simulates a crash between waitForPersist() and removePendingFatalException(): the
    // FatalJournalIngested set on the next launch tells us to skip the re-capture.
    const journalId = '0192f1c2-1111-7abc-9def-0123456789ab'
    const eventUuid = 'event-uuid-no-duplicate'
    const entry = buildFatalJournalEntry({
      id: journalId,
      eventUuid,
      timestamp: new Date().toISOString(),
      sessionId: '',
      distinctId: '',
      anonymousId: '',
      deviceId: '',
      commonProperties: {},
      exceptionList: [{ type: 'Error', value: 'should-ship-once' }],
      exceptionLevel: 'fatal',
      optedOut: false,
    })

    // Simulate state across two launches: getPending returns the entry on both, but the
    // Seeded FatalJournalIngested set simulates the first launch's appendFatalJournalIngested
    // having landed before the simulated crash between persist and remove.
    const seeded = JSON.stringify({
      version: 'v1',
      content: { fatal_journal_ingested: [journalId] },
    })
    const customStorage = {
      getItem: (key: string) => (key === '.posthog-rn.json' ? seeded : null),
      setItem: () => {},
    }
    mockPlugin.getPendingFatalExceptions.mockImplementation(() =>
      Promise.resolve([{ id: journalId, report: serializeFatalJournalEntry(entry) }])
    )
    mockPlugin.removePendingFatalException.mockImplementation(() => {
      // Disk still has the file even after "remove" — simulating the partial-failure window.
      mockPlugin.getPendingFatalExceptions.mockImplementation(() =>
        Promise.resolve([{ id: journalId, report: serializeFatalJournalEntry(entry) }])
      )
      return Promise.resolve()
    })

    posthog = new PostHog('test-token', {
      customStorage: customStorage as any,
      flushInterval: 0,
      flushAt: 100,
      fetchRetryCount: 0,
      remoteConfig: false,
      preloadFeatureFlags: false,
      captureAppLifecycleEvents: false,
      capturePushNotificationSubscriptions: false,
      capturePushNotificationOpened: false,
      errorTracking: { autocapture: { uncaughtExceptions: true, nativeCrashes: true } },
    } as any)
    await posthog.ready()
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }

    expect(mockPlugin.removePendingFatalException).toHaveBeenCalledWith(journalId)
    expect(extractExceptionCount(stored.get('.posthog-rn.json'))).toBe(0)
  })

  it('drops a pending entry if its journal id has already been ingested on a previous launch', async () => {
    const journalId = '0192f1c2-dead-beef-0000-000000000001'
    const entry = buildFatalJournalEntry({
      id: journalId,
      eventUuid: 'event-uuid',
      timestamp: new Date().toISOString(),
      sessionId: '',
      distinctId: '',
      anonymousId: '',
      deviceId: '',
      commonProperties: {},
      exceptionList: [{ type: 'Error', value: 'duplicate me' }],
      exceptionLevel: 'fatal',
      optedOut: false,
    })
    const report = serializeFatalJournalEntry(entry)
    mockPlugin.getPendingFatalExceptions.mockImplementation(() =>
      Promise.resolve([{ id: journalId, report }])
    )

    const seeded = JSON.stringify({
      version: 'v1',
      content: { fatal_journal_ingested: [journalId] },
    })
    const customStorage = {
      getItem: (key: string) => (key === '.posthog-rn.json' ? seeded : null),
      setItem: () => {},
    }
    posthog = new PostHog('test-token', {
      customStorage: customStorage as any,
      flushInterval: 0,
      flushAt: 100,
      fetchRetryCount: 0,
      remoteConfig: false,
      preloadFeatureFlags: false,
      captureAppLifecycleEvents: false,
      capturePushNotificationSubscriptions: false,
      capturePushNotificationOpened: false,
      errorTracking: { autocapture: { uncaughtExceptions: true, nativeCrashes: true } },
    } as any)
    await posthog.ready()
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }

    expect(mockPlugin.removePendingFatalException).toHaveBeenCalledWith(journalId)
    expect(extractExceptionCount(stored.get('.posthog-rn.json'))).toBe(0)
  })

  it('drops pending entries that parse to null (corrupt on-disk JSON)', async () => {
    mockPlugin.getPendingFatalExceptions.mockImplementation(() =>
      Promise.resolve([
        { id: 'corrupt-1', report: 'definitely-not-json' },
        { id: 'corrupt-2', report: JSON.stringify({ id: 'corrupt-2' /* missing fields */ }) },
      ])
    )
    posthog = createClient()
    await posthog.ready()
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }

    expect(mockPlugin.removePendingFatalException).toHaveBeenCalledWith('corrupt-1')
    expect(mockPlugin.removePendingFatalException).toHaveBeenCalledWith('corrupt-2')
    expect(mockPlugin.removePendingFatalException).toHaveBeenCalledTimes(2)
    expect(extractExceptionCount(stored.get('.posthog-rn.json'))).toBe(0)
  })

  it('skips recovery while opted out and removes the journal entry', async () => {
    const journalId = '0192f1c2-1111-7abc-9def-0123456789ab'
    const entry = buildFatalJournalEntry({
      id: journalId,
      eventUuid: 'event-uuid',
      timestamp: new Date().toISOString(),
      sessionId: '',
      distinctId: '',
      anonymousId: '',
      deviceId: '',
      commonProperties: {},
      exceptionList: [{ type: 'Error', value: 'should-not-ship' }],
      exceptionLevel: 'fatal',
      optedOut: false,
    })
    mockPlugin.getPendingFatalExceptions.mockImplementation(() =>
      Promise.resolve([{ id: journalId, report: serializeFatalJournalEntry(entry) }])
    )

    const customStorage = {
      getItem: () => JSON.stringify({ version: 'v1', content: { opted_out: true } }),
      setItem: () => {},
    }
    posthog = new PostHog('test-token', {
      customStorage: customStorage as any,
      flushInterval: 0,
      flushAt: 100,
      fetchRetryCount: 0,
      remoteConfig: false,
      preloadFeatureFlags: false,
      captureAppLifecycleEvents: false,
      capturePushNotificationSubscriptions: false,
      capturePushNotificationOpened: false,
      errorTracking: { autocapture: { uncaughtExceptions: true, nativeCrashes: true } },
    } as any)
    await posthog.ready()
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }

    expect(mockPlugin.removePendingFatalException).toHaveBeenCalledWith(journalId)
    expect(extractExceptionCount(stored.get('.posthog-rn.json'))).toBe(0)
  })

  it('does not throw when the native plugin fails on persist (best-effort)', async () => {
    posthog = createClient()
    await posthog.ready()
    await (posthog as any)._eventsStorage.waitForPersist()
    mockPlugin.persistFatalException.mockImplementation(() =>
      Promise.reject(new Error('native bridge died'))
    )
    expect(() => handler(new Error('bridge-down'), true)).not.toThrow()
    await vi.advanceTimersByTimeAsync(0)
    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('non-fatal exceptions do not touch the journal', async () => {
    posthog = createClient()
    await posthog.ready()
    await (posthog as any)._eventsStorage.waitForPersist()
    handler(new Error('non-fatal'), false)
    await vi.advanceTimersByTimeAsync(0)
    expect(mockPlugin.persistFatalException).not.toHaveBeenCalled()
    expect(previous).toHaveBeenCalledTimes(1)
  })
})