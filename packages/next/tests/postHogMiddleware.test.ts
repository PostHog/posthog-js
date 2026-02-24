jest.mock('server-only', () => ({}))

import { postHogMiddleware } from '../src/middleware/postHogMiddleware'

// Mock identity module so we can control the generated ID
const mockGenerateAnonymousId = jest.fn(() => 'mock-anon-id')
jest.mock('../src/shared/identity', () => ({
    generateAnonymousId: () => mockGenerateAnonymousId(),
}))

// Mock NextRequest and NextResponse
class MockNextRequest {
    url: string
    nextUrl: { pathname: string; search: string }
    cookies: {
        get: (name: string) => { name: string; value: string } | undefined
    }
    headers: Map<string, string>

    constructor(url: string, cookies: Record<string, string> = {}) {
        this.url = url
        const parsed = new URL(url)
        this.nextUrl = { pathname: parsed.pathname, search: parsed.search }
        const cookieEntries = Object.entries(cookies)
        this.cookies = {
            get: (name: string) => {
                const entry = cookieEntries.find(([k]) => k === name)
                return entry ? { name: entry[0], value: entry[1] } : undefined
            },
        }
        this.headers = new Map()
    }
}

const mockCookiesSet = jest.fn()
const mockCookiesDelete = jest.fn()
const mockNextResponseNext = jest.fn(() => ({
    headers: new Map(),
    cookies: { set: mockCookiesSet, delete: mockCookiesDelete },
}))

const mockNextResponseRewrite = jest.fn((url: URL) => ({
    headers: new Map(),
    cookies: { set: jest.fn() },
    _rewriteUrl: url,
}))

jest.mock('next/server', () => ({
    NextResponse: {
        next: (...args: any[]) => mockNextResponseNext(...args),
        rewrite: (url: URL) => mockNextResponseRewrite(url),
    },
}))

const COOKIE_NAME = 'ph_phc_test123_posthog'

