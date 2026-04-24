import { PostHogPersistedProperty } from '@posthog/core'
import type { Logger } from '@posthog/core'
import { PostHogLogs } from '../src/logs'
import type { BufferedLogEntry, PostHogLogsConfig } from '../src/logs/types'
import { PostHogRNStorage, createLogsStorage, createLogsMemoryStorage } from '../src/storage'

// Mock PostHog instance that implements getPersistedProperty / setPersistedProperty
// against an in-memory backing store. This mirrors the routing that the real
// posthog-rn.ts does — the LogsQueue key would route to _logsStorage there;
// here it just lives in the backing store alongside anything else the test
// might read/write through the same API.
const createMockInstance = (overrides: Record<string, any> = {}): any => {
  const store: Record<string, any> = {}
  const instance: any = {
    optedOut: false,
    getDistinctId: jest.fn(() => 'user-123'),
    getSessionId: jest.fn(() => 'sess-456'),
    getPersistedProperty: jest.fn((key: string) => store[key]),
    setPersistedProperty: jest.fn((key: string, value: any) => {
      if (value === null || value === undefined) {
        delete store[key]
      } else {
        store[key] = value
      }
    }),
    // Core's shutdown-coordination hook — flushStorage registers its promise
    // with this. For tests we just pass the promise through.
    addPendingPromise: jest.fn(<T>(promise: Promise<T>) => promise),
    _store: store,
    ...overrides,
  }
  return instance
}

const createMockLogger = (): Logger => {
  const logger: any = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    critical: jest.fn(),
  }
  logger.createLogger = jest.fn(() => logger)
  return logger as Logger
}

const readQueue = (instance: any): BufferedLogEntry[] => {
  return (instance._store[PostHogPersistedProperty.LogsQueue] as BufferedLogEntry[] | undefined) ?? []
}

