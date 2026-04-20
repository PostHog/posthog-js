import type { GetServerSidePropsContext } from 'next'
import type { PostHogOptions, IPostHog } from 'posthog-node'
import { getOrCreateNodeClient } from '../server/nodeClientCache.js'
import { cookieStoreFromHeader, readPostHogCookie, isOptedOut } from '../shared/cookie.js'
import { resolveApiKey, resolveHostOrDefault } from '../shared/config.js'
import { readTracingHeaders, buildContextData } from '../shared/tracing-headers.js'

/**
 * Creates a PostHog server client scoped to the current request.
 *
 * Reads the user's identity from the PostHog cookie in request headers
 * and sets it as context via `enterContext()`. The returned client is
 * ready to use — methods like `getAllFlags()`, `getFeatureFlagResult()`,
 * and `capture()` automatically use the current user's identity.
 *
 * @param ctx - The Next.js GetServerSidePropsContext
 * @param apiKey - PostHog project API key. If omitted, reads from NEXT_PUBLIC_POSTHOG_KEY.
 * @param options - Optional posthog-node configuration
 *
 * @example
 * ```tsx
 * import { getServerSidePostHog } from '@posthog/next/pages'
 *
 * export const getServerSideProps: GetServerSideProps = async (ctx) => {
 *   const posthog = await getServerSidePostHog(ctx)
 *   const flags = await posthog.getAllFlagsAndPayloads()
 *   return { props: { posthogBootstrap: flags } }
 * }
 * ```
 */
export async function getServerSidePostHog(
    ctx: GetServerSidePropsContext,
    apiKey?: string,
    options?: Partial<PostHogOptions>
): Promise<IPostHog> {
    const resolvedApiKey = resolveApiKey(apiKey)
    const host = resolveHostOrDefault(options?.host)
    const resolvedOptions = { ...options, host }
    const client = await getOrCreateNodeClient(resolvedApiKey, resolvedOptions)

    const cookieStore = cookieStoreFromHeader(ctx.req.headers.cookie || '')

    if (!isOptedOut(cookieStore, resolvedApiKey)) {
        const state = readPostHogCookie(cookieStore, resolvedApiKey)
        const tracing = readTracingHeaders(ctx.req.headers)
        client.enterContext(buildContextData(tracing, state))
    }

    return client
}
