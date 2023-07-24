import { RateLimiter } from '../rate-limiter'
import { PostHogPersistence } from '../posthog-persistence'

describe('Rate Limiter', () => {
    const mockGetQuotaLimits = jest.fn()
    const mockSetQuotaLimits = jest.fn()
    const fakePersistence = {
        get_quota_limits: mockGetQuotaLimits,
        set_quota_limits: mockSetQuotaLimits,
    }
    let rateLimiter: RateLimiter

    beforeEach(() => {
        jest.useFakeTimers()

        mockGetQuotaLimits.mockReset()
        mockSetQuotaLimits.mockReset()

        // always defaults to the empty object
        mockGetQuotaLimits.mockReturnValue({})

        rateLimiter = new RateLimiter(fakePersistence as unknown as PostHogPersistence)
    })

    it('is not rate limited with no batch key', () => {
        expect(rateLimiter.isRateLimited(undefined)).toBe(false)
    })

    it('is not rate limited if there is nothing in persistence', () => {
        expect(rateLimiter.isRateLimited('the batch key')).toBe(false)
    })

    it('is not rate limited if there is false in persistence', () => {
        mockGetQuotaLimits.mockReturnValue({ 'the batch key': false })

        expect(rateLimiter.isRateLimited('the batch key')).toBe(false)
    })

    it('is not rate limited if there is mo matching batch key in persistence', () => {
        mockGetQuotaLimits.mockReturnValue({ 'a different batch key': false })

        expect(rateLimiter.isRateLimited('the batch key')).toBe(false)
    })

    it('is not rate limited if the retryAfter is in the past', () => {
        mockGetQuotaLimits.mockReturnValue({ 'the batch key': new Date(Date.now() - 1000).getTime() })

        expect(rateLimiter.isRateLimited('the batch key')).toBe(false)
    })

    it('is rate limited if the retryAfter is in the future', () => {
        mockGetQuotaLimits.mockReturnValue({ 'the batch key': new Date(Date.now() + 1000).getTime() })

        expect(rateLimiter.isRateLimited('the batch key')).toBe(true)
    })

    it('sets the retryAfter on429Response', () => {
        rateLimiter.on429Response({
            status: 429,
            getResponseHeader: (name: string) => (name === 'X-PostHog-Retry-After-Events' ? '150' : null),
        } as unknown as XMLHttpRequest)

        expect(mockSetQuotaLimits).toHaveBeenCalledWith({ events: new Date().getTime() + 150_000 })
    })

    it('keeps existing batch keys on429Response', () => {
        mockGetQuotaLimits.mockReturnValue({ 'some-other-key': 4000 })
        rateLimiter.on429Response({
            status: 429,
            getResponseHeader: (name: string) => (name === 'X-PostHog-Retry-After-Events' ? '150' : null),
        } as unknown as XMLHttpRequest)

        expect(mockSetQuotaLimits).toHaveBeenCalledWith({
            'some-other-key': 4000,
            events: new Date().getTime() + 150_000,
        })
    })

    it('replaces matching keys on429Response and ignores unexpected ones', () => {
        mockGetQuotaLimits.mockReturnValue({ 'some-other-key': 4000, events: 1000 })
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

        expect(mockSetQuotaLimits).toHaveBeenCalledWith({
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

        expect(mockSetQuotaLimits).toHaveBeenCalledWith({})
    })

    it('does not replace any limits if no Retry-After header is present', () => {
        mockGetQuotaLimits.mockReturnValue({ 'some-other-key': 4000, events: 1000 })

        rateLimiter.on429Response({
            status: 429,
            getResponseHeader: () => null,
        } as unknown as XMLHttpRequest)

        expect(mockSetQuotaLimits).toHaveBeenCalledWith({ 'some-other-key': 4000, events: 1000 })
    })
})
