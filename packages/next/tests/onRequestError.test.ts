vi.mock('server-only', () => ({}))

const { fakeClient, mockCaptureExceptionImmediate, mockGetOrCreateNodeClient } = await vi.hoisted(async () => {
    const { fakeExceptionClient } = await import('./fakeExceptionClient')
    const mockCaptureExceptionImmediate = vi.fn().mockResolvedValue(undefined)
    const fakeClient = fakeExceptionClient(mockCaptureExceptionImmediate)
    return {
        fakeClient,
        mockCaptureExceptionImmediate,
        mockGetOrCreateNodeClient: vi.fn().mockResolvedValue(fakeClient),
    }
})

vi.mock('../src/server/clientCache.node', () => ({
    getOrCreateNodeClient: (...args: unknown[]) => mockGetOrCreateNodeClient(...args),
}))

import { NextRequest } from 'next/server'
import type { NextFetchEvent } from 'next/server'
import type { OnRequestErrorOptions } from '../src/server/onRequestError'
import {
    captureRequestError,
    createOnRequestError,
    onRequestError,
    withPostHogProxy,
} from '../src/server/onRequestError'

describe('Next.js onRequestError', () => {
    const originalEnv = process.env

    beforeEach(() => {
        vi.clearAllMocks()
        process.env = { ...originalEnv }
        process.env.NEXT_RUNTIME = 'nodejs'
        process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test123'
        delete process.env.NEXT_PUBLIC_POSTHOG_HOST
        delete process.env.__NEXT_ROUTER_BASEPATH
    })

    afterAll(() => {
        process.env = originalEnv
    })

    function postHogCookie(apiKey: string, value: Record<string, unknown>): string {
        return `ph_${apiKey}_posthog=${encodeURIComponent(JSON.stringify(value))}`
    }

    const MINUTE_MS = 60 * 1000
    const HOUR_MS = 60 * MINUTE_MS

    // $sesid is [lastActivityTimestamp, sessionId, sessionStartTimestamp].
    function sessionCookie(
        sessionId: string,
        { idleMs = MINUTE_MS, ageMs = HOUR_MS }: { idleMs?: number; ageMs?: number } = {}
    ): string {
        const now = Date.now()
        return postHogCookie('phc_test123', {
            distinct_id: 'cookie_user',
            $device_id: 'cookie_device',
            $sesid: [now - idleMs, sessionId, now - ageMs],
        })
    }

    function capturedProperties(): Record<string, unknown> {
        expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
        return mockCaptureExceptionImmediate.mock.calls[0][2]
    }

    it('captures server-side request errors with user and Next.js context', async () => {
        expect(onRequestError).toBe(captureRequestError)

        process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'
        const error = new Error('server exploded') as Error & { digest?: string }
        error.digest = 'digest-123'
        const cookie = postHogCookie('phc_test123', {
            distinct_id: 'user_123',
            $device_id: 'device_456',
            $sesid: [Date.now() - MINUTE_MS, 'session_789', Date.now() - HOUR_MS],
        })

        await onRequestError(
            error,
            {
                method: 'POST',
                path: '/checkout?step=payment#payment',
                headers: { cookie },
            },
            {
                routerKind: 'App Router',
                routePath: '/checkout',
                routeType: 'render',
                renderSource: 'server-rendering',
                revalidateReason: 'stale',
            }
        )

        expect(mockGetOrCreateNodeClient).toHaveBeenCalledWith('phc_test123', {
            host: 'https://eu.i.posthog.com',
        })
        expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(
            error,
            'user_123',
            expect.objectContaining({
                $http_method: 'POST',
                $pathname: '/checkout#payment',
                $session_id: 'session_789',
                $device_id: 'device_456',
                nextjs_error_digest: 'digest-123',
                nextjs_router_kind: 'App Router',
                nextjs_route_path: '/checkout',
                nextjs_route_type: 'render',
                nextjs_render_source: 'server-rendering',
                nextjs_revalidate_reason: 'stale',
            })
        )
    })

    it('sends a route error through captureExceptionImmediate, without an exception source', async () => {
        await onRequestError(
            new Error('route handler failed'),
            { path: '/api/orders', method: 'GET' },
            {
                routeType: 'route',
            }
        )

        expect(fakeClient.captureImmediate).not.toHaveBeenCalled()
        expect(capturedProperties()).not.toHaveProperty('$exception_source')
    })

    it('supports explicit options, Headers-like request headers, and beforeCapture properties', async () => {
        const handler = createOnRequestError({
            apiKey: 'phc_custom',
            host: 'https://custom.posthog.com',
            serverOptions: { flushAt: 1 },
            beforeCapture: () => ({ custom_property: 'custom-value' }),
        })
        const error = new Error('route handler failed')
        const cookie = postHogCookie('phc_custom', { distinct_id: 'user_custom' })
        const headers = { get: vi.fn((name: string) => (name === 'cookie' ? cookie : null)) }

        await handler(error, { method: 'GET', url: 'https://example.com/api/items?id=1#details', headers }, {})

        expect(headers.get).toHaveBeenCalledWith('cookie')
        expect(mockGetOrCreateNodeClient).toHaveBeenCalledWith('phc_custom', {
            flushAt: 1,
            host: 'https://custom.posthog.com',
        })
        expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(
            error,
            'user_custom',
            expect.objectContaining({
                $pathname: '/api/items#details',
                $current_url: 'https://example.com/api/items#details',
                custom_property: 'custom-value',
            })
        )
    })

    it('prefers PostHog tracing headers over the cookie for distinct and session ids', async () => {
        const error = new Error('route handler failed')
        const beforeCapture = vi.fn()

        await createOnRequestError({ beforeCapture })(
            error,
            {
                method: 'GET',
                path: '/api/items',
                headers: {
                    cookie: sessionCookie('cookie_session'),
                    'x-posthog-distinct-id': 'header_user',
                    'x-posthog-session-id': 'header_session',
                },
            },
            {}
        )

        expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(
            error,
            'header_user',
            expect.objectContaining({ $session_id: 'header_session', $device_id: 'cookie_device' })
        )
        expect(beforeCapture).toHaveBeenCalledWith(expect.objectContaining({ distinctId: 'header_user' }))
    })

    it('sanitizes tracing header values and falls back to the cookie for missing ones', async () => {
        await onRequestError(
            new Error('route handler failed'),
            {
                headers: {
                    cookie: sessionCookie('cookie_session'),
                    'x-posthog-distinct-id': ['  ', ' header\u0000_user\n '],
                    'x-posthog-session-id': ' \t ',
                },
            },
            {}
        )

        expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(
            expect.any(Error),
            'header_user',
            expect.objectContaining({ $session_id: 'cookie_session' })
        )
    })

    it('caps tracing header values at 1000 characters', async () => {
        await onRequestError(
            new Error('route handler failed'),
            { headers: { 'x-posthog-distinct-id': 'a'.repeat(1500) } },
            {}
        )

        expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(
            expect.any(Error),
            'a'.repeat(1000),
            expect.any(Object)
        )
    })

    it('uses a tracing session id without a distinct id for a personless exception', async () => {
        await onRequestError(
            new Error('route handler failed'),
            { headers: { 'x-posthog-session-id': 'header_session' } },
            {}
        )

        expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(
            expect.any(Error),
            undefined,
            expect.objectContaining({ $session_id: 'header_session' })
        )
    })

    it('reads tracing headers from a plain record in any case', async () => {
        await onRequestError(
            new Error('route handler failed'),
            {
                path: '/api/items',
                headers: {
                    Host: 'shop.example.com',
                    'X-PostHog-Distinct-Id': 'header_user',
                    'X-POSTHOG-SESSION-ID': 'header_session',
                },
            },
            {}
        )

        expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(
            expect.any(Error),
            'header_user',
            expect.objectContaining({
                $session_id: 'header_session',
                $current_url: 'https://shop.example.com/api/items',
            })
        )
    })

    it('adds the tracing window id with the tracing session id', async () => {
        await onRequestError(
            new Error('route handler failed'),
            {
                headers: {
                    'x-posthog-session-id': 'header_session',
                    'x-posthog-window-id': ' header\u0000_window ',
                },
            },
            {}
        )

        expect(capturedProperties()).toMatchObject({ $session_id: 'header_session', $window_id: 'header_window' })
    })

    it('ignores a tracing window id without a tracing session id', async () => {
        await onRequestError(
            new Error('route handler failed'),
            { headers: { cookie: sessionCookie('cookie_session'), 'x-posthog-window-id': 'header_window' } },
            {}
        )

        expect(capturedProperties()).toMatchObject({ $session_id: 'cookie_session' })
        expect(capturedProperties()).not.toHaveProperty('$window_id')
    })

    it('keeps a cookie session id that is still active', async () => {
        await onRequestError(
            new Error('route handler failed'),
            { headers: { cookie: sessionCookie('fresh_session', { idleMs: 29 * MINUTE_MS, ageMs: 23 * HOUR_MS }) } },
            {}
        )

        expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(
            expect.any(Error),
            'cookie_user',
            expect.objectContaining({ $session_id: 'fresh_session', $device_id: 'cookie_device' })
        )
    })

    it.each([
        ['has been idle for more than 30 minutes', { idleMs: 31 * MINUTE_MS }],
        ['started more than 24 hours ago', { ageMs: 25 * HOUR_MS }],
    ])('drops a cookie session id that %s', async (_name, sessionAge) => {
        await onRequestError(
            new Error('route handler failed'),
            { headers: { cookie: sessionCookie('stale_session', sessionAge) } },
            {}
        )

        expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(expect.any(Error), 'cookie_user', expect.any(Object))
        expect(capturedProperties()).not.toHaveProperty('$session_id')
        expect(capturedProperties()).toMatchObject({ $device_id: 'cookie_device' })
    })

    // A session active a moment ago, by a browser clock that runs ahead of the server's: its timestamps are in the
    // future. posthog-js's absolute difference would drop it.
    it.each([
        ['40 minutes', { idleMs: -40 * MINUTE_MS, ageMs: 20 * MINUTE_MS }],
        ['26 hours', { idleMs: -26 * HOUR_MS, ageMs: -25 * HOUR_MS }],
    ])('keeps a cookie session from a browser clock %s ahead', async (_name, sessionAge) => {
        await onRequestError(
            new Error('route handler failed'),
            { headers: { cookie: sessionCookie('cookie_session', sessionAge) } },
            {}
        )

        expect(capturedProperties()).toMatchObject({ $session_id: 'cookie_session' })
    })

    it.each([
        { name: 'keeps', idleMs: MINUTE_MS, kept: true },
        { name: 'drops', idleMs: 31 * MINUTE_MS, kept: false },
    ])('$name a session from a cookie without a start timestamp by its idle time', async ({ idleMs, kept }) => {
        // posthog-js versions from before June 2022 wrote $sesid as [lastActivityTimestamp, sessionId].
        const cookie = postHogCookie('phc_test123', {
            distinct_id: 'cookie_user',
            $sesid: [Date.now() - idleMs, 'legacy_session'],
        })

        await onRequestError(new Error('route handler failed'), { headers: { cookie } }, {})

        if (kept) {
            expect(capturedProperties()).toMatchObject({ $session_id: 'legacy_session' })
        } else {
            expect(capturedProperties()).not.toHaveProperty('$session_id')
        }
    })

    it('drops a cookie session id without session timestamps', async () => {
        const cookie = postHogCookie('phc_test123', { distinct_id: 'cookie_user', $sesid: [null, 'old_session'] })

        await onRequestError(new Error('route handler failed'), { headers: { cookie } }, {})

        expect(capturedProperties()).not.toHaveProperty('$session_id')
    })

    it('adds request properties without the query string', async () => {
        await onRequestError(
            new Error('route handler failed'),
            {
                method: 'POST',
                path: '/checkout?token=secret',
                headers: {
                    host: 'shop.example.com',
                    'x-forwarded-proto': 'http',
                    'user-agent': ['Mozilla/5.0 (test)', 'ignored'],
                },
            },
            { routeType: 'route' }
        )

        const properties = capturedProperties()
        expect(properties).toMatchObject({
            $current_url: 'http://shop.example.com/checkout',
            $request_method: 'POST',
            $request_path: '/checkout',
            $user_agent: 'Mozilla/5.0 (test)',
            $http_method: 'POST',
            $pathname: '/checkout',
            nextjs_route_type: 'route',
        })
        expect(JSON.stringify(properties)).not.toContain('secret')
    })

    it('prefers X-Forwarded-Host and X-Forwarded-Proto for $current_url', async () => {
        await onRequestError(
            new Error('route handler failed'),
            {
                path: '/checkout',
                headers: {
                    host: 'internal:3000',
                    'x-forwarded-host': 'shop.example.com, proxy.internal',
                    'x-forwarded-proto': 'https,http',
                },
            },
            {}
        )

        expect(capturedProperties()).toMatchObject({ $current_url: 'https://shop.example.com/checkout' })
    })

    it.each([
        { name: 'empty', forwardedHost: '' },
        { name: 'unparseable', forwardedHost: 'bad host' },
    ])('falls back to Host when X-Forwarded-Host is $name', async ({ forwardedHost }) => {
        await onRequestError(
            new Error('route handler failed'),
            { path: '/checkout', headers: { host: 'shop.example.com', 'x-forwarded-host': forwardedHost } },
            {}
        )

        expect(capturedProperties()).toMatchObject({ $current_url: 'https://shop.example.com/checkout' })
    })

    it.each([
        { name: 'without a host', headers: {} },
        { name: 'when no host can be parsed', headers: { 'x-forwarded-host': 'bad host' } },
    ])('omits $current_url $name', async ({ headers }) => {
        await onRequestError(new Error('route handler failed'), { method: 'GET', path: '/checkout', headers }, {})

        expect(capturedProperties()).not.toHaveProperty('$current_url')
        expect(capturedProperties()).toMatchObject({ $request_path: '/checkout' })
    })

    it.each([
        { path: '/_next/data/build-id/gssp/item.json?label=item', expected: '/gssp/item' },
        { path: '/_next/data/build-id/index.json', expected: '/' },
        { path: '/_next/data.json', expected: '/_next/data.json' },
    ])('reports the page of a data request: $path', async ({ path, expected }) => {
        await onRequestError(
            new Error('getServerSideProps failed'),
            { method: 'GET', path, headers: { host: 'shop.example.com' } },
            { routerKind: 'Pages Router', routeType: 'render' }
        )

        expect(capturedProperties()).toMatchObject({
            $pathname: expected,
            $request_path: expected,
            $current_url: `https://shop.example.com${expected}`,
        })
    })

    describe('with a basePath', () => {
        beforeEach(() => {
            // Next.js inlines this at build time; here it is read from the environment.
            process.env.__NEXT_ROUTER_BASEPATH = '/base'
        })

        it.each([
            { routeType: 'render', path: '/checkout?step=1', expected: '/base/checkout' },
            { routeType: 'route', path: '/api/items', expected: '/base/api/items' },
            { routeType: 'action', path: '/', expected: '/base' },
        ])('adds it to a $routeType path, which Next.js reports without it', async ({ routeType, path, expected }) => {
            await onRequestError(
                new Error('route handler failed'),
                { method: 'GET', path, headers: { host: 'shop.example.com' } },
                { routeType }
            )

            expect(capturedProperties()).toMatchObject({
                $pathname: expected,
                $request_path: expected,
                $current_url: `https://shop.example.com${expected}`,
            })
        })

        it.each([
            { path: '/_next/data/build-id/gssp/item.json', expected: '/base/gssp/item' },
            { path: '/_next/data/build-id/index.json', expected: '/base' },
        ])('adds it to the page of a data request: $path', async ({ path, expected }) => {
            await onRequestError(
                new Error('getServerSideProps failed'),
                { method: 'GET', path, headers: { host: 'shop.example.com' } },
                { routerKind: 'Pages Router', routeType: 'render' }
            )

            expect(capturedProperties()).toMatchObject({ $current_url: `https://shop.example.com${expected}` })
        })

        it('keeps the slash of the page of a data request with trailingSlash', async () => {
            process.env.__NEXT_TRAILING_SLASH = 'true'

            await onRequestError(
                new Error('getServerSideProps failed'),
                { method: 'GET', path: '/_next/data/build-id/gssp/item.json', headers: { host: 'shop.example.com' } },
                { routerKind: 'Pages Router', routeType: 'render' }
            )

            expect(capturedProperties()).toMatchObject({ $current_url: 'https://shop.example.com/base/gssp/item/' })
        })

        // webpack inlines this as a boolean, so it does not stay the string it would be in the environment.
        it.each([true, 'true'])('keeps the slash of the root page with trailingSlash: %s', async (trailingSlash) => {
            process.env.__NEXT_TRAILING_SLASH = trailingSlash as string

            await onRequestError(
                new Error('render failed'),
                { method: 'GET', path: '/', headers: { host: 'shop.example.com' } },
                { routeType: 'render' }
            )

            expect(capturedProperties()).toMatchObject({
                $request_path: '/base/',
                $current_url: 'https://shop.example.com/base/',
            })
        })

        it.each(['middleware', 'proxy'])(
            'keeps a $routeType path, which Next.js reports with it',
            async (routeType) => {
                await onRequestError(
                    new Error('middleware failed'),
                    { method: 'GET', path: '/base/account?tab=1', headers: { host: 'shop.example.com' } },
                    { routerKind: 'Pages Router', routePath: `/${routeType}`, routeType }
                )

                expect(capturedProperties()).toMatchObject({
                    $request_path: '/base/account',
                    $current_url: 'https://shop.example.com/base/account',
                })
            }
        )

        it('keeps the path of an absolute request URL', async () => {
            await onRequestError(
                new Error('route handler failed'),
                { method: 'GET', url: 'https://shop.example.com/base/api/items', headers: {} },
                { routeType: 'route' }
            )

            expect(capturedProperties()).toMatchObject({ $current_url: 'https://shop.example.com/base/api/items' })
        })
    })

    it('always strips search and strips hash from request paths when disable_capture_url_hashes is enabled', async () => {
        const handler = createOnRequestError({
            serverOptions: { disable_capture_url_hashes: true },
        })
        const error = new Error('route handler failed')

        await handler(error, { method: 'GET', path: '/account?token=secret#billing', headers: {} }, {})

        expect(mockGetOrCreateNodeClient).toHaveBeenCalledWith(
            'phc_test123',
            expect.objectContaining({ disable_capture_url_hashes: true })
        )
        expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(
            error,
            undefined,
            expect.objectContaining({
                $pathname: '/account',
            })
        )
    })

    it.each([
        {
            name: 'the error was already captured',
            run: async () => {
                const error = Object.defineProperty(
                    new Error('already captured'),
                    '__posthog_previously_captured_error',
                    {
                        value: true,
                    }
                )
                await onRequestError(error, { headers: {} }, {})
            },
        },
        {
            name: 'beforeCapture returns false',
            run: async () => {
                const handler = createOnRequestError({ beforeCapture: () => false })
                await handler(new Error('ignored'), { headers: {} }, {})
            },
        },
        {
            name: 'the user has opted out',
            run: async () => {
                await onRequestError(
                    new Error('opted out'),
                    { headers: { cookie: '__ph_opt_in_out_phc_test123=0' } },
                    {}
                )
            },
        },
        {
            name: 'outside the nodejs runtime',
            run: async () => {
                process.env.NEXT_RUNTIME = 'edge'
                await onRequestError(new Error('edge error'), { headers: {} }, {})
            },
        },
    ])('skips capture when $name', async ({ run }) => {
        await run()

        expect(mockGetOrCreateNodeClient).not.toHaveBeenCalled()
        expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled()
    })

    it('does not throw or capture when beforeCapture throws', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation()
        const handler = createOnRequestError({
            beforeCapture: () => {
                throw new Error('beforeCapture failed')
            },
        })

        try {
            await expect(handler(new Error('ignored'), { headers: {} }, {})).resolves.toBeUndefined()

            expect(warnSpy).toHaveBeenCalledWith(
                '[PostHog Next.js] Failed to run beforeCapture for server-side exception:',
                expect.any(Error)
            )
            expect(mockGetOrCreateNodeClient).not.toHaveBeenCalled()
            expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled()
        } finally {
            warnSpy.mockRestore()
        }
    })

    it.each([
        {
            name: 'creating the PostHog client fails',
            captureError: new Error('client unavailable'),
            setup: (captureError: Error) => mockGetOrCreateNodeClient.mockRejectedValueOnce(captureError),
            run: async () => onRequestError(new Error('server exploded'), { headers: {} }, {}),
            assertCapture: () => expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled(),
        },
        {
            name: 'immediate exception capture fails',
            captureError: new Error('transport unavailable'),
            setup: (captureError: Error) => mockCaptureExceptionImmediate.mockRejectedValueOnce(captureError),
            run: async () => {
                const error = new Error('server exploded')
                await onRequestError(error, { headers: {} }, {})
                expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(error, undefined, expect.any(Object))
            },
            assertCapture: () => undefined,
        },
    ])('does not throw when $name', async ({ captureError, setup, run, assertCapture }) => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation()
        setup(captureError)

        try {
            await expect(run()).resolves.toBeUndefined()

            assertCapture()
            expect(warnSpy).toHaveBeenCalledWith(
                '[PostHog Next.js] Failed to capture server-side exception:',
                captureError
            )
        } finally {
            warnSpy.mockRestore()
        }
    })

    describe('withPostHogProxy', () => {
        type TestFetchEvent = NextFetchEvent & { kept: Array<Promise<unknown>> }

        function proxyRequest(cookie = sessionCookie('proxy_session')): NextRequest {
            return new NextRequest('https://shop.example.com/dashboard?tab=billing', {
                method: 'POST',
                headers: {
                    host: 'shop.example.com',
                    cookie,
                    'user-agent': 'Mozilla/5.0 (proxy)',
                },
            })
        }

        // A fetch event that keeps what the wrapper hands to waitUntil, as a serverless platform does.
        function fetchEvent(sourcePage = '/proxy'): TestFetchEvent {
            const kept: Array<Promise<unknown>> = []
            return { sourcePage, kept, waitUntil: (promise: Promise<unknown>) => kept.push(promise) } as TestFetchEvent
        }

        // What the platform waits for after the response.
        async function settle(event: TestFetchEvent): Promise<void> {
            await Promise.all(event.kept)
        }

        // A proxy that throws what it is given.
        function throwing(
            thrown: unknown,
            options?: OnRequestErrorOptions
        ): ReturnType<typeof withPostHogProxy<never>> {
            return withPostHogProxy(() => {
                throw thrown
            }, options)
        }

        // What Next.js does with an edge middleware error once the wrapper rethrows it.
        function reportMiddlewareError(
            error: unknown,
            request: NextRequest,
            handler = onRequestError
        ): void | Promise<void> {
            const url = new URL(request.url)
            return handler(
                error,
                {
                    path: url.pathname + url.search,
                    method: request.method,
                    headers: Object.fromEntries(request.headers.entries()),
                },
                { routerKind: 'Pages Router', routePath: '/middleware', routeType: 'middleware' }
            )
        }

        // A request through the wrapper that Next.js then reports, as edge middleware on Next.js 15 and 16 does.
        async function failAndReport(
            proxy: ReturnType<typeof withPostHogProxy<never>>,
            error: unknown,
            handler = onRequestError
        ): Promise<void> {
            const request = proxyRequest()
            const event = fetchEvent()
            await expect(proxy(request, event)).rejects.toBe(error)
            await reportMiddlewareError(error, request, handler)
            await settle(event)
        }

        beforeEach(() => {
            // A capture that fails warns; these tests check what is sent instead.
            vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        })

        afterEach(() => {
            vi.useRealTimers()
            // oxlint-disable-next-line no-console
            vi.mocked(console.warn).mockRestore()
        })

        it('captures a proxy error with request context and rethrows it', async () => {
            const error = new Error('proxy exploded')
            const proxy = withPostHogProxy(async (request) => {
                // The callback gets the Next.js request, not a plain Request.
                expect(request.nextUrl.pathname).toBe('/dashboard')
                throw error
            })
            const event = fetchEvent()

            await expect(proxy(proxyRequest(), event)).rejects.toBe(error)
            await settle(event)

            expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(error, 'cookie_user', expect.any(Object))
            expect(capturedProperties()).toMatchObject({
                $session_id: 'proxy_session',
                $current_url: 'https://shop.example.com/dashboard',
                $request_method: 'POST',
                $request_path: '/dashboard',
                $user_agent: 'Mozilla/5.0 (proxy)',
                nextjs_router_kind: 'Pages Router',
                nextjs_route_type: 'proxy',
                nextjs_route_path: '/proxy',
            })
            expect(JSON.stringify(capturedProperties())).not.toContain('billing')
            // The mark is not enumerable, so it does not show up where the app serializes the error.
            expect(Object.keys(error)).toEqual([])
        })

        it.each([
            { sourcePage: '/middleware', routeType: 'middleware' },
            { sourcePage: '/src/middleware', routeType: 'middleware' },
            { sourcePage: '/src/proxy', routeType: 'proxy' },
        ])('labels an error from $sourcePage as $routeType', async ({ sourcePage, routeType }) => {
            const event = fetchEvent(sourcePage)

            await expect(throwing(new Error('proxy exploded'))(proxyRequest(), event)).rejects.toThrow('proxy exploded')
            await settle(event)

            expect(capturedProperties()).toMatchObject({
                nextjs_route_type: routeType,
                nextjs_route_path: `/${routeType}`,
                $exception_source: `nextjs.${routeType}`,
            })
        })

        it('sends a proxy error as an unhandled middleware exception', async () => {
            process.env.POSTHOG_RELEASE_ID = 'release-1'
            const event = fetchEvent()

            await expect(throwing(new Error('proxy exploded'))(proxyRequest(), event)).rejects.toThrow()
            await settle(event)

            expect(fakeClient.captureImmediate).toHaveBeenCalledWith({
                event: '$exception',
                distinctId: 'cookie_user',
                properties: expect.objectContaining({
                    $exception_list: [expect.objectContaining({ mechanism: { type: 'middleware', handled: false } })],
                    $exception_level: 'error',
                    $exception_source: 'nextjs.proxy',
                    $release_id: 'release-1',
                    $session_id: 'proxy_session',
                }),
                _originatedFromCaptureException: true,
            })
        })

        it("sends Next.js's report of an unwrapped middleware error as unhandled too", async () => {
            const request = proxyRequest()

            await reportMiddlewareError(new Error('middleware exploded'), request)

            expect(fakeClient.captureImmediate).toHaveBeenCalledTimes(1)
            expect(capturedProperties()).toMatchObject({
                $exception_list: [{ mechanism: { type: 'middleware', handled: false } }],
                $exception_source: 'nextjs.middleware',
            })
        })

        it('passes options and every proxy argument through', async () => {
            const beforeCapture = vi.fn(() => ({ custom_property: 'proxy-value' }))
            const handler = vi.fn((_request: NextRequest, _event: NextFetchEvent) => {
                throw new Error('sync proxy failure')
            })
            const proxy = withPostHogProxy(handler, { apiKey: 'phc_proxy', beforeCapture })
            const request = proxyRequest()
            const event = fetchEvent()

            await expect(proxy(request, event)).rejects.toThrow('sync proxy failure')
            await settle(event)

            expect(handler).toHaveBeenCalledWith(request, event)
            expect(mockGetOrCreateNodeClient).toHaveBeenCalledWith('phc_proxy', expect.any(Object))
            expect(beforeCapture).toHaveBeenCalledWith(
                expect.objectContaining({
                    request: expect.objectContaining({ method: 'POST', path: '/dashboard?tab=billing' }),
                    context: { routerKind: 'Pages Router', routePath: '/proxy', routeType: 'proxy' },
                })
            )
            expect(capturedProperties()).toMatchObject({ custom_property: 'proxy-value' })
        })

        it('returns the proxy result without capturing', async () => {
            const response = new Response('ok')
            const event = fetchEvent()

            await expect(withPostHogProxy(() => response)(proxyRequest(), event)).resolves.toBe(response)

            expect(event.kept).toHaveLength(0)
            expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled()
        })

        it('rethrows without waiting for the capture', async () => {
            mockCaptureExceptionImmediate.mockImplementationOnce(() => new Promise<void>(() => undefined))
            const error = new Error('proxy exploded')
            const event = fetchEvent()

            await expect(throwing(error)(proxyRequest(), event)).rejects.toBe(error)

            expect(event.kept).toHaveLength(1)
        })

        it('keeps the function running for a capture for at most 2 seconds', async () => {
            vi.useFakeTimers()
            mockCaptureExceptionImmediate.mockImplementationOnce(() => new Promise<void>(() => undefined))
            const event = fetchEvent()
            let released = false

            await expect(throwing(new Error('proxy exploded'))(proxyRequest(), event)).rejects.toThrow()
            void settle(event).then(() => (released = true))
            await vi.advanceTimersByTimeAsync(1999)
            expect(released).toBe(false)
            await vi.advanceTimersByTimeAsync(1)

            expect(released).toBe(true)
            expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
        })

        it('releases the function as soon as the capture is sent', async () => {
            vi.useFakeTimers()
            const event = fetchEvent()

            await expect(throwing(new Error('proxy exploded'))(proxyRequest(), event)).rejects.toThrow()
            // No timer is advanced: waiting for the 2 second limit would never end.
            await settle(event)

            expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
        })

        it("also hands the capture to Vercel's request context, which Next.js 13 and 14 do not use", async () => {
            const VERCEL_REQUEST_CONTEXT_KEY = Symbol.for('@vercel/request-context')
            const vercelWaitUntil = vi.fn()
            const store = globalThis as unknown as Record<symbol, unknown>
            store[VERCEL_REQUEST_CONTEXT_KEY] = { get: () => ({ waitUntil: vercelWaitUntil }) }
            try {
                const event = fetchEvent()

                await expect(throwing(new Error('proxy exploded'))(proxyRequest(), event)).rejects.toThrow()

                expect(vercelWaitUntil).toHaveBeenCalledWith(event.kept[0])
            } finally {
                delete store[VERCEL_REQUEST_CONTEXT_KEY]
            }
        })

        it('captures without a fetch event, and with one whose waitUntil throws', async () => {
            const throwingEvent = {
                sourcePage: '/proxy',
                waitUntil: () => {
                    throw new Error('outside a request context')
                },
            } as unknown as NextFetchEvent

            for (const event of [undefined as unknown as NextFetchEvent, throwingEvent]) {
                await expect(throwing(new Error('proxy exploded'))(proxyRequest(), event)).rejects.toThrow(
                    'proxy exploded'
                )
            }

            await vi.waitFor(() => expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(2))
        })

        it('does not capture a proxy error again when Next.js also reports it to onRequestError', async () => {
            const error = new Error('middleware exploded')
            const request = proxyRequest()
            const event = fetchEvent('/middleware')

            await expect(throwing(error)(request, event)).rejects.toBe(error)
            // Next.js 15 and later report edge middleware errors to onRequestError as soon as the proxy throws, before
            // the capture is sent.
            await reportMiddlewareError(error, request)
            await settle(event)

            expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
        })

        it('does not send a failed capture again from onRequestError', async () => {
            mockCaptureExceptionImmediate.mockRejectedValueOnce(new Error('transport unavailable'))
            const error = new Error('proxy exploded')

            await failAndReport(throwing(error), error)

            expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
        })

        describe('when requests throw the same error object', () => {
            // A cached failed init, say: each failing request is an occurrence.
            it('captures it once per request', async () => {
                const error = new Error('init failed')
                const proxy = throwing(error)

                for (let i = 0; i < 3; i++) {
                    await failAndReport(proxy, error)
                }

                expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(3)
            })

            it.each([
                { name: 'the user opted out', cookie: `${sessionCookie('skipped')}; __ph_opt_in_out_phc_test123=0` },
                { name: 'beforeCapture skipped it', cookie: `${sessionCookie('skipped')}; skip=1` },
            ])('captures it for a later request after one where $name', async ({ cookie }) => {
                const error = new Error('init failed')
                const proxy = throwing(error, {
                    beforeCapture: ({ request }) =>
                        (request.headers as Record<string, string>).cookie.includes('skip=1') ? false : undefined,
                })

                for (const request of [proxyRequest(cookie), proxyRequest()]) {
                    const event = fetchEvent()
                    await expect(proxy(request, event)).rejects.toBe(error)
                    await reportMiddlewareError(error, request)
                    await settle(event)
                }

                expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
                expect(capturedProperties()).toMatchObject({ $session_id: 'proxy_session' })
            })

            it('still captures it from a route handler, which the wrapper never saw', async () => {
                const error = new Error('init failed')

                await failAndReport(throwing(error), error)
                await onRequestError(error, { path: '/api/orders', method: 'GET', headers: {} }, { routeType: 'route' })

                expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(2)
                expect(mockCaptureExceptionImmediate.mock.calls[1][2]).toMatchObject({ nextjs_route_type: 'route' })
            })

            it('sees the mark from another copy of the module, as Next.js bundles one per entry', async () => {
                const error = new Error('init failed')
                vi.resetModules()
                const otherCopy = await import('../src/server/onRequestError')

                await failAndReport(throwing(error), error, otherCopy.onRequestError)

                expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
            })
        })

        it('captures once through nested wrappers', async () => {
            const error = new Error('proxy exploded')

            await failAndReport(withPostHogProxy(throwing(error)), error)

            expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
        })

        it('lets an outer wrapper capture what a disabled inner wrapper skipped', async () => {
            const error = new Error('proxy exploded')

            await failAndReport(withPostHogProxy(throwing(error, { disabled: true })), error)

            expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
            expect(capturedProperties()).toMatchObject({ nextjs_route_type: 'proxy' })
        })

        it('leaves the error to onRequestError when the wrapper is disabled', async () => {
            const error = new Error('proxy exploded')

            await failAndReport(throwing(error, { disabled: true }), error)

            expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
            expect(capturedProperties()).toMatchObject({ nextjs_route_type: 'middleware' })
        })

        it.each([
            { name: 'a string', thrown: 'proxy exploded' },
            { name: 'a number', thrown: 42 },
            { name: 'null', thrown: null },
            { name: 'undefined', thrown: undefined },
            { name: 'a frozen error', thrown: Object.freeze(new Error('frozen')) },
        ])('rethrows $name, which cannot be marked, so Next.js reports it again', async ({ thrown }) => {
            await failAndReport(throwing(thrown), thrown)

            expect(capturedRouteTypes()).toEqual(['proxy', 'middleware'])
        })

        it.each([
            {
                name: 'a throwing digest getter',
                thrown: () =>
                    Object.defineProperty(new Error('proxy exploded'), 'digest', {
                        get: () => {
                            throw new Error('digest getter failed')
                        },
                    }),
            },
            {
                name: 'a revoked proxy',
                thrown: () => {
                    const { proxy, revoke } = Proxy.revocable(new Error('proxy exploded'), {})
                    revoke()
                    return proxy
                },
            },
        ])('rethrows an error with $name as is', async ({ thrown }) => {
            const error = thrown()
            const event = fetchEvent()
            let rethrown: unknown

            await throwing(error)(proxyRequest(), event).catch((caught: unknown) => {
                rethrown = caught
            })
            await settle(event)

            expect(rethrown === error).toBe(true)
        })

        it('does not capture outside the nodejs runtime', async () => {
            process.env.NEXT_RUNTIME = 'edge'
            const error = new Error('proxy exploded')
            const event = fetchEvent()

            await expect(throwing(error)(proxyRequest(), event)).rejects.toBe(error)

            expect(event.kept).toHaveLength(0)
            expect(mockGetOrCreateNodeClient).not.toHaveBeenCalled()
            expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled()
        })

        it.each([
            { name: 'beforeCapture returns false', options: { beforeCapture: () => false as const } },
            { name: 'capture is disabled', options: { disabled: true } },
            { name: 'there is no API key', options: {}, setup: () => delete process.env.NEXT_PUBLIC_POSTHOG_KEY },
            {
                name: 'the client cannot be created',
                options: {},
                setup: () => mockGetOrCreateNodeClient.mockRejectedValueOnce(new Error('client unavailable')),
            },
            {
                name: 'the user opted out',
                options: {},
                cookie: `${sessionCookie('proxy_session')}; __ph_opt_in_out_phc_test123=0`,
            },
            { name: 'consent defaults to opted out', options: { consent: { opt_out_capturing_by_default: true } } },
        ])('does not capture the error when $name', async ({ options, setup, cookie }) => {
            setup?.()
            const error = new Error('proxy exploded')
            const event = fetchEvent()

            await expect(throwing(error, options)(proxyRequest(cookie), event)).rejects.toBe(error)
            await settle(event)

            expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled()
        })

        it("skips Next.js's report of an error the wrapper's beforeCapture skipped", async () => {
            const error = new Error('proxy exploded')
            const proxy = throwing(error, { beforeCapture: () => false })

            // The wrapper's options decide for the errors it handles.
            await failAndReport(proxy, error, createOnRequestError())

            expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled()
        })

        it('rethrows an error that was already captured without capturing it again', async () => {
            const error = Object.defineProperty(new Error('already captured'), '__posthog_previously_captured_error', {
                value: true,
            })
            const event = fetchEvent()

            await expect(throwing(error)(proxyRequest(), event)).rejects.toBe(error)

            expect(event.kept).toHaveLength(0)
            expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled()
        })

        // Next.js handles these digests in a render, but in a proxy they are a 500 like any other error.
        it.each(['NEXT_REDIRECT;replace;/login;307;', 'NEXT_HTTP_ERROR_FALLBACK;404'])(
            'captures %s once and rethrows it',
            async (digest) => {
                const navigation = Object.assign(new Error(digest.split(';')[0]), { digest })

                await failAndReport(throwing(navigation), navigation)

                expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
            }
        )

        function capturedRouteTypes(): unknown[] {
            return mockCaptureExceptionImmediate.mock.calls.map((call) => call[2].nextjs_route_type)
        }
    })
})
