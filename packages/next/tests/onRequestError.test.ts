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
        function proxyRequest(): Request {
            return new Request('https://shop.example.com/dashboard?tab=billing', {
                method: 'POST',
                headers: {
                    host: 'shop.example.com',
                    cookie: sessionCookie('proxy_session'),
                    'user-agent': 'Mozilla/5.0 (proxy)',
                },
            })
        }

        it('captures a proxy error with request context and rethrows it', async () => {
            const error = new Error('proxy exploded')
            const proxy = withPostHogProxy(async (_request: Request) => {
                throw error
            })
            // posthog-node skips marked errors, so the error must be marked only after the capture call.
            let markedAtCapture: unknown
            mockCaptureExceptionImmediate.mockImplementationOnce(async (captured: Record<string, unknown>) => {
                markedAtCapture = captured.__posthog_previously_captured_error
            })

            await expect(proxy(proxyRequest())).rejects.toBe(error)

            expect(markedAtCapture).toBeUndefined()
            expect((error as Error & Record<string, unknown>).__posthog_previously_captured_error).toBe(true)

            expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(error, 'cookie_user', expect.any(Object))
            expect(capturedProperties()).toMatchObject({
                $session_id: 'proxy_session',
                $current_url: 'https://shop.example.com/dashboard',
                $request_method: 'POST',
                $request_path: '/dashboard',
                $user_agent: 'Mozilla/5.0 (proxy)',
                nextjs_route_type: 'proxy',
                nextjs_route_path: '/proxy',
            })
            expect(JSON.stringify(capturedProperties())).not.toContain('billing')
            expect(Object.keys(error)).not.toContain('__posthog_previously_captured_error')
        })

        it('passes options and every proxy argument through', async () => {
            const beforeCapture = vi.fn(() => ({ custom_property: 'proxy-value' }))
            const handler = vi.fn((_request: Request, _event: { waitUntil(promise: Promise<unknown>): void }) => {
                throw new Error('sync proxy failure')
            })
            const proxy = withPostHogProxy(handler, { apiKey: 'phc_proxy', beforeCapture })
            const request = proxyRequest()
            const event = { waitUntil: vi.fn() }

            await expect(proxy(request, event)).rejects.toThrow('sync proxy failure')

            expect(handler).toHaveBeenCalledWith(request, event)
            expect(mockGetOrCreateNodeClient).toHaveBeenCalledWith('phc_proxy', expect.any(Object))
            expect(beforeCapture).toHaveBeenCalledWith(
                expect.objectContaining({
                    request: expect.objectContaining({ method: 'POST', path: '/dashboard?tab=billing' }),
                    context: { routePath: '/proxy', routeType: 'proxy' },
                })
            )
            expect(capturedProperties()).toMatchObject({ custom_property: 'proxy-value' })
        })

        it('returns the proxy result without capturing', async () => {
            const response = new Response('ok')
            const proxy = withPostHogProxy((_request: Request) => response)

            await expect(proxy(proxyRequest())).resolves.toBe(response)

            expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled()
        })

        it('does not capture a proxy error again when Next.js also reports it to onRequestError', async () => {
            const error = new Error('middleware exploded')
            const proxy = withPostHogProxy((_request: Request) => {
                throw error
            })

            await expect(proxy(proxyRequest())).rejects.toBe(error)
            // Next.js 15 and earlier report edge middleware errors to onRequestError after the proxy throws.
            await onRequestError(
                error,
                { path: '/dashboard?tab=billing', method: 'POST', headers: {} },
                { routerKind: 'Pages Router', routePath: '/middleware', routeType: 'middleware' }
            )

            expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
        })

        it('rethrows the proxy error when capture fails', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation()
            mockCaptureExceptionImmediate.mockRejectedValueOnce(new Error('transport unavailable'))
            const error = new Error('proxy exploded')
            const proxy = withPostHogProxy((_request: Request) => {
                throw error
            })

            try {
                await expect(proxy(proxyRequest())).rejects.toBe(error)
            } finally {
                warnSpy.mockRestore()
            }
        })

        it('rethrows Next.js control-flow errors without capturing them', async () => {
            const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' })
            const proxy = withPostHogProxy((_request: Request) => {
                throw redirect
            })

            await expect(proxy(proxyRequest())).rejects.toBe(redirect)

            expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled()
        })
    })
})
