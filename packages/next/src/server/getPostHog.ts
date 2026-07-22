import { isFunction } from '@posthog/core'
import type { PostHogOptions, IPostHog } from 'posthog-node'
import { cookies, headers } from 'next/headers.js'
import { getOrCreateNodeClient } from './clientCache.node.js'
import { readPostHogCookie, isOptedOut } from '../shared/cookie.js'
import { resolveApiKey, resolveHostOrDefault } from '../shared/config.js'
import { readTracingHeaders, buildContextData } from '../shared/tracing-headers.js'
import { resolveServerDistinctId, type PostHogDistinctIdResolver } from '../shared/identity.js'

/**
 * Wraps the shared client in a Proxy that applies request-scoped context
 * to every method call. We can't use enterContext() here because
 * AsyncLocalStorage.enterWith() doesn't propagate back to the caller
 * across the await boundary of this async function.
 */
export function withRequestContext(client: IPostHog, contextData: Parameters<IPostHog['withContext']>[0]): IPostHog {
    return new Proxy(client, {
        get(target, prop, receiver) {
            if (prop === 'withContext') {
                return Reflect.get(target, prop, receiver)
            }
            const value = Reflect.get(target, prop, receiver)
            if (isFunction(value)) {
                return (...args: unknown[]) => target.withContext(contextData, () => value.apply(target, args))
            }
            return value
        },
    }) as IPostHog
}

/**
 * Dedupes server identity resolution per request. Next's request store reuses
 * the same read-only headers object for repeated `headers()` calls, so a
 * WeakMap keyed on it scopes the cache to the request and lets entries be
 * garbage-collected with it. This is the same mechanism used by the Flags
 * SDK's `dedupe()` helper; React's `cache()` is a no-op outside RSC render and
 * unavailable under the `react >= 18` peer range.
 *
 * Results are keyed per resolver so factories with different resolvers don't
 * share identities. Rejections are cached too, ensuring a rethrown Next.js
 * control-flow error is rethrown on every call in the request.
 */
const resolverResultsByRequest = new WeakMap<object, Map<PostHogDistinctIdResolver, Promise<string | undefined>>>()

function resolveServerDistinctIdOncePerRequest(
    headerStore: object,
    getDistinctId: PostHogDistinctIdResolver
): Promise<string | undefined> {
    let byResolver = resolverResultsByRequest.get(headerStore)
    if (!byResolver) {
        byResolver = new Map()
        resolverResultsByRequest.set(headerStore, byResolver)
    }

    let result = byResolver.get(getDistinctId)
    if (!result) {
        result = resolveServerDistinctId(getDistinctId)
        byResolver.set(getDistinctId, result)
    }
    return result
}

export async function getRequestScopedPostHog(
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

    const cookieStore = await cookies()

    if (isOptedOut(cookieStore, resolvedApiKey)) {
        return client
    }

    const state = readPostHogCookie(cookieStore, resolvedApiKey)
    const headerStore = await headers()
    const tracing = readTracingHeaders(headerStore)
    const contextData = buildContextData(tracing, state)

    if (getDistinctId) {
        const serverDistinctId = await resolveServerDistinctIdOncePerRequest(headerStore, getDistinctId)
        if (serverDistinctId) {
            contextData.distinctId = serverDistinctId
        }
    }

    return withRequestContext(client, contextData)
}
