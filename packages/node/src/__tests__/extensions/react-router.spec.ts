import { PostHog } from '@/entrypoints/index.node'
import { sentEvents as sentEventsFrom, v1Response } from '../utils'
import { createReactRouterErrorHandler } from '@/extensions/react-router'
import { captureRequestException, getRequestExceptionContext } from '@/extensions/request-exception'

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

const routeErrorResponse = (status: number, internal = false): object => ({
  status,
  statusText: status === 404 ? 'Not Found' : 'Method Not Allowed',
  internal,
  data: 'Not found',
  ...(internal ? { error: new Error(`No route matches URL "/x"`) } : {}),
})

describe('React Router error handler', () => {
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

  it('captures a loader error with the tracing headers, request properties and an unhandled mechanism', async () => {
    posthog = createPostHog()
    const handleError = createReactRouterErrorHandler(posthog)
    const request = new Request('https://shop.example/products/SKU-1?token=secret', {
      headers: {
        'x-posthog-distinct-id': ' user-1 ',
        'x-posthog-session-id': 'session-1',
        'user-agent': 'TestAgent/1.0',
        'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      },
    })

    handleError(new Error('Stock ledger out of balance'), { request })
    const [event] = await sentEvents(posthog)

    expect(event.event).toBe('$exception')
    expect(event.distinct_id).toBe('user-1')
    expect(event.properties).toMatchObject({
      $session_id: 'session-1',
      $current_url: 'https://shop.example/products/SKU-1',
      $request_method: 'GET',
      $request_path: '/products/SKU-1',
      $user_agent: 'TestAgent/1.0',
      $ip: '203.0.113.7',
    })
    expect(event.properties.$exception_list[0].mechanism).toMatchObject({ type: 'middleware', handled: false })
    expect(JSON.stringify(event.properties)).not.toContain('secret')
  })

  it('falls back to the posthog-js cookie when readPostHogCookie is on and the request has no tracing header', async () => {
    posthog = createPostHog({ readPostHogCookie: true })
    const now = Date.now()
    const request = new Request('https://shop.example/reports', {
      headers: {
        cookie: cookieFor({ distinct_id: 'user-2', $user_state: 'identified', $sesid: [now, 'session-2', now] }),
      },
    })

    createReactRouterErrorHandler(posthog)(new Error('Report range not supported'), { request })
    const [event] = await sentEvents(posthog)

    expect(event.distinct_id).toBe('user-2')
    expect(event.properties.$session_id).toBe('session-2')
  })

  it('prefers the tracing headers over the cookie', async () => {
    posthog = createPostHog({ readPostHogCookie: true })
    const now = Date.now()
    const request = new Request('https://shop.example/api/label', {
      headers: {
        'x-posthog-distinct-id': 'header-user',
        'x-posthog-session-id': 'header-session',
        cookie: cookieFor({
          distinct_id: 'cookie-user',
          $user_state: 'identified',
          $sesid: [now, 'cookie-session', now],
        }),
      },
    })

    createReactRouterErrorHandler(posthog)(new Error('Label template missing'), { request })
    const [event] = await sentEvents(posthog)

    expect(event.distinct_id).toBe('header-user')
    expect(event.properties.$session_id).toBe('header-session')
  })

  it('drops a stale cookie session and keeps an anonymous cookie visitor personless', async () => {
    posthog = createPostHog({ readPostHogCookie: true })
    const old = Date.now() - 31 * 60 * 1000
    const request = new Request('https://shop.example/stores/x', {
      headers: { cookie: cookieFor({ distinct_id: 'anon-1', $sesid: [old, 'stale-session', old] }) },
    })

    createReactRouterErrorHandler(posthog)(new Error('Tenant lookup failed'), { request })
    const [event] = await sentEvents(posthog)

    expect(event.distinct_id).not.toBe('anon-1')
    expect(event.properties.$session_id).toBeUndefined()
  })

  it('ignores the cookie when readPostHogCookie is off (the default)', async () => {
    posthog = createPostHog()
    const now = Date.now()
    const request = new Request('https://shop.example/', {
      headers: { cookie: cookieFor({ distinct_id: 'user-3', $user_state: 'identified', $sesid: [now, 's-3', now] }) },
    })

    expect(getRequestExceptionContext(posthog, request)).toEqual({
      properties: { $current_url: 'https://shop.example/', $request_method: 'GET', $request_path: '/' },
    })
  })

  it('lets an id from the active context win over the headers', async () => {
    posthog = createPostHog()
    const request = new Request('https://shop.example/', { headers: { 'x-posthog-distinct-id': 'header-user' } })

    posthog.withContext({ distinctId: 'app-user' }, () => {
      createReactRouterErrorHandler(posthog)(new Error('Checkout failed'), { request })
    })
    const [event] = await sentEvents(posthog)

    expect(event.distinct_id).toBe('app-user')
  })

  it.each([
    ['a thrown data() 404', routeErrorResponse(404)],
    ['the router 404 for an unknown URL', routeErrorResponse(404, true)],
    ['the router 405 for a missing action', routeErrorResponse(405, true)],
    ['a thrown Response', new Response(null, { status: 302, headers: { location: '/' } })],
  ])('does not capture %s', async (_, error) => {
    posthog = createPostHog()
    createReactRouterErrorHandler(posthog)(error, { request: new Request('https://shop.example/x') })

    expect(await sentEvents(posthog)).toEqual([])
  })

  it('does not capture or log errors of an aborted request', async () => {
    posthog = createPostHog()
    const controller = new AbortController()
    controller.abort()
    const request = new Request('https://shop.example/slow', { signal: controller.signal })

    createReactRouterErrorHandler(posthog)(new Error('The operation was aborted'), { request })

    expect(await sentEvents(posthog)).toEqual([])
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('captures an error once when handleError and the stream onError both see it', async () => {
    posthog = createPostHog()
    const handleError = createReactRouterErrorHandler(posthog)
    const request = new Request('https://shop.example/reports/forecast')
    const error = new Error('Demand forecast diverged')

    handleError(error, { request })
    handleError(error, { request })

    expect(await sentEvents(posthog)).toHaveLength(1)
  })

  it('logs like React Router by default, and calls onError instead when given', async () => {
    posthog = createPostHog()
    const request = new Request('https://shop.example/x')
    const notFound = routeErrorResponse(404, true) as { error: Error }

    createReactRouterErrorHandler(posthog)(notFound, { request })
    expect(consoleError).toHaveBeenCalledWith(notFound.error)

    const onError = vi.fn()
    const error = new Error('Recount rejected')
    createReactRouterErrorHandler(posthog, { onError })(error, { request })
    expect(onError).toHaveBeenCalledWith(error, { request })
    expect(consoleError).toHaveBeenCalledTimes(1)
  })
})

describe('captureRequestException', () => {
  it('skips an error that was already captured', async () => {
    mockedFetch.mockClear()
    mockedFetch.mockImplementation(() => Promise.resolve(v1Response()) as any)
    const posthog = createPostHog()
    const error = Object.assign(new Error('seen'), { __posthog_previously_captured_error: true })

    captureRequestException(posthog, error, new Request('https://shop.example/'))

    expect(await sentEvents(posthog)).toEqual([])
  })
})
