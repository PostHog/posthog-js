import { PostHogPersistedProperty } from '../types'
import { createTestClient, PostHogCoreTestClient } from '../testing'
import type { Logger } from '../types'
import { PostHogLogs } from './index'
import type { BufferedLogEntry, ResolvedPostHogLogsConfig } from './types'

// Default resolved config for tests — mirrors what each SDK would build by
// merging user config onto its own defaults. Test-only fixture; the real
// defaults live per-SDK. Takes the resolved (flat) shape directly so tests
// can override `maxLogsPerInterval` / `rateCapWindowMs` without going through
// the public `rateCap: { maxLogs, windowMs }` wrapper.
const DEFAULT_MAX_BUFFER_SIZE = 100
const DEFAULT_FLUSH_INTERVAL_MS = 10000
const DEFAULT_MAX_BATCH_RECORDS_PER_POST = 50
const DEFAULT_RATE_CAP_WINDOW_MS = 10000
const DEFAULT_BACKGROUND_FLUSH_BUDGET_MS = 25000
const DEFAULT_TERMINATION_FLUSH_BUDGET_MS = 2000
const resolveForTest = (partial?: Partial<ResolvedPostHogLogsConfig>): ResolvedPostHogLogsConfig => ({
  ...partial,
  maxBufferSize: partial?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE,
  flushIntervalMs: partial?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
  maxBatchRecordsPerPost: partial?.maxBatchRecordsPerPost ?? DEFAULT_MAX_BATCH_RECORDS_PER_POST,
  rateCapWindowMs: partial?.rateCapWindowMs ?? DEFAULT_RATE_CAP_WINDOW_MS,
  backgroundFlushBudgetMs: DEFAULT_BACKGROUND_FLUSH_BUDGET_MS,
  terminationFlushBudgetMs: DEFAULT_TERMINATION_FLUSH_BUDGET_MS,
  // Uncapped by default so existing tests aren't affected. The rate-limit
  // describe block opts in explicitly via { maxLogsPerInterval: N }.
  maxLogsPerInterval: partial?.maxLogsPerInterval,
})

// Mock PostHog instance exposing the `PostHogCoreStateless` surface PostHogLogs
// touches. Init gating is injected separately via the onReady closure.
const createMockInstance = (overrides: Record<string, any> = {}): any => {
  const store: Record<string, any> = {}
  const instance: any = {
    optedOut: false,
    getDistinctId: vi.fn(() => 'user-123'),
    getSessionId: vi.fn(() => 'sess-456'),
    getLibraryId: vi.fn(() => 'posthog-core-tests'),
    getLibraryVersion: vi.fn(() => '0.0.0-test'),
    getPersistedProperty: vi.fn((key: string) => store[key]),
    setPersistedProperty: vi.fn((key: string, value: any) => {
      if (value === null || value === undefined) {
        delete store[key]
      } else {
        store[key] = value
      }
    }),
    _sendLogsBatch: vi.fn(() => Promise.resolve({ kind: 'ok' })),
    addPendingPromise: vi.fn(<T>(promise: Promise<T>) => promise),
    _store: store,
    ...overrides,
  }
  return instance
}

// Default onReady for tests — runs fn synchronously, matching a post-init SDK.
// Tests that model pre-init or rejected init provide their own closure.
const immediateOnReady = (fn: () => void): void => fn()

const createMockLogger = (): Logger => {
  const logger: any = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    critical: vi.fn(),
  }
  logger.createLogger = vi.fn(() => logger)
  return logger as Logger
}

const readQueue = (instance: any): BufferedLogEntry[] => {
  return (instance._store[PostHogPersistedProperty.LogsQueue] as BufferedLogEntry[] | undefined) ?? []
}

// Default getContext closure for tests — reads from the mock instance the way
// a real SDK adapter would. Tests that need dynamic context override per-call.
const getContextFor = (instance: any) => (): { distinctId?: string; sessionId?: string } => ({
  distinctId: instance.getDistinctId() || undefined,
  sessionId: instance.getSessionId() || undefined,
})

// Drives a real core host rather than a stubbed `_sendLogsBatch`, so the sender's
// error classification and the queue bookkeeping are exercised together.
describe('PostHogLogs over the core sender', () => {
  const createLogsOverCore = (status: number): { logs: PostHogLogs; client: PostHogCoreTestClient } => {
    const [client, mocks] = createTestClient('TEST_API_KEY', {
      fetchRetryCount: 0,
      preloadFeatureFlags: false,
    })
    mocks.fetch.mockResolvedValue({
      status,
      text: () => Promise.resolve('err'),
      json: () => Promise.resolve({ status: 'err' }),
    })
    const logs = new PostHogLogs(
      client,
      resolveForTest(),
      createMockLogger(),
      () => ({ distinctId: 'user-123' }),
      immediateOnReady
    )
    return { logs, client }
  }

  const queueOf = (client: PostHogCoreTestClient): BufferedLogEntry[] =>
    client.getPersistedProperty<BufferedLogEntry[]>(PostHogPersistedProperty.LogsQueue) ?? []

  it.each([408, 429, 500, 503])('keeps records queued when the endpoint answers %i', async (status) => {
    const { logs, client } = createLogsOverCore(status)
    logs.captureLog({ body: 'keep me' })

    await expect(logs.flush()).rejects.toHaveProperty('name', 'PostHogFetchHttpError')

    expect(queueOf(client)).toHaveLength(1)
  })

  it('retains and resends records after transport retries are exhausted', async () => {
    vi.useRealTimers()
    const [client, mocks] = createTestClient('TEST_API_KEY', {
      fetchRetryCount: 2,
      fetchRetryDelay: 1,
      preloadFeatureFlags: false,
    })
    const unavailableResponse = { status: 503, text: async () => 'unavailable', json: async () => ({}) }
    mocks.fetch
      .mockResolvedValueOnce(unavailableResponse)
      .mockResolvedValueOnce(unavailableResponse)
      .mockResolvedValueOnce(unavailableResponse)
      .mockResolvedValueOnce({ status: 200, text: async () => 'ok', json: async () => ({}) })
    const logs = new PostHogLogs(
      client,
      resolveForTest(),
      createMockLogger(),
      () => ({ distinctId: 'user-123' }),
      immediateOnReady
    )

    logs.captureLog({ body: 'retry me' })
    await expect(logs.flush()).rejects.toHaveProperty('name', 'PostHogFetchHttpError')
    expect(mocks.fetch).toHaveBeenCalledTimes(3)
    expect(queueOf(client)).toHaveLength(1)

    await expect(logs.flush()).resolves.toBeUndefined()
    expect(mocks.fetch).toHaveBeenCalledTimes(4)
    expect(queueOf(client)).toHaveLength(0)
  })

  it('drops the batch when the endpoint answers 401', async () => {
    const { logs, client } = createLogsOverCore(401)
    logs.captureLog({ body: 'unauthorized' })

    await expect(logs.flush()).rejects.toHaveProperty('name', 'PostHogFetchHttpError')

    expect(queueOf(client)).toHaveLength(0)
  })
})

