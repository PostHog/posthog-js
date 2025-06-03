import { ExceptionRateLimiter } from '../../../extensions/exception-autocapture/exception-rate-limiter'
import { jest } from '@jest/globals'

jest.useFakeTimers()

describe('ExceptionRateLimiter', () => {
    let exceptionRateLimiter: ExceptionRateLimiter

    beforeEach(() => {
        exceptionRateLimiter = new ExceptionRateLimiter()
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    test('it is not rate limited by default', () => {
        const result = exceptionRateLimiter.isRateLimited({ $exception_list: [{ type: 'ResizeObserver' }] })
        expect(result).toBe(false)
    })

    test('returns undefined if no mutations are left', () => {
        exceptionRateLimiter['_exceptionBuckets']['ResizeObserver'] = 0

        const result = exceptionRateLimiter.isRateLimited({ $exception_list: [{ type: 'ResizeObserver' }] })
        expect(result).toBe(true)
    })
})
