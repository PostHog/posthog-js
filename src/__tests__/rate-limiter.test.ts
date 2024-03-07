import { window } from '../../src/utils/globals'
import { RateLimiter } from '../rate-limiter'
import { logger } from '../utils/logger'

jest.mock('../../src/utils/logger')

describe('Rate Limiter', () => {
    let rateLimiter: RateLimiter
    let systemTime: number
    let persistedBucket = {}

    const moveTimeForward = (milliseconds: number) => {
        systemTime += milliseconds
        jest.setSystemTime(systemTime)
    }

    const range = (n: number) => Array.from({ length: n }, (_, i) => i)

    beforeEach(() => {
        jest.useFakeTimers()
        jest.spyOn(window.console, 'error').mockImplementation()

        const baseUTCDateTime = new Date(Date.UTC(2020, 0, 1, 0, 0, 0))
        systemTime = baseUTCDateTime.getTime()
        moveTimeForward(0)

        persistedBucket = {}

        const mockPostHog = {
            config: {
                rate_limiting: {
                    events_per_second: 10,
                    events_burst_limit: 100,
                },
            },
            persistence: {
                get_property: jest.fn((key) => persistedBucket[key]),
                set_property: jest.fn((key, value) => {
                    persistedBucket[key] = value
                }),
            },
        }

        rateLimiter = new RateLimiter(mockPostHog as any)
    })

    describe('client side', () => {
        it('starts with the max tokens', () => {
            rateLimiter.isCaptureRateLimited(true)
            expect(persistedBucket['$capture_rate_limit']).toEqual({
                tokens: 100,
                last: systemTime,
            })
            expect(rateLimiter.isCaptureRateLimited()).toBe(false)
        })

        it('subtracts a token with each call', () => {
            range(5).forEach(() => {
                expect(rateLimiter.isCaptureRateLimited()).toBe(false)
            })
            expect(persistedBucket['$capture_rate_limit']).toEqual({
                tokens: 95,
                last: systemTime,
            })
        })

        it('adds tokens if time has passed ', () => {
            range(50).forEach(() => {
                expect(rateLimiter.isCaptureRateLimited()).toBe(false)
            })
            expect(persistedBucket['$capture_rate_limit']).toEqual({
                tokens: 50,
                last: systemTime,
            })

            moveTimeForward(2000) // 2 seconds = 20 tokens
            expect(rateLimiter.isCaptureRateLimited()).toBe(false)
            expect(persistedBucket['$capture_rate_limit']).toEqual({
                tokens: 69, // 50 + 20 - 1
                last: systemTime,
            })
        })

        it('rate limits when past the threshold ', () => {
            range(100).forEach(() => {
                expect(rateLimiter.isCaptureRateLimited()).toBe(false)
            })
            range(200).forEach(() => {
                expect(rateLimiter.isCaptureRateLimited()).toBe(true)
            })
            expect(persistedBucket['$capture_rate_limit']).toEqual({
                tokens: 0,
                last: systemTime,
            })

            moveTimeForward(2000) // 2 seconds = 20 tokens
            expect(rateLimiter.isCaptureRateLimited()).toBe(false)
            expect(persistedBucket['$capture_rate_limit']).toEqual({
                tokens: 19, // 20 - 1
                last: systemTime,
            })
        })

        it('refills up to the maximum amount ', () => {
            range(100).forEach(() => {
                expect(rateLimiter.isCaptureRateLimited()).toBe(false)
            })
            expect(rateLimiter.isCaptureRateLimited()).toBe(true)
            expect(persistedBucket['$capture_rate_limit'].tokens).toEqual(0)

            moveTimeForward(1000000)
            expect(rateLimiter.isCaptureRateLimited()).toBe(false)
            expect(persistedBucket['$capture_rate_limit'].tokens).toEqual(99) // limit - 1
        })
    })

    it('sets the events retryAfter on checkForLimiting', () => {
        rateLimiter.checkForLimiting({
            statusCode: 200,
            text: JSON.stringify({ quota_limited: ['events'] }),
        })

        const expectedRetry = new Date().getTime() + 60_000
        expect(rateLimiter.limits).toStrictEqual({ events: expectedRetry })
    })

    it('sets the recordings retryAfter on checkForLimiting', () => {
        rateLimiter.checkForLimiting({
            statusCode: 200,
            text: JSON.stringify({ quota_limited: ['recordings'] }),
        })

        it('is not rate limited if there is mo matching batch key in persistence', () => {
            rateLimiter.serverLimits = { 'a different batch key': 1000 }

    it('sets multiple retryAfter on checkForLimiting', () => {
        rateLimiter.checkForLimiting({
            statusCode: 200,
            text: JSON.stringify({ quota_limited: ['recordings', 'events', 'mystery'] }),
        })

        it('is not rate limited if the retryAfter is in the past', () => {
            rateLimiter.serverLimits = { 'the batch key': new Date(Date.now() - 1000).getTime() }

    it('keeps existing batch keys checkForLimiting', () => {
        rateLimiter.checkForLimiting({
            statusCode: 200,
            text: JSON.stringify({ quota_limited: ['events'] }),
        })

        rateLimiter.checkForLimiting({
            statusCode: 200,
            text: JSON.stringify({ quota_limited: ['recordings'] }),
        })

            expect(rateLimiter.isServerRateLimited('the batch key')).toBe(true)
        })

    it('replaces matching keys', () => {
        rateLimiter.checkForLimiting({
            statusCode: 200,
            text: JSON.stringify({ quota_limited: ['events'] }),
        })

        it('sets the recordings retryAfter on checkForLimiting', () => {
            rateLimiter.checkForLimiting({
                responseText: JSON.stringify({ quota_limited: ['recordings'] }),
            })

        rateLimiter.checkForLimiting({
            statusCode: 200,
            text: JSON.stringify({ quota_limited: ['events'] }),
        })

        it('sets multiple retryAfter on checkForLimiting', () => {
            rateLimiter.checkForLimiting({
                responseText: JSON.stringify({ quota_limited: ['recordings', 'events', 'mystery'] }),
            })

            const expectedRetry = new Date().getTime() + 60_000
            expect(rateLimiter.serverLimits).toStrictEqual({
                events: expectedRetry,
                recordings: expectedRetry,
                mystery: expectedRetry,
            })
        })

    it('does not set a limit if no limits are present', () => {
        rateLimiter.checkForLimiting({
            statusCode: 200,
            text: JSON.stringify({ quota_limited: [] }),
        })

        it('replaces matching keys', () => {
            rateLimiter.checkForLimiting({
                responseText: JSON.stringify({ quota_limited: ['events'] }),
            })

        rateLimiter.checkForLimiting({
            statusCode: 200,
            text: JSON.stringify({ status: 1 }),
        })

        it('does not set a limit if no limits are present', () => {
            rateLimiter.checkForLimiting({
                responseText: JSON.stringify({ quota_limited: [] }),
            })

            expect(rateLimiter.serverLimits).toStrictEqual({})

    it('does not log an error when there is an empty body', () => {
        rateLimiter.checkForLimiting({
            statusCode: 500,
            text: '',
        })

        it('does not log an error when there is an empty body', () => {
            rateLimiter.checkForLimiting({
                responseText: '',
            })

            expect(jest.mocked(logger).error).not.toHaveBeenCalled()
        })
    })
})
