import { Linking, AppState } from 'react-native'
import { PostHog } from '../src'
import {
  appendFatalJournalIngested,
  buildFatalJournalEntry,
  entryToEventProperties,
  FATAL_JOURNAL_INGESTED_MAX,
  hasFatalJournalIngested,
  hashApiKey,
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

const TEST_API_KEY = 'test-token'
let TEST_API_KEY_HASH = ''
beforeAll(async () => {
  TEST_API_KEY_HASH = await hashApiKey(TEST_API_KEY)
})

describe('fatal journal helper', () => {
  it('roundtrips a serialized entry preserving all fields', () => {
    const entry = buildFatalJournalEntry({
      id: '0192f1c2-1234-7abc-9def-0123456789ab',
      eventUuid: '0192f1c2-1234-7abc-9def-0123456789ac',
      timestamp: '2026-09-15T10:00:00.000Z',
      sessionId: 'session-1',
      distinctId: 'user-1',
      deviceId: 'device-1',
      attribution: {
        $lib: 'posthog-react-native',
        $app_version: '1.2.3',
        $app_state: 'active',
        $expo_update_id: 'u-1',
      },
      exceptionList: [{ type: 'Error', value: 'boom' }],
      exceptionLevel: 'fatal',
      exceptionSteps: undefined,
      optedOut: false,
      apiKeyHash: 'abcd1234',
    })
    const raw = serializeFatalJournalEntry(entry)
    const parsed = parseFatalJournalEntry(raw)
    expect(parsed).not.toBeNull()
    expect(parsed!.id).toBe(entry.id)
    expect(parsed!.eventUuid).toBe(entry.eventUuid)
    expect(parsed!.timestamp).toBe(entry.timestamp)
    expect(parsed!.sessionId).toBe(entry.sessionId)
    expect(parsed!.distinctId).toBe(entry.distinctId)
    expect(parsed!.deviceId).toBe(entry.deviceId)
    expect(parsed!.exceptionLevel).toBe(entry.exceptionLevel)
    expect(parsed!.optedOut).toBe(false)
    expect(parsed!.apiKeyHash).toBe('abcd1234')
    expect(parsed!.attribution).toEqual({
      $lib: 'posthog-react-native',
      $app_version: '1.2.3',
      $app_state: 'active',
      $expo_update_id: 'u-1',
    })
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
          deviceId: '',
          attribution: {},
          exceptionLevel: 'fatal',
          optedOut: false,
          apiKeyHash: 'x',
          exceptionList: 'not-an-array',
        })
      )
    ).toBeNull()
    // attribution must be an object
    expect(
      parseFatalJournalEntry(
        JSON.stringify({
          id: 'a',
          eventUuid: 'b',
          timestamp: 'c',
          sessionId: '',
          distinctId: '',
          deviceId: '',
          attribution: 'not-an-object',
          exceptionLevel: 'fatal',
          optedOut: false,
          apiKeyHash: 'x',
          exceptionList: [{ type: 'Error', value: 'boom' }],
        })
      )
    ).toBeNull()
    // apiKeyHash must be a string
    expect(
      parseFatalJournalEntry(
        JSON.stringify({
          id: 'a',
          eventUuid: 'b',
          timestamp: 'c',
          sessionId: '',
          distinctId: '',
          deviceId: '',
          attribution: {},
          exceptionLevel: 'fatal',
          optedOut: false,
          apiKeyHash: 123,
          exceptionList: [{ type: 'Error', value: 'boom' }],
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
      deviceId: 'd',
      attribution: {
        $lib: 'posthog-react-native',
        $app_version: '1.0.0',
        $app_state: 'background',
      },
      exceptionList: [{ type: 'Error', value: 'recover me' }],
      exceptionLevel: 'fatal',
      optedOut: false,
      apiKeyHash: 'abcd1234',
    })
    const reconstructed = entryToEventProperties(entry)
    expect(reconstructed.uuid).toBe('event-uuid-1')
    expect(reconstructed.timestamp).toBe('2026-09-15T10:00:00.000Z')
    expect(reconstructed.properties.$exception_list).toEqual(entry.exceptionList)
    expect(reconstructed.properties.$exception_level).toBe('fatal')
    expect(reconstructed.properties.$lib).toBe('posthog-react-native')
    expect(reconstructed.properties.$app_version).toBe('1.0.0')
    expect(reconstructed.properties.$app_state).toBe('background')
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
        deviceId: '',
        attribution: {},
        exceptionList: [],
        exceptionLevel: 'fatal',
        optedOut: false,
        apiKeyHash: 'abcd1234',
      })
    ).toThrow()
  })

  it('rejects a missing apiKeyHash at build time so cross-client recovery is impossible', () => {
    expect(() =>
      buildFatalJournalEntry({
        id: 'a',
        eventUuid: 'b',
        timestamp: 'c',
        sessionId: '',
        distinctId: '',
        deviceId: '',
        attribution: {},
        exceptionList: [{ type: 'Error', value: 'boom' }],
        exceptionLevel: 'fatal',
        optedOut: false,
        apiKeyHash: '',
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
    // Advance enough time for the async apiKey hash (which uses libuv's thread pool via
    // crypto.subtle.digest, not microtasks — vitest's fake timers don't flush those on
    // advanceTimersByTime(0)).
    await vi.advanceTimersByTimeAsync(100)
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
    // await it directly so a leaked call can't pollute the next test's mocks.
    await (posthog as any)._fatalJournalDrainPromise
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

  it('retains the journal entry when JS durable handoff fails (sync setItem throws)', async () => {
    const journalId = '0192f1c2-aaaa-7bbb-cccc-dddddddddddd'
    const entry = buildFatalJournalEntry({
      id: journalId,
      eventUuid: 'event-uuid-handoff-fails',
      timestamp: new Date().toISOString(),
      sessionId: 's',
      distinctId: 'u',
      deviceId: 'd',
      attribution: {},
      exceptionList: [{ type: 'Error', value: 'persist-fails' }],
      exceptionLevel: 'fatal',
      optedOut: false,
      apiKeyHash: TEST_API_KEY_HASH,
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
    posthog = new PostHog(TEST_API_KEY, {
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
    await (posthog as any)._fatalJournalDrainPromise
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }

    expect(mockPlugin.removePendingFatalException).not.toHaveBeenCalled()
  })

  it('retains the journal entry when JS durable handoff fails (async setItem rejects)', async () => {
    // The previous test covered the sync-throw case; this one covers the async-reject path,
    // which waitForPersist used to swallow silently — leading to a lost fatal.
    const journalId = '0192f1c2-bbbb-7ccc-dddd-eeeeeeeeeeee'
    const entry = buildFatalJournalEntry({
      id: journalId,
      eventUuid: 'event-uuid-async-fail',
      timestamp: new Date().toISOString(),
      sessionId: 's',
      distinctId: 'u',
      deviceId: 'd',
      attribution: {},
      exceptionList: [{ type: 'Error', value: 'persist-rejects' }],
      exceptionLevel: 'fatal',
      optedOut: false,
      apiKeyHash: TEST_API_KEY_HASH,
    })
    mockPlugin.getPendingFatalExceptions.mockImplementation(() =>
      Promise.resolve([{ id: journalId, report: serializeFatalJournalEntry(entry) }])
    )

    // Async rejection — the previous waitForPersist() swallowed this and lost the fatal.
    const customStorage = {
      getItem: () => null,
      setItem: () => Promise.reject(new Error('async disk failure')),
    }
    posthog = new PostHog(TEST_API_KEY, {
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
    await (posthog as any)._fatalJournalDrainPromise
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }

    expect(mockPlugin.removePendingFatalException).not.toHaveBeenCalled()
    expect(extractExceptionCount(stored.get('.posthog-rn.json'))).toBe(0)
  })

  it('does not produce a duplicate when recovery is interrupted after persist but before native remove', async () => {
    // Simulates a crash between waitForPersistSuccess() and removePendingFatalException():
    // the FatalJournalIngested marker is durable (same write as the queue item), so the
    // next launch sees it, short-circuits, and removes the native file without re-capturing.
    const journalId = '0192f1c2-1111-7abc-9def-0123456789ab'
    const eventUuid = 'event-uuid-no-duplicate'
    const entry = buildFatalJournalEntry({
      id: journalId,
      eventUuid,
      timestamp: new Date().toISOString(),
      sessionId: '',
      distinctId: '',
      deviceId: '',
      attribution: {},
      exceptionList: [{ type: 'Error', value: 'should-ship-once' }],
      exceptionLevel: 'fatal',
      optedOut: false,
      apiKeyHash: TEST_API_KEY_HASH,
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

    posthog = new PostHog(TEST_API_KEY, {
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
    await (posthog as any)._fatalJournalDrainPromise
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
      deviceId: '',
      attribution: {},
      exceptionList: [{ type: 'Error', value: 'duplicate me' }],
      exceptionLevel: 'fatal',
      optedOut: false,
      apiKeyHash: TEST_API_KEY_HASH,
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
    posthog = new PostHog(TEST_API_KEY, {
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
    await (posthog as any)._fatalJournalDrainPromise
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }

    expect(mockPlugin.removePendingFatalException).toHaveBeenCalledWith(journalId)
    expect(extractExceptionCount(stored.get('.posthog-rn.json'))).toBe(0)
  })

  it('leaves another client\'s pending entry untouched so the producing client can still recover it', async () => {
    const journalId = '0192f1c2-eeee-ffff-0000-111111111111'
    const entry = buildFatalJournalEntry({
      id: journalId,
      eventUuid: 'event-uuid',
      timestamp: new Date().toISOString(),
      sessionId: '',
      distinctId: '',
      deviceId: '',
      attribution: {},
      exceptionList: [{ type: 'Error', value: 'wrong-client' }],
      exceptionLevel: 'fatal',
      optedOut: false,
      // Mismatched — produced by another PostHog client in the same app. Removing it
      // here (when Project A initializes first) would be deterministic data loss
      // for Project B. The per-client 5-entry FIFO cap bounds the directory growth.
      apiKeyHash: 'someone-elses-hash',
    })
    mockPlugin.getPendingFatalExceptions.mockImplementation(() =>
      Promise.resolve([{ id: journalId, report: serializeFatalJournalEntry(entry) }])
    )
    posthog = createClient()
    await posthog.ready()
    await (posthog as any)._fatalJournalDrainPromise
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }

    // The entry is left on disk for the producing client to recover on its own launch.
    expect(mockPlugin.removePendingFatalException).not.toHaveBeenCalled()
    expect(extractExceptionCount(stored.get('.posthog-rn.json'))).toBe(0)
  })

  it('drops a pending entry whose crash-time optedOut is true (privacy carry-over)', async () => {
    const journalId = '0192f1c2-2222-7abc-9def-0123456789ab'
    const entry = buildFatalJournalEntry({
      id: journalId,
      eventUuid: 'event-uuid',
      timestamp: new Date().toISOString(),
      sessionId: '',
      distinctId: '',
      deviceId: '',
      attribution: {},
      exceptionList: [{ type: 'Error', value: 'was-opted-out' }],
      exceptionLevel: 'fatal',
      optedOut: true,
      apiKeyHash: TEST_API_KEY_HASH,
    })
    mockPlugin.getPendingFatalExceptions.mockImplementation(() =>
      Promise.resolve([{ id: journalId, report: serializeFatalJournalEntry(entry) }])
    )
    posthog = createClient()
    await posthog.ready()
    await (posthog as any)._fatalJournalDrainPromise
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
    await (posthog as any)._fatalJournalDrainPromise
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
      deviceId: '',
      attribution: {},
      exceptionList: [{ type: 'Error', value: 'should-not-ship' }],
      exceptionLevel: 'fatal',
      optedOut: false,
      apiKeyHash: TEST_API_KEY_HASH,
    })
    mockPlugin.getPendingFatalExceptions.mockImplementation(() =>
      Promise.resolve([{ id: journalId, report: serializeFatalJournalEntry(entry) }])
    )

    const customStorage = {
      getItem: () => JSON.stringify({ version: 'v1', content: { opted_out: true } }),
      setItem: () => {},
    }
    posthog = new PostHog(TEST_API_KEY, {
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
    await (posthog as any)._fatalJournalDrainPromise
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }

    expect(mockPlugin.removePendingFatalException).toHaveBeenCalledWith(journalId)
    expect(extractExceptionCount(stored.get('.posthog-rn.json'))).toBe(0)
  })

  it('does not write a journal entry when the user is opted out at crash time', async () => {
    const customStorage = {
      getItem: () => JSON.stringify({ version: 'v1', content: { opted_out: true } }),
      setItem: (key: string, value: string) => {
        stored.set(key, value)
      },
    }
    posthog = new PostHog(TEST_API_KEY, {
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
    await (posthog as any)._eventsStorage.waitForPersist()
    handler(new Error('opted-out-fatal'), true)
    await vi.advanceTimersByTimeAsync(0)
    expect(mockPlugin.persistFatalException).not.toHaveBeenCalled()
  })

  it('preserves the crash-time app version so a fix in version N is not reported as a regression in N+1', async () => {
    const journalId = '0192f1c2-aaaa-bbbb-cccc-dddddddddddd'
    const entry = buildFatalJournalEntry({
      id: journalId,
      eventUuid: 'event-uuid-version-regression',
      timestamp: new Date().toISOString(),
      sessionId: 's',
      distinctId: 'u',
      deviceId: 'd',
      // Crash-time snapshot: app was at 1.0.0 with iOS 16.0. The current launch (this test)
      // is running app version 2.0.0 / iOS 17.0 — those values would normally flow through
      // getCommonEventProperties() and overwrite the snapshot if not reapplied.
      attribution: { $app_version: '1.0.0', $os_version: '16.0', $lib_version: '1.0.0' },
      exceptionList: [{ type: 'Error', value: 'pre-fix-crash' }],
      exceptionLevel: 'fatal',
      optedOut: false,
      apiKeyHash: TEST_API_KEY_HASH,
    })
    mockPlugin.getPendingFatalExceptions.mockImplementation(() =>
      Promise.resolve([{ id: journalId, report: serializeFatalJournalEntry(entry) }])
    )

    // Set up custom storage that reports the new launch's runtime state via getCommonEventProperties.
    posthog = createClient()
    await posthog.ready()
    await (posthog as any)._fatalJournalDrainPromise
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }

    const recoveredQueue = JSON.parse(stored.get('.posthog-rn.json') || '{}')
    const queue = (recoveredQueue.content && recoveredQueue.content.queue) || []
    expect(queue.length).toBe(1)
    // The recovered event carries the CRASH-time version, not the relaunch's runtime version.
    expect(queue[0].message.properties.$app_version).toBe('1.0.0')
    expect(queue[0].message.properties.$os_version).toBe('16.0')
    expect(queue[0].message.properties.$lib_version).toBe('1.0.0')
  })

  it('preserves the crash-time $app_state and Expo update context', async () => {
    const journalId = '0192f1c2-aaaa-bbbb-cccc-eeeeeeeeeeee'
    const entry = buildFatalJournalEntry({
      id: journalId,
      eventUuid: 'event-uuid-context',
      timestamp: new Date().toISOString(),
      sessionId: 's',
      distinctId: 'u',
      deviceId: 'd',
      attribution: {
        $app_state: 'background',
        $expo_update_id: 'expo-update-pre-fix',
        $expo_runtime_version: '1.0.0',
        $expo_channel: 'production',
      },
      exceptionList: [{ type: 'Error', value: 'with-context' }],
      exceptionLevel: 'fatal',
      optedOut: false,
      apiKeyHash: TEST_API_KEY_HASH,
    })
    mockPlugin.getPendingFatalExceptions.mockImplementation(() =>
      Promise.resolve([{ id: journalId, report: serializeFatalJournalEntry(entry) }])
    )

    posthog = createClient()
    await posthog.ready()
    await (posthog as any)._fatalJournalDrainPromise
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }

    const recoveredQueue = JSON.parse(stored.get('.posthog-rn.json') || '{}')
    const queue = (recoveredQueue.content && recoveredQueue.content.queue) || []
    expect(queue.length).toBe(1)
    expect(queue[0].message.properties.$app_state).toBe('background')
    expect(queue[0].message.properties.$expo_update_id).toBe('expo-update-pre-fix')
    expect(queue[0].message.properties.$expo_runtime_version).toBe('1.0.0')
    expect(queue[0].message.properties.$expo_channel).toBe('production')
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

  it('does not crash the fatal handler when captureExceptionInternal throws', async () => {
    posthog = createClient()
    await posthog.ready()
    await (posthog as any)._eventsStorage.waitForPersist()
    // Force captureExceptionInternal to throw — the handler falls back to a minimal
    // captured so persistFatalReportToNative + flush still run, which is strictly more
    // than nothing for the crash this code path exists to recover.
    const original = (posthog as any).captureExceptionInternal
    ;(posthog as any).captureExceptionInternal = () => {
      throw new Error('capture exploded')
    }
    expect(() => handler(new Error('capture-throws'), true)).not.toThrow()
    // Wait long enough for the libuv-backed crypto.subtle.digest used by hashApiKey.
    await vi.advanceTimersByTimeAsync(100)
    expect(mockPlugin.persistFatalException).toHaveBeenCalledTimes(1)
    expect(previous).toHaveBeenCalledTimes(1)
    // restore so afterEach teardown doesn't observe a polluted state
    ;(posthog as any).captureExceptionInternal = original
  })

  it('drains the journal on init even when native crashes are NOT autocaptured', async () => {
    // Drain is independent of nativeCrashes: every fatal JS exception writes the journal,
    // so every launch with uncaughtExceptions + the plugin installed must drain.
    const journalId = '0192f1c2-3333-7abc-9def-0123456789ab'
    const entry = buildFatalJournalEntry({
      id: journalId,
      eventUuid: 'event-uuid-no-native',
      timestamp: new Date().toISOString(),
      sessionId: 's',
      distinctId: 'u',
      deviceId: 'd',
      attribution: {},
      exceptionList: [{ type: 'Error', value: 'no-native-crashes' }],
      exceptionLevel: 'fatal',
      optedOut: false,
      apiKeyHash: TEST_API_KEY_HASH,
    })
    mockPlugin.getPendingFatalExceptions.mockImplementation(() =>
      Promise.resolve([{ id: journalId, report: serializeFatalJournalEntry(entry) }])
    )

    posthog = new PostHog(TEST_API_KEY, {
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
      // Note: nativeCrashes is OMITTED — only uncaughtExceptions is set. Drain still runs.
      errorTracking: { autocapture: { uncaughtExceptions: true } },
    } as any)
    await posthog.ready()
    await (posthog as any)._fatalJournalDrainPromise
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }

    expect(mockPlugin.getPendingFatalExceptions).toHaveBeenCalled()
    expect(mockPlugin.removePendingFatalException).toHaveBeenCalledWith(journalId)
    expect(extractExceptionCount(stored.get('.posthog-rn.json'))).toBe(1)
  })

  it('does not double-send when AsyncStorage finishes within the 2s deadline', async () => {
    // The dedup marker is written in the same AsyncStorage write as the recovered event,
    // so a successful JS persist + successful native remove means the next launch sees the
    // marker and skips re-capture.
    const journalId = '0192f1c2-4444-7abc-9def-0123456789ab'
    const entry = buildFatalJournalEntry({
      id: journalId,
      eventUuid: 'event-uuid-no-double',
      timestamp: new Date().toISOString(),
      sessionId: '',
      distinctId: '',
      deviceId: '',
      attribution: {},
      exceptionList: [{ type: 'Error', value: 'no-double' }],
      exceptionLevel: 'fatal',
      optedOut: false,
      apiKeyHash: TEST_API_KEY_HASH,
    })
    mockPlugin.getPendingFatalExceptions.mockImplementation(() =>
      Promise.resolve([{ id: journalId, report: serializeFatalJournalEntry(entry) }])
    )
    mockPlugin.removePendingFatalException.mockImplementation(() => Promise.resolve())

    posthog = createClient()
    await posthog.ready()
    await (posthog as any)._fatalJournalDrainPromise
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }

    // Exactly one recovery and one removal — second launch would short-circuit on the marker.
    expect(extractExceptionCount(stored.get('.posthog-rn.json'))).toBe(1)
    expect(mockPlugin.removePendingFatalException).toHaveBeenCalledTimes(1)
    const recovered = JSON.parse(stored.get('.posthog-rn.json') || '{}')
    expect(recovered.content.fatal_journal_ingested).toEqual([journalId])
  })

  it('skips the journal entirely when persistence is "memory"', async () => {
    const customStorage = {
      getItem: () => null,
      setItem: (key, value) => {
        stored.set(key, value)
      },
    }
    posthog = new PostHog(TEST_API_KEY, {
      customStorage: customStorage as any,
      persistence: 'memory',
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
    await (posthog as any)._eventsStorage.waitForPersist()
    handler(new Error('memory-mode-fatal'), true)
    await vi.advanceTimersByTimeAsync(100)
    // Memory mode has no AsyncStorage to recover from; writing would land data the rest
    // of the SDK promises never to touch disk.
    expect(mockPlugin.persistFatalException).not.toHaveBeenCalled()
    expect(previous).toHaveBeenCalledTimes(1)
  })

  it('waits for storage preload before reading opt-out at crash time', async () => {
    // Slow AsyncStorage preload: while it's pending, in-memory values are defaults.
    // A previously opted-out user must NOT have their fatal crash land on disk just
    // because we read the default value of optedOut.
    let resolvePreload!: () => void
    const pendingPreload = new Promise<void>((resolve) => {
      resolvePreload = resolve
    })
    const customStorage = {
      getItem: (key: string) => {
        if (key === '.posthog-rn.json') {
          return pendingPreload.then(() =>
            JSON.stringify({ version: 'v1', content: { opted_out: true } })
          ) as any
        }
        return null as any
      },
      setItem: (key: string, value: string) => {
        stored.set(key, value)
      },
    }
    posthog = new PostHog(TEST_API_KEY, {
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
    // Don't await posthog.ready() — the preload is pending. The fatal handler
    // installed synchronously should still gate on the storage init promise, so the
    // native write doesn't fire with the default in-memory optedOut value.
    const readyPromise = posthog.ready()
    handler(new Error('slow-preload-fatal'), true)
    await vi.advanceTimersByTimeAsync(0)
    expect(mockPlugin.persistFatalException).not.toHaveBeenCalled()
    // Now resolve the preload and let the SDK finish initialization so the test
    // doesn't time out on afterEach teardown.
    resolvePreload()
    await readyPromise
  })

  it('lets before_send strip user properties on recovery (reapplies only attribution)', async () => {
    // The journal only carries attribution keys (SDK / device / session identifiers);
    // user properties are never persisted, so before_send can't accidentally resurrect
    // them and the recovered event honors whatever the customer hook decides. We can't
    // reach the core before_send hook from RN's PostHog subclass, but we can verify
    // the structural invariant: a key that's NOT in FATAL_JOURNAL_ATTRIBUTION_KEYS is
    // dropped on the way to the journal, so it can never reach recovery or before_send.
    const journalId = '0192f1c2-5555-7abc-9def-0123456789ab'
    const entry = buildFatalJournalEntry({
      id: journalId,
      eventUuid: 'event-uuid-no-user-props',
      timestamp: new Date().toISOString(),
      sessionId: 's',
      distinctId: 'u',
      deviceId: 'd',
      attribution: {
        $app_version: '1.0.0',
        // Anything outside the attribution allowlist is dropped before the journal
        // entry is built — a customer's before_send hook can't resurrect it because
        // we never persisted it in the first place.
        $sensitive_user_email: 'leaked@example.com',
      },
      exceptionList: [{ type: 'Error', value: 'with-pii' }],
      exceptionLevel: 'fatal',
      optedOut: false,
      apiKeyHash: TEST_API_KEY_HASH,
    })
    const parsed = parseFatalJournalEntry(serializeFatalJournalEntry(entry))
    expect(parsed).not.toBeNull()
    // Attribution keys survive; non-attribution keys are stripped on the way in.
    expect(parsed!.attribution.$app_version).toBe('1.0.0')
    expect(parsed!.attribution.$sensitive_user_email).toBeUndefined()
  })

  it('before_send is final on user properties but SDK metadata is reapplied (regression for hpouillot P1)', async () => {
    // hpouillot raised a P1 about before_send final authority. The chosen design is:
    //   - user properties are never persisted in the journal, so before_send's scrubbing
    //     of user properties is final (nothing to reapply).
    //   - SDK / device / session identifiers ARE persisted and reapplied AFTER
    //     super.processBeforeEnqueue so crash attribution survives across app versions —
    //     a customer's before_send stripping $app_version would lose the crash-to-version
    //     link when the user updates between the crash and the relaunch.
    // This test locks in both halves so a future refactor can't silently change either.
    const journalId = '0192f1c2-6666-7abc-9def-0123456789ab'
    const entry = buildFatalJournalEntry({
      id: journalId,
      eventUuid: 'event-uuid-before-send',
      timestamp: new Date().toISOString(),
      sessionId: 's',
      distinctId: 'u',
      deviceId: 'd',
      attribution: {
        $app_version: '1.0.0',
        $os_version: '16.0',
        $lib_version: '1.0.0',
        // User properties never reach the journal, so they can't reach before_send
        // either — the assertion below confirms before_send has nothing to scrub here.
        $user_email: 'attribution-key-not-in-allowlist-so-stripped',
      },
      exceptionList: [{ type: 'Error', value: 'before-send-recovery' }],
      exceptionLevel: 'fatal',
      optedOut: false,
      apiKeyHash: TEST_API_KEY_HASH,
    })
    mockPlugin.getPendingFatalExceptions.mockImplementation(() =>
      Promise.resolve([{ id: journalId, report: serializeFatalJournalEntry(entry) }])
    )

    const beforeSend = vi.fn((event: any) => {
      // Try to scrub SDK metadata. The override reapplies these after this hook
      // returns, so the recovered event MUST still carry them — this is the design
      // choice hpouillot flagged.
      delete event.properties.$app_version
      delete event.properties.$os_version
      delete event.properties.$lib_version
      return event
    })

    posthog = new PostHog(TEST_API_KEY, {
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
      before_send: beforeSend,
      errorTracking: { autocapture: { uncaughtExceptions: true, nativeCrashes: true } },
    } as any)
    await posthog.ready()
    await (posthog as any)._fatalJournalDrainPromise
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(10)
    }

    expect(beforeSend).toHaveBeenCalled()
    const recoveredQueue = JSON.parse(stored.get('.posthog-rn.json') || '{}')
    const queue = (recoveredQueue.content && recoveredQueue.content.queue) || []
    expect(queue.length).toBe(1)
    // Design choice: SDK metadata is reapplied after before_send so the crash stays
    // attributed to the version the user was running, not the relaunch's version.
    expect(queue[0].message.properties.$app_version).toBe('1.0.0')
    expect(queue[0].message.properties.$os_version).toBe('16.0')
    expect(queue[0].message.properties.$lib_version).toBe('1.0.0')
    // User properties never made it into the journal in the first place — before_send
    // has nothing to scrub here, but the assertion documents the boundary.
    expect(queue[0].message.properties.$user_email).toBeUndefined()
  })
})