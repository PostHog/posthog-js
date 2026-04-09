import { getServerSidePostHog } from '../src/pages/getServerSidePostHog'

const mockEnterContext = jest.fn()
const mockGetAllFlags = jest.fn()
const mockGetAllFlagsAndPayloads = jest.fn()

jest.mock('posthog-node', () => ({
    PostHog: jest.fn().mockImplementation(() => ({
        enterContext: mockEnterContext,
        getAllFlags: mockGetAllFlags,
        getAllFlagsAndPayloads: mockGetAllFlagsAndPayloads,
    })),
}))

function createMockContext(
    cookies: Record<string, string> = {},
    extraHeaders: Record<string, string> = {}
) {
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
        const ctx = createMockContext({
            ph_phc_test123_posthog: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
            }),
        })

        const posthog = await getServerSidePostHog(ctx, 'phc_test123')
        expect(posthog).toBeDefined()
    })

    it('calls enterContext with distinctId and properties', async () => {
        const ctx = createMockContext({
            ph_phc_test123_posthog: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
                $sesid: [1708700000000, 'session-123', 1708700000000],
            }),
        })

        await getServerSidePostHog(ctx, 'phc_test123')
        expect(mockEnterContext).toHaveBeenCalledWith({
            distinctId: 'user_abc',
            sessionId: 'session-123',
            properties: { $session_id: 'session-123', $device_id: 'device_xyz' },
        })
    })

    it('reads apiKey from NEXT_PUBLIC_POSTHOG_KEY env when not provided', async () => {
        process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_env_key'
        const ctx = createMockContext({
            ph_phc_env_key_posthog: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
            }),
        })

        await getServerSidePostHog(ctx)
        expect(mockEnterContext).toHaveBeenCalledWith({
            distinctId: 'user_abc',
            properties: { $device_id: 'device_xyz' },
        })
    })

    it('throws when no apiKey provided and env not set', async () => {
        const ctx = createMockContext({})
        await expect(getServerSidePostHog(ctx)).rejects.toThrow('apiKey is required')
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

            await getServerSidePostHog(ctx, 'phc_test123')
            expect(mockEnterContext).toHaveBeenCalledWith({
                distinctId: 'header-user-789',
                sessionId: 'header-session-456',
                properties: {
                    $session_id: 'header-session-456',
                    $window_id: 'window-abc',
                },
            })
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

            await getServerSidePostHog(ctx, 'phc_test123')
            expect(mockEnterContext).toHaveBeenCalledWith({
                distinctId: 'header-user',
                sessionId: 'header-session',
                properties: {
                    $session_id: 'header-session',
                    $device_id: 'device_xyz',
                },
            })
        })

        it('falls back to cookie values when tracing headers are absent', async () => {
            const ctx = createMockContext({
                ph_phc_test123_posthog: JSON.stringify({
                    distinct_id: 'cookie-user',
                    $device_id: 'device_xyz',
                    $sesid: [1708700000000, 'cookie-session', 1708700000000],
                }),
            })

            await getServerSidePostHog(ctx, 'phc_test123')
            expect(mockEnterContext).toHaveBeenCalledWith({
                distinctId: 'cookie-user',
                sessionId: 'cookie-session',
                properties: { $session_id: 'cookie-session', $device_id: 'device_xyz' },
            })
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

            await getServerSidePostHog(ctx, 'phc_test123')
            expect(mockEnterContext).toHaveBeenCalledWith({
                distinctId: 'cookie-user',
                sessionId: 'cookie-session',
                properties: {
                    $session_id: 'cookie-session',
                    $device_id: 'device_xyz',
                    $window_id: 'window-123',
                },
            })
        })
    })
})
