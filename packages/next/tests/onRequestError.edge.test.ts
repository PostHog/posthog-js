const mockCaptureExceptionImmediate = jest.fn().mockResolvedValue(undefined)
const mockPostHog = jest.fn().mockImplementation(() => ({
    captureExceptionImmediate: mockCaptureExceptionImmediate,
}))

jest.mock('posthog-node', () => ({
    PostHog: mockPostHog,
}))

import { captureRequestError, createOnRequestError, onRequestError } from '../src/server.edge'

describe('Next.js onRequestError edge runtime', () => {
    const originalEnv = process.env

    beforeEach(() => {
        jest.clearAllMocks()
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

    it('captures request errors with the edge-safe posthog-node client', async () => {
        expect(onRequestError).toBe(captureRequestError)

        process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'
        const error = new Error('edge route failed') as Error & { digest?: string }
        error.digest = 'edge-digest-123'
        const cookie = postHogCookie('phc_edge_test', {
            distinct_id: 'edge_user',
            $device_id: 'edge_device',
            $sesid: [1708700000000, 'edge_session', 1708700000000],
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
                $pathname: '/edge-route',
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
})
