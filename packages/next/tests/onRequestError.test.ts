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
                $pathname: '/checkout',
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
                $pathname: '/api/items',
                custom_property: 'custom-value',
            })
        )
    })

    it('skips capture when beforeCapture returns false', async () => {
        const handler = createOnRequestError({ beforeCapture: () => false })

        await handler(new Error('ignored'), { headers: {} }, {})

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

        await expect(handler(new Error('ignored'), { headers: {} }, {})).resolves.toBeUndefined()

        expect(warnSpy).toHaveBeenCalledWith(
            '[PostHog Next.js] Failed to run beforeCapture for server-side exception:',
            expect.any(Error)
        )
        expect(mockGetOrCreateNodeClient).not.toHaveBeenCalled()
        expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled()
        warnSpy.mockRestore()
    })

    it('does not throw when creating the PostHog client fails', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
        const captureError = new Error('client unavailable')
        mockGetOrCreateNodeClient.mockRejectedValueOnce(captureError)

        await expect(onRequestError(new Error('server exploded'), { headers: {} }, {})).resolves.toBeUndefined()

        expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled()
        expect(warnSpy).toHaveBeenCalledWith('[PostHog Next.js] Failed to capture server-side exception:', captureError)
        warnSpy.mockRestore()
    })

    it('does not throw when immediate exception capture fails', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
        const captureError = new Error('transport unavailable')
        const error = new Error('server exploded')
        mockCaptureExceptionImmediate.mockRejectedValueOnce(captureError)

        await expect(onRequestError(error, { headers: {} }, {})).resolves.toBeUndefined()

        expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(error, undefined, expect.any(Object))
        expect(warnSpy).toHaveBeenCalledWith('[PostHog Next.js] Failed to capture server-side exception:', captureError)
        warnSpy.mockRestore()
    })

    it('skips capture when the user has opted out', async () => {
        await onRequestError(new Error('opted out'), { headers: { cookie: '__ph_opt_in_out_phc_test123=0' } }, {})

        expect(mockGetOrCreateNodeClient).not.toHaveBeenCalled()
        expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled()
    })

    it('skips capture outside the nodejs runtime', async () => {
        process.env.NEXT_RUNTIME = 'edge'

        await onRequestError(new Error('edge error'), { headers: {} }, {})

        expect(mockGetOrCreateNodeClient).not.toHaveBeenCalled()
        expect(mockCaptureExceptionImmediate).not.toHaveBeenCalled()
    })
})
