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
    cookies: {
        get: (name: string) => { name: string; value: string } | undefined
    }
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
        this.headers = new Map()
    }
}

const mockCookiesSet = jest.fn()
const mockNextResponseNext = jest.fn(() => ({
    headers: new Map(),
    cookies: { set: mockCookiesSet },
}))

jest.mock('next/server', () => ({
    NextResponse: {
        next: (...args: any[]) => mockNextResponseNext(...args),
    },
}))

const COOKIE_NAME = 'ph_phc_test123_posthog'

describe('postHogMiddleware', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockGenerateAnonymousId.mockReturnValue('mock-anon-id')
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
})
