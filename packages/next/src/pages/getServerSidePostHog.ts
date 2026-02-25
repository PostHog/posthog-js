import type { GetServerSidePropsContext } from 'next'
import { PostHog } from 'posthog-node'
import type { PostHogOptions } from 'posthog-node'
import { cookieStoreFromHeader, readPostHogCookie, cookieStateToProperties, isOptedOut } from '../shared/cookie'
import { resolveApiKey } from '../shared/config'

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
 *   const posthog = getServerSidePostHog(ctx)
 *   const flags = await posthog.getAllFlagsAndPayloads()
 *   return { props: { posthogBootstrap: flags } }
 * }
 * ```
 */
export function getServerSidePostHog(
    ctx: GetServerSidePropsContext,
    apiKey?: string,
    options?: Partial<PostHogOptions>
): PostHog {
    const resolvedApiKey = resolveApiKey(apiKey)
    const host = options?.host ?? process.env.NEXT_PUBLIC_POSTHOG_HOST
    const resolvedOptions = host ? { ...options, host } : options
    const client = new PostHog(resolvedApiKey, resolvedOptions)

    const cookieStore = cookieStoreFromHeader(ctx.req.headers.cookie || '')

    if (!isOptedOut(cookieStore, resolvedApiKey)) {
        const state = readPostHogCookie(cookieStore, resolvedApiKey)
        const properties = cookieStateToProperties(state)
        client.enterContext({ distinctId: state?.distinctId, properties })
    }

    return client
}
