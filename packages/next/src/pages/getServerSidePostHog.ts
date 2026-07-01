import { isFunction } from '@posthog/core'
import type { GetServerSidePropsContext } from 'next'
import type { PostHogOptions, IPostHog } from 'posthog-node'
import { getOrCreateNodeClient } from '../server/clientCache.node.js'
import { cookieStoreFromHeader, readPostHogCookie, isOptedOut } from '../shared/cookie.js'
import { resolveApiKey, resolveHostOrDefault } from '../shared/config.js'
import { readTracingHeaders, buildContextData } from '../shared/tracing-headers.js'

/**
 * Creates a PostHog server client scoped to the current request.
 *
 * Reads the user's identity from the PostHog cookie in request headers.
 * The returned client is ready to use — methods like `getAllFlags()`,
 * `getFeatureFlagResult()`, and `capture()` automatically use the current
 * user's identity.
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
