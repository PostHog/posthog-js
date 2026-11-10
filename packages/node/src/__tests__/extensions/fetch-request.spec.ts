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

  it('maps unknown methods to _OTHER so they cannot mint span names or metric series', async () => {
    await instrumentRequest(
      posthog,
      new Request('http://localhost/x', { method: 'FOOBAR' }),
      () => new Response('ok'),
      {
        getRoute: () => '/x',
      }
    )
    expect(spans[0].name).toBe('HTTP /x')
    expect(spans[0].attributes).toMatchObject({
      'http.request.method': '_OTHER',
      'http.request.method_original': 'FOOBAR',
    })
    expect(count.mock.calls[0][2]).toMatchObject({ attributes: { 'http.request.method': '_OTHER' } })
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
    expect(spans[0].events.filter((e) => e.name === 'exception')).toHaveLength(1)
    expect(histogram.mock.calls[0][2]).toMatchObject({ attributes: { 'http.response.status_code': 500 } })
  })

  it('forwards an inbound tracestate with the traceparent', async () => {
    let tracestate: string | null | undefined
    await instrumentRequest(
      posthog,
      new Request('http://localhost/x', { headers: { traceparent: TRACEPARENT, tracestate: 'vendor=abc' } }),
      () => {
        tracestate = posthog.getActiveSpan()?.tracestate()
        return new Response('ok')
      }
    )
    expect(tracestate).toBe('vendor=abc')
  })

  it('ends the request context when the response settles', async () => {
    let release!: () => void
    const released = new Promise<void>((resolve) => (release = resolve))
    let detached: Promise<unknown> | undefined
    const response = await instrumentRequest(
      posthog,
      new Request('http://localhost/x', { headers: { 'x-posthog-session-id': 'sess-1' } }),
      () => {
        // Detached work started inside the request, still running after the response.
        detached = released.then(() => posthog.getContext())
        return new Response('ok')
      }
    )
    await response.text()
    release()
    expect(await detached).toBeUndefined()
  })

  it('keeps the request context open until a streamed body ends', async () => {
    const encoder = new TextEncoder()
    let controllerRef!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start: (c) => (controllerRef = c) })
    const response = await instrumentRequest(
      posthog,
      new Request('http://localhost/stream', { headers: { 'x-posthog-session-id': 'sess-1' } }),
      () => new Response(body, { status: 200 })
    )

    expect(histogram).toHaveBeenCalledTimes(1)
    controllerRef.enqueue(encoder.encode('chunk'))
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('chunk')
    expect(posthog.getContext()).toBeUndefined()
    controllerRef.close()
    expect((await reader.read()).done).toBe(true)
  })

  it('ends the streamed request context when the consumer cancels', async () => {
    const body = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) })
    const response = await instrumentRequest(posthog, new Request('http://localhost/stream'), () => new Response(body))
    await expect(response.body!.cancel('client went away')).resolves.toBeUndefined()
    expect(histogram).toHaveBeenCalledTimes(1)
  })

  it('hands the metrics flush to waitUntil', async () => {
    const waitUntil = vi.fn()
    posthog.options.waitUntil = waitUntil
    const flush = vi.spyOn((posthog as any)._metrics, 'flushCoalesced').mockResolvedValue(undefined)
    await instrumentRequest(posthog, new Request('http://localhost/x'), () => new Response('ok'))
    expect(flush).toHaveBeenCalled()
    expect(waitUntil).toHaveBeenCalled()
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

    it('records the error Hono caught and keeps its response', async () => {
      const boom = new Error('boom')
      const c: any = { req: { raw: new Request('http://localhost/x'), routePath: '/x' }, res: undefined }
      await posthogHonoMiddleware(posthog)(c, async () => {
        c.error = boom
        c.res = new Response('Internal Server Error', { status: 500 })
      })
      expect(c.res.status).toBe(500)
      const exceptions = spans[0].events.filter((e) => e.name === 'exception')
      expect(exceptions).toHaveLength(1)
      expect(exceptions[0].attributes).toMatchObject({ 'exception.message': 'boom' })
      expect(spans[0].status?.code).toBe('error')
    })

    it('does not record an error Hono turned into a 4xx', async () => {
      const c: any = { req: { raw: new Request('http://localhost/x'), routePath: '/x' }, res: undefined }
      await posthogHonoMiddleware(posthog)(c, async () => {
        c.error = new Error('unauthorized')
        c.res = new Response('no', { status: 401 })
      })
      expect(spans[0].events.some((e) => e.name === 'exception')).toBe(false)
      expect(spans[0].status?.code).not.toBe('error')
    })
  })
})
