jest.mock('server-only', () => ({}))

import { postHogMiddleware } from '../src/middleware/postHogMiddleware'
import { PostHog } from 'posthog-node'

// Mock posthog-node
const mockGetAllFlags = jest.fn()
const mockShutdown = jest.fn()
jest.mock('posthog-node', () => ({
    PostHog: jest.fn().mockImplementation(() => ({
        getAllFlags: mockGetAllFlags,
        shutdown: mockShutdown,
    })),
}))

// Mock identity module so we can control the generated ID
const mockGenerateAnonymousId = jest.fn(() => 'mock-anon-id')
jest.mock('../src/shared/identity', () => ({
    generateAnonymousId: () => mockGenerateAnonymousId(),
}))

// Mock NextRequest and NextResponse
class MockNextRequest {
    url: string
    cookies: {
        get: (name: string) => { name: string; value: string } | undefined
    }
    nextUrl: { pathname: string; searchParams: URLSearchParams; clone: () => any }
    headers: Map<string, string>

    constructor(url: string, cookies: Record<string, string> = {}) {
        this.url = url
        const cookieEntries = Object.entries(cookies)
        this.cookies = {
            get: (name: string) => {
                const entry = cookieEntries.find(([k]) => k === name)
                return entry ? { name: entry[0], value: entry[1] } : undefined
            },
        }
        const parsedUrl = new URL(url)
        this.nextUrl = {
            pathname: parsedUrl.pathname,
            searchParams: parsedUrl.searchParams,
            clone: () => ({ ...this.nextUrl, pathname: this.nextUrl.pathname }),
        }
        this.headers = new Map()
    }
}

const mockCookiesSet = jest.fn()
const mockNextResponseNext = jest.fn(() => ({
    headers: new Map(),
    cookies: { set: mockCookiesSet },
}))

const mockRewriteCookiesSet = jest.fn()
const mockNextResponseRewrite = jest.fn((url: any) => ({
    headers: new Map(),
    cookies: { set: mockRewriteCookiesSet },
    url: url.toString(),
}))

jest.mock('next/server', () => ({
    NextResponse: {
        next: (...args: any[]) => mockNextResponseNext(...args),
        rewrite: (...args: any[]) => mockNextResponseRewrite(...args),
    },
}))

const COOKIE_NAME = 'ph_phc_test123_posthog'

