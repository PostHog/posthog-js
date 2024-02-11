import { window } from '../../src/utils/globals'
import { RateLimiter } from '../rate-limiter'
import { logger } from '../utils/logger'

jest.mock('../../src/utils/logger')

describe('Rate Limiter', () => {
    let rateLimiter: RateLimiter

    beforeEach(() => {
        jest.useFakeTimers()
        rateLimiter = new RateLimiter()
        jest.spyOn(window!.console, 'error').mockImplementation()
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
        })

        const expectedRetry = new Date().getTime() + 60_000
        expect(rateLimiter.limits).toStrictEqual({ events: expectedRetry })
    })

    it('sets the recordings retryAfter on checkForLimiting', () => {
        rateLimiter.checkForLimiting({
            responseText: JSON.stringify({ quota_limited: ['recordings'] }),
        })

        const expectedRetry = new Date().getTime() + 60_000
        expect(rateLimiter.limits).toStrictEqual({ recordings: expectedRetry })
    })

    it('sets multiple retryAfter on checkForLimiting', () => {
        rateLimiter.checkForLimiting({
            responseText: JSON.stringify({ quota_limited: ['recordings', 'events', 'mystery'] }),
        })

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
        })

        rateLimiter.checkForLimiting({
            responseText: JSON.stringify({ quota_limited: ['recordings'] }),
        })

        expect(rateLimiter.limits).toStrictEqual({
            events: expect.any(Number),
            recordings: expect.any(Number),
        })
    })

    it('replaces matching keys', () => {
        rateLimiter.checkForLimiting({
            responseText: JSON.stringify({ quota_limited: ['events'] }),
        })

        const firstRetryValue = rateLimiter.limits.events
        jest.advanceTimersByTime(1000)

        rateLimiter.checkForLimiting({
            responseText: JSON.stringify({ quota_limited: ['events'] }),
        })

        expect(rateLimiter.limits).toStrictEqual({
            events: firstRetryValue + 1000,
        })
    })

    it('does not set a limit if no limits are present', () => {
        rateLimiter.checkForLimiting({
            responseText: JSON.stringify({ quota_limited: [] }),
        })

        expect(rateLimiter.limits).toStrictEqual({})

        rateLimiter.checkForLimiting({
            responseText: JSON.stringify({ status: 1 }),
        })

        expect(rateLimiter.limits).toStrictEqual({})
    })

    it('does not log an error when there is an empty body', () => {
        rateLimiter.checkForLimiting({
            responseText: '',
        })

        expect(jest.mocked(logger).error).not.toHaveBeenCalled()
    })
})