describe('postHogMiddleware', () => {
    const originalEnv = process.env

    beforeEach(() => {
        jest.clearAllMocks()
        mockGenerateAnonymousId.mockReturnValue('mock-anon-id')
        process.env = { ...originalEnv }
    })

    afterAll(() => {
        process.env = originalEnv
    })

    it('returns a middleware function', () => {
        const middleware = postHogMiddleware({ apiKey: 'phc_test123' })
        expect(typeof middleware).toBe('function')
    })

    it('calls NextResponse.next()', async () => {
        const middleware = postHogMiddleware({ apiKey: 'phc_test123' })
        const req = new MockNextRequest('https://example.com/page')

        await middleware(req as any)
        expect(mockNextResponseNext).toHaveBeenCalled()
    })

    describe('apiKey resolution', () => {
        it('reads apiKey from NEXT_PUBLIC_POSTHOG_KEY when not in config', async () => {
            process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_from_env'
            const middleware = postHogMiddleware({})
            const req = new MockNextRequest('https://example.com/')

            await middleware(req as any)

            expect(mockCookiesSet).toHaveBeenCalledWith(
                'ph_phc_from_env_posthog',
                expect.any(String),
                expect.any(Object)
            )
        })

        it('prefers config apiKey over env var', async () => {
            process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_from_env'
            const middleware = postHogMiddleware({ apiKey: 'phc_test123' })
            const req = new MockNextRequest('https://example.com/')

            await middleware(req as any)

            expect(mockCookiesSet).toHaveBeenCalledWith(COOKIE_NAME, expect.any(String), expect.any(Object))
        })

        it('throws when neither config nor env var provides apiKey', () => {
            delete process.env.NEXT_PUBLIC_POSTHOG_KEY
            expect(() => postHogMiddleware({})).toThrow('[PostHog Next.js] apiKey is required')
        })
    })

    describe('cookie seeding', () => {
        it('seeds cookie on first visit', async () => {
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

        it('uses the generated anonymous ID in the cookie', async () => {
            mockGenerateAnonymousId.mockReturnValue('seeded-uuid-v7')

            const middleware = postHogMiddleware({ apiKey: 'phc_test123' })
            const req = new MockNextRequest('https://example.com/')

            await middleware(req as any)

            const cookieValue = mockCookiesSet.mock.calls[0][1]
            const parsed = JSON.parse(cookieValue)
            expect(parsed.distinct_id).toBe('seeded-uuid-v7')
        })

        it('uses custom cookieMaxAgeSeconds when provided', async () => {
            const middleware = postHogMiddleware({ apiKey: 'phc_test123', cookieMaxAgeSeconds: 3600 })
            const req = new MockNextRequest('https://example.com/')

            await middleware(req as any)

            expect(mockCookiesSet).toHaveBeenCalledWith(
                COOKIE_NAME,
                expect.any(String),
                expect.objectContaining({ maxAge: 3600 })
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
    })

    describe('composable response', () => {
        it('uses the provided response instead of creating one', async () => {
            const providedCookiesSet = jest.fn()
            const providedResponse = {
                headers: new Map(),
                cookies: { set: providedCookiesSet },
            }

            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                response: providedResponse as any,
            })
            const req = new MockNextRequest('https://example.com/')

            const result = await middleware(req as any)

            expect(mockNextResponseNext).not.toHaveBeenCalled()
            expect(result).toBe(providedResponse)
            expect(providedCookiesSet).toHaveBeenCalledWith(
                COOKIE_NAME,
                expect.any(String),
                expect.objectContaining({ path: '/', sameSite: 'lax' })
            )
        })

        it('returns the provided response unmodified when cookie exists', async () => {
            const providedCookiesSet = jest.fn()
            const providedResponse = {
                headers: new Map(),
                cookies: { set: providedCookiesSet },
            }

            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                response: providedResponse as any,
            })
            const req = new MockNextRequest('https://example.com/', {
                [COOKIE_NAME]: JSON.stringify({
                    distinct_id: 'existing-user',
                    $device_id: 'existing-device',
                }),
            })

            const result = await middleware(req as any)

            expect(result).toBe(providedResponse)
            expect(providedCookiesSet).not.toHaveBeenCalled()
        })
    })

    describe('proxy', () => {
        it('proxies ingest requests to PostHog host', async () => {
            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                proxy: true,
            })
            const req = new MockNextRequest('https://example.com/ingest/e/')

            await middleware(req as any)

            expect(mockNextResponseRewrite).toHaveBeenCalledWith(expect.any(URL))
            const rewriteUrl: URL = mockNextResponseRewrite.mock.calls[0][0]
            expect(rewriteUrl.origin).toBe('https://us.i.posthog.com')
            expect(rewriteUrl.pathname).toBe('/e/')
        })

        it('preserves query string on proxy', async () => {
            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                proxy: true,
            })
            const req = new MockNextRequest('https://example.com/ingest/flags?v=2')

            await middleware(req as any)

            const rewriteUrl: URL = mockNextResponseRewrite.mock.calls[0][0]
            expect(rewriteUrl.pathname).toBe('/flags')
            expect(rewriteUrl.search).toBe('?v=2')
        })

        it('does not proxy non-ingest paths', async () => {
            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                proxy: true,
            })
            const req = new MockNextRequest('https://example.com/about')

            await middleware(req as any)

            expect(mockNextResponseRewrite).not.toHaveBeenCalled()
            expect(mockNextResponseNext).toHaveBeenCalled()
        })

        it('does not seed cookie on proxied requests', async () => {
            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                proxy: true,
            })
            const req = new MockNextRequest('https://example.com/ingest/e/')

            await middleware(req as any)

            expect(mockCookiesSet).not.toHaveBeenCalled()
        })

        it('proxies exact prefix path to root', async () => {
            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                proxy: true,
            })
            const req = new MockNextRequest('https://example.com/ingest')

            await middleware(req as any)

            const rewriteUrl: URL = mockNextResponseRewrite.mock.calls[0][0]
            expect(rewriteUrl.pathname).toBe('/')
        })

        it('supports custom pathPrefix', async () => {
            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                proxy: { pathPrefix: '/ph-proxy' },
            })
            const req = new MockNextRequest('https://example.com/ph-proxy/e/')

            await middleware(req as any)

            const rewriteUrl: URL = mockNextResponseRewrite.mock.calls[0][0]
            expect(rewriteUrl.origin).toBe('https://us.i.posthog.com')
            expect(rewriteUrl.pathname).toBe('/e/')
        })

        it('normalizes pathPrefix without leading slash', async () => {
            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                proxy: { pathPrefix: 'ingest' },
            })
            const req = new MockNextRequest('https://example.com/ingest/e/')

            await middleware(req as any)

            expect(mockNextResponseRewrite).toHaveBeenCalled()
            const rewriteUrl: URL = mockNextResponseRewrite.mock.calls[0][0]
            expect(rewriteUrl.pathname).toBe('/e/')
        })

        it('supports custom host', async () => {
            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                proxy: { host: 'https://eu.i.posthog.com' },
            })
            const req = new MockNextRequest('https://example.com/ingest/e/')

            await middleware(req as any)

            const rewriteUrl: URL = mockNextResponseRewrite.mock.calls[0][0]
            expect(rewriteUrl.origin).toBe('https://eu.i.posthog.com')
            expect(rewriteUrl.pathname).toBe('/e/')
        })

        it('has no effect when proxy is false', async () => {
            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                proxy: false,
            })
            const req = new MockNextRequest('https://example.com/ingest/e/')

            await middleware(req as any)

            expect(mockNextResponseRewrite).not.toHaveBeenCalled()
            expect(mockNextResponseNext).toHaveBeenCalled()
        })

        it('has no effect when proxy is undefined', async () => {
            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
            })
            const req = new MockNextRequest('https://example.com/ingest/e/')

            await middleware(req as any)

            expect(mockNextResponseRewrite).not.toHaveBeenCalled()
            expect(mockNextResponseNext).toHaveBeenCalled()
        })
    })

    describe('consent awareness', () => {
        const CONSENT_COOKIE = '__ph_opt_in_out_phc_test123'

        it('does not seed identity cookie when opted out (consent cookie = 0)', async () => {
            const middleware = postHogMiddleware({ apiKey: 'phc_test123' })
            const req = new MockNextRequest('https://example.com/', {
                [CONSENT_COOKIE]: '0',
            })

            await middleware(req as any)
            expect(mockCookiesSet).not.toHaveBeenCalled()
        })

        it('seeds identity cookie when opted in (consent cookie = 1)', async () => {
            const middleware = postHogMiddleware({ apiKey: 'phc_test123' })
            const req = new MockNextRequest('https://example.com/', {
                [CONSENT_COOKIE]: '1',
            })

            await middleware(req as any)
            expect(mockCookiesSet).toHaveBeenCalledWith(COOKIE_NAME, expect.any(String), expect.any(Object))
        })

        it('does not seed when no consent cookie and optOutByDefault is true', async () => {
            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                optOutByDefault: true,
            })
            const req = new MockNextRequest('https://example.com/')

            await middleware(req as any)
            expect(mockCookiesSet).not.toHaveBeenCalled()
        })

        it('seeds when no consent cookie and optOutByDefault is false (default)', async () => {
            const middleware = postHogMiddleware({ apiKey: 'phc_test123' })
            const req = new MockNextRequest('https://example.com/')

            await middleware(req as any)
            expect(mockCookiesSet).toHaveBeenCalled()
        })

        it('deletes existing identity cookie when opted out', async () => {
            const middleware = postHogMiddleware({ apiKey: 'phc_test123' })
            const req = new MockNextRequest('https://example.com/', {
                [COOKIE_NAME]: JSON.stringify({ distinct_id: 'user_123', $device_id: 'device_abc' }),
                [CONSENT_COOKIE]: '0',
            })

            await middleware(req as any)
            expect(mockCookiesDelete).toHaveBeenCalledWith(COOKIE_NAME)
        })

        it('uses custom consentCookieName', async () => {
            const middleware = postHogMiddleware({
                apiKey: 'phc_test123',
                consentCookieName: 'my_consent',
            })
            const req = new MockNextRequest('https://example.com/', {
                my_consent: '0',
            })

            await middleware(req as any)
            expect(mockCookiesSet).not.toHaveBeenCalled()
        })
    })
})