describe('postHogMiddleware', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockGetAllFlags.mockResolvedValue({})
        mockGenerateAnonymousId.mockReturnValue('mock-anon-id')
    })

    it('returns a middleware function', () => {
        const middleware = postHogMiddleware({ apiKey: 'phc_test123' })
        expect(typeof middleware).toBe('function')
    })

    it('calls NextResponse.next() when no flags to evaluate', async () => {
        const middleware = postHogMiddleware({ apiKey: 'phc_test123' })
        const req = new MockNextRequest('https://example.com/page')

        await middleware(req as any)
        expect(mockNextResponseNext).toHaveBeenCalled()
    })

    it('evaluates feature flags and sets response headers', async () => {
        mockGetAllFlags.mockResolvedValue({
            'flag-a': true,
            'flag-b': 'variant-1',
            'flag-c': false,
        })

        const middleware = postHogMiddleware({
            apiKey: 'phc_test123',
            evaluateFlags: ['flag-a', 'flag-b', 'flag-c'],
        })

        const req = new MockNextRequest('https://example.com/page', {
            [COOKIE_NAME]: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
            }),
        })

        const response = await middleware(req as any)
        const headers = response.headers as Map<string, string>
        expect(headers.get('x-posthog-flag-flag-a')).toBe('true')
        expect(headers.get('x-posthog-flag-flag-b')).toBe('variant-1')
        expect(headers.get('x-posthog-flag-flag-c')).toBe('false')
    })

    it('rewrites URL based on feature flag value', async () => {
        mockGetAllFlags.mockResolvedValue({
            'new-landing': true,
        })

        const middleware = postHogMiddleware({
            apiKey: 'phc_test123',
            evaluateFlags: ['new-landing'],
            rewrites: {
                'new-landing': {
                    true: '/landing-v2',
                },
            },
        })

        const req = new MockNextRequest('https://example.com/', {
            [COOKIE_NAME]: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
            }),
        })

        await middleware(req as any)
        expect(mockNextResponseRewrite).toHaveBeenCalled()
    })

    it('does not rewrite when flag value does not match', async () => {
        mockGetAllFlags.mockResolvedValue({
            'new-landing': false,
        })

        const middleware = postHogMiddleware({
            apiKey: 'phc_test123',
            evaluateFlags: ['new-landing'],
            rewrites: {
                'new-landing': {
                    true: '/landing-v2',
                },
            },
        })

        const req = new MockNextRequest('https://example.com/', {
            [COOKIE_NAME]: JSON.stringify({
                distinct_id: 'user_abc',
                $device_id: 'device_xyz',
            }),
        })

        await middleware(req as any)
        expect(mockNextResponseRewrite).not.toHaveBeenCalled()
        expect(mockNextResponseNext).toHaveBeenCalled()
    })

    it('handles missing cookie gracefully', async () => {
        mockGetAllFlags.mockResolvedValue({ 'flag-a': false })

        const middleware = postHogMiddleware({
            apiKey: 'phc_test123',
            evaluateFlags: ['flag-a'],
        })

        const req = new MockNextRequest('https://example.com/')
        await middleware(req as any)
        expect(mockNextResponseNext).toHaveBeenCalled()
        // Should still call getAllFlags with a generated anonymous ID
        expect(mockGetAllFlags).toHaveBeenCalled()
    })

    it('continues on flag evaluation error', async () => {
        mockGetAllFlags.mockRejectedValue(new Error('API timeout'))
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

        const middleware = postHogMiddleware({
            apiKey: 'phc_test123',
            evaluateFlags: ['flag-a'],
        })

        const req = new MockNextRequest('https://example.com/')
        await middleware(req as any)
        expect(mockNextResponseNext).toHaveBeenCalled()
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[PostHog Next.js]'))
        consoleSpy.mockRestore()
    })

    describe('cookie seeding', () => {
        it('seeds cookie on first visit with no flags configured', async () => {
            const middleware = postHogMiddleware({ apiKey: 'phc_test123' })
            const req = new MockNextRequest('https://example.com/')

            await middleware(req as any)

            expect(mockCookiesSet).toHaveBeenCalledWith(
                COOKIE_NAME,
                expect.any(String),
                expect.objectContaining({
                    path: '/',
                    sameSite: 'lax',
                    maxAge: 365 * 24 * 60 * 60,
                    httpOnly: false,
                })
            )

            // Verify the cookie value is valid PostHog cookie JSON
            const cookieValue = mockCookiesSet.mock.calls[0][1]
            const parsed = JSON.parse(cookieValue)
            expect(parsed.distinct_id).toBe('mock-anon-id')
            expect(parsed.$device_id).toBe('mock-anon-id')
        })

        it('seeds cookie on first visit with flags configured', async () => {
            mockGetAllFlags.mockResolvedValue({ 'flag-a': true })

            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                evaluateFlags: ['flag-a'],
            })

            const req = new MockNextRequest('https://example.com/')
            await middleware(req as any)

            expect(mockCookiesSet).toHaveBeenCalledWith(
                COOKIE_NAME,
                expect.any(String),
                expect.objectContaining({
                    path: '/',
                    sameSite: 'lax',
                    httpOnly: false,
                })
            )
        })

        it('seeds cookie even when flag evaluation fails', async () => {
            mockGetAllFlags.mockRejectedValue(new Error('API error'))
            jest.spyOn(console, 'warn').mockImplementation()

            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                evaluateFlags: ['flag-a'],
            })

            const req = new MockNextRequest('https://example.com/')
            await middleware(req as any)

            expect(mockCookiesSet).toHaveBeenCalledWith(
                COOKIE_NAME,
                expect.any(String),
                expect.objectContaining({ path: '/' })
            )
        })

        it('does not overwrite existing cookie', async () => {
            const middleware = postHogMiddleware({ apiKey: 'phc_test123' })
            const req = new MockNextRequest('https://example.com/', {
                [COOKIE_NAME]: JSON.stringify({
                    distinct_id: 'existing-user',
                    $device_id: 'existing-device',
                }),
            })

            await middleware(req as any)
            expect(mockCookiesSet).not.toHaveBeenCalled()
        })

        it('does not overwrite existing cookie when flags are configured', async () => {
            mockGetAllFlags.mockResolvedValue({ 'flag-a': true })

            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                evaluateFlags: ['flag-a'],
            })

            const req = new MockNextRequest('https://example.com/', {
                [COOKIE_NAME]: JSON.stringify({
                    distinct_id: 'existing-user',
                    $device_id: 'existing-device',
                }),
            })

            await middleware(req as any)
            expect(mockCookiesSet).not.toHaveBeenCalled()
        })

        it('uses the seeded ID for flag evaluation', async () => {
            mockGenerateAnonymousId.mockReturnValue('seeded-uuid-v7')
            mockGetAllFlags.mockResolvedValue({ 'flag-a': true })

            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                evaluateFlags: ['flag-a'],
            })

            const req = new MockNextRequest('https://example.com/')
            await middleware(req as any)

            // The same generated ID should be used for both flag evaluation and cookie seeding
            expect(mockGetAllFlags).toHaveBeenCalledWith('seeded-uuid-v7', {})

            const cookieValue = mockCookiesSet.mock.calls[0][1]
            const parsed = JSON.parse(cookieValue)
            expect(parsed.distinct_id).toBe('seeded-uuid-v7')
        })

        it('seeds cookie on rewrite responses', async () => {
            mockGetAllFlags.mockResolvedValue({ 'new-landing': true })

            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                evaluateFlags: ['new-landing'],
                rewrites: {
                    'new-landing': { true: '/landing-v2' },
                },
            })

            const req = new MockNextRequest('https://example.com/')
            await middleware(req as any)

            expect(mockNextResponseRewrite).toHaveBeenCalled()
            expect(mockRewriteCookiesSet).toHaveBeenCalledWith(
                COOKIE_NAME,
                expect.any(String),
                expect.objectContaining({ path: '/' })
            )
        })
    })

    describe('lazy client creation', () => {
        const MockPostHog = jest.mocked(PostHog)

        it('does not create PostHog client when no flags configured', () => {
            MockPostHog.mockClear()

            postHogMiddleware({ apiKey: 'phc_test123' })
            expect(MockPostHog).not.toHaveBeenCalled()
        })

        it('creates PostHog client when flags are configured', () => {
            MockPostHog.mockClear()

            postHogMiddleware({
                apiKey: 'phc_test123',
                evaluateFlags: ['some-flag'],
            })
            expect(MockPostHog).toHaveBeenCalledWith('phc_test123', undefined)
        })
    })
})
