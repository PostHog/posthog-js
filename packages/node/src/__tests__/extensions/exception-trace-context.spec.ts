import { context, trace, TraceFlags, type Span, type SpanContext } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { PostHog } from '@/entrypoints/index.node'

const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
const spanId = '00f067aa0ba902b7'

let client: PostHog

function capture(properties?: Record<string, string>) {
  return client.prepareEventMessage({ event: '$exception', distinctId: 'user-1', properties })
}

function withSpan(spanContext: SpanContext, callback: () => ReturnType<typeof capture>) {
  return context.with(trace.setSpan(context.active(), trace.wrapSpanContext(spanContext)), callback)
}

describe('exception trace context', () => {
  const manager = new AsyncLocalStorageContextManager()

  beforeAll(() => {
    context.setGlobalContextManager(manager.enable())
    client = new PostHog('test-token', {
      host: 'https://example.test',
      fetchRetryCount: 0,
      fetch: async () => ({ status: 200, text: async () => 'ok', json: async () => ({}) }),
    })
  })

  afterAll(async () => {
    await client.shutdown()
    context.disable()
    manager.disable()
  })

  it.each([TraceFlags.SAMPLED, TraceFlags.NONE])('adds active IDs with trace flags %i', async (traceFlags) => {
    const event = await withSpan({ traceId, spanId, traceFlags }, () => capture())

    expect(event.properties).toMatchObject({ $trace_id: traceId, $span_id: spanId })
  })

  it('keeps leading zeros', async () => {
    const event = await withSpan(
      { traceId: '00000000000000000000000000000001', spanId: '0000000000000002', traceFlags: TraceFlags.NONE },
      () => capture()
    )

    expect(event.properties).toMatchObject({
      $trace_id: '00000000000000000000000000000001',
      $span_id: '0000000000000002',
    })
  })

  it.each([
    { traceId: '00000000000000000000000000000000', spanId },
    { traceId, spanId: '0000000000000000' },
  ])('omits both IDs when one ID is zero', async ({ traceId: invalidTraceId, spanId: invalidSpanId }) => {
    const event = await withSpan(
      { traceId: invalidTraceId, spanId: invalidSpanId, traceFlags: TraceFlags.SAMPLED },
      () => capture()
    )

    expect(event.properties).not.toHaveProperty('$trace_id')
    expect(event.properties).not.toHaveProperty('$span_id')
  })

  it('omits trace IDs when no span is active', async () => {
    const event = await capture()

    expect(event.properties).not.toHaveProperty('$trace_id')
    expect(event.properties).not.toHaveProperty('$span_id')
  })

  it.each([
    { $trace_id: 'custom-trace', $span_id: 'custom-span' },
    { $trace_id: 'custom-trace' },
    { $span_id: 'custom-span' },
  ])('preserves caller supplied IDs without mixing trace contexts', async (properties) => {
    const event = await withSpan({ traceId, spanId, traceFlags: TraceFlags.SAMPLED }, () => capture(properties))

    expect(
      Object.fromEntries(Object.entries(event.properties).filter(([key]) => key === '$trace_id' || key === '$span_id'))
    ).toEqual(properties)
  })

  it.each([
    { $trace_id: 'context-trace', $span_id: 'context-span' },
    { $trace_id: 'context-trace' },
    { $span_id: 'context-span' },
  ])('preserves request context IDs without mixing trace contexts', async (properties) => {
    const event = await client.withContext({ properties }, () =>
      withSpan({ traceId, spanId, traceFlags: TraceFlags.SAMPLED }, () => capture())
    )

    expect(
      Object.fromEntries(Object.entries(event.properties).filter(([key]) => key === '$trace_id' || key === '$span_id'))
    ).toEqual(properties)
  })

  it('preserves caller supplied IDs when there is no span', async () => {
    const event = await capture({ $trace_id: 'custom-trace', $span_id: 'custom-span' })

    expect(event.properties).toMatchObject({ $trace_id: 'custom-trace', $span_id: 'custom-span' })
  })

  it('does not drop an exception when reading the span fails', async () => {
    const span = {
      spanContext: () => {
        throw new Error('span failed')
      },
    } as unknown as Span
    const event = await context.with(trace.setSpan(context.active(), span), () => capture())

    expect(event.event).toBe('$exception')
    expect(event.properties).not.toHaveProperty('$trace_id')
    expect(event.properties).not.toHaveProperty('$span_id')
  })

  it('adds IDs to an exception captured through the public API', async () => {
    const events: any[] = []
    client.on('capture', (event) => events.push(event))

    await withSpan({ traceId, spanId, traceFlags: TraceFlags.SAMPLED }, async () => {
      client.captureException(new Error('boom'), 'user-1')
      await client.flush()
    })

    expect(events.find((event) => event.event === '$exception')?.properties).toMatchObject({
      $trace_id: traceId,
      $span_id: spanId,
    })
  })

  it('does not add trace IDs to other events', async () => {
    const event = await withSpan({ traceId, spanId, traceFlags: TraceFlags.SAMPLED }, () =>
      client.prepareEventMessage({ event: 'purchase', distinctId: 'user-1' })
    )

    expect(event.properties).not.toHaveProperty('$trace_id')
    expect(event.properties).not.toHaveProperty('$span_id')
  })
})
