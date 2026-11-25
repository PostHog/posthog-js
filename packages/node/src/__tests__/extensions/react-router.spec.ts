import { createRequestHandler, data, type ServerBuild } from 'react-router'
import { PostHog } from '@/entrypoints/index.node'
import { sentEvents as sentEventsFrom, v1Response } from '../utils'
import { createReactRouterErrorHandler } from '@/extensions/react-router'

vi.mock('../../version', () => ({ version: '1.2.3' }))

const mockedFetch = vi.spyOn(globalThis, 'fetch').mockImplementation()

const createPostHog = (options: Record<string, any> = {}): PostHog =>
  new PostHog('TEST_API_KEY', {
    host: 'http://example.com',
    fetchRetryCount: 0,
    disableCompression: true,
    flushAt: 1,
    flushInterval: 0,
    ...options,
  })

const sentEvents = async (posthog: PostHog): Promise<any[]> => {
  await posthog.shutdown()
  return sentEventsFrom(mockedFetch as any)
}

const cookieFor = (state: Record<string, unknown>): string =>
  `ph_TEST_API_KEY_posthog=${encodeURIComponent(JSON.stringify(state))}`

const liveSession = (id: string): [number, string, number] => [Date.now(), id, Date.now()]

const routeErrorResponse = (status: number, internal = false, error?: Error): object => ({
  status,
  statusText: 'Error',
  internal,
  data: error ? error.toString() : 'Not found',
  ...(internal ? { error: new Error(`No route matches URL "/x"`) } : error ? { error } : {}),
})

let posthog: PostHog
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  mockedFetch.mockClear()
  mockedFetch.mockImplementation(() => Promise.resolve(v1Response()) as any)
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(async () => {
  consoleError.mockRestore()
  await posthog?.shutdown()
})

