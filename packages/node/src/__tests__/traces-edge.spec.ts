import { PostHog } from '@/entrypoints/index.edge'
import type { OtlpSpan, OtlpTracesPayload } from '@posthog/types'

vi.mock('../version', () => ({ version: '1.2.3' }))

const mockedFetch = vi.spyOn(globalThis, 'fetch').mockImplementation()

describe('PostHog traces on the edge build', () => {
  const createClient = (): PostHog =>
    new PostHog('phc_test_key', {
      host: 'http://example.com',
      flushAt: 1,
      fetchRetryCount: 0,
      disableCompression: true,
      traces: { serviceName: 'edge-api' },
    })

  const sentSpans = (): OtlpSpan[] =>
    mockedFetch.mock.calls
      .filter((call) => (call[0] as string).includes('/i/v1/traces'))
      .map(([, init]) => JSON.parse((init as any).body as string) as OtlpTracesPayload)
      .flatMap((payload) => payload.resourceSpans[0].scopeSpans[0].spans)

  beforeEach(() => {
    mockedFetch.mockReset()
    mockedFetch.mockResolvedValue({ status: 200, text: async () => '{}', json: async () => ({}) } as any)
  })

  it('exports spans', async () => {
    const client = createClient()
    client.startSpan('edge-work').end()
    await client.shutdown()

    expect(sentSpans().map((span) => span.name)).toEqual(['edge-work'])
  })

  it('nests spans created synchronously inside withSpan', async () => {
    const client = createClient()
    client.withSpan('parent', () => {
      client.startSpan('child', { parent: client.getActiveSpan()! }).end()
    })
    await client.shutdown()

    const spans = sentSpans()
    const parent = spans.find((span) => span.name === 'parent')!
    const child = spans.find((span) => span.name === 'child')!
    expect(child.traceId).toBe(parent.traceId)
    expect(child.parentSpanId).toBe(parent.spanId)
  })

  it('starts a new trace for a span created after an await, as documented', async () => {
    const client = createClient()
    let parentTraceId = ''
    await client.withSpan('parent', async (span) => {
      parentTraceId = span.traceparent()!.split('-')[1]
      await Promise.resolve()
      expect(client.getActiveSpan()).toBeNull()
      client.startSpan('after-await').end()
    })
    await client.shutdown()

    const orphan = sentSpans().find((span) => span.name === 'after-await')!
    expect(orphan.traceId).not.toBe(parentTraceId)
    expect(orphan.parentSpanId).toBeUndefined()
  })

  it('still nests across an await when the parent is passed explicitly', async () => {
    const client = createClient()
    await client.withSpan('parent', async (span) => {
      await Promise.resolve()
      client.startSpan('after-await', { parent: span }).end()
    })
    await client.shutdown()

    const spans = sentSpans()
    const parent = spans.find((span) => span.name === 'parent')!
    const child = spans.find((span) => span.name === 'after-await')!
    expect(child.traceId).toBe(parent.traceId)
    expect(child.parentSpanId).toBe(parent.spanId)
  })
})
