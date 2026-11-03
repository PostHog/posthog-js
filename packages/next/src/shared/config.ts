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

export function normalizeConfigValue(value?: unknown): string | undefined {
    const normalizedValue = typeof value === 'string' ? value.trim() : ''
    return normalizedValue || undefined
}

/**
 * Options that accept the project token. `apiKey` is the deprecated name.
 */
export interface ProjectTokenOptions {
    /**
     * Your PostHog project token, which starts with `phc_`.
     * If omitted, reads from the `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` env var.
     */
    projectToken?: string
    /**
     * Your PostHog project token. Ignored when `projectToken` is set.
     *
     * @deprecated Use `projectToken` instead. This will be removed in the next major version.
     */
    apiKey?: string
}

/**
 * Returns the explicitly configured project token, preferring `projectToken`
 * over the deprecated `apiKey`.
 */
export function getProjectTokenOption({ projectToken, apiKey }: ProjectTokenOptions): string | undefined {
    return normalizeConfigValue(projectToken) ?? normalizeConfigValue(apiKey)
}

/**
 * Resolves the PostHog project token from an explicit value, the
 * `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` env var, or the legacy
 * `NEXT_PUBLIC_POSTHOG_KEY` env var, in that order.
 *
 * Warns and returns undefined if none is available.
 */
export function resolveProjectToken(projectToken?: unknown): string | undefined {
    const resolved =
        normalizeConfigValue(projectToken) ??
        normalizeConfigValue(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) ??
        normalizeConfigValue(process.env.NEXT_PUBLIC_POSTHOG_KEY)
    if (!resolved) {
        // oxlint-disable-next-line no-console
        console.warn(
            '[PostHog Next.js] projectToken is required — set NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN or pass projectToken. PostHog will not be initialized'
        )
    }
    return resolved
}

export function resolveHost(host?: unknown): string | undefined {
    return normalizeConfigValue(host) ?? normalizeConfigValue(process.env.NEXT_PUBLIC_POSTHOG_HOST)
}

export function resolveHostOrDefault(host?: unknown): string {
    return resolveHost(host) ?? DEFAULT_API_HOST
}

/**
 * Next.js-specific defaults for the posthog-js client.
 *
 * These ensure the server can read both identity and consent state from cookies:
 * - `capture_pageview: false` — disables posthog-js automatic pageviews so the
 *   `PostHogPageView` component can handle them without duplicates
 * - `capture_exceptions: true` — enables browser-side unhandled error and
 *   rejection capture by default for Next.js apps
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
    capture_exceptions: true,
    persistence: 'localStorage+cookie',
    opt_out_capturing_persistence_type: 'cookie',
    opt_out_persistence_by_default: true,
}
