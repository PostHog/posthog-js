import type { GetServerSidePropsContext } from 'next'
import type { PostHogOptions, IPostHog } from 'posthog-node'
import { getOrCreateNodeClient } from '../server/clientCache.node.js'
import { cookieStoreFromHeader, readPostHogCookie, isOptedOut } from '../shared/cookie.js'
import { resolveApiKey, resolveHostOrDefault } from '../shared/config.js'
import { readTracingHeaders, buildContextData } from '../shared/tracing-headers.js'
import { resolveServerDistinctId, type PostHogDistinctIdResolver } from '../shared/identity.js'

/**
 * Implementation behind `createPostHog().getServerSidePostHog` (Pages Router).
 *
 * Reads the user's identity from the PostHog cookie in request headers
 * and sets it as context via `enterContext()`. The returned client is
 * ready to use — methods like `getAllFlags()`, `getFeatureFlagResult()`,
 * and `capture()` automatically use the current user's identity.
 *
 * When a `getDistinctId` resolver is provided, it receives the
 * `GetServerSidePropsContext` and its result takes precedence over the
 * client-provided identity. The resolver is never called for opted-out users.
 */
export async function getServerSidePostHog(
    ctx: GetServerSidePropsContext,
    apiKey?: string,
    options?: Partial<PostHogOptions>,
    getDistinctId?: PostHogDistinctIdResolver
): Promise<IPostHog> {
    const resolvedApiKey = resolveApiKey(apiKey)
    const host = resolveHostOrDefault(options?.host)
    const resolvedOptions = { ...options, host }
    const client = await getOrCreateNodeClient(resolvedApiKey ?? '', resolvedOptions)

    if (!resolvedApiKey) {
        return client
    }

    const cookieStore = cookieStoreFromHeader(ctx.req.headers.cookie || '')

    if (!isOptedOut(cookieStore, resolvedApiKey)) {
        const state = readPostHogCookie(cookieStore, resolvedApiKey)
        const tracing = readTracingHeaders(ctx.req.headers)
        const contextData = buildContextData(tracing, state)

        if (getDistinctId) {
            const serverDistinctId = await resolveServerDistinctId(getDistinctId, ctx)
            if (serverDistinctId) {
                contextData.distinctId = serverDistinctId
            }
        }

        client.enterContext(contextData)
    }

    return client
}