describe('PostHogLogs', () => {
  let mockInstance: any
  let logger: Logger

  beforeEach(() => {
    mockInstance = createMockInstance()
    logger = createMockLogger()
  })

  it('constructs without throwing', () => {
    const logs = new PostHogLogs(mockInstance, resolveForTest(), logger, getContextFor(mockInstance), immediateOnReady)
    expect(logs).toBeDefined()
  })

  describe('clearQueue', () => {
    it('does not let an in-flight batch drop records captured after the clear', async () => {
      let releaseSend: (v: any) => void = () => {}
      const mockInstance = createMockInstance({
        _sendLogsBatch: vi.fn(() => new Promise((resolve) => (releaseSend = resolve))),
      })
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'before the clear' })

      const flushing = logs.flush()
      logs.clearQueue()
      logs.captureLog({ body: 'captured after the clear' })

      releaseSend({ kind: 'ok' })
      await flushing

      expect(readQueue(mockInstance).map((e) => e.record.body)).toEqual([{ stringValue: 'captured after the clear' }])
    })
  })

  describe('a 413 retry that lands after the queue is cleared', () => {
    it('does not re-send records the clear purged', async () => {
      const sentBodies: string[][] = []
      let releaseSend: (v: any) => void = () => {}
      const mockInstance = createMockInstance({
        _sendLogsBatch: vi.fn((payload: any) => {
          sentBodies.push(payload.resourceLogs[0].scopeLogs[0].logRecords.map((r: any) => r.body.stringValue))
          // Only the first send is held open; any retry resolves at once so a
          // regression fails on the assertion rather than by hanging the test.
          return sentBodies.length === 1
            ? new Promise((resolve) => (releaseSend = resolve))
            : Promise.resolve({ kind: 'ok' })
        }),
      })
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'purged one' })
      logs.captureLog({ body: 'purged two' })

      const flushing = logs.flush()
      logs.clearQueue()
      // A 413 makes `_flushInner` retry the same records with a smaller batch cap.
      releaseSend({ kind: 'too-large' })
      await flushing

      expect(sentBodies).toEqual([['purged one', 'purged two']])
    })
  })

  describe('a clear that lands between two batches of one flush', () => {
    it('still advances the batch assembled after the clear', async () => {
      const sent: string[][] = []
      let releasePersist: (() => void) | null = null
      const mockInstance = createMockInstance({
        _sendLogsBatch: vi.fn((payload: any) => {
          sent.push(payload.resourceLogs[0].scopeLogs[0].logRecords.map((r: any) => r.body.stringValue))
          return Promise.resolve({ kind: 'ok' })
        }),
      })
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBatchRecordsPerPost: 1 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady,
        () => new Promise<void>((resolve) => (releasePersist = resolve))
      )
      logs.captureLog({ body: 'a' })
      logs.captureLog({ body: 'b' })

      const flushing = logs.flush()
      // Let batch ['a'] send and park inside the persist await between batches.
      for (let i = 0; i < 10; i++) {
        await Promise.resolve()
      }
      logs.clearQueue()
      logs.captureLog({ body: 'c' })
      // Each batch installs a fresh persist gate; release whichever is pending until
      // the flush drains.
      for (let i = 0; i < 20; i++) {
        const pending = releasePersist
        releasePersist = null
        pending?.()
        await Promise.resolve()
      }
      await flushing

      expect({ sent, queue: readQueue(mockInstance).map((e) => e.record.body.stringValue) }).toEqual({
        sent: [['a'], ['c']],
        queue: [],
      })
    })
  })

  describe('reset during an in-flight flush', () => {
    it('does not let an in-flight batch drop records captured after the reset', async () => {
      let releaseSend: (v: any) => void = () => {}
      const mockInstance = createMockInstance({
        _sendLogsBatch: vi.fn(() => new Promise((resolve) => (releaseSend = resolve))),
      })
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'before the reset' })

      const flushing = logs.flush()
      logs.clearQueue()
      logs.reset()
      logs.captureLog({ body: 'captured after the reset' })

      releaseSend({ kind: 'ok' })
      await flushing

      expect(readQueue(mockInstance).map((e) => e.record.body)).toEqual([{ stringValue: 'captured after the reset' }])
    })

    it('does not let a flush started after the reset run alongside the in-flight one', async () => {
      let releaseSend: (v: any) => void = () => {}
      const mockInstance = createMockInstance({
        _sendLogsBatch: vi.fn(() => new Promise((resolve) => (releaseSend = resolve))),
      })
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'before the reset' })

      const flushing = logs.flush()
      logs.clearQueue()
      logs.reset()
      logs.captureLog({ body: 'captured after the reset' })
      const second = logs.flush()

      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      releaseSend({ kind: 'ok' })
      await flushing
      await second

      expect(readQueue(mockInstance).map((e) => e.record.body)).toEqual([{ stringValue: 'captured after the reset' }])
    })
  })

  describe('captureLog', () => {
    it('writes a record to the logs queue via setPersistedProperty', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'hello world' })

      const queue = readQueue(mockInstance)
      expect(queue).toHaveLength(1)
      expect(queue[0].record.body).toEqual({ stringValue: 'hello world' })
      expect(mockInstance.setPersistedProperty).toHaveBeenCalledWith(
        PostHogPersistedProperty.LogsQueue,
        expect.any(Array)
      )
    })

    it('stamps a record from `capturedAt` rather than live state', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      const occurredAtMs = Date.now() - 5000

      logs.captureLog(
        { body: 'buffered before identify' },
        { context: { distinctId: 'anon-1', sessionId: 'session-1' }, occurredAtMs }
      )

      const [{ record }] = readQueue(mockInstance)
      const attributes = Object.fromEntries(record.attributes.map((a: any) => [a.key, a.value.stringValue]))
      expect(attributes.posthogDistinctId).toBe('anon-1')
      expect(attributes.sessionId).toBe('session-1')
      expect(record.timeUnixNano).toBe(String(occurredAtMs) + '000000')
      expect(record.observedTimeUnixNano).toBe(record.timeUnixNano)
    })

    it('maps severity levels correctly', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'oh no', level: 'error' })

      const queue = readQueue(mockInstance)
      expect(queue[0].record.severityText).toBe('ERROR')
      expect(queue[0].record.severityNumber).toBe(17)
    })

    it('defaults to INFO when no level is provided', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'hello' })

      const queue = readQueue(mockInstance)
      expect(queue[0].record.severityText).toBe('INFO')
    })

    it('auto-populates distinctId and sessionId', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'test' })

      const queue = readQueue(mockInstance)
      const attrs = Object.fromEntries(queue[0].record.attributes.map((a: any) => [a.key, a.value]))
      expect(attrs['posthogDistinctId']).toEqual({ stringValue: 'user-123' })
      expect(attrs['sessionId']).toEqual({ stringValue: 'sess-456' })
    })

    it('merges user attributes over auto-populated ones', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'test', attributes: { posthogDistinctId: 'override' } })

      const queue = readQueue(mockInstance)
      const attrs = Object.fromEntries(queue[0].record.attributes.map((a: any) => [a.key, a.value]))
      expect(attrs['posthogDistinctId']).toEqual({ stringValue: 'override' })
    })

    it('is a no-op when body is empty', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: '' })
      expect(readQueue(mockInstance)).toHaveLength(0)
      expect(mockInstance.setPersistedProperty).not.toHaveBeenCalled()
    })

    it('is a no-op when body is missing', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({} as any)
      expect(readQueue(mockInstance)).toHaveLength(0)
    })

    it('is a no-op when optedOut is true', () => {
      const instance = createMockInstance({ optedOut: true })
      const logs = new PostHogLogs(instance, resolveForTest(), logger, getContextFor(instance), immediateOnReady)
      logs.captureLog({ body: 'should be dropped' })
      expect(readQueue(instance)).toHaveLength(0)
    })

    it('captures unconditionally — only optedOut, missing body, and beforeSend can drop', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'kept' })
      expect(readQueue(mockInstance)).toHaveLength(1)
    })

    it('appends subsequent captures to the existing queue', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
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
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBufferSize: 3 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )

      logs.captureLog({ body: 'one' })
      logs.captureLog({ body: 'two' })
      logs.captureLog({ body: 'three' })
      logs.captureLog({ body: 'four' })

      const queue = readQueue(mockInstance)
      expect(queue).toHaveLength(3)
      expect(queue.map((e) => e.record.body.stringValue)).toEqual(['two', 'three', 'four'])
    })

    it('holds a burst up to maxQueueSize, evicting only above it (flush trigger decoupled from eviction cap)', () => {
      // maxBufferSize triggers a flush at 2, but the async drain can't run mid-burst,
      // so the queue grows to the larger eviction cap (4) before the oldest is dropped.
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBufferSize: 2, maxQueueSize: 4 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )

      logs.captureLog({ body: 'one' })
      logs.captureLog({ body: 'two' })
      logs.captureLog({ body: 'three' })
      logs.captureLog({ body: 'four' })
      logs.captureLog({ body: 'five' })

      const queue = readQueue(mockInstance)
      // Grew past the flush trigger (2) to the eviction cap (4); only 'one' evicted.
      expect(queue.map((e) => e.record.body.stringValue)).toEqual(['two', 'three', 'four', 'five'])
    })

    it('clamps a maxQueueSize below maxBufferSize up to maxBufferSize (flush trigger always reachable)', () => {
      // A misconfigured eviction cap below the flush trigger would otherwise stop
      // the size-based flush from ever firing; it collapses to single-knob instead.
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBufferSize: 3, maxQueueSize: 1 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )

      logs.captureLog({ body: 'one' })
      logs.captureLog({ body: 'two' })
      logs.captureLog({ body: 'three' })
      logs.captureLog({ body: 'four' })

      const queue = readQueue(mockInstance)
      // Evicts at maxBufferSize (3), not the bogus maxQueueSize (1).
      expect(queue.map((e) => e.record.body.stringValue)).toEqual(['two', 'three', 'four'])
    })

    it('logs a diagnostic when evicting on overflow', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBufferSize: 1 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )

      logs.captureLog({ body: 'first' })
      logs.captureLog({ body: 'second' })

      expect(logger.info).toHaveBeenCalledWith('Logs queue is full, dropping oldest record.')
    })

    it('passes trace context through to the OTLP record', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
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

  // captureLog routes deferred work through the injected onReady closure. These
  // tests exercise that contract by substituting a custom onReady.
  describe('init gating via onReady', () => {
    it('defers captures until onReady runs fn, then drains in order', () => {
      const pending: Array<() => void> = []
      const defer = (fn: () => void): void => {
        pending.push(fn)
      }

      mockInstance._store[PostHogPersistedProperty.LogsQueue] = [
        { record: { body: { stringValue: 'prior-session' } } as any },
      ]

      const logs = new PostHogLogs(mockInstance, resolveForTest(), logger, getContextFor(mockInstance), defer)
      logs.captureLog({ body: 'before-init' })

      expect(mockInstance.setPersistedProperty).not.toHaveBeenCalled()

      pending.forEach((fn) => fn())

      const queue = readQueue(mockInstance)
      expect(queue).toHaveLength(2)
      expect(queue[0].record.body.stringValue).toBe('prior-session')
      expect(queue[1].record.body.stringValue).toBe('before-init')
    })

    it('silently drops captures when onReady never invokes fn (rejected init)', () => {
      const neverReady = vi.fn(() => {
        /* simulate rejected init: fn is never called */
      })
      const logs = new PostHogLogs(mockInstance, resolveForTest(), logger, getContextFor(mockInstance), neverReady)

      logs.captureLog({ body: 'dropped' })

      expect(readQueue(mockInstance)).toHaveLength(0)
      expect(mockInstance.setPersistedProperty).not.toHaveBeenCalled()
      expect(neverReady).toHaveBeenCalledTimes(1)
    })

    it('builds record with capture-time context even when onReady defers drain', () => {
      const pending: Array<() => void> = []
      const defer = (fn: () => void): void => {
        pending.push(fn)
      }
      const instance = createMockInstance({
        getDistinctId: vi.fn().mockReturnValue('user-A'),
      })

      const logs = new PostHogLogs(instance, resolveForTest(), logger, getContextFor(instance), defer)
      logs.captureLog({ body: 'captured-as-user-A' })

      instance.getDistinctId = vi.fn().mockReturnValue('user-B')

      pending.forEach((fn) => fn())

      const queue = readQueue(instance)
      expect(queue).toHaveLength(1)
      const attrs = Object.fromEntries(queue[0].record.attributes.map((a: any) => [a.key, a.value]))
      expect(attrs['posthogDistinctId']).toEqual({ stringValue: 'user-A' })
    })

    it('captureLog does not throw to the caller', () => {
      const neverReady = (): void => {
        /* simulate rejected init */
      }
      const logs = new PostHogLogs(mockInstance, resolveForTest(), logger, getContextFor(mockInstance), neverReady)

      expect(() => logs.captureLog({ body: 'after-reject-1' })).not.toThrow()
      expect(() => logs.captureLog({ body: 'after-reject-2' })).not.toThrow()
    })
  })

  describe('flush', () => {
    it('is a no-op when the queue is empty', async () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      await logs.flush()
      expect(mockInstance._sendLogsBatch).not.toHaveBeenCalled()
    })

    it('drains the queue and sends an OTLP payload with resource + scope attrs', async () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ serviceName: 'my-service', environment: 'prod', serviceVersion: '1.2.3' }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'one' })
      logs.captureLog({ body: 'two' })

      await logs.flush()

      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
      const payload = mockInstance._sendLogsBatch.mock.calls[0][0]
      const resourceAttrs = Object.fromEntries(
        payload.resourceLogs[0].resource.attributes.map((a: any) => [a.key, a.value])
      )
      expect(resourceAttrs['service.name']).toEqual({ stringValue: 'my-service' })
      expect(resourceAttrs['deployment.environment']).toEqual({ stringValue: 'prod' })
      expect(resourceAttrs['service.version']).toEqual({ stringValue: '1.2.3' })
      // OTLP-standard SDK identification — pulled from the instance's
      // getLibraryId/Version so every SDK self-identifies.
      expect(resourceAttrs['telemetry.sdk.name']).toEqual({ stringValue: 'posthog-core-tests' })
      expect(resourceAttrs['telemetry.sdk.version']).toEqual({ stringValue: '0.0.0-test' })

      const scope = payload.resourceLogs[0].scopeLogs[0].scope
      expect(scope).toEqual({ name: 'posthog-core-tests', version: '0.0.0-test' })

      const bodies = payload.resourceLogs[0].scopeLogs[0].logRecords.map((r: any) => r.body.stringValue)
      expect(bodies).toEqual(['one', 'two'])

      expect(readQueue(mockInstance)).toHaveLength(0)
    })

    it('uses the scopeName constructor param as the OTLP scope name', async () => {
      vi.useFakeTimers()
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady,
        () => Promise.resolve(),
        'console'
      )
      logs.captureLog({ body: 'test' })

      await logs.flush()

      const payload = mockInstance._sendLogsBatch.mock.calls[0][0]
      const scope = payload.resourceLogs[0].scopeLogs[0].scope
      // scopeName param overrides getLibraryId(); telemetry.sdk.name still uses getLibraryId().
      expect(scope.name).toBe('console')
      const resourceAttrs = Object.fromEntries(
        payload.resourceLogs[0].resource.attributes.map((a: any) => [a.key, a.value])
      )
      expect(resourceAttrs['telemetry.sdk.name']).toEqual({ stringValue: 'posthog-core-tests' })
      vi.useRealTimers()
    })

    it('defaults service.name to "unknown_service" when not configured', async () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'hi' })
      await logs.flush()

      const attrs = Object.fromEntries(
        mockInstance._sendLogsBatch.mock.calls[0][0].resourceLogs[0].resource.attributes.map((a: any) => [
          a.key,
          a.value,
        ])
      )
      expect(attrs['service.name']).toEqual({ stringValue: 'unknown_service' })
    })

    it('SDK-controlled telemetry.sdk.* and service.name win over user resourceAttributes', async () => {
      // Most logs backends index on these keys for routing, SDK-version
      // dashboards, and bug-correlation. Letting a stray user key clobber
      // them silently breaks ingestion attribution, so the layout puts
      // user attrs first and SDK identity attrs on top.
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({
          resourceAttributes: {
            'telemetry.sdk.name': 'my-wrapper',
            'service.name': 'user-supplied-service',
            // Non-protected user keys still pass through.
            'host.name': 'my-host',
          },
        }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'hi' })
      await logs.flush()

      const attrs = Object.fromEntries(
        mockInstance._sendLogsBatch.mock.calls[0][0].resourceLogs[0].resource.attributes.map((a: any) => [
          a.key,
          a.value,
        ])
      )
      expect(attrs['telemetry.sdk.name']).toEqual({ stringValue: 'posthog-core-tests' })
      expect(attrs['telemetry.sdk.version']).toEqual({ stringValue: '0.0.0-test' })
      expect(attrs['service.name']).toEqual({ stringValue: 'unknown_service' })
      expect(attrs['host.name']).toEqual({ stringValue: 'my-host' })
    })

    it('splits a large queue into multiple batches of maxBatchRecordsPerPost and persists after each', async () => {
      const sendOrder: number[] = []
      let persistCallsBeforeSecondSend = 0
      mockInstance._sendLogsBatch = vi.fn(async (payload: any) => {
        // Record the persist count *at the start of* send #2. The first send
        // must have already persisted its queue advance by then — otherwise a
        // crash between sends could double-send the first batch.
        if (sendOrder.length === 1) {
          persistCallsBeforeSecondSend = mockInstance.setPersistedProperty.mock.calls.length
        }
        sendOrder.push(payload.resourceLogs[0].scopeLogs[0].logRecords.length)
        return { kind: 'ok' }
      })
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBatchRecordsPerPost: 2, maxBufferSize: 10 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      for (let i = 0; i < 5; i++) {
        logs.captureLog({ body: `msg-${i}` })
      }

      await logs.flush()

      // 2 + 2 + 1 = 5 records across 3 POSTs
      expect(sendOrder).toEqual([2, 2, 1])
      // After the first send, the queue must have been persisted before the second send —
      // otherwise a crash between sends could double-send the first batch.
      expect(persistCallsBeforeSecondSend).toBeGreaterThan(5 /* enqueue writes */)
      expect(readQueue(mockInstance)).toHaveLength(0)
    })

    it('halves maxBatchRecordsPerPost and retries the same records on too-large outcome', async () => {
      const sendSizes: number[] = []
      mockInstance._sendLogsBatch = vi.fn(async (payload: any) => {
        const size = payload.resourceLogs[0].scopeLogs[0].logRecords.length
        sendSizes.push(size)
        if (sendSizes.length === 1) {
          return { kind: 'too-large' }
        }
        return { kind: 'ok' }
      })
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBatchRecordsPerPost: 4, maxBufferSize: 10 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      for (let i = 0; i < 4; i++) {
        logs.captureLog({ body: `msg-${i}` })
      }

      await logs.flush()

      // First POST: 4 records → too-large. Retry with halved cap = 2, so: 2 + 2.
      expect(sendSizes).toEqual([4, 2, 2])
      expect(readQueue(mockInstance)).toHaveLength(0)
    })

    it('ramps maxBatchRecordsPerPost back toward the configured cap after a healthy streak', async () => {
      // Reproduces the Greptile P1 concern: a one-off oversized payload
      // should not permanently degrade throughput. After a 413 halves the
      // cap, each healthy send grows it back by 1 until the configured
      // maximum is reached.
      const sendSizes: number[] = []
      mockInstance._sendLogsBatch = vi.fn(async (payload: any) => {
        const size = payload.resourceLogs[0].scopeLogs[0].logRecords.length
        sendSizes.push(size)
        // First POST is rejected as too-large; everything else succeeds.
        if (sendSizes.length === 1) {
          return { kind: 'too-large' }
        }
        return { kind: 'ok' }
      })
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBatchRecordsPerPost: 4, maxBufferSize: 100 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      // Enqueue plenty so the recovery has room to ramp.
      for (let i = 0; i < 16; i++) {
        logs.captureLog({ body: `msg-${i}` })
      }

      await logs.flush()

      // First POST: 4 records → too-large. Cap halves to 2. From there each
      // healthy send grows the cap by 1 toward the configured 4:
      //   sizes: [4 (413), 2, 3, 4, 4, ...] (the trailing 3 drains the
      //   remainder of the 16-record queue).
      expect(sendSizes).toEqual([4, 2, 3, 4, 4, 3])
      expect(readQueue(mockInstance)).toHaveLength(0)
    })

    it('drops the only record when too-large arrives on a batch of size 1', async () => {
      mockInstance._sendLogsBatch = vi.fn(() => Promise.resolve({ kind: 'too-large' }))
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBatchRecordsPerPost: 1 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'too-big' })

      await logs.flush()

      // Batch of 1 that's rejected as too-large is permanent — drop it rather
      // than spin on the same record forever.
      expect(readQueue(mockInstance)).toHaveLength(0)
    })

    it('warns explicitly when dropping a size-1 413 (visibility for the lost record)', async () => {
      mockInstance._sendLogsBatch = vi.fn(() => Promise.resolve({ kind: 'too-large' }))
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBatchRecordsPerPost: 1 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'oversized' })
      await logs.flush()

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Dropping a single log record with batch size 1')
      )
    })

    it('keeps draining the queue after a size-1 413 drop (one bad record does not stall the pipeline)', async () => {
      // First record returns too-large with size 1 (drops and warns), then
      // the rest of the queue should continue flushing normally.
      let callCount = 0
      mockInstance._sendLogsBatch = vi.fn(() => {
        callCount++
        return Promise.resolve(callCount === 1 ? { kind: 'too-large' } : { kind: 'ok' })
      })
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBatchRecordsPerPost: 1, maxBufferSize: 10 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'oversized' })
      logs.captureLog({ body: 'ok-1' })
      logs.captureLog({ body: 'ok-2' })

      await logs.flush()

      // Three sends: oversized (dropped), ok-1, ok-2. Queue is empty.
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(3)
      expect(readQueue(mockInstance)).toHaveLength(0)
    })

    it('size-1 413 retry-shrink path: starts at maxBatchRecordsPerPost, halves to 1, drops at 1', async () => {
      // Realistic flow: batch=N gets too-large, halves to N/2, halves to 1,
      // then 413 on size 1 is the permanent drop. Verifies the cap actually
      // shrinks all the way down before the size-1 drop fires.
      const sendSizes: number[] = []
      mockInstance._sendLogsBatch = vi.fn(async (payload: any) => {
        const size = payload.resourceLogs[0].scopeLogs[0].logRecords.length
        sendSizes.push(size)
        return { kind: 'too-large' }
      })
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBatchRecordsPerPost: 4, maxBufferSize: 10 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      // Single oversized record. With maxBatchRecordsPerPost=4 but only 1 record
      // in the queue, the first send is size 1 — going straight to the drop path.
      logs.captureLog({ body: 'huge' })

      await logs.flush()

      // Single send of size 1, dropped immediately (no halving rounds because
      // batch was already at 1).
      expect(sendSizes).toEqual([1])
      expect(readQueue(mockInstance)).toHaveLength(0)
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Dropping a single log record with batch size 1')
      )
    })

    it('keeps records in the queue on retry-later outcome and re-throws the carried error', async () => {
      const netErr = new Error('offline')
      mockInstance._sendLogsBatch = vi.fn(() => Promise.resolve({ kind: 'retry-later', error: netErr }))
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'queued' })

      await expect(logs.flush()).rejects.toBe(netErr)

      expect(readQueue(mockInstance)).toHaveLength(1)
    })

    it('drops the batch on fatal outcome and re-throws the carried error', async () => {
      const bogus = new Error('malformed')
      mockInstance._sendLogsBatch = vi.fn(() => Promise.resolve({ kind: 'fatal', error: bogus }))
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'doomed' })

      await expect(logs.flush()).rejects.toBe(bogus)

      expect(readQueue(mockInstance)).toHaveLength(0)
    })

    it('awaits _waitForStoragePersist between batches so a crash can’t replay records', async () => {
      const sequence: string[] = []
      mockInstance._sendLogsBatch = vi.fn(async (payload: any) => {
        sequence.push(`send:${payload.resourceLogs[0].scopeLogs[0].logRecords.length}`)
        return { kind: 'ok' }
      })
      const waitForStoragePersist = vi.fn(async () => {
        sequence.push('waitForPersist')
      })
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBatchRecordsPerPost: 2, maxBufferSize: 10 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady,
        waitForStoragePersist
      )
      for (let i = 0; i < 3; i++) {
        logs.captureLog({ body: `msg-${i}` })
      }

      await logs.flush()

      // Send 2 → waitForPersist → send 1 → waitForPersist. If the wait
      // landed out-of-order (e.g. before send), a crash mid-batch could
      // replay records on the next startup.
      expect(sequence).toEqual(['send:2', 'waitForPersist', 'send:1', 'waitForPersist'])
      expect(waitForStoragePersist).toHaveBeenCalledTimes(2)
    })

    it('serializes concurrent flush calls rather than racing them', async () => {
      let resolveFirst: (v: any) => void = () => {}
      mockInstance._sendLogsBatch = vi.fn(
        () =>
          new Promise((r) => {
            resolveFirst = r
          })
      )
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'a' })

      const first = logs.flush()
      const second = logs.flush()

      // Both callers observe the same in-flight promise, so only one POST happens.
      resolveFirst({ kind: 'ok' })
      await Promise.all([first, second])
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
    })
  })

  describe('flush triggers', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('fires a flush when the buffer hits maxBufferSize', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBufferSize: 3 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'a' })
      logs.captureLog({ body: 'b' })
      expect(mockInstance._sendLogsBatch).not.toHaveBeenCalled()

      logs.captureLog({ body: 'c' })
      // Threshold trigger fires `flush()` fire-and-forget; the call happens
      // synchronously on the hot path.
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
    })

    it('schedules one timer per idle window and fires flush on expiry', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 5000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'first' })
      logs.captureLog({ body: 'second' })
      logs.captureLog({ body: 'third' })

      // Only one timer armed, not three — subsequent enqueues inside the
      // window must not push the flush out.
      expect(mockInstance._sendLogsBatch).not.toHaveBeenCalled()
      vi.advanceTimersByTime(4999)
      expect(mockInstance._sendLogsBatch).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
    })

    it('does not schedule a timer for the threshold-triggered path', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBufferSize: 2, flushIntervalMs: 5000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'a' })
      logs.captureLog({ body: 'b' })
      // Threshold path flushed already; advancing time must not trigger a second send.
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(5000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
    })

    it('re-arms the timer after a failed flush so a retry happens without a new capture', async () => {
      // First flush fails (retry-later keeps the records); the second succeeds.
      mockInstance._sendLogsBatch = vi
        .fn()
        .mockResolvedValueOnce({ kind: 'retry-later', error: new Error('net') })
        .mockResolvedValueOnce({ kind: 'ok' })

      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 5000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'retry-me' })

      // First timer fires → flush #1 → retry-later → record retained, timer re-armed.
      await vi.advanceTimersByTimeAsync(5000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
      expect(readQueue(mockInstance)).toHaveLength(1)

      // No new capture: the re-armed timer alone fires the retry, which drains.
      await vi.advanceTimersByTimeAsync(5000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)
      expect(readQueue(mockInstance)).toHaveLength(0)
    })

    it('waits out Retry-After even when a capture re-arms the timer mid-flush', async () => {
      // The capture that lands while the send is in flight arms a timer at the
      // plain interval; the 429 then asks for far longer. The earlier timer must
      // not fire first, or the SDK sends inside the window it was told to skip.
      mockInstance._sendLogsBatch = vi.fn(async () => {
        logs.captureLog({ body: 'arrived mid-flush' })
        return { kind: 'retry-later', error: new Error('429'), retryAfterMs: 300_000 }
      })

      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 5000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'first' })

      await vi.advanceTimersByTimeAsync(5000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(6000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(300_000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)
    })

    it('does not let the size trigger send inside a Retry-After window', async () => {
      mockInstance._sendLogsBatch = vi.fn(() =>
        Promise.resolve({ kind: 'retry-later', error: new Error('429'), retryAfterMs: 300_000 })
      )
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 1000, maxBufferSize: 2 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'first' })
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      // Enough records to trip the size trigger, well inside the window.
      logs.captureLog({ body: 'second' })
      logs.captureLog({ body: 'third' })
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(300_000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)
    })

    it('does not let onReconnect send inside a Retry-After window', async () => {
      // `online` fires on every network handover; it says nothing about the
      // rate-limit window the endpoint set.
      mockInstance._sendLogsBatch = vi.fn(() =>
        Promise.resolve({ kind: 'retry-later', error: new Error('429'), retryAfterMs: 300_000 })
      )
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 1000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'first' })
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      logs.onReconnect()
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
    })

    it('flushes on reconnect once the Retry-After window has passed', async () => {
      const outcomes: any[] = [{ kind: 'retry-later', error: new Error('429'), retryAfterMs: 5000 }]
      mockInstance._sendLogsBatch = vi.fn(() => Promise.resolve(outcomes.shift() ?? { kind: 'ok' }))
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 1000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'first' })
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      // Stop just short of the deadline, then cross it without letting the
      // re-armed timer fire — otherwise the timer satisfies the assertion and
      // the test says nothing about onReconnect.
      await vi.advanceTimersByTimeAsync(4999)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
      vi.setSystemTime(Date.now() + 2)

      logs.onReconnect()
      await vi.advanceTimersByTimeAsync(1)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)
    })

    it('does not let a capture after an explicit flush send inside the window', async () => {
      // `flush()` is the lifecycle path (RN foreground/background, shutdown).
      // It leaves no timer behind, so the next capture is the one that arms
      // one — at the plain interval unless the window floors it.
      mockInstance._sendLogsBatch = vi.fn(() =>
        Promise.resolve({ kind: 'retry-later', error: new Error('429'), retryAfterMs: 300_000 })
      )
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 5000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'first' })
      await logs.flush().catch(() => {})
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      logs.captureLog({ body: 'second' })
      await vi.advanceTimersByTimeAsync(5000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(295_000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)
    })

    it('does not let a capture during an explicit flush send inside the window', async () => {
      // The sibling case covers a capture *after* the flush settles. This one
      // lands while the send is in flight, so it arms the timer at the plain
      // interval before the window exists.
      let release: (v: any) => void = () => {}
      mockInstance._sendLogsBatch = vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve
          })
      )
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 5000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'first' })
      const flushed = logs.flush().catch(() => {})
      await vi.advanceTimersByTimeAsync(0)

      logs.captureLog({ body: 'second' })
      release({ kind: 'retry-later', error: new Error('429'), retryAfterMs: 300_000 })
      await flushed
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(5000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
    })

    it('arms a timer when onReconnect lands inside the window after an explicit flush', async () => {
      // `flush()` leaves no timer behind, so returning early here without
      // arming one leaves the records with nothing scheduled at all.
      mockInstance._sendLogsBatch = vi.fn(() =>
        Promise.resolve({ kind: 'retry-later', error: new Error('429'), retryAfterMs: 300_000 })
      )
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 10_000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'first' })
      await logs.flush().catch(() => {})
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(10_000)
      logs.onReconnect()

      await vi.advanceTimersByTimeAsync(289_000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(2000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)
    })

    it('releases a record captured mid-flush once that flush closes the window', async () => {
      // The capture arms against the window that was open when it landed; the
      // outcome then closes that window, so the timer has to come back down.
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 10_000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      let sends = 0
      mockInstance._sendLogsBatch = vi.fn(async () => {
        sends += 1
        if (sends === 1) {
          return { kind: 'retry-later', error: new Error('429'), retryAfterMs: 300_000 }
        }
        await Promise.resolve()
        if (sends === 2) {
          logs.captureLog({ body: 'mid' })
        }
        return { kind: 'ok' }
      })

      logs.captureLog({ body: 'first' })
      await vi.advanceTimersByTimeAsync(10_000)
      await logs.flush().catch(() => {})

      await vi.advanceTimersByTimeAsync(10_000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(3)
    })

    it('keeps the Retry-After window when a batch is refused for size', async () => {
      // `too-large` is a verdict on the body's size — the SDK's own or a 413 —
      // so it says nothing about the endpoint's rate limit and must not end the
      // wait.
      const outcomes: any[] = [{ kind: 'retry-later', error: new Error('429'), retryAfterMs: 300_000 }]
      mockInstance._sendLogsBatch = vi.fn(() => Promise.resolve(outcomes.shift() ?? { kind: 'too-large' }))
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 1000, maxBatchRecordsPerPost: 1 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'first' })
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      // A batch of one the endpoint cannot accept: the record is dropped.
      await logs.flush()
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)

      logs.captureLog({ body: 'second' })
      logs.onReconnect()
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)
    })

    it('ends the window when an explicit flush succeeds', async () => {
      // The endpoint just accepted a batch, so the wait it asked for earlier is
      // over — the gated paths must not stay blocked for the rest of it.
      const outcomes: any[] = [{ kind: 'retry-later', error: new Error('429'), retryAfterMs: 300_000 }]
      mockInstance._sendLogsBatch = vi.fn(() => Promise.resolve(outcomes.shift() ?? { kind: 'ok' }))
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 5000, maxBufferSize: 2 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'first' })
      await vi.advanceTimersByTimeAsync(5000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      await logs.flush()
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)

      logs.captureLog({ body: 'second' })
      logs.onReconnect()
      await vi.advanceTimersByTimeAsync(1)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(3)
    })

    it('drops a Retry-After wait on reset', async () => {
      const outcomes: any[] = [{ kind: 'retry-later', error: new Error('429'), retryAfterMs: 300_000 }]
      mockInstance._sendLogsBatch = vi.fn(() => Promise.resolve(outcomes.shift() ?? { kind: 'ok' }))
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 1000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'first' })
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      // Asserted through a gated path: a plain capture would flush either way.
      logs.reset()
      logs.captureLog({ body: 'second' })
      logs.onReconnect()
      await vi.advanceTimersByTimeAsync(1)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)
    })

    it('keeps its own backoff when the endpoint asks for less', async () => {
      // A proxy answering `Retry-After: 1` must not turn the retry into a
      // one-second hot loop against an endpoint already refusing traffic.
      mockInstance._sendLogsBatch = vi.fn(() =>
        Promise.resolve({ kind: 'retry-later', error: new Error('503'), retryAfterMs: 10 })
      )
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 5000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'first' })
      await vi.advanceTimersByTimeAsync(5000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(5000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)
    })

    it('does not restart a served-out wait for a capture during the retry', async () => {
      // A deadline, not a duration. The retry's timer has already fired, so the
      // capture below arms the next one — and it sees the wait still set,
      // because the send it belongs to has not settled. Holding a duration here
      // re-arms for the whole window again and leaves the record 300s behind an
      // endpoint that has already recovered.
      let settle: ((outcome: any) => void) | undefined
      let call = 0
      mockInstance._sendLogsBatch = vi.fn(() => {
        call++
        if (call === 1) {
          return Promise.resolve({ kind: 'retry-later', error: new Error('429'), retryAfterMs: 300_000 })
        }
        return new Promise((resolve) => {
          settle = resolve
        })
      })
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 5000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'first' })
      await vi.advanceTimersByTimeAsync(5000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      // The wait elapses and the retry goes out, but hangs.
      await vi.advanceTimersByTimeAsync(300_000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)

      logs.captureLog({ body: 'second' })
      settle?.({ kind: 'ok' })
      await vi.advanceTimersByTimeAsync(0)

      // One interval, not another window.
      await vi.advanceTimersByTimeAsync(5000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(3)
    })

    it('does not let a host out-pacing the window keep it open forever', async () => {
      // RN takes flush() on every app-state transition. If each refusal slid the
      // deadline forward, the window would never elapse and the gated paths —
      // the size trigger and onReconnect — would stay suppressed indefinitely.
      mockInstance._sendLogsBatch = vi.fn(() =>
        Promise.resolve({ kind: 'retry-later', error: new Error('429'), retryAfterMs: 30_000 })
      )
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 60_000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'first' })
      await logs.flush().catch(() => {})
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      // Lifecycle flushes every 5s, well past the 30s window. Sampled rather
      // than asserted through onReconnect: whether a given moment falls inside
      // a window is timing-dependent, but it must fall outside one *sometimes*.
      let sawWindowClosed = false
      for (let i = 0; i < 12; i++) {
        await vi.advanceTimersByTimeAsync(5000)
        // Sampled before the flush: a flush that finds the window closed opens
        // a fresh one, so sampling after it would always look open.
        if ((logs as any)._retryAfter.remainingMs() === 0) {
          sawWindowClosed = true
        }
        logs.captureLog({ body: `line ${i}` })
        await logs.flush().catch(() => {})
      }
      expect(sawWindowClosed).toBe(true)
    })

    it('keeps flushing after a backward clock step', async () => {
      const outcomes: any[] = [{ kind: 'retry-later', error: new Error('429'), retryAfterMs: 60_000 }]
      mockInstance._sendLogsBatch = vi.fn(() => Promise.resolve(outcomes.shift() ?? { kind: 'ok' }))
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 1000, maxBufferSize: 2 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'first' })
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      const real = Date.now()
      vi.spyOn(Date, 'now').mockImplementation(() => real - 3_600_000)

      // A gated path: suppressed for the size of the step without the guard.
      logs.captureLog({ body: 'second' })
      logs.onReconnect()
      await vi.advanceTimersByTimeAsync(1)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)
    })

    it('ends the wait when a later failure names none', async () => {
      // 429 with a window, then a plain 503: the queue drops back to its own
      // backoff rather than waiting the old window out on every attempt.
      const outcomes: any[] = [
        { kind: 'retry-later', error: new Error('429'), retryAfterMs: 300_000 },
        { kind: 'retry-later', error: new Error('503') },
      ]
      mockInstance._sendLogsBatch = vi.fn(() => Promise.resolve(outcomes.shift() ?? { kind: 'ok' }))
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 1000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'first' })
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(300_000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)

      // Back on the plain backoff, not another 300s.
      await vi.advanceTimersByTimeAsync(4000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(3)
    })

    it('keeps flushing on the interval while captures keep arriving', async () => {
      // Every capture arms the timer. Re-arming a pending one would push the
      // flush out for as long as logs keep coming, stranding a steady stream
      // that never reaches the size trigger.
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 10_000, maxBufferSize: 100 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )

      for (let i = 0; i < 30; i++) {
        logs.captureLog({ body: `line ${i}` })
        await vi.advanceTimersByTimeAsync(2000)
      }

      expect(mockInstance._sendLogsBatch).toHaveBeenCalled()
      expect(readQueue(mockInstance)).toHaveLength(0)
    })

    it('stops re-arming once the queue is empty', async () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 5000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'one' })

      await vi.advanceTimersByTimeAsync(5000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
      expect(readQueue(mockInstance)).toHaveLength(0)

      // Successful drain leaves nothing queued, so no further timer should fire.
      await vi.advanceTimersByTimeAsync(20000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
    })

    it('backs off exponentially across consecutive failed flushes', async () => {
      // Every flush fails, so the record stays queued and the retry interval grows:
      // base (initial), base (1st retry), 2x, 4x, ...
      mockInstance._sendLogsBatch = vi.fn(() => Promise.resolve({ kind: 'retry-later', error: new Error('down') }))
      const base = 1000
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: base }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'x' })

      await vi.advanceTimersByTimeAsync(base) // initial timer → attempt #1
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(base) // 1st retry still at base → attempt #2
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)

      // Now backoff: next retry is 2x base — base alone must not fire it.
      await vi.advanceTimersByTimeAsync(base)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(base) // 2x base elapsed → attempt #3
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(3)

      // Next retry is 4x base.
      await vi.advanceTimersByTimeAsync(2 * base)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(2 * base) // 4x base elapsed → attempt #4
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(4)
    })

    it('resets the backoff after a successful flush', async () => {
      let shouldFail = true
      mockInstance._sendLogsBatch = vi.fn(() =>
        Promise.resolve(shouldFail ? { kind: 'retry-later', error: new Error('down') } : { kind: 'ok' })
      )
      const base = 1000
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: base }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'a' })

      await vi.advanceTimersByTimeAsync(base) // attempt #1 fail (failures→1)
      await vi.advanceTimersByTimeAsync(base) // attempt #2 fail (failures→2, next 2x)
      await vi.advanceTimersByTimeAsync(2 * base) // attempt #3 fail (failures→3, next 4x)
      shouldFail = false
      await vi.advanceTimersByTimeAsync(4 * base) // attempt #4 succeeds → drains + resets
      expect(readQueue(mockInstance)).toHaveLength(0)

      // A new capture flushes at the base interval again, not the backed-off one.
      ;(mockInstance._sendLogsBatch as vi.Mock).mockClear()
      logs.captureLog({ body: 'b' })
      await vi.advanceTimersByTimeAsync(base)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
    })

    it('onReconnect flushes immediately without waiting out the backoff', async () => {
      let shouldFail = true
      mockInstance._sendLogsBatch = vi.fn(() =>
        Promise.resolve(shouldFail ? { kind: 'retry-later', error: new Error('down') } : { kind: 'ok' })
      )
      const base = 1000
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: base }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'x' })

      await vi.advanceTimersByTimeAsync(base) // attempt #1 fails → record retained, backoff armed
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
      expect(readQueue(mockInstance)).toHaveLength(1)

      // Reconnect drains now — no timer advance needed.
      shouldFail = false
      logs.onReconnect()
      await vi.advanceTimersByTimeAsync(0)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)
      expect(readQueue(mockInstance)).toHaveLength(0)
    })
  })

  describe('flushWithTimeout', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('clears the timeout timer when the flush finishes first', async () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      mockInstance.setPersistedProperty(PostHogPersistedProperty.LogsQueue, [
        { record: { body: { stringValue: 'a' } } },
      ])

      await logs.flushWithTimeout(5000)

      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('shutdown', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('drains the queue and clears any armed flush timer', async () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 5000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'a' })
      // A timer is now armed — shutdown must cancel it so the process can
      // exit cleanly even if the final flush triggers a duplicate send.

      await logs.shutdown()

      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
      // Advancing past the original interval must not produce a second flush.
      vi.advanceTimersByTime(10000)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
    })

    it('clears the timeout timer when the final flush finishes first', async () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ flushIntervalMs: 5000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'a' })

      await logs.shutdown(5000)

      expect(vi.getTimerCount()).toBe(0)
    })

    it('swallows flush errors so shutdown can complete', async () => {
      mockInstance._sendLogsBatch = vi.fn(() => Promise.resolve({ kind: 'fatal', error: new Error('boom') }))
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'doomed' })

      await expect(logs.shutdown()).resolves.toBeUndefined()
    })

    it('is a no-op when the queue is empty and no timer is armed', async () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      await logs.shutdown()
      expect(mockInstance._sendLogsBatch).not.toHaveBeenCalled()
    })

    it('called twice is idempotent (second call is a no-op once queue drains)', async () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'x' })
      await logs.shutdown()
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      // Queue is empty now — a second shutdown shouldn't re-send.
      await logs.shutdown()
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
    })

    it('while a flush is in flight, the shared promise coordinates a single drain', async () => {
      let resolveFirst: (v: any) => void = () => {}
      mockInstance._sendLogsBatch = vi.fn(
        () =>
          new Promise((r) => {
            resolveFirst = r
          })
      )
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'a' })

      // Real timers only here — shutdown(timeoutMs) path uses safeSetTimeout,
      // which is incompatible with the default `vi.useFakeTimers()`.
      vi.useRealTimers()

      const flushP = logs.flush()
      const shutdownP = logs.shutdown()

      resolveFirst({ kind: 'ok' })
      await Promise.all([flushP, shutdownP])

      // Both callers joined the same in-flight flush — no double-send.
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)
    })

    it('races the final flush against timeoutMs so a stalled send does not hang shutdown', async () => {
      vi.useRealTimers()
      // _sendLogsBatch never resolves — the budget must force shutdown to return.
      mockInstance._sendLogsBatch = vi.fn(() => new Promise(() => {}))
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'stuck' })

      const start = Date.now()
      await logs.shutdown(30)
      const elapsed = Date.now() - start

      // Loose upper bound — just prove we didn't wait forever.
      expect(elapsed).toBeLessThan(500)
    })

    it('propagates a _waitForStoragePersist rejection out of flush (so callers can react)', async () => {
      const persistErr = new Error('disk is gone')
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest(),
        logger,
        getContextFor(mockInstance),
        immediateOnReady,
        // Persist fails AFTER the HTTP send succeeds — records were sent but
        // the queue-advance didn't reach disk. Surface the error so the
        // caller knows a retry on restart may re-send.
        () => Promise.reject(persistErr)
      )
      logs.captureLog({ body: 'sent-but-not-persisted' })

      await expect(logs.flush()).rejects.toBe(persistErr)
    })
  })

  describe('beforeSend hook', () => {
    // Helper that hides the constructor boilerplate so the table-driven
    // cases below can be a single line of setup each.
    const makeLogs = (beforeSend: PostHogLogsConfig['beforeSend']): PostHogLogs =>
      new PostHogLogs(
        mockInstance,
        resolveForTest({ beforeSend }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )

    // Cases that share a "captureLog → assert queue body" shape. Bespoke
    // assertions (logger expectations, throw-drops-the-record) live in their
    // own `it` blocks below — those were warping the table when forced into it.
    type Case = {
      name: string
      beforeSend: PostHogLogsConfig['beforeSend']
      input: string
      expectedQueueLen: number
      expectedBody?: string
    }
    const cases: Case[] = [
      {
        name: 'transforms body when fn returns mutated value',
        beforeSend: (r) => ({ ...r, body: r.body.toUpperCase() }),
        input: 'hello',
        expectedQueueLen: 1,
        expectedBody: 'HELLO',
      },
      {
        name: 'drops the record when fn returns null',
        beforeSend: () => null,
        input: 'silent',
        expectedQueueLen: 0,
      },
      {
        name: 'chains an array left-to-right (each fn sees previous result)',
        beforeSend: [
          (r) => ({ ...r, body: `${r.body}-1` }),
          (r) => ({ ...r, body: `${r.body}-2` }),
          (r) => ({ ...r, body: `${r.body}-3` }),
        ],
        input: 'x',
        expectedQueueLen: 1,
        expectedBody: 'x-1-2-3',
      },
      {
        name: 'short-circuits the chain when any fn returns null',
        beforeSend: [(r) => r, () => null, (r) => r],
        input: 'dropped',
        expectedQueueLen: 0,
      },
      {
        name: 'treats an empty body returned by beforeSend as a drop',
        beforeSend: (r) => ({ ...r, body: '' }),
        input: 'will-be-emptied',
        expectedQueueLen: 0,
      },
    ]

    it.each(cases)('$name', ({ beforeSend, input, expectedQueueLen, expectedBody }) => {
      const logs = makeLogs(beforeSend)
      logs.captureLog({ body: input })

      const queue = readQueue(mockInstance)
      expect(queue).toHaveLength(expectedQueueLen)
      if (expectedBody !== undefined) {
        expect(queue[0].record.body.stringValue).toBe(expectedBody)
      }
    })

    it('logs an info line when a fn returns null', () => {
      // Carved out because the table only asserts queue shape; this
      // verifies the diagnostic path that warns the user a record was
      // dropped by their filter (no other knob to surface that).
      const logs = makeLogs(() => null)
      logs.captureLog({ body: 'silent' })
      expect(logger.info).toHaveBeenCalledWith('Log was rejected in beforeSend function')
    })

    it('logs the same info line when a fn empties the body', () => {
      // An emptied body is a drop too, so it surfaces the same diagnostic as a
      // null return rather than vanishing silently.
      const logs = makeLogs((r) => ({ ...r, body: '' }))
      logs.captureLog({ body: 'will-be-emptied' })
      expect(logger.info).toHaveBeenCalledWith('Log was rejected in beforeSend function')
    })

    it('never crashes the caller when a fn throws — drops the record (fail closed) and logs', () => {
      const thrower = vi.fn(() => {
        throw new Error('bad filter')
      })
      const after = vi.fn((r: any) => ({ ...r, body: `${r.body}!` }))
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ beforeSend: [thrower, after] }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )

      expect(() => logs.captureLog({ body: 'hi' })).not.toThrow()
      expect(readQueue(mockInstance)).toHaveLength(0)
      expect(after).not.toHaveBeenCalled()
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error in beforeSend function for log:'),
        expect.any(Error)
      )
    })
  })

  describe('rate limiting', () => {
    beforeEach(() => vi.useFakeTimers({ now: 0 }))
    afterEach(() => vi.useRealTimers())

    // Tabular form for the simple in-window cap cases. Bespoke ones
    // (warn-once, window-roll reset, clock-jump backward, beforeSend
    // accounting) keep their own `it` blocks because they assert
    // multi-window or interleaving behavior.
    type CapCase = {
      name: string
      maxLogsPerInterval: number | undefined
      capturesInWindow: number
      expectedQueueLen: number
    }
    const capCases: CapCase[] = [
      {
        name: 'is uncapped when maxLogsPerInterval is undefined (default)',
        maxLogsPerInterval: undefined,
        capturesInWindow: 50,
        expectedQueueLen: 50,
      },
      {
        name: 'drops captures beyond maxLogsPerInterval within the window',
        maxLogsPerInterval: 3,
        capturesInWindow: 5,
        expectedQueueLen: 3,
      },
    ]

    it.each(capCases)('$name', ({ maxLogsPerInterval, capturesInWindow, expectedQueueLen }) => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxLogsPerInterval, rateCapWindowMs: 1000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      for (let i = 0; i < capturesInWindow; i++) {
        logs.captureLog({ body: `msg-${i}` })
      }
      expect(readQueue(mockInstance)).toHaveLength(expectedQueueLen)
    })

    it('warns exactly once per window when dropping, regardless of how many drops', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxLogsPerInterval: 2, rateCapWindowMs: 1000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      for (let i = 0; i < 10; i++) {
        logs.captureLog({ body: `msg-${i}` })
      }
      expect(logger.warn).toHaveBeenCalledTimes(1)
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('captureLog dropping logs'))
    })

    it('resets the counter when the window rolls (and warns again on next overflow)', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxLogsPerInterval: 1, rateCapWindowMs: 1000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'window-1-kept' })
      logs.captureLog({ body: 'window-1-dropped' })
      expect(readQueue(mockInstance)).toHaveLength(1)
      expect(logger.warn).toHaveBeenCalledTimes(1)

      vi.setSystemTime(1001)
      logs.captureLog({ body: 'window-2-kept' })
      logs.captureLog({ body: 'window-2-dropped' })
      expect(readQueue(mockInstance)).toHaveLength(2)
      expect(logger.warn).toHaveBeenCalledTimes(2)
    })

    it('resets the window when the clock jumps backward (NTP correction / manual clock change)', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxLogsPerInterval: 2, rateCapWindowMs: 1000 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      // Seed the window at t=5000, fill the budget.
      vi.setSystemTime(5000)
      logs.captureLog({ body: 'a' })
      logs.captureLog({ body: 'b' })
      logs.captureLog({ body: 'dropped-pre-jump' })
      expect(readQueue(mockInstance)).toHaveLength(2)

      // Clock jumps backward by 1 hour (e.g. user reset device time).
      // Without the `elapsed < 0` guard, the rate cap would stay "stuck"
      // until `now` exceeds the old window-start again — potentially
      // dropping every log for the duration of the backward jump.
      vi.setSystemTime(5000 - 60 * 60 * 1000)
      logs.captureLog({ body: 'accepted-post-jump' })

      expect(readQueue(mockInstance)).toHaveLength(3)
      expect(readQueue(mockInstance)[2].record.body.stringValue).toBe('accepted-post-jump')
    })

    it('beforeSend-rejected records do not consume the per-interval budget', () => {
      // beforeSend drops the first record; rate cap is 1 per window. The
      // SECOND capture should still succeed — if beforeSend consumed the
      // budget, it'd be dropped.
      const beforeSend = vi
        .fn()
        .mockReturnValueOnce(null)
        .mockImplementation((r: any) => r)
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxLogsPerInterval: 1, rateCapWindowMs: 1000, beforeSend }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'pre-filtered-out' })
      logs.captureLog({ body: 'should-still-fit' })

      expect(readQueue(mockInstance)).toHaveLength(1)
      expect(readQueue(mockInstance)[0].record.body.stringValue).toBe('should-still-fit')
    })
  })

  describe('concurrent capture during flush', () => {
    it('mid-flush captures land in the queue for the next cycle — not lost, not double-sent', async () => {
      let resolveSend: (v: any) => void = () => {}
      let captureDuringSend: (() => void) | null = null

      mockInstance._sendLogsBatch = vi.fn(
        () =>
          new Promise((r) => {
            if (captureDuringSend) {
              captureDuringSend()
              captureDuringSend = null
            }
            resolveSend = (v) => r(v)
          })
      )

      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBatchRecordsPerPost: 1, maxBufferSize: 10 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )
      logs.captureLog({ body: 'first' })
      captureDuringSend = (): void => {
        logs.captureLog({ body: 'mid-flight' })
      }

      const flushP = logs.flush()
      await new Promise((r) => setImmediate(r))
      resolveSend({ kind: 'ok' })
      await flushP

      // flush() uses `originalQueueLength` at entry, so a mid-flight capture
      // is intentionally left for the NEXT flush (matches events semantics).
      // The invariant we care about: not lost, not double-sent.
      expect(readQueue(mockInstance)).toHaveLength(1)
      expect(readQueue(mockInstance)[0].record.body.stringValue).toBe('mid-flight')
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      // A subsequent flush picks it up — no data lost.
      const flushP2 = logs.flush()
      await new Promise((r) => setImmediate(r))
      resolveSend({ kind: 'ok' })
      await flushP2
      expect(readQueue(mockInstance)).toHaveLength(0)
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(2)
    })
  })

  describe('queue advance under FIFO eviction', () => {
    it('keeps records captured during an in-flight flush at capacity', async () => {
      // Regression: the advance used to drop `consumed` records positionally,
      // but the FIFO cap evicts from the head while a batch is in flight, so a
      // positional drop discarded the records that arrived during the send.
      let resolveSend: (v: any) => void = () => {}
      const sendGate = new Promise((r) => {
        resolveSend = r
      })
      mockInstance._sendLogsBatch = vi.fn(() => sendGate)

      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBufferSize: 3, maxBatchRecordsPerPost: 3 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady
      )

      // Fill to capacity → triggers a background flush that awaits the gate.
      logs.captureLog({ body: 'a' })
      logs.captureLog({ body: 'b' })
      logs.captureLog({ body: 'c' })
      expect(mockInstance._sendLogsBatch).toHaveBeenCalledTimes(1)

      // While the send is in flight, two captures arrive at capacity and evict
      // the (already-sent) head records a and b.
      logs.captureLog({ body: 'd' })
      logs.captureLog({ body: 'e' })

      resolveSend({ kind: 'ok' })
      await logs.flush()

      // The sent batch [a, b, c] leaves the queue; d and e survive for next flush.
      expect(readQueue(mockInstance).map((entry) => entry.record.body.stringValue)).toEqual(['d', 'e'])
    })

    it('advances correctly across batches when eviction happens between iterations', async () => {
      // Regression: the eviction counter was reset once per flush, so an eviction
      // during the persist-await between batches got counted against the NEXT
      // batch's advance — under-dropping and re-sending an already-sent record.
      const entry = (body: string): any => ({ record: { body: { stringValue: body } } })
      mockInstance._store[PostHogPersistedProperty.LogsQueue] = [entry('a'), entry('b'), entry('c'), entry('d')]
      mockInstance._sendLogsBatch = vi.fn(() => Promise.resolve({ kind: 'ok' }))

      let persistCalls = 0
      // oxlint-disable-next-line prefer-const
      let logs: PostHogLogs
      logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBufferSize: 4, maxQueueSize: 4, maxBatchRecordsPerPost: 2 }),
        logger,
        getContextFor(mockInstance),
        immediateOnReady,
        () => {
          persistCalls++
          if (persistCalls === 1) {
            // After batch 1 [a,b] advances, captures arrive before batch 2 and
            // evict the head record 'c' at capacity.
            logs.captureLog({ body: 'e' })
            logs.captureLog({ body: 'f' })
            logs.captureLog({ body: 'g' })
          }
          return Promise.resolve()
        }
      )

      await logs.flush()

      // batch1 [a,b] dropped, 'c' evicted, batch2 [d,e] dropped — nothing sent twice.
      expect(readQueue(mockInstance).map((x) => x.record.body.stringValue)).toEqual(['f', 'g'])
    })
  })
})
