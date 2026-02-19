import { uuidv7 } from '@posthog/core'

/**
 * Generates a random anonymous distinct_id using UUIDv7.
 * Used as a fallback when no PostHog cookie is available.
 */
export function generateAnonymousId(): string {
    return uuidv7()
}
