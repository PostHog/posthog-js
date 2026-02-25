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

function createMockContext(cookies: Record<string, string> = {}) {
    return {
        req: {
            headers: {
                cookie: Object.entries(cookies)
                    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
                    .join('; '),
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

    it('returns a posthog client', () => {
        const ctx = createMockContext({
            ph_phc_test123_posthog: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
            }),
        })

        const posthog = getServerSidePostHog(ctx, 'phc_test123')
        expect(posthog).toBeDefined()
    })

    it('calls enterContext with distinctId and properties', () => {
        const ctx = createMockContext({
            ph_phc_test123_posthog: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
                $sesid: [1708700000000, 'session-123', 1708700000000],
            }),
        })

        getServerSidePostHog(ctx, 'phc_test123')
        expect(mockEnterContext).toHaveBeenCalledWith({
            distinctId: 'user_abc',
            properties: { $session_id: 'session-123', $device_id: 'device_xyz' },
        })
    })

    it('reads apiKey from NEXT_PUBLIC_POSTHOG_KEY env when not provided', () => {
        process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_env_key'
        const ctx = createMockContext({
            ph_phc_env_key_posthog: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
            }),
        })

        getServerSidePostHog(ctx)
        expect(mockEnterContext).toHaveBeenCalledWith({
            distinctId: 'user_abc',
            properties: { $device_id: 'device_xyz' },
        })
    })

    it('throws when no apiKey provided and env not set', () => {
        const ctx = createMockContext({})
        expect(() => getServerSidePostHog(ctx)).toThrow('apiKey is required')
    })
})
