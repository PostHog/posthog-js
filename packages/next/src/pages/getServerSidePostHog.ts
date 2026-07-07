import type { GetServerSidePropsContext } from 'next'
import type { PostHogOptions, IPostHog } from 'posthog-node'
import { getOrCreateNodeClient } from '../server/clientCache.node.js'
import { cookieStoreFromHeader, readPostHogCookie, isOptedOut } from '../shared/cookie.js'
import { resolveApiKey, resolveHostOrDefault } from '../shared/config.js'
import { readTracingHeaders, buildContextData } from '../shared/tracing-headers.js'
import { resolveServerDistinctId, type PostHogDistinctIdResolver } from '../shared/identity.js'
import { withRequestContext } from '../server/getPostHog.js'

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

    if (isOptedOut(cookieStore, resolvedApiKey)) {
        return client
    }

    const state = readPostHogCookie(cookieStore, resolvedApiKey)
    const tracing = readTracingHeaders(ctx.req.headers)
    const contextData = buildContextData(tracing, state)

    if (getDistinctId) {
        const serverDistinctId = await resolveServerDistinctId(getDistinctId, ctx)
        if (serverDistinctId) {
            contextData.distinctId = serverDistinctId
        }
    }

    return withRequestContext(client, contextData)
}
