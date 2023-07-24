import { PostHogPersistence } from './posthog-persistence'

export class RateLimiter {
    constructor(private persistence: PostHogPersistence) {}

    isRateLimited(): boolean {
        const retryAfter = this.persistence.get_quota_limited()
        if (retryAfter === false) {
            return false
        }
        return new Date().getTime() < retryAfter
    }

    on429Response(response: XMLHttpRequest): void {
        if (response.status !== 429) {
            return
        }
        const retryAfter = parseInt(response.getResponseHeader('Retry-After') || '3600', 10)
        this.persistence.set_quota_limited(new Date().getTime() + retryAfter)
    }
}
