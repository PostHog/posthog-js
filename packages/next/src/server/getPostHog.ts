import 'server-only'

import { isFunction } from '@posthog/core'
import type { PostHogOptions, IPostHog } from 'posthog-node'
import { cookies, headers } from 'next/headers'
import { getOrCreateNodeClient } from './nodeClientCache'
import { readPostHogCookie, isOptedOut } from '../shared/cookie'
import { resolveApiKey, resolveHost } from '../shared/config'
import { readTracingHeaders, buildContextData } from '../shared/tracing-headers'

/**
 * Returns a PostHog server client scoped to the current request.
 *
 * Reads the user's identity from the PostHog cookie and returns a
 * request-scoped client. Methods like `getAllFlags()`, `getFeatureFlagResult()`,
 * and `capture()` automatically use the current user's identity.
 *
 * Calls `cookies()` and `headers()` internally, which opts the route into dynamic rendering.
 *
 * @param apiKey - PostHog project API key. If omitted, reads from `NEXT_PUBLIC_POSTHOG_KEY`.
 * @param options - Optional `posthog-node` configuration (e.g., `{ host: '...' }`).
 * @returns A `posthog-node` client scoped to the current user.
 *
 * @example
 * ```ts
 * import { getPostHog } from '@posthog/next'
 *
 * export default async function Page() {
 *     const posthog = await getPostHog()
 *     const flags = await posthog.getAllFlags()
 *     posthog.capture({ event: 'page_viewed' })
 *     return <div>...</div>
 * }
 * ```
 */
export async function getPostHog(apiKey?: string, options?: Partial<PostHogOptions>): Promise<IPostHog> {
    const resolvedApiKey = resolveApiKey(apiKey)
    const host = resolveHost(options?.host)
    const resolvedOptions = host ? { ...options, host } : options
    const client = await getOrCreateNodeClient(resolvedApiKey, resolvedOptions)
    const cookieStore = await cookies()

    if (isOptedOut(cookieStore, resolvedApiKey)) {
        return client
    }

    const state = readPostHogCookie(cookieStore, resolvedApiKey)
    const headerStore = await headers()
    const tracing = readTracingHeaders(headerStore)
    const contextData = buildContextData(tracing, state)

    // Wrap the shared client in a Proxy that applies request-scoped context
    // to every method call. We can't use enterContext() here because
    // AsyncLocalStorage.enterWith() doesn't propagate back to the caller
    // across the await boundary of this async function.
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
