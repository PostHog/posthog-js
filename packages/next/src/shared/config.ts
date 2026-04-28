import type { PostHogConfig } from 'posthog-js'
import type { PostHogOptions } from 'posthog-node'
import { DEFAULT_API_HOST } from './constants.js'

/**
 * Configuration for the client-side PostHog provider.
 * Extends the standard posthog-js config.
 */
export type PostHogClientConfig = Partial<PostHogConfig>

/**
 * Configuration for the server-side PostHog client.
 * Extends the standard posthog-node options.
 */
export type PostHogServerConfig = PostHogOptions

/**
 * Resolves the PostHog API key from an explicit value or the
 * `NEXT_PUBLIC_POSTHOG_KEY` environment variable.
 *
 * Throws if neither is available.
 */
export function normalizeConfigValue(value?: unknown): string | undefined {
    const normalizedValue = typeof value === 'string' ? value.trim() : ''
    return normalizedValue || undefined
}

export function resolveApiKey(apiKey?: string): string {
    const resolved = normalizeConfigValue(apiKey) ?? normalizeConfigValue(process.env.NEXT_PUBLIC_POSTHOG_KEY)
    if (!resolved) {
        throw new Error(
            '[PostHog Next.js] apiKey is required. Either pass it explicitly or set the NEXT_PUBLIC_POSTHOG_KEY environment variable.'
        )
    }
    return resolved
}

export function resolveHost(host?: string): string | undefined {
    return normalizeConfigValue(host) ?? normalizeConfigValue(process.env.NEXT_PUBLIC_POSTHOG_HOST)
}

export function resolveHostOrDefault(host?: string): string {
    return resolveHost(host) ?? DEFAULT_API_HOST
}

/**
 * Next.js-specific defaults for the posthog-js client.
 *
 * These ensure the server can read both identity and consent state from cookies:
 * - `capture_pageview: false` — disables posthog-js automatic pageviews so the
 *   `PostHogPageView` component can handle them without duplicates
 * - `persistence: 'localStorage+cookie'` — already the posthog-js default, made explicit
 * - `opt_out_capturing_persistence_type: 'cookie'` — writes consent state to a cookie
 *   so middleware/server components can read it (posthog-js default is 'localStorage')
 * - `opt_out_persistence_by_default: true` — when opted out, disables persistence
 *   so posthog-js does not write cookies or localStorage; the middleware
 *   handles deleting the identity cookie separately
 *
 * Users can override any of these via the `options` prop on PostHogProvider.
 */
export const NEXTJS_CLIENT_DEFAULTS: Partial<PostHogConfig> = {
    capture_pageview: false,
    persistence: 'localStorage+cookie',
    opt_out_capturing_persistence_type: 'cookie',
    opt_out_persistence_by_default: true,
}
