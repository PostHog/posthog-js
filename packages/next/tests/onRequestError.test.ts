vi.mock('server-only', () => ({}))

const { mockCaptureExceptionImmediate, mockGetOrCreateNodeClient } = vi.hoisted(() => {
    const mockCaptureExceptionImmediate = vi.fn().mockResolvedValue(undefined)
    return {
        mockCaptureExceptionImmediate,
        mockGetOrCreateNodeClient: vi
            .fn()
            .mockResolvedValue({ captureExceptionImmediate: mockCaptureExceptionImmediate }),
    }
})

vi.mock('../src/server/clientCache.node', () => ({
    getOrCreateNodeClient: (...args: unknown[]) => mockGetOrCreateNodeClient(...args),
}))

import { NextRequest } from 'next/server'
import type { NextFetchEvent } from 'next/server'
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

    it.each([
        {
            name: 'a longer idle timeout keeps a session idle for 31 minutes',
            timeout: 2 * 60 * 60,
            idleMinutes: 31,
            kept: true,
        },
        { name: 'a shorter idle timeout drops a session idle for 2 minutes', timeout: 60, idleMinutes: 2, kept: false },
        { name: 'a timeout under 60 seconds counts as 60 seconds', timeout: 10, idleMinutes: 0.5, kept: true },
        {
            name: 'a timeout over 10 hours counts as 10 hours',
            timeout: 24 * 60 * 60,
            idleMinutes: 11 * 60,
            kept: false,
        },
        { name: 'a zero timeout means the 30 minute default', timeout: 0, idleMinutes: 31, kept: false },
    ])('applies sessionIdleTimeoutSeconds: $name', async ({ timeout, idleMinutes, kept }) => {
        await createOnRequestError({ sessionIdleTimeoutSeconds: timeout })(
            new Error('route handler failed'),
            { headers: { cookie: sessionCookie('cookie_session', { idleMs: idleMinutes * MINUTE_MS }) } },
            {}
        )

        if (kept) {
            expect(capturedProperties()).toMatchObject({ $session_id: 'cookie_session' })
        } else {
            expect(capturedProperties()).not.toHaveProperty('$session_id')
        }
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

        it('keeps a middleware path, which Next.js reports with it', async () => {
            await onRequestError(
                new Error('middleware failed'),
                { method: 'GET', path: '/base/account?tab=1', headers: { host: 'shop.example.com' } },
                { routerKind: 'Pages Router', routePath: '/middleware', routeType: 'middleware' }
            )

            expect(capturedProperties()).toMatchObject({
                $request_path: '/base/account',
                $current_url: 'https://shop.example.com/base/account',
            })
        })

        it('keeps the path of an absolute request URL', async () => {
            await onRequestError(
                new Error('route handler failed'),
                { method: 'GET', url: 'https://shop.example.com/base/api/items', headers: {} },
                { routeType: 'route' }
            )

            expect(capturedProperties()).toMatchObject({ $current_url: 'https://shop.example.com/base/api/items' })
        })
    })

    it('omits $current_url without a host', async () => {
        await onRequestError(new Error('route handler failed'), { method: 'GET', path: '/checkout', headers: {} }, {})

        expect(capturedProperties()).not.toHaveProperty('$current_url')
        expect(capturedProperties()).toMatchObject({ $request_path: '/checkout' })
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
        function proxyRequest(): NextRequest {
            return new NextRequest('https://shop.example.com/dashboard?tab=billing', {
                method: 'POST',
                headers: {
                    host: 'shop.example.com',
                    cookie: sessionCookie('proxy_session'),
                    'user-agent': 'Mozilla/5.0 (proxy)',
                },
            })
        }

        function fetchEvent(sourcePage = '/proxy'): NextFetchEvent & { waitUntil: ReturnType<typeof vi.fn> } {
            return { sourcePage, waitUntil: vi.fn() } as unknown as NextFetchEvent & {
                waitUntil: ReturnType<typeof vi.fn>
            }
        }

        function isMarkedAsCaptured(error: unknown): boolean {
            return (error as Record<string, unknown>).__posthog_previously_captured_error === true
        }

        afterEach(() => {
            vi.useRealTimers()
        })

        it('captures a proxy error with request context and rethrows it', async () => {
            const error = new Error('proxy exploded')
            const proxy = withPostHogProxy(async (request) => {
                // The callback gets the Next.js request, not a plain Request.
                expect(request.nextUrl.pathname).toBe('/dashboard')
                throw error
            })
            // posthog-node skips marked errors, so the error must be marked only after the capture call.
            let markedAtCapture: unknown
            mockCaptureExceptionImmediate.mockImplementationOnce(async (captured: Record<string, unknown>) => {
                markedAtCapture = captured.__posthog_previously_captured_error
            })

            await expect(proxy(proxyRequest(), fetchEvent())).rejects.toBe(error)

            expect(markedAtCapture).toBeUndefined()
            expect((error as Error & Record<string, unknown>).__posthog_previously_captured_error).toBe(true)

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
            expect(Object.getOwnPropertyNames(error)).not.toContain('__posthog_next_proxy_capture')
            expect(Object.keys(error)).not.toContain('__posthog_previously_captured_error')
        })

        it.each([
            { sourcePage: '/middleware', routeType: 'middleware' },
            { sourcePage: '/src/middleware', routeType: 'middleware' },
            { sourcePage: '/src/proxy', routeType: 'proxy' },
        ])('labels an error from $sourcePage as $routeType', async ({ sourcePage, routeType }) => {
            const proxy = withPostHogProxy(() => {
                throw new Error('proxy exploded')
            })

            await expect(proxy(proxyRequest(), fetchEvent(sourcePage))).rejects.toThrow('proxy exploded')

            expect(capturedProperties()).toMatchObject({
                nextjs_route_type: routeType,
                nextjs_route_path: `/${routeType}`,
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

            expect(handler).toHaveBeenCalledWith(request, event)
            expect(mockGetOrCreateNodeClient).toHaveBeenCalledWith('phc_proxy', expect.any(Object))
            expect(beforeCapture).toHaveBeenCalledWith(
                expect.objectContaining({
                    request: expect.objectContaining({ method: 'POST', path: '/dashboard?tab=billing' }),
                    context: { routerKind: 'Pages Router', routePath: '/proxy', routeType: 'proxy' },
                })
            )
            expect(capturedProperties()).toMatchObject({ custom_property: 'proxy-value' })
            expect(event.waitUntil).toHaveBeenCalledWith(expect.any(Promise))
        })

        it('returns the proxy result without capturing', async () => {
            const response = new Response('ok')
            const proxy = withPostHogProxy(() => response)

            await expect(proxy(proxyRequest(), fetchEvent())).resolves.toBe(response)

            expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled()
        })

        it('does not capture a proxy error again when Next.js also reports it to onRequestError', async () => {
            const error = new Error('middleware exploded')
            const proxy = withPostHogProxy(() => {
                throw error
            })

            await expect(proxy(proxyRequest(), fetchEvent('/middleware'))).rejects.toBe(error)
            // Next.js 15 and earlier report edge middleware errors to onRequestError after the proxy throws.
            await onRequestError(
                error,
                { path: '/dashboard?tab=billing', method: 'POST', headers: {} },
                { routerKind: 'Pages Router', routePath: '/middleware', routeType: 'middleware' }
            )

            expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
        })

        it('marks the error as captured when sending it fails, so onRequestError does not send it again', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation()
            mockCaptureExceptionImmediate.mockRejectedValueOnce(new Error('transport unavailable'))
            const error = new Error('proxy exploded')
            const proxy = withPostHogProxy(() => {
                throw error
            })

            try {
                await expect(proxy(proxyRequest(), fetchEvent())).rejects.toBe(error)
                await onRequestError(error, { headers: {} }, { routeType: 'middleware' })

                expect(isMarkedAsCaptured(error)).toBe(true)
                expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
            } finally {
                warnSpy.mockRestore()
            }
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
        ])('leaves the error unmarked when $name', async ({ options, setup }) => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation()
            setup?.()
            const error = new Error('proxy exploded')
            const proxy = withPostHogProxy(() => {
                throw error
            }, options)

            try {
                await expect(proxy(proxyRequest(), fetchEvent())).rejects.toBe(error)

                expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled()
                expect(isMarkedAsCaptured(error)).toBe(false)
                expect(Object.getOwnPropertyNames(error)).not.toContain('__posthog_next_proxy_capture')
            } finally {
                warnSpy.mockRestore()
            }
        })

        it('lets onRequestError capture an error the proxy options skipped', async () => {
            const error = new Error('proxy exploded')
            const proxy = withPostHogProxy(
                () => {
                    throw error
                },
                { beforeCapture: ({ context }) => (context.routeType === 'proxy' ? false : undefined) }
            )

            await expect(proxy(proxyRequest(), fetchEvent())).rejects.toBe(error)
            await onRequestError(error, { headers: {} }, { routeType: 'middleware' })

            expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
            expect(capturedProperties()).toMatchObject({ nextjs_route_type: 'middleware' })
        })

        it('rethrows after 2 seconds when the capture is slower, and keeps the capture alive', async () => {
            vi.useFakeTimers()
            let finishCapture: () => void = () => undefined
            mockCaptureExceptionImmediate.mockImplementationOnce(
                () => new Promise<void>((resolve) => (finishCapture = resolve))
            )
            const error = new Error('proxy exploded')
            const event = fetchEvent()
            const proxy = withPostHogProxy(() => {
                throw error
            })

            const result = proxy(proxyRequest(), event)
            const rejected = expect(result).rejects.toBe(error)
            await vi.advanceTimersByTimeAsync(1999)
            expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
            let settled = false
            void result.catch(() => (settled = true))
            await vi.advanceTimersByTimeAsync(0)
            expect(settled).toBe(false)

            await vi.advanceTimersByTimeAsync(1)
            await rejected

            // Next.js reports the rethrown error while the capture is still running: it must not be sent twice.
            await onRequestError(error, { headers: {} }, { routeType: 'middleware' })
            expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
            expect(event.waitUntil).toHaveBeenCalledTimes(1)
            const keptAlive = event.waitUntil.mock.calls[0][0] as Promise<void>

            finishCapture()
            await keptAlive
            expect(isMarkedAsCaptured(error)).toBe(true)
        })

        it('rethrows an error that was already captured without capturing it again', async () => {
            const error = Object.defineProperty(new Error('already captured'), '__posthog_previously_captured_error', {
                value: true,
            })
            const proxy = withPostHogProxy(() => {
                throw error
            })

            await expect(proxy(proxyRequest(), fetchEvent())).rejects.toBe(error)

            expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled()
        })

        it('captures without a fetch event', async () => {
            const proxy = withPostHogProxy(() => {
                throw new Error('proxy exploded')
            })

            await expect(proxy(proxyRequest(), undefined as unknown as NextFetchEvent)).rejects.toThrow()

            expect(capturedProperties()).toMatchObject({ nextjs_route_type: 'proxy' })
        })

        it('rethrows Next.js control-flow errors without capturing them', async () => {
            const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' })
            const proxy = withPostHogProxy(() => {
                throw redirect
            })

            await expect(proxy(proxyRequest(), fetchEvent())).rejects.toBe(redirect)

            expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled()
        })
    })
})