describe('PostHogLogs', () => {
  let mockInstance: any
  let logsStorage: PostHogRNStorage
  let logger: Logger

  beforeEach(() => {
    mockInstance = createMockInstance()
    logsStorage = createLogsMemoryStorage()
    logger = createMockLogger()
  })

  it('constructs without throwing', () => {
    const logs = new PostHogLogs(mockInstance, undefined, logger, logsStorage)
    expect(logs).toBeDefined()
  })

  describe('captureLog', () => {
    it('writes a record to the logs queue via getPersistedProperty', () => {
      const logs = new PostHogLogs(mockInstance, undefined, logger, logsStorage)
      logs.captureLog({ body: 'hello world' })

      const queue = readQueue(mockInstance)
      expect(queue).toHaveLength(1)
      expect(queue[0].record.body).toEqual({ stringValue: 'hello world' })
      expect(mockInstance.setPersistedProperty).toHaveBeenCalledWith(
        PostHogPersistedProperty.LogsQueue,
        expect.any(Array)
      )
    })

    it('maps severity levels correctly', () => {
      const logs = new PostHogLogs(mockInstance, undefined, logger, logsStorage)
      logs.captureLog({ body: 'oh no', level: 'error' })

      const queue = readQueue(mockInstance)
      expect(queue[0].record.severityText).toBe('ERROR')
      expect(queue[0].record.severityNumber).toBe(17)
    })

    it('defaults to INFO when no level is provided', () => {
      const logs = new PostHogLogs(mockInstance, undefined, logger, logsStorage)
      logs.captureLog({ body: 'hello' })

      const queue = readQueue(mockInstance)
      expect(queue[0].record.severityText).toBe('INFO')
    })

    it('auto-populates distinctId and sessionId', () => {
      const logs = new PostHogLogs(mockInstance, undefined, logger, logsStorage)
      logs.captureLog({ body: 'test' })

      const queue = readQueue(mockInstance)
      const attrs = Object.fromEntries(queue[0].record.attributes.map((a) => [a.key, a.value]))
      expect(attrs['posthogDistinctId']).toEqual({ stringValue: 'user-123' })
      expect(attrs['sessionId']).toEqual({ stringValue: 'sess-456' })
    })

    it('merges user attributes over auto-populated ones', () => {
      const logs = new PostHogLogs(mockInstance, undefined, logger, logsStorage)
      logs.captureLog({ body: 'test', attributes: { posthogDistinctId: 'override' } })

      const queue = readQueue(mockInstance)
      const attrs = Object.fromEntries(queue[0].record.attributes.map((a) => [a.key, a.value]))
      expect(attrs['posthogDistinctId']).toEqual({ stringValue: 'override' })
    })

    it('is a no-op when body is empty', () => {
      const logs = new PostHogLogs(mockInstance, undefined, logger, logsStorage)
      logs.captureLog({ body: '' })
      expect(readQueue(mockInstance)).toHaveLength(0)
      expect(mockInstance.setPersistedProperty).not.toHaveBeenCalled()
    })

    it('is a no-op when body is missing', () => {
      const logs = new PostHogLogs(mockInstance, undefined, logger, logsStorage)
      logs.captureLog({} as any)
      expect(readQueue(mockInstance)).toHaveLength(0)
    })

    it('is a no-op when optedOut is true', () => {
      const instance = createMockInstance({ optedOut: true })
      const logs = new PostHogLogs(instance, undefined, logger, logsStorage)
      logs.captureLog({ body: 'should be dropped' })
      expect(readQueue(instance)).toHaveLength(0)
    })

    it('is a no-op when config.enabled is false', () => {
      const config: PostHogLogsConfig = { enabled: false }
      const logs = new PostHogLogs(mockInstance, config, logger, logsStorage)
      logs.captureLog({ body: 'should be dropped' })
      expect(readQueue(mockInstance)).toHaveLength(0)
    })

    it('captures when config is provided with enabled undefined (defaults to true)', () => {
      const config: PostHogLogsConfig = {}
      const logs = new PostHogLogs(mockInstance, config, logger, logsStorage)
      logs.captureLog({ body: 'kept' })
      expect(readQueue(mockInstance)).toHaveLength(1)
    })

    it('appends subsequent captures to the existing queue', () => {
      const logs = new PostHogLogs(mockInstance, undefined, logger, logsStorage)
      logs.captureLog({ body: 'first' })
      logs.captureLog({ body: 'second' })
      logs.captureLog({ body: 'third' })

      const queue = readQueue(mockInstance)
      expect(queue).toHaveLength(3)
      expect(queue[0].record.body.stringValue).toBe('first')
      expect(queue[1].record.body.stringValue).toBe('second')
      expect(queue[2].record.body.stringValue).toBe('third')
    })

    it('drops the oldest record when buffer overflows maxBufferSize', () => {
      const config: PostHogLogsConfig = { maxBufferSize: 3 }
      const logs = new PostHogLogs(mockInstance, config, logger, logsStorage)

      logs.captureLog({ body: 'one' })
      logs.captureLog({ body: 'two' })
      logs.captureLog({ body: 'three' })
      logs.captureLog({ body: 'four' })

      const queue = readQueue(mockInstance)
      expect(queue).toHaveLength(3)
      expect(queue.map((e) => e.record.body.stringValue)).toEqual(['two', 'three', 'four'])
    })

    it('logs a diagnostic when evicting on overflow', () => {
      const config: PostHogLogsConfig = { maxBufferSize: 1 }
      const logs = new PostHogLogs(mockInstance, config, logger, logsStorage)

      logs.captureLog({ body: 'first' })
      logs.captureLog({ body: 'second' })

      expect(logger.info).toHaveBeenCalledWith('Logs queue is full, dropping oldest record.')
    })

    it('passes trace context through to the OTLP record', () => {
      const logs = new PostHogLogs(mockInstance, undefined, logger, logsStorage)
      logs.captureLog({
        body: 'trace test',
        trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
        span_id: '00f067aa0ba902b7',
        trace_flags: 1,
      })

      const queue = readQueue(mockInstance)
      expect(queue[0].record.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
      expect(queue[0].record.spanId).toBe('00f067aa0ba902b7')
      expect(queue[0].record.flags).toBe(1)
    })
  })

  // Simulates the real AsyncStorage case where the underlying backend's
  // getItem returns a Promise. Until that Promise resolves, captureLog must
  // NOT invoke setPersistedProperty (would route to empty memoryCache and
  // overwrite pre-existing records on preload).
  //
  // Matches events' `wrap()` pattern in @posthog/core/posthog-core-stateless.ts:
  // pre-init captures chain onto _initPromise.then(fn), which drains in-order
  // on resolution and silently drops on rejection.
  describe('preload race during cold start', () => {
    let resolvePreload: (value: string | null) => void = () => {}
    let asyncStorage: PostHogRNStorage

    // Fake timers (enabled globally via jest.config) block setTimeout-based
    // microtask flushing. Use real timers here so promise chains resolve.
    beforeAll(() => {
      jest.useRealTimers()
    })
    afterAll(() => {
      jest.useFakeTimers()
    })

    beforeEach(() => {
      const backend = {
        getItem: jest.fn((_key: string) => {
          return new Promise<string | null>((resolve) => {
            resolvePreload = (value) => resolve(value)
          })
        }),
        setItem: jest.fn(),
      }
      asyncStorage = createLogsStorage(backend)
    })

    it('defers captures until preload completes, then drains in order', async () => {
      const logs = new PostHogLogs(mockInstance, undefined, logger, asyncStorage)
      logs.captureLog({ body: 'before-preload' })

      // Before preload: no write has happened yet
      expect(mockInstance.setPersistedProperty).not.toHaveBeenCalled()

      // Simulate a pre-existing persisted queue being in the mock instance's
      // store (as if the previous session's records were already loaded).
      mockInstance._store[PostHogPersistedProperty.LogsQueue] = [
        { record: { body: { stringValue: 'prior-session' } } as any },
      ]

      resolvePreload(null)
      await asyncStorage.preloadPromise
      // Allow the _initPromise.then(fn) microtasks to drain.
      await new Promise((resolve) => setTimeout(resolve, 0))

      const queue = readQueue(mockInstance)
      expect(queue).toHaveLength(2)
      expect(queue[0].record.body.stringValue).toBe('prior-session')
      expect(queue[1].record.body.stringValue).toBe('before-preload')
    })

    it('does not write to storage when no captures came in during preload', async () => {
      new PostHogLogs(mockInstance, undefined, logger, asyncStorage)

      resolvePreload(null)
      await asyncStorage.preloadPromise
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockInstance.setPersistedProperty).not.toHaveBeenCalled()
    })

    it('drains pending captures with capture-time context, not drain-time', async () => {
      // Records are built at captureLog() time — identity changes between
      // capture and drain must not corrupt recorded attributes.
      const instance = createMockInstance()
      instance.getDistinctId = jest.fn().mockReturnValue('user-A')

      const logs = new PostHogLogs(instance, undefined, logger, asyncStorage)
      logs.captureLog({ body: 'captured-as-user-A' })

      // Simulate an identity change BEFORE preload resolves (while the
      // capture is still pending on _initPromise).
      instance.getDistinctId = jest.fn().mockReturnValue('user-B')

      resolvePreload(null)
      await asyncStorage.preloadPromise
      await new Promise((resolve) => setTimeout(resolve, 0))

      const queue = readQueue(instance)
      expect(queue).toHaveLength(1)
      const attrs = Object.fromEntries(queue[0].record.attributes.map((a) => [a.key, a.value]))
      // Record should carry the distinctId that was active at capture time
      expect(attrs['posthogDistinctId']).toEqual({ stringValue: 'user-A' })
    })

    it('silently drops captures if preload rejects (matches events wrap())', async () => {
      let rejectPreload: (err: Error) => void = () => {}
      const backend = {
        getItem: jest.fn(
          (_key: string) =>
            new Promise<string | null>((_, reject) => {
              rejectPreload = (err) => reject(err)
            })
        ),
        setItem: jest.fn(),
      }
      const storage = createLogsStorage(backend)
      const logs = new PostHogLogs(mockInstance, undefined, logger, storage)

      logs.captureLog({ body: 'pending-during-reject' })
      rejectPreload(new Error('disk read failed'))
      await new Promise((resolve) => setTimeout(resolve, 0))

      // Captures chained on the rejected _initPromise never run → dropped.
      expect(readQueue(mockInstance)).toHaveLength(0)
      expect(mockInstance.setPersistedProperty).not.toHaveBeenCalled()
      // The failure is still logged (diagnostic only — no recovery).
      expect(logger.error).toHaveBeenCalledWith('Logs storage preload failed:', expect.any(Error))
    })

    it('captureLog does not throw to callers after preload rejects', async () => {
      let rejectPreload: (err: Error) => void = () => {}
      const backend = {
        getItem: jest.fn(
          (_key: string) =>
            new Promise<string | null>((_, reject) => {
              rejectPreload = (err) => reject(err)
            })
        ),
        setItem: jest.fn(),
      }
      const storage = createLogsStorage(backend)
      const logs = new PostHogLogs(mockInstance, undefined, logger, storage)

      rejectPreload(new Error('disk read failed'))
      await new Promise((resolve) => setTimeout(resolve, 0))

      // Calls AFTER the rejection must not propagate to the caller.
      expect(() => logs.captureLog({ body: 'after-reject-1' })).not.toThrow()
      expect(() => logs.captureLog({ body: 'after-reject-2' })).not.toThrow()

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(readQueue(mockInstance)).toHaveLength(0)
    })
  })

  // Shutdown coordination: flushStorage() awaits the underlying storage's
  // waitForPersist() so AppState-triggered flushes can ensure pending writes
  // reach disk before the process may be suspended.
  describe('flushStorage', () => {
    // Real timers here — fake timers block setTimeout-based microtask flushing.
    beforeAll(() => {
      jest.useRealTimers()
    })
    afterAll(() => {
      jest.useFakeTimers()
    })

    it('awaits the underlying storage write before resolving', async () => {
      let resolveSetItem: () => void = () => {}
      const backend = {
        getItem: jest.fn((_key: string) => Promise.resolve(null)),
        setItem: jest.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveSetItem = resolve
            })
        ),
      }
      const storage = createLogsStorage(backend)
      await storage.preloadPromise

      const logs = new PostHogLogs(mockInstance, undefined, logger, storage)
      // Poke storage directly to trigger a pending async write. We don't go
      // through the full captureLog → instance.setPersistedProperty routing
      // here because the test is specifically about flushStorage awaiting
      // storage's pending persist operations.
      storage.setItem(PostHogPersistedProperty.LogsQueue, [{ record: {} as any }])

      let flushResolved = false
      const flushPromise = logs.flushStorage().then(() => {
        flushResolved = true
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(flushResolved).toBe(false)

      resolveSetItem()
      await flushPromise
      expect(flushResolved).toBe(true)
    })

    it('serializes concurrent flushStorage calls', async () => {
      // A storage whose persist is gated on an external resolver so we can
      // observe that two flushStorage calls complete in order.
      const resolvers: Array<() => void> = []
      const backend = {
        getItem: jest.fn((_key: string) => Promise.resolve(null)),
        setItem: jest.fn(
          () =>
            new Promise<void>((resolve) => {
              resolvers.push(resolve)
            })
        ),
      }
      const storage = createLogsStorage(backend)
      await storage.preloadPromise

      const logs = new PostHogLogs(mockInstance, undefined, logger, storage)

      // Trigger two separate pending writes before calling flushStorage twice.
      // Each setItem creates a pending Promise in the storage.
      storage.setItem(PostHogPersistedProperty.LogsQueue, [{ record: {} as any }])
      storage.setItem(PostHogPersistedProperty.LogsQueue, [{ record: {} as any }])

      const order: string[] = []
      const p1 = logs.flushStorage().then(() => order.push('first'))
      const p2 = logs.flushStorage().then(() => order.push('second'))

      // Neither has resolved yet — both awaiting pending setItem promises
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(order).toEqual([])

      // Resolve both pending setItems. Both flushes should now complete, but
      // the second is chained after the first — so ordering is deterministic.
      resolvers[0]()
      resolvers[1]()
      await Promise.all([p1, p2])
      expect(order).toEqual(['first', 'second'])
    })

    it('registers pending flushes with the instance for shutdown coordination', async () => {
      const backend = {
        getItem: jest.fn((_key: string) => Promise.resolve(null)),
        setItem: jest.fn(() => Promise.resolve()),
      }
      const storage = createLogsStorage(backend)
      await storage.preloadPromise

      const logs = new PostHogLogs(mockInstance, undefined, logger, storage)
      await logs.flushStorage()

      expect(mockInstance.addPendingPromise).toHaveBeenCalledWith(expect.any(Promise))
    })
  })
})
