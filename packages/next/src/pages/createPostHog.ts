import type { GetServerSidePropsContext } from 'next'
import type { IPostHog } from 'posthog-node'
import { getServerSidePostHog } from './getServerSidePostHog.js'
import type { CreatePostHogConfig } from '../server/createPostHog.js'

export interface PagesCreatePostHogResult {
    /**
     * Returns a PostHog server client scoped to the current request.
     *
     * Pass the `GetServerSidePropsContext` so identity is read from the
     * request; the configured `getDistinctId` resolver receives it too.
     */
    getPostHog: (ctx: GetServerSidePropsContext) => Promise<IPostHog>
}

/**
 * Creates the server-side PostHog entry points for your Pages Router app,
 * bound to your configuration — most notably a server-side identity resolver,
 * so events and feature flags are attributed to the authenticated user
 * regardless of the client-provided distinct id, which is spoofable.
 *
 * Define it once in a shared server module and import it everywhere you need
 * server-side PostHog. The returned `getPostHog` requires the
 * `GetServerSidePropsContext`; the resolver receives it so it can read the
 * session from the request.
 *
 * For the App Router, import `createPostHog` from `@posthog/next`.
 *
 * @example
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
export function createPostHog(config: CreatePostHogConfig = {}): PagesCreatePostHogResult {
    return {
        getPostHog: (ctx: GetServerSidePropsContext) =>
            getServerSidePostHog(ctx, config.apiKey, config.options, config.getDistinctId),
    }
}
