import { RateLimiter } from '../rate-limiter'

describe('Rate Limiter', () => {
    let rateLimiter: RateLimiter

    beforeEach(() => {
        jest.useFakeTimers()
    })

    it('not every request is checked for limiting', () => {
        // you can probably do this with a jest spy but jest's mocks and spies are too confusing for me
        let accessCounter = 0
        const fakeResponse = { responseText: '{}' }
        const objectWithCounting = new Proxy(fakeResponse, {
            get: function () {
                accessCounter++
                return '{}'
            },
        })

        rateLimiter = new RateLimiter(0.1)

        // call a loop 1000 times
        for (let i = 0; i < 1000; i++) {
            rateLimiter.checkForLimiting(objectWithCounting as unknown as XMLHttpRequest)
        }
        expect(accessCounter).toBeLessThan(110)
        expect(accessCounter).toBeGreaterThanOrEqual(1)
    })

    describe('with all requests checked for limiting', () => {
        beforeEach(() => {
            rateLimiter = new RateLimiter(1)
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

        it('sets the events retryAfter on checkForLimiting', () => {
            rateLimiter.checkForLimiting({
                responseText: JSON.stringify({ quota_limited: ['events'] }),
            } as unknown as XMLHttpRequest)

            const expectedRetry = new Date().getTime() + 60_000
            expect(rateLimiter.limits).toStrictEqual({ events: expectedRetry })
        })

        it('sets the recordings retryAfter on checkForLimiting', () => {
            rateLimiter.checkForLimiting({
                responseText: JSON.stringify({ quota_limited: ['recordings'] }),
            } as unknown as XMLHttpRequest)

            const expectedRetry = new Date().getTime() + 60_000
            expect(rateLimiter.limits).toStrictEqual({ recordings: expectedRetry })
        })

        it('sets multiple retryAfter on checkForLimiting', () => {
            rateLimiter.checkForLimiting({
                responseText: JSON.stringify({ quota_limited: ['recordings', 'events', 'mystery'] }),
            } as unknown as XMLHttpRequest)

            const expectedRetry = new Date().getTime() + 60_000
            expect(rateLimiter.limits).toStrictEqual({
                events: expectedRetry,
                recordings: expectedRetry,
                mystery: expectedRetry,
            })
        })

        it('keeps existing batch keys checkForLimiting', () => {
            rateLimiter.checkForLimiting({
                responseText: JSON.stringify({ quota_limited: ['events'] }),
            } as unknown as XMLHttpRequest)

            rateLimiter.checkForLimiting({
                responseText: JSON.stringify({ quota_limited: ['recordings'] }),
            } as unknown as XMLHttpRequest)

            expect(rateLimiter.limits).toStrictEqual({
                events: expect.any(Number),
                recordings: expect.any(Number),
            })
        })

        it('replaces matching keys', () => {
            rateLimiter.checkForLimiting({
                responseText: JSON.stringify({ quota_limited: ['events'] }),
            } as unknown as XMLHttpRequest)

            const firstRetryValue = rateLimiter.limits.events
            jest.advanceTimersByTime(1000)

            rateLimiter.checkForLimiting({
                responseText: JSON.stringify({ quota_limited: ['events'] }),
            } as unknown as XMLHttpRequest)

            expect(rateLimiter.limits).toStrictEqual({
                events: firstRetryValue + 1000,
            })
        })

        it('does not set a limit if no limits are present', () => {
            rateLimiter.checkForLimiting({
                responseText: JSON.stringify({ quota_limited: [] }),
            } as unknown as XMLHttpRequest)

            expect(rateLimiter.limits).toStrictEqual({})

            rateLimiter.checkForLimiting({
                responseText: JSON.stringify({ status: 1 }),
            } as unknown as XMLHttpRequest)

            expect(rateLimiter.limits).toStrictEqual({})
        })
    })
})
