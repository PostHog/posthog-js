import type { PostHogConfig } from 'posthog-js'
import type { PostHogOptions } from 'posthog-node'

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
export function resolveApiKey(apiKey?: string): string {
    const resolved = apiKey || process.env.NEXT_PUBLIC_POSTHOG_KEY
    if (!resolved) {
        throw new Error(
            '[PostHog Next.js] apiKey is required. Either pass it explicitly or set the NEXT_PUBLIC_POSTHOG_KEY environment variable.'
        )
    }
    return resolved
}

/**
 * Next.js-specific defaults for the posthog-js client.
 *
 * These ensure the server can read both identity and consent state from cookies:
 * - `persistence: 'localStorage+cookie'` — already the posthog-js default, made explicit
 * - `opt_out_capturing_persistence_type: 'cookie'` — writes consent state to a cookie
 *   so middleware/server components can read it (posthog-js default is 'localStorage')
 * - `opt_out_persistence_by_default: true` — clears the identity cookie on opt-out
 *   so the server never sees stale identifiers after consent is withdrawn
 *
 * Users can override any of these via the `options` prop on PostHogProvider.
 */
export const NEXTJS_CLIENT_DEFAULTS: Partial<PostHogConfig> = {
    persistence: 'localStorage+cookie',
    opt_out_capturing_persistence_type: 'cookie',
    opt_out_persistence_by_default: true,
}
