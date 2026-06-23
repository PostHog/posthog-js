jest.mock('server-only', () => ({}))

const mockCaptureExceptionImmediate = jest.fn().mockResolvedValue(undefined)
const mockGetOrCreateNodeClient = jest.fn().mockResolvedValue({
    captureExceptionImmediate: mockCaptureExceptionImmediate,
})

jest.mock('../src/server/clientCache.node', () => ({
    getOrCreateNodeClient: (...args: unknown[]) => mockGetOrCreateNodeClient(...args),
}))

import { captureRequestError, createOnRequestError, onRequestError } from '../src/server/onRequestError'

describe('Next.js onRequestError', () => {
    const originalEnv = process.env

    beforeEach(() => {
        jest.clearAllMocks()
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

    it('captures server-side request errors with user and Next.js context', async () => {
        expect(onRequestError).toBe(captureRequestError)

        process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'
        const error = new Error('server exploded') as Error & { digest?: string }
        error.digest = 'digest-123'
        const cookie = postHogCookie('phc_test123', {
            distinct_id: 'user_123',
            $device_id: 'device_456',
            $sesid: [1708700000000, 'session_789', 1708700000000],
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
        const headers = { get: jest.fn((name: string) => (name === 'cookie' ? cookie : null)) }

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
                custom_property: 'custom-value',
            })
        )
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
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
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
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
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
})
