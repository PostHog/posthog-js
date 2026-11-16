const { mockCaptureExceptionImmediate, mockPostHog } = await vi.hoisted(async () => {
    const { fakeExceptionClient } = await import('./fakeExceptionClient')
    const mockCaptureExceptionImmediate = vi.fn().mockResolvedValue(undefined)
    return {
        mockCaptureExceptionImmediate,
        mockPostHog: vi.fn().mockImplementation(() => fakeExceptionClient(mockCaptureExceptionImmediate)),
    }
})

vi.mock('posthog-node', () => ({
    PostHog: mockPostHog,
}))

import { NextRequest } from 'next/server'
import type { NextFetchEvent } from 'next/server'
import { captureRequestError, createOnRequestError, onRequestError, withPostHogProxy } from '../src/server.edge'

describe('Next.js onRequestError edge runtime', () => {
    const originalEnv = process.env

    beforeEach(() => {
        vi.clearAllMocks()
        process.env = { ...originalEnv }
        process.env.NEXT_RUNTIME = 'edge'
        process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_edge_test'
        delete process.env.NEXT_PUBLIC_POSTHOG_HOST
    })

    afterAll(() => {
        process.env = originalEnv
    })

    function postHogCookie(apiKey: string, value: Record<string, unknown>): string {
        return `ph_${apiKey}_posthog=${encodeURIComponent(JSON.stringify(value))}`
    }

    // A middleware fetch event that keeps what the wrapper hands to waitUntil, as a serverless platform does.
    function middlewareEvent(): NextFetchEvent & { kept: Array<Promise<unknown>> } {
        const kept: Array<Promise<unknown>> = []
        return {
            sourcePage: '/middleware',
            kept,
            waitUntil: (promise: Promise<unknown>) => kept.push(promise),
        } as unknown as NextFetchEvent & { kept: Array<Promise<unknown>> }
    }

    // What Next.js reports for an edge middleware error, from the request that failed.
    function reportMiddlewareError(error: unknown, request: NextRequest): void | Promise<void> {
        const url = new URL(request.url)
        return onRequestError(
            error,
            {
                path: url.pathname + url.search,
                method: request.method,
                headers: Object.fromEntries(request.headers.entries()),
            },
            { routerKind: 'Pages Router', routePath: '/middleware', routeType: 'middleware' }
        )
    }

    it('captures request errors with the edge-safe posthog-node client', async () => {
        expect(onRequestError).toBe(captureRequestError)

        process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'
        const error = new Error('edge route failed') as Error & { digest?: string }
        error.digest = 'edge-digest-123'
        const cookie = postHogCookie('phc_edge_test', {
            distinct_id: 'edge_user',
            $device_id: 'edge_device',
            $sesid: [Date.now() - 60 * 1000, 'edge_session', Date.now() - 60 * 60 * 1000],
        })

        await onRequestError(
            error,
            {
                method: 'GET',
                path: '/edge-route?step=1#fragment',
                headers: { cookie },
            },
            {
                routerKind: 'App Router',
                routePath: '/edge-route',
                routeType: 'route',
                renderSource: 'server-rendering',
            }
        )

        expect(mockPostHog).toHaveBeenCalledWith(
            'phc_edge_test',
            expect.objectContaining({ host: 'https://eu.i.posthog.com' })
        )
        expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(
            error,
            'edge_user',
            expect.objectContaining({
                $http_method: 'GET',
                $pathname: '/edge-route#fragment',
                $session_id: 'edge_session',
                $device_id: 'edge_device',
                nextjs_error_digest: 'edge-digest-123',
                nextjs_router_kind: 'App Router',
                nextjs_route_path: '/edge-route',
                nextjs_route_type: 'route',
                nextjs_render_source: 'server-rendering',
            })
        )
    })

    it('supports custom options via createOnRequestError', async () => {
        const handler = createOnRequestError({
            apiKey: 'phc_edge_custom',
            host: 'https://custom.posthog.com',
            serverOptions: { flushAt: 1 },
            beforeCapture: () => ({ custom_property: 'edge-custom-value' }),
        })

        await handler(new Error('edge custom'), { headers: {} }, {})

        expect(mockPostHog).toHaveBeenCalledWith(
            'phc_edge_custom',
            expect.objectContaining({ flushAt: 1, host: 'https://custom.posthog.com' })
        )
        expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(
            expect.any(Error),
            undefined,
            expect.objectContaining({ custom_property: 'edge-custom-value' })
        )
    })

    it('reads identity from tracing headers in the edge runtime', async () => {
        await onRequestError(
            new Error('edge route failed'),
            { headers: { 'x-posthog-distinct-id': 'edge_header_user', 'x-posthog-session-id': 'edge_header_session' } },
            {}
        )

        expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(
            expect.any(Error),
            'edge_header_user',
            expect.objectContaining({ $session_id: 'edge_header_session' })
        )
    })

    it('captures edge middleware errors once with withPostHogProxy and rethrows them', async () => {
        const error = new Error('edge middleware failed')
        const middleware = withPostHogProxy(() => {
            throw error
        })
        const request = new NextRequest('https://edge.example.com/account?session=secret', {
            headers: { host: 'edge.example.com' },
        })
        const event = middlewareEvent()

        await expect(middleware(request, event)).rejects.toBe(error)
        // Next.js 15 and later report edge middleware errors to onRequestError after the middleware throws.
        await reportMiddlewareError(error, request)
        await Promise.all(event.kept)

        expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
        expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(
            error,
            undefined,
            expect.objectContaining({
                $current_url: 'https://edge.example.com/account',
                $request_path: '/account',
                nextjs_router_kind: 'Pages Router',
                nextjs_route_path: '/middleware',
                nextjs_route_type: 'middleware',
                $exception_source: 'nextjs.middleware',
                $exception_list: [expect.objectContaining({ mechanism: { type: 'middleware', handled: false } })],
            })
        )
    })

    it('leaves an edge middleware error to onRequestError when the wrapper skips it', async () => {
        const error = new Error('edge middleware failed')
        const middleware = withPostHogProxy(
            () => {
                throw error
            },
            { disabled: true }
        )
        const event = middlewareEvent()

        const request = new NextRequest('https://edge.example.com/account')
        await expect(middleware(request, event)).rejects.toBe(error)
        await reportMiddlewareError(error, request)

        expect(event.kept).toHaveLength(0)

        expect(mockCaptureExceptionImmediate).toHaveBeenCalledTimes(1)
        expect(mockCaptureExceptionImmediate).toHaveBeenCalledWith(
            error,
            undefined,
            expect.objectContaining({ nextjs_route_type: 'middleware' })
        )
    })
})
