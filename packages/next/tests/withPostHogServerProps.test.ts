import { withPostHogServerProps } from '../src/pages/withPostHogServerProps'

// Mock posthog-node
const mockCapture = jest.fn()
const mockIdentify = jest.fn()
const mockIsFeatureEnabled = jest.fn()
const mockGetFeatureFlag = jest.fn()
const mockGetFeatureFlagPayload = jest.fn()
const mockGetAllFlags = jest.fn()
const mockShutdown = jest.fn()
const mockEnterContext = jest.fn()

jest.mock('posthog-node', () => ({
    PostHog: jest.fn().mockImplementation(() => ({
        capture: mockCapture,
        identify: mockIdentify,
        isFeatureEnabled: mockIsFeatureEnabled,
        getFeatureFlag: mockGetFeatureFlag,
        getFeatureFlagPayload: mockGetFeatureFlagPayload,
        getAllFlags: mockGetAllFlags,
        shutdown: mockShutdown,
        enterContext: mockEnterContext,
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

describe('withPostHogServerProps', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('provides the raw PostHog client and distinctId to the handler', async () => {
        const getServerSideProps = withPostHogServerProps('phc_test123', async (_ctx, posthog, distinctId) => {
            expect(posthog).toBeDefined()
            expect(typeof posthog.capture).toBe('function')
            expect(typeof posthog.isFeatureEnabled).toBe('function')
            expect(typeof distinctId).toBe('string')
            return { props: {} }
        })

        const ctx = createMockContext({
            ph_phc_test123_posthog: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
            }),
        })

        await getServerSideProps(ctx)
    })

    it('reads distinct_id from the PostHog cookie in request headers', async () => {
        const getServerSideProps = withPostHogServerProps('phc_test123', async (_ctx, _posthog, distinctId) => {
            expect(distinctId).toBe('user_abc')
            return { props: {} }
        })

        const ctx = createMockContext({
            ph_phc_test123_posthog: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
            }),
        })

        await getServerSideProps(ctx)
    })

    it('generates anonymous id when no cookie exists', async () => {
        const getServerSideProps = withPostHogServerProps('phc_test123', async (_ctx, _posthog, distinctId) => {
            expect(distinctId).toBeTruthy()
            expect(typeof distinctId).toBe('string')
            return { props: {} }
        })

        const ctx = createMockContext({})
        await getServerSideProps(ctx)
    })

    it('returns the handler result', async () => {
        mockIsFeatureEnabled.mockResolvedValue(true)

        const getServerSideProps = withPostHogServerProps('phc_test123', async (_ctx, posthog, distinctId) => {
            const showFeature = await posthog.isFeatureEnabled('my-flag', distinctId)
            return { props: { showFeature } }
        })

        const ctx = createMockContext({
            ph_phc_test123_posthog: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
            }),
        })

        const result = await getServerSideProps(ctx)
        expect(result).toEqual({ props: { showFeature: true } })
    })

    it('calls enterContext with correct distinctId and properties', async () => {
        const getServerSideProps = withPostHogServerProps('phc_test123', async () => {
            return { props: {} }
        })

        const ctx = createMockContext({
            ph_phc_test123_posthog: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
                $sesid: [1708700000000, 'session-123', 1708700000000],
            }),
        })

        await getServerSideProps(ctx)
        expect(mockEnterContext).toHaveBeenCalledWith({
            distinctId: 'user_abc',
            properties: { $session_id: 'session-123', $device_id: 'device_xyz' },
        })
    })
})
