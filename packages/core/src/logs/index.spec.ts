import { PostHogPersistedProperty } from '../types'
import type { Logger } from '../types'
import { PostHogLogs } from './index'
import type { BufferedLogEntry, PostHogLogsConfig, ResolvedPostHogLogsConfig } from './types'

// Default resolved config for tests — mirrors what each SDK would build by
// merging user config onto its own defaults. Test-only fixture; the real
// defaults live per-SDK.
const DEFAULT_MAX_BUFFER_SIZE = 100
const resolveForTest = (partial?: PostHogLogsConfig): ResolvedPostHogLogsConfig => ({
  ...partial,
  maxBufferSize: partial?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE,
})

// Mock PostHog instance. Defaults to "already initialized" — `wrap(fn)` runs
// fn synchronously, matching `PostHogCore.wrap` after init resolves. Tests that
// need to model the cold-start window override `wrap` to defer.
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
    wrap: jest.fn((fn: () => void) => fn()),
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

// Default getContext closure for tests — reads from the mock instance the way
// a real SDK adapter would. Tests that need dynamic context override per-call.
const getContextFor = (instance: any) => (): { distinctId?: string; sessionId?: string } => ({
  distinctId: instance.getDistinctId() || undefined,
  sessionId: instance.getSessionId() || undefined,
})

