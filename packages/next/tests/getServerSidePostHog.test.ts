import { getServerSidePostHog } from '../src/pages/getServerSidePostHog'

const mockEnterContext = jest.fn()
const mockWithContext = jest.fn((_, fn) => fn())
const mockGetAllFlags = jest.fn()
const mockGetAllFlagsAndPayloads = jest.fn()

jest.mock('posthog-node', () => ({
    PostHog: jest.fn().mockImplementation(() => ({
        enterContext: mockEnterContext,
        withContext: mockWithContext,
        getAllFlags: mockGetAllFlags,
        getAllFlagsAndPayloads: mockGetAllFlagsAndPayloads,
    })),
}))

function createMockContext(cookies: Record<string, string> = {}, extraHeaders: Record<string, string> = {}) {
    return {
        req: {
            headers: {
                cookie: Object.entries(cookies)
                    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
                    .join('; '),
                ...extraHeaders,
            },
        },
        res: {},
        query: {},
        resolvedUrl: '/test',
    } as any
}

describe('getServerSidePostHog', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        delete process.env.NEXT_PUBLIC_POSTHOG_KEY
    })

    it('returns a posthog client', async () => {
        const { PostHog } = require('posthog-node')
        const ctx = createMockContext({
            ph_phc_test123_posthog: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
            }),
        })

        const posthog = await getServerSidePostHog(ctx, 'phc_test123')
        expect(posthog).toBeDefined()
        expect(PostHog).toHaveBeenCalledWith('phc_test123', {
            host: 'https://us.i.posthog.com',
        })
    })

    it('wraps method calls with request context from cookies', async () => {
        const ctx = createMockContext({
            ph_phc_test123_posthog: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
                $sesid: [1708700000000, 'session-123', 1708700000000],
            }),
        })

        const posthog = await getServerSidePostHog(ctx, 'phc_test123')
        posthog.getAllFlags()

        expect(mockEnterContext).not.toHaveBeenCalled()
        expect(mockWithContext).toHaveBeenCalledWith(
            {
                distinctId: 'user_abc',
                sessionId: 'session-123',
                properties: { $session_id: 'session-123', $device_id: 'device_xyz' },
            },
            expect.any(Function)
        )
        expect(mockGetAllFlags).toHaveBeenCalledWith()
    })

    it('reads apiKey from NEXT_PUBLIC_POSTHOG_KEY env when not provided', async () => {
        process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_env_key'
        const ctx = createMockContext({
            ph_phc_env_key_posthog: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
            }),
        })

        const posthog = await getServerSidePostHog(ctx)
        posthog.getAllFlags()

        expect(mockWithContext).toHaveBeenCalledWith(
            {
                distinctId: 'user_abc',
                properties: { $device_id: 'device_xyz' },
            },
            expect.any(Function)
        )
    })

    it('warns and returns a disabled client when no apiKey provided and env not set', async () => {
        const { PostHog } = require('posthog-node')
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
        const ctx = createMockContext({})

        const posthog = await getServerSidePostHog(ctx)
        posthog.getAllFlags()

        expect(posthog).toBeDefined()
        expect(PostHog).toHaveBeenCalledWith('', {
            host: 'https://us.i.posthog.com',
        })
        expect(mockEnterContext).not.toHaveBeenCalled()
        expect(mockWithContext).not.toHaveBeenCalled()
        expect(warnSpy).toHaveBeenCalledWith('[PostHog Next.js] apiKey is required — PostHog will not be initialized')
        warnSpy.mockRestore()
    })

    it('trims apiKey and host before creating the node client', async () => {
        const { PostHog } = require('posthog-node')
        const ctx = createMockContext({})

        await getServerSidePostHog(ctx, '  phc_test123\n', { host: '  https://custom.posthog.com/\t ' })

        expect(PostHog).toHaveBeenCalledWith('phc_test123', {
            host: 'https://custom.posthog.com/',
        })
    })

    it('defaults host when it is omitted', async () => {
        const { PostHog } = require('posthog-node')
        const ctx = createMockContext({})

        await getServerSidePostHog(ctx, 'phc_default_host_test')

        expect(PostHog).toHaveBeenCalledWith('phc_default_host_test', {
            host: 'https://us.i.posthog.com',
        })
    })

    describe('tracing headers', () => {
        it('uses tracing headers when present and no cookie exists', async () => {
            const ctx = createMockContext(
                {},
                {
                    'x-posthog-session-id': 'header-session-456',
                    'x-posthog-distinct-id': 'header-user-789',
                    'x-posthog-window-id': 'window-abc',
                }
            )

            const posthog = await getServerSidePostHog(ctx, 'phc_test123')
            posthog.getAllFlags()

            expect(mockWithContext).toHaveBeenCalledWith(
                {
                    distinctId: 'header-user-789',
                    sessionId: 'header-session-456',
                    properties: {
                        $session_id: 'header-session-456',
                        $window_id: 'window-abc',
                    },
                },
                expect.any(Function)
            )
        })

        it('tracing headers override cookie values for distinctId and sessionId', async () => {
            const ctx = createMockContext(
                {
                    ph_phc_test123_posthog: JSON.stringify({
                        distinct_id: 'cookie-user',
                        $device_id: 'device_xyz',
                        $sesid: [1708700000000, 'cookie-session', 1708700000000],
                    }),
                },
                {
                    'x-posthog-session-id': 'header-session',
                    'x-posthog-distinct-id': 'header-user',
                }
            )

            const posthog = await getServerSidePostHog(ctx, 'phc_test123')
            posthog.getAllFlags()

            expect(mockWithContext).toHaveBeenCalledWith(
                {
                    distinctId: 'header-user',
                    sessionId: 'header-session',
                    properties: {
                        $session_id: 'header-session',
                        $device_id: 'device_xyz',
                    },
                },
                expect.any(Function)
            )
        })

        it('falls back to cookie values when tracing headers are absent', async () => {
            const ctx = createMockContext({
                ph_phc_test123_posthog: JSON.stringify({
                    distinct_id: 'cookie-user',
                    $device_id: 'device_xyz',
                    $sesid: [1708700000000, 'cookie-session', 1708700000000],
                }),
            })

            const posthog = await getServerSidePostHog(ctx, 'phc_test123')
            posthog.getAllFlags()

            expect(mockWithContext).toHaveBeenCalledWith(
                {
                    distinctId: 'cookie-user',
                    sessionId: 'cookie-session',
                    properties: { $session_id: 'cookie-session', $device_id: 'device_xyz' },
                },
                expect.any(Function)
            )
        })

        it('adds $window_id from tracing headers alongside cookie properties', async () => {
            const ctx = createMockContext(
                {
                    ph_phc_test123_posthog: JSON.stringify({
                        distinct_id: 'cookie-user',
                        $device_id: 'device_xyz',
                        $sesid: [1708700000000, 'cookie-session', 1708700000000],
                    }),
                },
                {
                    'x-posthog-window-id': 'window-123',
                }
            )

            const posthog = await getServerSidePostHog(ctx, 'phc_test123')
            posthog.getAllFlags()

            expect(mockWithContext).toHaveBeenCalledWith(
                {
                    distinctId: 'cookie-user',
                    sessionId: 'cookie-session',
                    properties: {
                        $session_id: 'cookie-session',
                        $device_id: 'device_xyz',
                        $window_id: 'window-123',
                    },
                },
                expect.any(Function)
            )
        })
    })
})
