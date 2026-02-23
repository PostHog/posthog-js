import { withPostHogServerProps } from '../src/pages/withPostHogServerProps'

// Mock posthog-node
const mockCapture = jest.fn()
const mockIdentify = jest.fn()
const mockIsFeatureEnabled = jest.fn()
const mockGetFeatureFlag = jest.fn()
const mockGetFeatureFlagPayload = jest.fn()
const mockGetAllFlags = jest.fn()
const mockShutdown = jest.fn()

jest.mock('posthog-node', () => ({
    PostHog: jest.fn().mockImplementation(() => ({
        capture: mockCapture,
        identify: mockIdentify,
        isFeatureEnabled: mockIsFeatureEnabled,
        getFeatureFlag: mockGetFeatureFlag,
        getFeatureFlagPayload: mockGetFeatureFlagPayload,
        getAllFlags: mockGetAllFlags,
        shutdown: mockShutdown,
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

    it('provides a PostHogServerClient to the handler', async () => {
        const getServerSideProps = withPostHogServerProps('phc_test123', async (_ctx, posthog) => {
            expect(posthog).toBeDefined()
            expect(typeof posthog.capture).toBe('function')
            expect(typeof posthog.isFeatureEnabled).toBe('function')
            expect(typeof posthog.getDistinctId).toBe('function')
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
        const getServerSideProps = withPostHogServerProps('phc_test123', async (_ctx, posthog) => {
            expect(posthog.getDistinctId()).toBe('user_abc')
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
        const getServerSideProps = withPostHogServerProps('phc_test123', async (_ctx, posthog) => {
            const distinctId = posthog.getDistinctId()
            expect(distinctId).toBeTruthy()
            expect(typeof distinctId).toBe('string')
            return { props: {} }
        })

        const ctx = createMockContext({})
        await getServerSideProps(ctx)
    })

    it('returns the handler result', async () => {
        mockIsFeatureEnabled.mockResolvedValue(true)

        const getServerSideProps = withPostHogServerProps('phc_test123', async (_ctx, posthog) => {
            const showFeature = await posthog.isFeatureEnabled('my-flag')
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

    it('scopes capture calls to the cookie distinct_id', async () => {
        const getServerSideProps = withPostHogServerProps('phc_test123', async (_ctx, posthog) => {
            posthog.capture('test_event', { page: '/dashboard' })
            return { props: {} }
        })

        const ctx = createMockContext({
            ph_phc_test123_posthog: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
            }),
        })

        await getServerSideProps(ctx)
        expect(mockCapture).toHaveBeenCalledWith({
            distinctId: 'user_abc',
            event: 'test_event',
            properties: { $device_id: 'device_xyz', page: '/dashboard' },
        })
    })
})