describe('PostHogLogs', () => {
  let mockInstance: any
  let logger: Logger

  beforeEach(() => {
    mockInstance = createMockInstance()
    logger = createMockLogger()
  })

  it('constructs without throwing', () => {
    const logs = new PostHogLogs(mockInstance, resolveForTest(), logger, getContextFor(mockInstance))
    expect(logs).toBeDefined()
  })

  describe('captureLog', () => {
    it('writes a record to the logs queue via setPersistedProperty', () => {
      const logs = new PostHogLogs(mockInstance, resolveForTest(), logger, getContextFor(mockInstance))
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
      const logs = new PostHogLogs(mockInstance, resolveForTest(), logger, getContextFor(mockInstance))
      logs.captureLog({ body: 'oh no', level: 'error' })

      const queue = readQueue(mockInstance)
      expect(queue[0].record.severityText).toBe('ERROR')
      expect(queue[0].record.severityNumber).toBe(17)
    })

    it('defaults to INFO when no level is provided', () => {
      const logs = new PostHogLogs(mockInstance, resolveForTest(), logger, getContextFor(mockInstance))
      logs.captureLog({ body: 'hello' })

      const queue = readQueue(mockInstance)
      expect(queue[0].record.severityText).toBe('INFO')
    })

    it('auto-populates distinctId and sessionId', () => {
      const logs = new PostHogLogs(mockInstance, resolveForTest(), logger, getContextFor(mockInstance))
      logs.captureLog({ body: 'test' })

      const queue = readQueue(mockInstance)
      const attrs = Object.fromEntries(queue[0].record.attributes.map((a: any) => [a.key, a.value]))
      expect(attrs['posthogDistinctId']).toEqual({ stringValue: 'user-123' })
      expect(attrs['sessionId']).toEqual({ stringValue: 'sess-456' })
    })

    it('merges user attributes over auto-populated ones', () => {
      const logs = new PostHogLogs(mockInstance, resolveForTest(), logger, getContextFor(mockInstance))
      logs.captureLog({ body: 'test', attributes: { posthogDistinctId: 'override' } })

      const queue = readQueue(mockInstance)
      const attrs = Object.fromEntries(queue[0].record.attributes.map((a: any) => [a.key, a.value]))
      expect(attrs['posthogDistinctId']).toEqual({ stringValue: 'override' })
    })

    it('is a no-op when body is empty', () => {
      const logs = new PostHogLogs(mockInstance, resolveForTest(), logger, getContextFor(mockInstance))
      logs.captureLog({ body: '' })
      expect(readQueue(mockInstance)).toHaveLength(0)
      expect(mockInstance.setPersistedProperty).not.toHaveBeenCalled()
    })

    it('is a no-op when body is missing', () => {
      const logs = new PostHogLogs(mockInstance, resolveForTest(), logger, getContextFor(mockInstance))
      logs.captureLog({} as any)
      expect(readQueue(mockInstance)).toHaveLength(0)
    })

    it('is a no-op when optedOut is true', () => {
      const instance = createMockInstance({ optedOut: true })
      const logs = new PostHogLogs(instance, resolveForTest(), logger, getContextFor(instance))
      logs.captureLog({ body: 'should be dropped' })
      expect(readQueue(instance)).toHaveLength(0)
    })

    it('is a no-op when config.enabled is false', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ enabled: false }),
        logger,
        getContextFor(mockInstance)
      )
      logs.captureLog({ body: 'should be dropped' })
      expect(readQueue(mockInstance)).toHaveLength(0)
    })

    it('captures when config is provided with enabled undefined (defaults to true)', () => {
      const logs = new PostHogLogs(mockInstance, resolveForTest({}), logger, getContextFor(mockInstance))
      logs.captureLog({ body: 'kept' })
      expect(readQueue(mockInstance)).toHaveLength(1)
    })

    it('appends subsequent captures to the existing queue', () => {
      const logs = new PostHogLogs(mockInstance, resolveForTest(), logger, getContextFor(mockInstance))
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
        getContextFor(mockInstance)
      )

      logs.captureLog({ body: 'one' })
      logs.captureLog({ body: 'two' })
      logs.captureLog({ body: 'three' })
      logs.captureLog({ body: 'four' })

      const queue = readQueue(mockInstance)
      expect(queue).toHaveLength(3)
      expect(queue.map((e) => e.record.body.stringValue)).toEqual(['two', 'three', 'four'])
    })

    it('logs a diagnostic when evicting on overflow', () => {
      const logs = new PostHogLogs(
        mockInstance,
        resolveForTest({ maxBufferSize: 1 }),
        logger,
        getContextFor(mockInstance)
      )

      logs.captureLog({ body: 'first' })
      logs.captureLog({ body: 'second' })

      expect(logger.info).toHaveBeenCalledWith('Logs queue is full, dropping oldest record.')
    })

    it('passes trace context through to the OTLP record', () => {
      const logs = new PostHogLogs(mockInstance, resolveForTest(), logger, getContextFor(mockInstance))
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

  // captureLog routes through `_instance.wrap()` so init gating is the parent
  // SDK's responsibility. These tests exercise that contract by overriding
  // `wrap` on the mock instance.
  describe('init gating via _instance.wrap', () => {
    it('defers captures until wrap calls fn, then drains in order', () => {
      const pending: Array<() => void> = []
      const instance = createMockInstance({
        wrap: jest.fn((fn: () => void) => {
          pending.push(fn)
        }),
      })

      // Pre-existing persisted queue (as if previous session's records loaded).
      instance._store[PostHogPersistedProperty.LogsQueue] = [
        { record: { body: { stringValue: 'prior-session' } } as any },
      ]

      const logs = new PostHogLogs(instance, resolveForTest(), logger, getContextFor(instance))
      logs.captureLog({ body: 'before-init' })

      expect(instance.setPersistedProperty).not.toHaveBeenCalled()

      pending.forEach((fn) => fn())

      const queue = readQueue(instance)
      expect(queue).toHaveLength(2)
      expect(queue[0].record.body.stringValue).toBe('prior-session')
      expect(queue[1].record.body.stringValue).toBe('before-init')
    })

    it('silently drops captures when wrap never invokes fn (rejected init)', () => {
      const instance = createMockInstance({
        wrap: jest.fn(() => {
          /* simulate rejected init: fn is never called */
        }),
      })
      const logs = new PostHogLogs(instance, resolveForTest(), logger, getContextFor(instance))

      logs.captureLog({ body: 'dropped' })

      expect(readQueue(instance)).toHaveLength(0)
      expect(instance.setPersistedProperty).not.toHaveBeenCalled()
      expect(instance.wrap).toHaveBeenCalledTimes(1)
    })

    it('builds record with capture-time context even when wrap defers drain', () => {
      const pending: Array<() => void> = []
      const instance = createMockInstance({
        getDistinctId: jest.fn().mockReturnValue('user-A'),
        wrap: jest.fn((fn: () => void) => {
          pending.push(fn)
        }),
      })

      const logs = new PostHogLogs(instance, resolveForTest(), logger, getContextFor(instance))
      logs.captureLog({ body: 'captured-as-user-A' })

      instance.getDistinctId = jest.fn().mockReturnValue('user-B')

      pending.forEach((fn) => fn())

      const queue = readQueue(instance)
      expect(queue).toHaveLength(1)
      const attrs = Object.fromEntries(queue[0].record.attributes.map((a: any) => [a.key, a.value]))
      expect(attrs['posthogDistinctId']).toEqual({ stringValue: 'user-A' })
    })

    it('captureLog does not throw to the caller', () => {
      const instance = createMockInstance({
        wrap: jest.fn(() => {
          /* simulate rejected init */
        }),
      })
      const logs = new PostHogLogs(instance, resolveForTest(), logger, getContextFor(instance))

      expect(() => logs.captureLog({ body: 'after-reject-1' })).not.toThrow()
      expect(() => logs.captureLog({ body: 'after-reject-2' })).not.toThrow()
    })
  })
})
