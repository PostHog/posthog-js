import { PostHog, PostHogOptions } from '@/entrypoints/index.node'

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
})
