import type { Analytics } from './analytics-core'

/**
 * The client's capture pipeline, for optional modules that extend it with less common operations. It lives apart from
 * analytics-core and imports nothing at runtime, so a product chunk that only needs it doesn't share core's modules.
 */
export const analyticsOf = (posthog: object): Analytics | undefined =>
    (posthog as { _analytics?: Analytics })._analytics
