import { RateLimiter } from '../rate-limiter'
import { PostHogPersistence } from '../posthog-persistence'

describe('Rate Limiter', () => {
    const mockGetQuotaLimited = jest.fn()
    const mockSetQuotaLimited = jest.fn()
    const fakePersistence = {
        get_quota_limited: mockGetQuotaLimited,
        set_quota_limited: mockSetQuotaLimited,
    }
    let rateLimiter: RateLimiter

    beforeEach(() => {
        mockGetQuotaLimited.mockReset()
        mockSetQuotaLimited.mockReset()
        rateLimiter = new RateLimiter(fakePersistence as unknown as PostHogPersistence)
    })

    it('is not rate limited if there is nothing in persistence', () => {
        expect(rateLimiter.isRateLimited()).toBe(false)
    })

    it('is not rate limited if there is false in persistence', () => {
        mockGetQuotaLimited.mockReturnValue(false)

        expect(rateLimiter.isRateLimited()).toBe(false)
    })

    it('is not rate limited if the retryAfter is in the past', () => {
        mockGetQuotaLimited.mockReturnValue(new Date(Date.now() - 1000).getTime())

        expect(rateLimiter.isRateLimited()).toBe(false)
    })

    it('is rate limited if the retryAfter is in the future', () => {
        mockGetQuotaLimited.mockReturnValue(new Date(Date.now() + 1000).getTime())

        expect(rateLimiter.isRateLimited()).toBe(true)
    })

    it('sets the retryAfter on429Resposne', () => {
        rateLimiter.on429Response({
            status: 429,
            getResponseHeader: () => '150',
        } as unknown as XMLHttpRequest)

        expect(mockSetQuotaLimited).toHaveBeenCalledWith(new Date().getTime() + 150)
    })

    it('defaults to 3600 if no Retry-After header is present', () => {
        rateLimiter.on429Response({
            status: 429,
            getResponseHeader: () => null,
        } as unknown as XMLHttpRequest)

        expect(mockSetQuotaLimited).toHaveBeenCalledWith(new Date().getTime() + 3600)
    })
})
