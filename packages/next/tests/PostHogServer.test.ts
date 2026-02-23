jest.mock('server-only', () => ({}))

import { PostHogServer } from '../src/server/PostHogServer'

// Mock posthog-node
const mockCapture = jest.fn()
const mockIdentify = jest.fn()
const mockIsFeatureEnabled = jest.fn()
const mockGetFeatureFlag = jest.fn()
const mockGetFeatureFlagPayload = jest.fn()
const mockGetAllFlags = jest.fn()
const mockGetAllFlagsAndPayloads = jest.fn()
const mockShutdown = jest.fn()

jest.mock('posthog-node', () => ({
    PostHog: jest.fn().mockImplementation(() => ({
        capture: mockCapture,
        identify: mockIdentify,
        isFeatureEnabled: mockIsFeatureEnabled,
        getFeatureFlag: mockGetFeatureFlag,
        getFeatureFlagPayload: mockGetFeatureFlagPayload,
        getAllFlags: mockGetAllFlags,
        getAllFlagsAndPayloads: mockGetAllFlagsAndPayloads,
        shutdown: mockShutdown,
    })),
}))

// Mock cookie jar
function createMockCookies(entries: Record<string, string>) {
    return {
        get: jest.fn((name: string) => {
            const value = entries[name]
            return value !== undefined ? { name, value } : undefined
        }),
        getAll: jest.fn(() => Object.entries(entries).map(([name, value]) => ({ name, value }))),
        has: jest.fn((name: string) => name in entries),
    }
}

describe('PostHogServer', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('throws when apiKey is empty', () => {
        expect(() => new PostHogServer('')).toThrow('[PostHog Next.js] apiKey is required')
    })

    describe('getClient', () => {
        it('reads distinct_id from PostHog cookie', () => {
            const server = new PostHogServer('phc_test123')
            const cookies = createMockCookies({
                ph_phc_test123_posthog: JSON.stringify({
                    distinct_id: 'user_abc',
                    $device_id: 'device_xyz',
                }),
            })

            const client = server.getClient(cookies as any)
            expect(client.getDistinctId()).toBe('user_abc')
        })

        it('generates anonymous distinct_id when no cookie exists', () => {
            const server = new PostHogServer('phc_test123')
            const cookies = createMockCookies({})

            const client = server.getClient(cookies as any)
            const distinctId = client.getDistinctId()
            expect(distinctId).toBeTruthy()
            expect(typeof distinctId).toBe('string')
        })

        it('scopes capture calls to the extracted distinct_id', () => {
            const server = new PostHogServer('phc_test123')
            const cookies = createMockCookies({
                ph_phc_test123_posthog: JSON.stringify({
                    distinct_id: 'user_abc',
                    $device_id: 'device_xyz',
                }),
            })

            const client = server.getClient(cookies as any)
            client.capture('test_event', { key: 'value' })

            expect(mockCapture).toHaveBeenCalledWith({
                distinctId: 'user_abc',
                event: 'test_event',
                properties: { key: 'value' },
            })
        })

        it('scopes isFeatureEnabled to the extracted distinct_id', async () => {
            mockIsFeatureEnabled.mockResolvedValue(true)
            const server = new PostHogServer('phc_test123')
            const cookies = createMockCookies({
                ph_phc_test123_posthog: JSON.stringify({
                    distinct_id: 'user_abc',
                    $device_id: 'device_xyz',
                }),
            })

            const client = server.getClient(cookies as any)
            const result = await client.isFeatureEnabled('my-flag')

            expect(result).toBe(true)
            expect(mockIsFeatureEnabled).toHaveBeenCalledWith('my-flag', 'user_abc', {})
        })

        it('scopes getAllFlags to the extracted distinct_id', async () => {
            mockGetAllFlags.mockResolvedValue({ 'flag-a': true, 'flag-b': 'variant' })
            const server = new PostHogServer('phc_test123')
            const cookies = createMockCookies({
                ph_phc_test123_posthog: JSON.stringify({
                    distinct_id: 'user_abc',
                    $device_id: 'device_xyz',
                }),
            })

            const client = server.getClient(cookies as any)
            const flags = await client.getAllFlags()

            expect(flags).toEqual({ 'flag-a': true, 'flag-b': 'variant' })
            expect(mockGetAllFlags).toHaveBeenCalledWith('user_abc', {})
        })

        it('supports getAllFlagsAndPayloads', async () => {
            mockGetAllFlagsAndPayloads.mockResolvedValue({
                featureFlags: { 'flag-a': true },
                featureFlagPayloads: { 'flag-a': { discount: 10 } },
            })
            const server = new PostHogServer('phc_test123')
            const cookies = createMockCookies({
                ph_phc_test123_posthog: JSON.stringify({
                    distinct_id: 'user_abc',
                    $device_id: 'device_xyz',
                }),
            })

            const client = server.getClient(cookies as any)
            const result = await client.getAllFlagsAndPayloads()

            expect(result).toEqual({
                featureFlags: { 'flag-a': true },
                featureFlagPayloads: { 'flag-a': { discount: 10 } },
            })
            expect(mockGetAllFlagsAndPayloads).toHaveBeenCalledWith('user_abc', {})
        })

        it('supports getAllFlags with flagKeys', async () => {
            mockGetAllFlags.mockResolvedValue({ 'flag-a': true })
            const server = new PostHogServer('phc_test123')
            const cookies = createMockCookies({
                ph_phc_test123_posthog: JSON.stringify({
                    distinct_id: 'user_abc',
                    $device_id: 'device_xyz',
                }),
            })

            const client = server.getClient(cookies as any)
            await client.getAllFlags({ flagKeys: ['flag-a'] })

            expect(mockGetAllFlags).toHaveBeenCalledWith('user_abc', { flagKeys: ['flag-a'] })
        })

        it('forwards options to getAllFlagsAndPayloads', async () => {
            mockGetAllFlagsAndPayloads.mockResolvedValue({
                featureFlags: { 'flag-a': true },
                featureFlagPayloads: { 'flag-a': { discount: 10 } },
            })
            const server = new PostHogServer('phc_test123')
            const cookies = createMockCookies({
                ph_phc_test123_posthog: JSON.stringify({
                    distinct_id: 'user_abc',
                    $device_id: 'device_xyz',
                }),
            })

            const client = server.getClient(cookies as any)
            await client.getAllFlagsAndPayloads({ flagKeys: ['flag-a'], groups: { company: 'posthog' } })

            expect(mockGetAllFlagsAndPayloads).toHaveBeenCalledWith('user_abc', {
                flagKeys: ['flag-a'],
                groups: { company: 'posthog' },
            })
        })
    })

    describe('getClientForDistinctId', () => {
        it('uses the provided distinct_id', () => {
            const server = new PostHogServer('phc_test123')
            const client = server.getClientForDistinctId('explicit_user')

            expect(client.getDistinctId()).toBe('explicit_user')
        })

        it('scopes capture calls to the provided distinct_id', () => {
            const server = new PostHogServer('phc_test123')
            const client = server.getClientForDistinctId('explicit_user')
            client.capture('event', { prop: 'val' })

            expect(mockCapture).toHaveBeenCalledWith({
                distinctId: 'explicit_user',
                event: 'event',
                properties: { prop: 'val' },
            })
        })
    })

    describe('shutdown', () => {
        it('delegates shutdown to the underlying posthog-node client', async () => {
            const server = new PostHogServer('phc_test123')
            const cookies = createMockCookies({})
            const client = server.getClient(cookies as any)

            await client.shutdown()
            expect(mockShutdown).toHaveBeenCalled()
        })
    })
})