describe('createReactRouterErrorHandler', () => {
  it('captures with the tracing headers, request properties, an unhandled mechanism and its source', async () => {
    posthog = createPostHog()
    const request = new Request('https://shop.example/products/SKU-1?token=secret', {
      headers: {
        'x-posthog-distinct-id': ' user-1 ',
        'x-posthog-session-id': 'session-1',
        'user-agent': 'TestAgent/1.0',
        'x-forwarded-for': '203.0.113.7',
      },
    })

    await createReactRouterErrorHandler(posthog)(new Error('Stock ledger out of balance'), { request })
    const [event] = await sentEvents(posthog)

    expect(event.event).toBe('$exception')
    expect(event.distinct_id).toBe('user-1')
    expect(event.properties).toMatchObject({
      $session_id: 'session-1',
      $current_url: 'https://shop.example/products/SKU-1',
      $request_method: 'GET',
      $request_path: '/products/SKU-1',
      $user_agent: 'TestAgent/1.0',
      $exception_source: 'react_router.handle_error',
    })
    expect(event.properties).not.toHaveProperty('$ip')
    expect(event.properties.$exception_list[0].mechanism).toMatchObject({ type: 'middleware', handled: false })
    expect(JSON.stringify(event.properties)).not.toContain('secret')
  })

  it.each([
    ['a document request', 'https://shop.example/products/SKU-1', 'https://shop.example/products/SKU-1'],
    [
      'a data request',
      'https://shop.example/products/SKU-1.data?_routes=routes%2Fproduct',
      'https://shop.example/products/SKU-1',
    ],
    ['the index data request', 'https://shop.example/_root.data', 'https://shop.example/'],
    ['the index data request under a basename', 'https://shop.example/app/_root.data', 'https://shop.example/app'],
    ['a trailing-slash data request', 'https://shop.example/products/_.data', 'https://shop.example/products/'],
    ['the trailing-slash index data request', 'https://shop.example/_.data', 'https://shop.example/'],
  ])('reports the page URL for %s', async (_, url, pageUrl) => {
    posthog = createPostHog()

    await createReactRouterErrorHandler(posthog)(new Error('Reorder failed'), { request: new Request(url) })
    const [event] = await sentEvents(posthog)

    expect(event.properties.$current_url).toBe(pageUrl)
    expect(event.properties.$request_path).toBe(new URL(pageUrl).pathname)
  })

  it.each([
    ['a thrown data() response', routeErrorResponse(503)],
    ['the router 404 for an unknown URL', routeErrorResponse(404, true)],
    ['the router 405 for a missing action', routeErrorResponse(405, true)],
  ])('does not capture %s', async (_, error) => {
    posthog = createPostHog()
    await createReactRouterErrorHandler(posthog)(error, { request: new Request('https://shop.example/x') })

    expect(await sentEvents(posthog)).toEqual([])
  })

  it('captures the error inside a data() response a middleware threw, and passes it to shouldCapture', async () => {
    posthog = createPostHog()
    const error = new Error('Inventory service unavailable')
    const shouldCapture = vi.fn(() => true)

    await createReactRouterErrorHandler(posthog, { shouldCapture })(routeErrorResponse(503, false, error), {
      request: new Request('https://shop.example/x'),
    })
    const [event] = await sentEvents(posthog)

    expect(shouldCapture).toHaveBeenCalledWith(error, expect.anything())
    expect(event.properties.$exception_list[0].value).toBe('Inventory service unavailable')
  })

  it('does not capture or log errors of an aborted request', async () => {
    posthog = createPostHog()
    const controller = new AbortController()
    controller.abort()
    const request = new Request('https://shop.example/slow', { signal: controller.signal })

    await createReactRouterErrorHandler(posthog)(new Error('The operation was aborted'), { request })

    expect(await sentEvents(posthog)).toEqual([])
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('logs like React Router by default, and calls handleError instead when given', async () => {
    posthog = createPostHog()
    const request = new Request('https://shop.example/x')
    const notFound = routeErrorResponse(404, true) as { error: Error }

    await createReactRouterErrorHandler(posthog)(notFound, { request })
    expect(consoleError).toHaveBeenCalledWith(notFound.error)

    const handleError = vi.fn()
    const error = new Error('Recount rejected')
    await createReactRouterErrorHandler(posthog, { handleError })(error, { request })
    expect(handleError).toHaveBeenCalledWith(error, { request })
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  it('skips an error shouldCapture rejects, and still logs it', async () => {
    posthog = createPostHog()
    const shouldCapture = vi.fn(() => false)
    const error = new Error('Cross-origin action')
    const args = { request: new Request('https://shop.example/x', { method: 'POST' }) }

    await createReactRouterErrorHandler(posthog, { shouldCapture })(error, args)

    expect(shouldCapture).toHaveBeenCalledWith(error, args)
    expect(consoleError).toHaveBeenCalledWith(error)
    expect(await sentEvents(posthog)).toEqual([])
  })

  it('captures an error once per request across hooks and handler instances', async () => {
    posthog = createPostHog()
    const request = new Request('https://shop.example/reports/forecast')
    const error = new Error('Demand forecast diverged')
    const frozen = Object.freeze(new Error('Frozen ledger'))

    await createReactRouterErrorHandler(posthog)(error, { request })
    await createReactRouterErrorHandler(posthog)(error, { request })
    await createReactRouterErrorHandler(posthog)(frozen, { request })
    await createReactRouterErrorHandler(posthog)(frozen, { request })

    expect(await sentEvents(posthog)).toHaveLength(2)
    expect(Object.keys(error)).not.toContain('__posthog_previously_captured_error')
  })

  it('captures the same error object again for a later request and for another project', async () => {
    posthog = createPostHog()
    const otherProject = createPostHog({ host: 'http://other.example' })
    // A cached rejected promise hands every request the same error.
    const error = new Error('Warehouse connection refused')
    const first = new Request('https://shop.example/a')

    await createReactRouterErrorHandler(posthog)(error, { request: first })
    await createReactRouterErrorHandler(otherProject)(error, { request: first })
    await createReactRouterErrorHandler(posthog)(error, { request: new Request('https://shop.example/b') })
    await otherProject.shutdown()
    await posthog.shutdown()
    const hosts = mockedFetch.mock.calls.flatMap(([url, init]: any) =>
      sentEventsFrom({ mock: { calls: [[url, init]] } } as any).map(() => new URL(url).host)
    )

    expect(hosts.sort()).toEqual(['example.com', 'example.com', 'other.example'])
  })

  it('resolves once the event is queued and hands the capture to waitUntil', async () => {
    const waitUntil = vi.fn()
    posthog = createPostHog({ waitUntil, flushAt: 20 })

    const result = createReactRouterErrorHandler(posthog)(new Error('Label printer offline'), {
      request: new Request('https://shop.example/api/label'),
    })

    expect(result).toBeInstanceOf(Promise)
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise))
    await result
    expect(await sentEvents(posthog)).toHaveLength(1)
  })
})

describe('createReactRouterErrorHandler identity', () => {
  const capture = (error: Error, request: Request): Promise<void> =>
    createReactRouterErrorHandler(posthog)(error, { request })

  it('links an identified visitor through the cookie when readPostHogCookie is on', async () => {
    posthog = createPostHog({ readPostHogCookie: true })
    const request = new Request('https://shop.example/reports', {
      headers: { cookie: cookieFor({ distinct_id: 'user-2', $user_state: 'identified', $sesid: liveSession('s-2') }) },
    })

    await capture(new Error('Report range not supported'), request)
    const [event] = await sentEvents(posthog)

    expect(event.distinct_id).toBe('user-2')
    expect(event.properties.$session_id).toBe('s-2')
    expect(event.properties).not.toHaveProperty('$process_person_profile')
  })

  it('links an anonymous visitor through the cookie and keeps them personless', async () => {
    posthog = createPostHog({ readPostHogCookie: true })
    const request = new Request('https://shop.example/reports', {
      headers: { cookie: cookieFor({ distinct_id: 'anon-1', $user_state: 'anonymous', $sesid: liveSession('s-1') }) },
    })

    await capture(new Error('Report range not supported'), request)
    const [event] = await sentEvents(posthog)

    expect(event.distinct_id).toBe('anon-1')
    expect(event.properties.$session_id).toBe('s-1')
    expect(event.properties.$process_person_profile).toBe(false)
  })

  it('drops a stale cookie session', async () => {
    posthog = createPostHog({ readPostHogCookie: true })
    const old = Date.now() - 31 * 60 * 1000
    const request = new Request('https://shop.example/stores/x', {
      headers: { cookie: cookieFor({ distinct_id: 'anon-1', $sesid: [old, 'stale-session', old] }) },
    })

    await capture(new Error('Tenant lookup failed'), request)
    const [event] = await sentEvents(posthog)

    expect(event.distinct_id).toBe('anon-1')
    expect(event.properties.$session_id).toBeUndefined()
  })

  it('ignores the cookie when readPostHogCookie is off (the default)', async () => {
    posthog = createPostHog()
    const request = new Request('https://shop.example/', {
      headers: { cookie: cookieFor({ distinct_id: 'user-3', $user_state: 'identified', $sesid: liveSession('s-3') }) },
    })

    await capture(new Error('Home failed'), request)
    const [event] = await sentEvents(posthog)

    expect(event.distinct_id).not.toBe('user-3')
    expect(event.properties.$session_id).toBeUndefined()
  })

  it('takes the active context first, then the tracing headers, then the cookie', async () => {
    posthog = createPostHog({ readPostHogCookie: true })
    const cookie = cookieFor({ distinct_id: 'cookie-user', $user_state: 'identified', $sesid: liveSession('cookie-s') })
    const withHeaders = new Request('https://shop.example/', {
      headers: { 'x-posthog-distinct-id': 'header-user', 'x-posthog-session-id': 'header-s', cookie },
    })
    const cookieOnly = new Request('https://shop.example/', { headers: { cookie } })

    await posthog.withContext({ distinctId: 'context-user', sessionId: 'context-s' }, () =>
      capture(new Error('b'), withHeaders)
    )
    await posthog.withContext({ distinctId: 'context-user' }, () => capture(new Error('c'), withHeaders))
    await posthog.withContext({ distinctId: 'context-user' }, () => capture(new Error('d'), cookieOnly))
    await capture(new Error('e'), withHeaders)
    await capture(new Error('f'), cookieOnly)
    const events = await sentEvents(posthog)

    expect(events.map((e) => [e.distinct_id, e.properties.$session_id])).toEqual([
      ['context-user', 'context-s'],
      ['context-user', 'header-s'],
      ['context-user', 'cookie-s'],
      ['header-user', 'header-s'],
      ['cookie-user', 'cookie-s'],
    ])
  })

  const identifiedCookie = (): string =>
    cookieFor({ distinct_id: 'user-4', $user_state: 'identified', $sesid: liveSession('s-4') })

  it.each([
    [
      'the consent cookie opts out',
      { readPostHogCookie: true },
      () => `${identifiedCookie()}; __ph_opt_in_out_TEST_API_KEY=0`,
    ],
    [
      'opt-out is the default and the visitor never opted in',
      { readPostHogCookie: { optOutCapturingByDefault: true } },
      identifiedCookie,
    ],
    [
      'opt-out is the default and the request has no Cookie header',
      { readPostHogCookie: { optOutCapturingByDefault: true } },
      () => undefined,
    ],
  ])('keeps no person, session or user agent when %s', async (_, options, cookie) => {
    posthog = createPostHog(options)
    const cookieHeader = cookie()
    const request = new Request('https://shop.example/checkout', {
      headers: {
        'x-posthog-distinct-id': 'header-user',
        'x-posthog-session-id': 'header-s',
        'user-agent': 'TestAgent/1.0',
        ...(cookieHeader !== undefined ? { cookie: cookieHeader } : {}),
      },
    })

    await capture(new Error('Payment declined'), request)
    await posthog.withContext(
      {
        distinctId: 'context-user',
        sessionId: 'context-s',
        properties: { $user_agent: 'Ctx/1.0', $ip: '203.0.113.9' },
      },
      () => capture(new Error('Card expired'), request)
    )
    const [event, inContext] = await sentEvents(posthog)

    for (const optedOut of [event, inContext]) {
      expect(['header-user', 'user-4', 'context-user']).not.toContain(optedOut.distinct_id)
      expect(optedOut.properties).not.toHaveProperty('$session_id')
      expect(optedOut.properties).not.toHaveProperty('$user_agent')
      expect(optedOut.properties).not.toHaveProperty('$ip')
      expect(optedOut.properties.$current_url).toBe('https://shop.example/checkout')
    }
  })

  it('keeps an anonymous visitor personless over registered and context options', async () => {
    posthog = createPostHog({ readPostHogCookie: true })
    posthog.registerOptions({ process_person_profile: true })
    const request = new Request('https://shop.example/reports', {
      headers: { cookie: cookieFor({ distinct_id: 'anon-2', $user_state: 'anonymous', $sesid: liveSession('s-2') }) },
    })

    await capture(new Error('Export timed out'), request)
    await posthog.withContext({ options: { process_person_profile: true } }, () =>
      capture(new Error('Export quota reached'), request)
    )
    const events = await sentEvents(posthog)

    expect(events.map((e) => [e.distinct_id, e.properties.$process_person_profile])).toEqual([
      ['anon-2', false],
      ['anon-2', false],
    ])
  })

  it('keeps flushing other events when building an exception event fails', async () => {
    posthog = createPostHog({ flushAt: 20 })
    vi.spyOn(posthog, 'getErrorPropertiesBuilder').mockReturnValue({
      buildFromUnknown: () => {
        throw new Error('builder broke')
      },
    } as any)

    await capture(new Error('Unbuildable'), new Request('https://shop.example/'))
    posthog.capture({ distinctId: 'user-5', event: 'order_placed' })

    expect((await sentEvents(posthog)).map((e) => e.event)).toEqual(['order_placed'])
  })
})

describe('createReactRouterErrorHandler in React Router 7 request handling', () => {
  const routeAssets = (id: string, parentId: string | undefined, path: string | undefined, index?: boolean) => ({
    id,
    parentId,
    path,
    index,
    module: `/${id}.js`,
    hasAction: false,
    hasLoader: true,
    hasClientAction: false,
    hasClientLoader: false,
    hasClientMiddleware: false,
    hasErrorBoundary: id === 'root',
  })

  const buildWith = (
    handleError: ServerBuild['entry']['module']['handleError'],
    middleware?: (() => unknown)[]
  ): ServerBuild => {
    const component = (): null => null
    return {
      entry: {
        module: {
          default: (_request: Request, status: number) => new Response('<html></html>', { status }),
          handleError,
        },
      },
      routes: {
        root: {
          id: 'root',
          path: '',
          module: {
            default: component,
            ErrorBoundary: component,
            loader: () => null,
            ...(middleware && { middleware }),
          },
        },
        'routes/home': {
          id: 'routes/home',
          parentId: 'root',
          index: true,
          module: {
            default: component,
            loader: () => {
              throw new Error('Home feed failed')
            },
          },
        },
        'routes/product': {
          id: 'routes/product',
          parentId: 'root',
          path: 'products/:sku',
          module: {
            default: component,
            loader: ({ params }: { params: { sku?: string } }) => {
              if (params.sku === 'gone') {
                throw data('Discontinued', { status: 503 })
              }
              throw new Error(`Stock lookup failed for ${params.sku}`)
            },
          },
        },
        'routes/api.label': {
          id: 'routes/api.label',
          parentId: 'root',
          path: 'api/label',
          module: {
            loader: () => {
              throw new Error('Label template missing')
            },
          },
        },
      },
      assets: {
        entry: { imports: [], module: '/entry.client.js' },
        routes: {
          root: routeAssets('root', undefined, ''),
          'routes/home': routeAssets('routes/home', 'root', undefined, true),
          'routes/product': routeAssets('routes/product', 'root', 'products/:sku'),
          'routes/api.label': routeAssets('routes/api.label', 'root', 'api/label'),
        },
        url: '/manifest.js',
        version: '1',
      },
      publicPath: '/',
      assetsBuildDirectory: 'build/client',
      future: middleware ? { v8_middleware: true } : {},
      ssr: true,
      isSpaMode: false,
      prerender: [],
      routeDiscovery: { mode: 'lazy', manifestPath: '/__manifest' },
    } as unknown as ServerBuild
  }

  it.each([
    ['a document request', '/products/SKU-1', 'https://shop.example/products/SKU-1', 'Stock lookup failed for SKU-1'],
    [
      'a data request',
      '/products/SKU-1.data?_routes=routes%2Fproduct',
      'https://shop.example/products/SKU-1',
      'Stock lookup failed for SKU-1',
    ],
    ['the index data request', '/_root.data', 'https://shop.example/', 'Home feed failed'],
    ['a resource route request', '/api/label', 'https://shop.example/api/label', 'Label template missing'],
  ])('captures %s once, with the page URL', async (_, path, pageUrl, message) => {
    posthog = createPostHog()
    const handler = createRequestHandler(buildWith(createReactRouterErrorHandler(posthog)), 'production')

    await handler(new Request(`https://shop.example${path}`))
    const events = await sentEvents(posthog)

    expect(events).toHaveLength(1)
    expect(events[0].properties.$exception_list[0].value).toBe(message)
    expect(events[0].properties.$current_url).toBe(pageUrl)
  })

  it.each([
    ['an unknown URL', '/nope'],
    ['a thrown 5xx data() response', '/products/gone'],
    ['a thrown 5xx data() response on a data request', '/products/gone.data'],
  ])('does not capture %s', async (_, path) => {
    posthog = createPostHog()
    const handler = createRequestHandler(buildWith(createReactRouterErrorHandler(posthog)), 'production')

    await handler(new Request(`https://shop.example${path}`))

    expect(await sentEvents(posthog)).toEqual([])
  })

  it.each([
    ['a document request', '/products/SKU-1'],
    ['a data request', '/products/SKU-1.data'],
  ])('captures the error inside a data() response a middleware threw, for %s', async (_, path) => {
    posthog = createPostHog()
    const middleware = [
      (): never => {
        throw data(new Error('Session store unavailable'), { status: 503 })
      },
    ]
    const handler = createRequestHandler(buildWith(createReactRouterErrorHandler(posthog), middleware), 'production')

    await handler(new Request(`https://shop.example${path}`))
    const events = await sentEvents(posthog)

    expect(events.map((e) => e.properties.$exception_list[0].value)).toEqual(['Session store unavailable'])
  })

  it('does not capture a data() response without an error that a middleware threw', async () => {
    posthog = createPostHog()
    const middleware = [
      (): never => {
        throw data('Region blocked', { status: 403 })
      },
    ]
    const handler = createRequestHandler(buildWith(createReactRouterErrorHandler(posthog), middleware), 'production')

    await handler(new Request('https://shop.example/products/SKU-1'))

    expect(await sentEvents(posthog)).toEqual([])
  })
})
