import type { GetServerSidePropsContext } from 'next'
import type { IPostHog } from 'posthog-node'
import { getServerSidePostHog } from './getServerSidePostHog.js'
import type { CreatePostHogConfig as AppCreatePostHogConfig } from '../server/createPostHog.js'
import type { PostHogDistinctIdResolver as SharedPostHogDistinctIdResolver } from '../shared/identity.js'

export type PostHogDistinctIdResolver = (ctx: GetServerSidePropsContext) => ReturnType<SharedPostHogDistinctIdResolver>

export interface CreatePostHogConfig extends Omit<AppCreatePostHogConfig, 'getDistinctId'> {
    /** Resolves a trusted distinct ID from the current Pages Router request. */
    getDistinctId?: PostHogDistinctIdResolver
}

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
 *     getDistinctId: async (ctx) => (await getServerSession(ctx.req, ctx.res, authOptions))?.user?.id,
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
    const getDistinctId = config.getDistinctId as SharedPostHogDistinctIdResolver | undefined

    return {
        getPostHog: (ctx: GetServerSidePropsContext) =>
            getServerSidePostHog(ctx, config.apiKey, config.options, getDistinctId),
    }
}
