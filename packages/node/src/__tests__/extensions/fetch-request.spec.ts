import { PostHog } from '@/entrypoints/index.node'
import { instrumentRequest, posthogHonoMiddleware } from '@/extensions/fetch-request'
import type { SpanRecord } from '@posthog/types'

vi.spyOn(globalThis, 'fetch').mockImplementation()

const TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'

describe('fetch request instrumentation', () => {
  let posthog: PostHog
  let spans: SpanRecord[]
  let histogram: ReturnType<typeof vi.spyOn>
  let count: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    spans = []
    posthog = new PostHog('phc_test_key', {
      host: 'http://example.com',
      disableCompression: true,
      fetchRetryCount: 0,
      traces: {
        serviceName: 'api',
        beforeSpanSend: (span) => {
          spans.push(span)
          return span
        },
      },
      metrics: { serviceName: 'api' },
    })
    histogram = vi.spyOn(posthog.metrics, 'histogram')
    count = vi.spyOn(posthog.metrics, 'count')
  })

  afterEach(async () => {
    await posthog.shutdown()
  })

  it('runs the handler in context from the session header and continues traceparent', async () => {
    let seen: any
    const request = new Request('http://localhost/api/users/42', {
      headers: { 'x-posthog-session-id': 'sess-1', 'x-posthog-distinct-id': 'user-1', traceparent: TRACEPARENT },
    })
    const response = await instrumentRequest(
      posthog,
      request,
      () => {
        seen = posthog.getContext()
        return new Response('ok')
      },
      { getRoute: () => '/api/users/:id' }
    )

    expect(response.status).toBe(200)
    expect(seen).toMatchObject({ sessionId: 'sess-1', distinctId: 'user-1' })
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({
      name: 'GET /api/users/:id',
      kind: 'server',
      traceId: '0af7651916cd43dd8448eb211c80319c',
      parentSpanId: 'b7ad6b7169203331',
    })
    expect(spans[0].attributes).toMatchObject({ 'http.route': '/api/users/:id', 'http.response.status_code': 200 })
    expect(spans[0].status?.code).not.toBe('error')
  })

  it('names the span after the method only when no route is known', async () => {
    await instrumentRequest(posthog, new Request('http://localhost/anything/123'), () => new Response('ok'))
    expect(spans[0].name).toBe('GET')
  })

  it('marks 5xx responses as errors', async () => {
    await instrumentRequest(
      posthog,
      new Request('http://localhost/x', { method: 'POST' }),
      () => new Response('no', { status: 503 })
    )
    expect(spans[0].status?.code).toBe('error')
    expect(count).toHaveBeenCalledWith(
      'http.server.request.count',
      1,
      expect.objectContaining({
        attributes: expect.objectContaining({ 'http.response.status_code': 503, 'http.request.method': 'POST' }),
      })
    )
  })

  it('does not mark 4xx responses as errors', async () => {
    await instrumentRequest(posthog, new Request('http://localhost/x'), () => new Response('nope', { status: 404 }))
    expect(spans[0].status?.code).not.toBe('error')
  })

  it('records the duration histogram in seconds and the request count', async () => {
    await instrumentRequest(posthog, new Request('http://localhost/x'), () => new Response('ok'), {
      getRoute: () => '/x',
    })
    expect(histogram).toHaveBeenCalledTimes(1)
    const [name, value, opts] = histogram.mock.calls[0] as any[]
    expect(name).toBe('http.server.request.duration')
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThan(5)
    expect(opts).toMatchObject({
      unit: 's',
      attributes: { 'http.request.method': 'GET', 'http.route': '/x', 'http.response.status_code': 200 },
    })
    expect(count).toHaveBeenCalledWith('http.server.request.count', 1, expect.anything())
  })

  it('records a thrown error as a 500 and rethrows it', async () => {
    const boom = new Error('boom')
    await expect(
      instrumentRequest(posthog, new Request('http://localhost/x'), () => {
        throw boom
      })
    ).rejects.toBe(boom)
    expect(spans[0].status?.code).toBe('error')
    expect(spans[0].events.some((e) => e.name === 'exception')).toBe(true)
    expect(histogram.mock.calls[0][2]).toMatchObject({ attributes: { 'http.response.status_code': 500 } })
  })

  it('skips ignored requests', async () => {
    const response = await instrumentRequest(
      posthog,
      new Request('http://localhost/health'),
      () => new Response('ok'),
      {
        ignore: (r) => new URL(r.url).pathname === '/health',
      }
    )
    expect(response.status).toBe(200)
    expect(spans).toHaveLength(0)
    expect(histogram).not.toHaveBeenCalled()
  })

  it('survives a throwing route resolver', async () => {
    const response = await instrumentRequest(posthog, new Request('http://localhost/x'), () => new Response('ok'), {
      getRoute: () => {
        throw new Error('bad')
      },
    })
    expect(response.status).toBe(200)
    expect(spans[0].name).toBe('GET')
  })

  describe('posthogHonoMiddleware', () => {
    it('names the span by the route matched after next()', async () => {
      const c: any = {
        req: {
          raw: new Request('http://localhost/api/dashboards/abc', { headers: { 'x-posthog-session-id': 's2' } }),
          routePath: '/*',
        },
        res: undefined,
      }
      let sessionId: string | undefined
      await posthogHonoMiddleware(posthog)(c, async () => {
        sessionId = posthog.getContext()?.sessionId
        c.req.routePath = '/api/dashboards/:uid'
        c.res = new Response('ok', { status: 500 })
      })
      expect(sessionId).toBe('s2')
      expect(spans[0].name).toBe('GET /api/dashboards/:uid')
      expect(spans[0].status?.code).toBe('error')
    })
  })
})
