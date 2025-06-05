import { jest } from '@jest/globals'
import { BucketedRateLimiter } from '../../utils/bucketed-rate-limiter'

jest.useFakeTimers()

describe('BucketedRateLimiter', () => {
    let rateLimiter: BucketedRateLimiter<string>

    beforeEach(() => {
        rateLimiter = new BucketedRateLimiter({
            bucketSize: 10,
            refillRate: 1,
            refillInterval: 1000,
        })
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    test('it is not rate limited by default', () => {
        const result = rateLimiter.consumeRateLimit('ResizeObserver')
        expect(result).toBe(false)
    })

    test('returns true if no mutations are left', () => {
        rateLimiter['_buckets']['ResizeObserver'] = 0

        const result = rateLimiter.consumeRateLimit('ResizeObserver')
        expect(result).toBe(true)
    })
})
