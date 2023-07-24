import { RateLimiter } from '../rate-limiter'

describe('Rate Limiter', () => {
    let rateLimiter: RateLimiter

    beforeEach(() => {
        jest.useFakeTimers()

        rateLimiter = new RateLimiter()
    })

    it('is not rate limited with no batch key', () => {
        expect(rateLimiter.isRateLimited(undefined)).toBe(false)
    })

    it('is not rate limited if there is nothing in persistence', () => {
        expect(rateLimiter.isRateLimited('the batch key')).toBe(false)
    })

    it('is not rate limited if there is mo matching batch key in persistence', () => {
        rateLimiter.limits = { 'a different batch key': 1000 }

        expect(rateLimiter.isRateLimited('the batch key')).toBe(false)
    })

    it('is not rate limited if the retryAfter is in the past', () => {
        rateLimiter.limits = { 'the batch key': new Date(Date.now() - 1000).getTime() }

        expect(rateLimiter.isRateLimited('the batch key')).toBe(false)
    })

    it('is rate limited if the retryAfter is in the future', () => {
        rateLimiter.limits = { 'the batch key': new Date(Date.now() + 1000).getTime() }

        expect(rateLimiter.isRateLimited('the batch key')).toBe(true)
    })

    it('sets the retryAfter on429Response', () => {
        rateLimiter.on429Response({
            status: 429,
            getResponseHeader: (name: string) => (name === 'X-PostHog-Retry-After-Events' ? '150' : null),
        } as unknown as XMLHttpRequest)

        expect(rateLimiter.limits).toStrictEqual({ events: new Date().getTime() + 150_000 })
    })

    it('sets the retryAfter to a default if the header is not a number in on429Response', () => {
        rateLimiter.on429Response({
            status: 429,
            getResponseHeader: (name: string) => (name === 'X-PostHog-Retry-After-Events' ? 'tomato' : null),
        } as unknown as XMLHttpRequest)

        expect(rateLimiter.limits).toStrictEqual({ events: new Date().getTime() + 60_000 })
    })

    it('keeps existing batch keys on429Response', () => {
        rateLimiter.limits = { 'some-other-key': 4000 }
        rateLimiter.on429Response({
            status: 429,
            getResponseHeader: (name: string) => (name === 'X-PostHog-Retry-After-Events' ? '150' : null),
        } as unknown as XMLHttpRequest)

        expect(rateLimiter.limits).toStrictEqual({
            'some-other-key': 4000,
            events: new Date().getTime() + 150_000,
        })
    })

    it('replaces matching keys on429Response and ignores unexpected ones', () => {
        rateLimiter.limits = { 'some-other-key': 4000, events: 1000 }
        rateLimiter.on429Response({
            status: 429,
            getResponseHeader: (name: string) => {
                if (name === 'X-PostHog-Retry-After-Events') {
                    return '150'
                } else if (name === 'X-PostHog-Retry-After-Recordings') {
                    return '200'
                }
                return null
            },
        } as unknown as XMLHttpRequest)

        expect(rateLimiter.limits).toStrictEqual({
            'some-other-key': 4000,
            events: new Date().getTime() + 150_000,
            sessionRecording: new Date().getTime() + 200_000,
        })
    })

    it('does not set a limit if no Retry-After header is present', () => {
        rateLimiter.on429Response({
            status: 429,
            getResponseHeader: () => null,
        } as unknown as XMLHttpRequest)

        expect(rateLimiter.limits).toStrictEqual({})
    })

    it('does not replace any limits if no Retry-After header is present', () => {
        rateLimiter.limits = { 'some-other-key': 4000, events: 1000 }

        rateLimiter.on429Response({
            status: 429,
            getResponseHeader: () => null,
        } as unknown as XMLHttpRequest)

        expect(rateLimiter.limits).toStrictEqual({ 'some-other-key': 4000, events: 1000 })
    })
})
