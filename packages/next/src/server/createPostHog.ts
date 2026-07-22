import type { PostHogOptions, IPostHog } from 'posthog-node'
import { getRequestScopedPostHog } from './getPostHog.js'
import type { PostHogDistinctIdResolver } from '../shared/identity.js'

export interface CreatePostHogConfig {
    /** PostHog project API key. If omitted, reads from `NEXT_PUBLIC_POSTHOG_KEY`. */
    apiKey?: string
    /** Optional `posthog-node` configuration (e.g., `{ host: '...' }`). */
    options?: Partial<PostHogOptions>
    /**
     * Resolves a trusted distinct id for the current request, such as an auth
     * session user id. A non-empty result overrides the client-provided
     * cookie/tracing distinct id for server events and flag evaluations, while
     * session/device/window linkage stays client-provided. Return nullish to
     * fall back to the client identity.
     *
     * Runs in request scope and may call `cookies()`/`headers()` or auth
     * helpers that do. In the App Router it runs at most once per request:
     * repeated `getPostHog()` calls share a single resolution. In the Pages
     * Router (`@posthog/next/pages`) it runs once per `getPostHog(ctx)` call
     * and receives that `GetServerSidePropsContext`. Skipped for opted-out
     * users. Errors are logged and treated as no identity; Next.js
     * control-flow errors propagate normally.
     */
    getDistinctId?: PostHogDistinctIdResolver
}

export interface CreatePostHogResult {
    /**
     * Returns a PostHog server client scoped to the current request.
     *
     * Call it from server components, route handlers, or server actions — it
     * reads `cookies()` and `headers()` internally, which opts the route into
     * dynamic rendering. In the Pages Router, use `createPostHog` from
     * `@posthog/next/pages` instead.
     */
    getPostHog: () => Promise<IPostHog>
}

/**
 * Creates the server-side PostHog entry points for your App Router app, bound
 * to your configuration — most notably a server-side identity resolver, so
 * events and feature flags are attributed to the authenticated user regardless
 * of the client-provided distinct id, which is spoofable.
 *
 * Define it once in a shared server module and import it everywhere you need
 * server-side PostHog. Mark that module `server-only` so accidental client
 * imports fail at build time.
 *
 * For the Pages Router, import `createPostHog` from `@posthog/next/pages`.
 *
 * @example
 * ```ts
 * // lib/posthog.ts
 * import 'server-only'
 * import { createPostHog } from '@posthog/next'
 * import { auth } from '@/auth'
 *
 * export const { getPostHog } = createPostHog({
 *     getDistinctId: async () => (await auth())?.user?.id,
 * })
 * ```
 *
 * ```ts
 * // app/api/checkout/route.ts
 * import { getPostHog } from '@/lib/posthog'
 *
 * export async function POST() {
 *     const posthog = await getPostHog()
 *     // Attributed to the logged-in user, or the client identity when logged out
 *     posthog.capture({ event: 'checkout_started' })
 * }
 * ```
 */
export function createPostHog(config: CreatePostHogConfig = {}): CreatePostHogResult {
    return {
        getPostHog: () => getRequestScopedPostHog(config.apiKey, config.options, config.getDistinctId),
    }
}
