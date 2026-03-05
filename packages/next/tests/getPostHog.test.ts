jest.mock('server-only', () => ({}))

// Mock posthog-node
const mockCapture = jest.fn()
const mockIdentify = jest.fn()
const mockIsFeatureEnabled = jest.fn()
const mockGetFeatureFlag = jest.fn()
const mockGetFeatureFlagPayload = jest.fn()
const mockGetAllFlags = jest.fn()
const mockGetAllFlagsAndPayloads = jest.fn()
const mockShutdown = jest.fn()
const mockEnterContext = jest.fn()
const mockWithContext = jest.fn((_, fn) => fn())

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
        enterContext: mockEnterContext,
        withContext: mockWithContext,
    })),
}))

// Mock next/headers cookies()
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

const mockCookieStore = createMockCookies({})

jest.mock('next/headers', () => ({
    cookies: jest.fn(() => Promise.resolve(mockCookieStore)),
}))

// Mock nodeClientCache to avoid cross-test cache pollution
const mockGetOrCreateNodeClient = jest.fn().mockImplementation(() => ({
    capture: mockCapture,
    identify: mockIdentify,
    isFeatureEnabled: mockIsFeatureEnabled,
    getFeatureFlag: mockGetFeatureFlag,
    getFeatureFlagPayload: mockGetFeatureFlagPayload,
    getAllFlags: mockGetAllFlags,
    getAllFlagsAndPayloads: mockGetAllFlagsAndPayloads,
    shutdown: mockShutdown,
    enterContext: mockEnterContext,
    withContext: mockWithContext,
}))

jest.mock('../src/server/nodeClientCache', () => ({
    getOrCreateNodeClient: (...args: unknown[]) => mockGetOrCreateNodeClient(...args),
}))

import { getPostHog } from '../src/server/getPostHog'
import { cookies } from 'next/headers'

describe('getPostHog', () => {
    const originalEnv = process.env

    beforeEach(() => {
        jest.clearAllMocks()
        process.env = { ...originalEnv }
        process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_env_key'

        // Reset to empty cookies by default
        const emptyCookies = createMockCookies({})
        ;(cookies as jest.Mock).mockResolvedValue(emptyCookies)
    })

    afterAll(() => {
        process.env = originalEnv
    })

    it('returns an IPostHog instance', async () => {
        const client = await getPostHog('phc_test123')

        expect(client).toBeDefined()
        expect(typeof client.capture).toBe('function')
        expect(typeof client.isFeatureEnabled).toBe('function')
    })

    it('wraps method calls with withContext using cookie identity', async () => {
        const cookieStore = createMockCookies({
            ph_phc_test123_posthog: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
                $sesid: [1708700000000, 'session-123', 1708700000000],
            }),
        })
        ;(cookies as jest.Mock).mockResolvedValue(cookieStore)

        const client = await getPostHog('phc_test123')
        client.capture({ distinctId: 'user_abc', event: 'test_event' })

        expect(mockWithContext).toHaveBeenCalledWith(
            {
                distinctId: 'user_abc',
                sessionId: 'session-123',
                properties: { $session_id: 'session-123', $device_id: 'device_xyz' },
            },
            expect.any(Function)
        )
        expect(mockCapture).toHaveBeenCalledWith({ distinctId: 'user_abc', event: 'test_event' })
    })

    it('wraps method calls with withContext with undefined identity when no cookie exists', async () => {
        const cookieStore = createMockCookies({})
        ;(cookies as jest.Mock).mockResolvedValue(cookieStore)

        const client = await getPostHog('phc_test123')
        client.capture({ distinctId: 'anon', event: 'test_event' })

        expect(mockWithContext).toHaveBeenCalledWith(
            {
                distinctId: undefined,
                sessionId: undefined,
                properties: undefined,
            },
            expect.any(Function)
        )
    })

    it('uses explicit apiKey over env var', async () => {
        process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_env_key'

        await getPostHog('phc_explicit_key')

        expect(mockGetOrCreateNodeClient).toHaveBeenCalledWith('phc_explicit_key', undefined)
    })

    it('falls back to NEXT_PUBLIC_POSTHOG_KEY env var when no apiKey provided', async () => {
        process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_env_key'

        await getPostHog()

        expect(mockGetOrCreateNodeClient).toHaveBeenCalledWith('phc_env_key', undefined)
    })

    it('throws when no apiKey provided and env var missing', async () => {
        delete process.env.NEXT_PUBLIC_POSTHOG_KEY

        await expect(getPostHog()).rejects.toThrow(
            '[PostHog Next.js] apiKey is required. Either pass it explicitly or set the NEXT_PUBLIC_POSTHOG_KEY environment variable.'
        )
    })

    it('passes host from options to getOrCreateNodeClient', async () => {
        await getPostHog('phc_test123', { host: 'https://custom.posthog.com' })

        expect(mockGetOrCreateNodeClient).toHaveBeenCalledWith('phc_test123', {
            host: 'https://custom.posthog.com',
        })
    })

    it('reads host from NEXT_PUBLIC_POSTHOG_HOST env var when not in options', async () => {
        process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://env-host.posthog.com'

        await getPostHog('phc_test123')

        expect(mockGetOrCreateNodeClient).toHaveBeenCalledWith('phc_test123', {
            host: 'https://env-host.posthog.com',
        })

        delete process.env.NEXT_PUBLIC_POSTHOG_HOST
    })

    it('wraps method calls with withContext with just distinctId when cookie has no session or device', async () => {
        const cookieStore = createMockCookies({
            ph_phc_test123_posthog: JSON.stringify({
                distinct_id: 'user_abc',
            }),
        })
        ;(cookies as jest.Mock).mockResolvedValue(cookieStore)

        const client = await getPostHog('phc_test123')
        client.capture({ distinctId: 'user_abc', event: 'test_event' })

        expect(mockWithContext).toHaveBeenCalledWith(
            {
                distinctId: 'user_abc',
                sessionId: undefined,
                properties: undefined,
            },
            expect.any(Function)
        )
    })

    describe('consent awareness', () => {
        it('returns the client directly without proxy when consent cookie is 0', async () => {
            const cookieStore = createMockCookies({
                ph_phc_test123_posthog: JSON.stringify({
                    distinct_id: 'user_abc',
                    $device_id: 'device_xyz',
                }),
                __ph_opt_in_out_phc_test123: '0',
            })
            ;(cookies as jest.Mock).mockResolvedValue(cookieStore)

            const client = await getPostHog('phc_test123')
            expect(client).toBeDefined()
            // When opted out, methods should not go through withContext
            client.capture({ distinctId: 'user_abc', event: 'test_event' })
            expect(mockWithContext).not.toHaveBeenCalled()
        })

        it('wraps method calls with withContext when consent cookie is 1', async () => {
            const cookieStore = createMockCookies({
                ph_phc_test123_posthog: JSON.stringify({
                    distinct_id: 'user_abc',
                    $device_id: 'device_xyz',
                }),
                __ph_opt_in_out_phc_test123: '1',
            })
            ;(cookies as jest.Mock).mockResolvedValue(cookieStore)

            const client = await getPostHog('phc_test123')
            client.capture({ distinctId: 'user_abc', event: 'test_event' })

            expect(mockWithContext).toHaveBeenCalledWith(
                expect.objectContaining({ distinctId: 'user_abc' }),
                expect.any(Function)
            )
        })
    })
})
