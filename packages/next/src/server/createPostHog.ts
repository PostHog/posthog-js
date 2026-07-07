import type { GetServerSidePropsContext } from 'next'
import type { PostHogOptions, IPostHog } from 'posthog-node'
import { getRequestScopedPostHog } from './getPostHog.js'
import { getServerSidePostHog } from '../pages/getServerSidePostHog.js'
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
     * Runs once per `getPostHog()` call. In Pages Router, `getPostHog(ctx)`
     * passes `ctx` to the resolver; in App Router it may call request-scoped
     * auth helpers directly. Skipped for opted-out users.
     */
    getDistinctId?: PostHogDistinctIdResolver
}

export interface CreatePostHogResult {
    /**
     * Returns a PostHog server client scoped to the current request.
     *
     * In the App Router (server components, route handlers, server actions),
     * call it with no arguments — it reads `cookies()` and `headers()`
     * internally, which opts the route into dynamic rendering. In the Pages
     * Router, pass the `GetServerSidePropsContext` so identity is read from
     * the request.
     */
    getPostHog: (ctx?: GetServerSidePropsContext) => Promise<IPostHog>
}

/**
 * Creates the server-side PostHog entry points for your app, bound to your
 * configuration — most notably a server-side identity resolver, so events and
 * feature flags are attributed to the authenticated user regardless of the
 * client-provided distinct id, which is spoofable.
 *
 * Define it once in a shared server module and import it everywhere you need
 * server-side PostHog. In App Router apps, mark that module `server-only` so
 * accidental client imports fail at build time.
 *
 * @example App Router
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
 *
 * @example Pages Router
 * Import from `@posthog/next/pages` in Pages Router server code and pass the
 * `GetServerSidePropsContext`; the resolver receives it so it can read the
 * session from the request:
 * ```ts
 * // lib/posthog.ts
 * import { createPostHog } from '@posthog/next/pages'
 *
 * export const { getPostHog } = createPostHog({
 *     getDistinctId: async (ctx) =>
 *         ctx ? (await getServerSession(ctx.req, ctx.res, authOptions))?.user?.id : undefined,
 * })
 *
 * // pages/index.tsx
 * export const getServerSideProps: GetServerSideProps = async (ctx) => {
 *     const posthog = await getPostHog(ctx)
 *     const flags = await posthog.getAllFlagsAndPayloads()
 *     return { props: { posthogBootstrap: flags } }
 * }
 * ```
 */
export function createPostHog(config: CreatePostHogConfig = {}): CreatePostHogResult {
    return {
        getPostHog: (ctx?: GetServerSidePropsContext) =>
            ctx
                ? getServerSidePostHog(ctx, config.apiKey, config.options, config.getDistinctId)
                : getRequestScopedPostHog(config.apiKey, config.options, config.getDistinctId),
    }
}
