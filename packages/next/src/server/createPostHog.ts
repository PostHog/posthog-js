// No `import 'server-only'` here: this module is reachable from the `./pages`
// `node` export condition (Pages Router server bundles), where server-only's
// non-react-server build throws at import time. See getPostHog.ts.
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
     * Resolves the distinct id for the current request from a server-side
     * source of truth, such as your auth session. When it returns a non-empty
     * string, that id overrides the client-provided distinct id (from the
     * PostHog cookie and tracing headers) for every event and flag evaluation
     * made through the returned client. Session and device linkage
     * (`$session_id`, `$device_id`, `$window_id`) stays client-provided so
     * server events still correlate with the browser session. Return
     * `null`/`undefined` to fall back to the client-provided distinct id.
     *
     * Runs once per `getPostHog()` / `getServerSidePostHog()` call, in request
     * scope — it may call `cookies()`/`headers()` or auth helpers that do.
     * When called from `getServerSidePostHog()`, it receives the
     * `GetServerSidePropsContext` for Pages Router auth helpers. Wrap
     * resolvers that do their own I/O (e.g. a database session lookup) in
     * React's `cache()` so multiple `getPostHog()` calls in one render don't
     * repeat it. It is not called for opted-out users. Errors are logged and
     * treated as "no identity"; Next.js `redirect()`/`notFound()` propagate
     * normally.
     */
    getDistinctId?: PostHogDistinctIdResolver
}

export interface CreatePostHogResult {
    /**
     * Returns a PostHog server client scoped to the current App Router
     * request (server components, route handlers, server actions).
     *
     * Calls `cookies()` and `headers()` internally, which opts the route
     * into dynamic rendering.
     */
    getPostHog: () => Promise<IPostHog>
    /**
     * Returns a PostHog server client scoped to the current Pages Router
     * request. Call it with the `GetServerSidePropsContext` inside
     * `getServerSideProps`.
     */
    getServerSidePostHog: (ctx: GetServerSidePropsContext) => Promise<IPostHog>
}

/**
 * Creates the server-side PostHog entry points for your app, bound to your
 * configuration — most notably a server-side identity resolver, so events and
 * feature flags are attributed to the authenticated user regardless of the
 * client-provided distinct id, which is spoofable.
 *
 * Define it once in a shared module and import it everywhere you need
 * server-side PostHog. Mark that module `server-only` so an accidental import
 * from a client component fails with a clear build-time error.
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
 *     // ...
 * }
 * ```
 *
 * In the Pages Router, use `getServerSidePostHog` inside `getServerSideProps`;
 * the resolver receives the context so it can read the session from the request:
 * ```ts
 * // lib/posthog.ts
 * export const { getServerSidePostHog } = createPostHog({
 *     getDistinctId: async (ctx) =>
 *         ctx ? (await getServerSession(ctx.req, ctx.res, authOptions))?.user?.id : undefined,
 * })
 *
 * // pages/index.tsx
 * export const getServerSideProps: GetServerSideProps = async (ctx) => {
 *     const posthog = await getServerSidePostHog(ctx)
 *     const flags = await posthog.getAllFlagsAndPayloads()
 *     return { props: { posthogBootstrap: flags } }
 * }
 * ```
 */
export function createPostHog(config: CreatePostHogConfig = {}): CreatePostHogResult {
    return {
        getPostHog: () => getRequestScopedPostHog(config.apiKey, config.options, config.getDistinctId),
        getServerSidePostHog: (ctx) => getServerSidePostHog(ctx, config.apiKey, config.options, config.getDistinctId),
    }
}
