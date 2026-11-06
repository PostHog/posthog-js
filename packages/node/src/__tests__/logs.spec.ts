import { PostHog, PostHogOptions } from '@/entrypoints/index.node'
import {
  DEFAULT_MAX_BATCH_RECORDS_PER_POST,
  DEFAULT_MAX_LOGS_PER_INTERVAL,
  resolveNodeLogsConfig,
} from '../logs-config'

vi.mock('../version', () => ({ version: '1.2.3' }))

const mockedFetch = vi.spyOn(globalThis, 'fetch').mockImplementation()

const options: PostHogOptions = {
  host: 'http://example.com',
  disableCompression: true,
  fetchRetryCount: 0,
  logs: { serviceName: 'test-service' },
}

describe('PostHog Node.js logs', () => {
  let posthog: PostHog

  vi.useFakeTimers()

  const create = (extra: Partial<PostHogOptions> = {}): PostHog => {
    posthog = new PostHog('TEST_API_KEY', { ...options, ...extra })
    return posthog
  }

  beforeEach(() => {
    mockedFetch.mockReset()
    mockedFetch.mockResolvedValue({ status: 200, text: async () => '' } as any)
  })

  afterEach(async () => {
    await posthog.shutdown()
  })

  const logsCalls = (): [string, any][] =>
    mockedFetch.mock.calls.filter((call) => (call[0] as string).includes('/i/v1/logs')) as [string, any][]

  const records = (): any[] =>
    logsCalls().flatMap(([, init]) =>
      JSON.parse(init.body).resourceLogs.flatMap((r: any) => r.scopeLogs.flatMap((s: any) => s.logRecords))
    )

  const attr = (record: any, key: string): any => record.attributes.find((a: any) => a.key === key)?.value

  it('sends logger calls as OTLP JSON to /i/v1/logs with the project token', async () => {
    create()
    posthog.logger.info('order placed', { order_id: 'ord_1' })
    posthog.logger.error('payment failed')
    await posthog.flush()

    expect(logsCalls()[0][0]).toBe('http://example.com/i/v1/logs?token=TEST_API_KEY')
    const body = JSON.parse(logsCalls()[0][1].body)
    expect(body.resourceLogs[0].resource.attributes).toContainEqual({
      key: 'service.name',
      value: { stringValue: 'test-service' },
    })
    const [info, error] = records()
    expect(info.body.stringValue).toBe('order placed')
    expect(info.severityText).toBe('INFO')
    expect(attr(info, 'order_id')).toEqual({ stringValue: 'ord_1' })
    expect(error.severityText).toBe('ERROR')
  })

  it('inherits the service name from traces when logs does not set one', async () => {
    create({ logs: {}, traces: { serviceName: 'checkout-api' } })
    posthog.logger.info('hello')
    await posthog.flush()
    const body = JSON.parse(logsCalls()[0][1].body)
    expect(body.resourceLogs[0].resource.attributes).toContainEqual({
      key: 'service.name',
      value: { stringValue: 'checkout-api' },
    })
  })

  it('attaches the active span ids', async () => {
    create({ traces: { serviceName: 'test-service' } })
    let ids: { traceId: string | null; spanId: string | null } | undefined
    posthog.withSpan('work', (span) => {
      ids = { traceId: span.traceId, spanId: span.spanId }
      posthog.logger.info('inside span')
    })
    posthog.logger.info('outside span')
    await posthog.flush()

    const [inside, outside] = records()
    expect(ids?.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(inside.traceId).toBe(ids?.traceId)
    expect(inside.spanId).toBe(ids?.spanId)
    expect(outside.traceId).toBeUndefined()
  })

  it('lets explicit trace ids win over the active span', async () => {
    create({ traces: { serviceName: 'test-service' } })
    const explicit = 'a'.repeat(32)
    posthog.withSpan('work', () => {
      posthog.captureLog({ body: 'x', trace_id: explicit, span_id: 'b'.repeat(16) })
    })
    await posthog.flush()
    expect(records()[0].traceId).toBe(explicit)
  })

  it('attaches the withContext distinctId and sessionId', async () => {
    create()
    posthog.withContext({ distinctId: 'user_1', sessionId: 'sess_1' }, () => {
      posthog.logger.warn('in context')
    })
    await posthog.flush()
    const [record] = records()
    expect(attr(record, 'posthogDistinctId')).toEqual({ stringValue: 'user_1' })
    expect(attr(record, 'sessionId')).toEqual({ stringValue: 'sess_1' })
  })

  it('drops records when the client is opted out', async () => {
    create()
    await posthog.optOut()
    posthog.logger.info('nope')
    await posthog.flush()
    expect(logsCalls()).toHaveLength(0)
  })

  it('flushes queued logs on shutdown', async () => {
    create()
    posthog.logger.info('last words')
    await posthog.shutdown()
    expect(records()).toHaveLength(1)
  })

  it('holds a serverless invocation open for a handler that only logs', async () => {
    const waitUntil = vi.fn()
    create({
      waitUntil,
      waitUntilDebounceMs: 50,
      flushAt: 100,
      flushInterval: 60_000,
      logs: { flushIntervalMs: 60_000 },
    })
    posthog.logger.info('only a log')

    await vi.advanceTimersByTimeAsync(100)

    expect(waitUntil).toHaveBeenCalled()
    expect(records()).toHaveLength(1)
  })

  it('leaves throttled logs alone on automatic flushes', async () => {
    mockedFetch.mockImplementation(async (url: any) =>
      String(url).includes('/i/v1/logs')
        ? ({
            status: 429,
            headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? '300' : null) },
            text: async () => '',
          } as any)
        : ({ status: 200, headers: { get: () => null }, text: async () => '' } as any)
    )
    create({ flushAt: 1, flushInterval: 1000, logs: { flushIntervalMs: 60_000 } })
    posthog.logger.info('refused')
    await posthog.flush()
    const refusals = logsCalls().length
    expect(refusals).toBeGreaterThan(0)

    // Events keep the events timer firing; logs must not ride along while the window is open.
    posthog.logger.info('queued during window')
    for (let i = 0; i < 5; i++) {
      posthog.capture({ distinctId: 'u', event: 'tick' })
      await vi.advanceTimersByTimeAsync(1000)
    }

    expect(logsCalls()).toHaveLength(refusals)
  })

  it('retries logs on the timer after an explicit flush fails', async () => {
    mockedFetch.mockImplementation(async (url: any) =>
      String(url).includes('/i/v1/logs')
        ? ({ status: 503, headers: { get: () => null }, text: async () => '' } as any)
        : ({ status: 200, headers: { get: () => null }, text: async () => '' } as any)
    )
    create({ logs: { flushIntervalMs: 1000 } })
    posthog.logger.info('retry me')
    await posthog.flush()
    expect(records()).toHaveLength(1)

    // Ingestion recovers and traffic stops: only the re-armed logs timer can deliver it.
    mockedFetch.mockResolvedValue({ status: 200, headers: { get: () => null }, text: async () => '' } as any)
    await vi.advanceTimersByTimeAsync(5000)

    expect(records()).toHaveLength(2)
  })

  it('does not let a stalled logs endpoint hold up the event drain on shutdown', async () => {
    let releaseLogs: () => void = () => {}
    mockedFetch.mockImplementation((url: any) =>
      String(url).includes('/i/v1/logs')
        ? new Promise((resolve) => {
            releaseLogs = () => resolve({ status: 200, headers: { get: () => null }, text: async () => '' } as any)
          })
        : Promise.resolve({ status: 200, headers: { get: () => null }, text: async () => '' } as any)
    )
    create({ flushAt: 100, flushInterval: 60_000 })
    posthog.logger.info('stalls')
    posthog.capture({ distinctId: 'u', event: 'must send' })

    const shutdown = posthog.shutdown(1000)
    await vi.advanceTimersByTimeAsync(10)
    const eventCalls = mockedFetch.mock.calls.filter((call) => String(call[0]).includes('/batch'))
    expect(eventCalls).toHaveLength(1)

    releaseLogs()
    await vi.advanceTimersByTimeAsync(1000)
    await shutdown
  })

  describe('config', () => {
    it.each([0, -1, 0.5, NaN, Infinity])('falls back to the default batch size for %s', (value) => {
      expect(resolveNodeLogsConfig({ maxBatchRecordsPerPost: value }).maxBatchRecordsPerPost).toBe(
        DEFAULT_MAX_BATCH_RECORDS_PER_POST
      )
    })

    it.each([[{ maxLogs: 0 }], [{ maxLogs: -5 }], [{ maxLogs: undefined }], [{ maxLogs: 10, windowMs: 0 }]])(
      'disables the rate cap for %j',
      (rateCap) => {
        const resolved = resolveNodeLogsConfig({ rateCap })
        expect(resolved.maxLogsPerInterval).toBeUndefined()
        expect(resolved.maxQueueSize).toBe(DEFAULT_MAX_LOGS_PER_INTERVAL)
      }
    )

    it('keeps a positive rate cap', () => {
      expect(resolveNodeLogsConfig({ rateCap: { maxLogs: 50 } }).maxLogsPerInterval).toBe(50)
    })
  })
})
