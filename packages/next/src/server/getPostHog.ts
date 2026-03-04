import 'server-only'

import type { PostHogOptions, IPostHog } from 'posthog-node'
import { cookies } from 'next/headers'
import { getOrCreateNodeClient } from './nodeClientCache'
import { readPostHogCookie, cookieStateToProperties, isOptedOut } from '../shared/cookie'
import { resolveApiKey } from '../shared/config'

/**
 * Returns a PostHog server client scoped to the current request.
 *
 * Reads the user's identity from the PostHog cookie and sets it as
 * context via `enterContext()`. The returned client is ready to use —
 * methods like `getAllFlags()`, `getFeatureFlagResult()`, and `capture()`
 * automatically use the current user's identity.
 *
 * Calls `cookies()` internally, which opts the route into dynamic rendering.
 *
 * @param apiKey - PostHog project API key. If omitted, reads from `NEXT_PUBLIC_POSTHOG_KEY`.
 * @param options - Optional `posthog-node` configuration (e.g., `{ host: '...' }`).
 * @returns A `posthog-node` client scoped to the current user.
 *
 * @example
 * ```ts
 * import { getPostHog } from '@posthog/next/server'
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
    const host = options?.host ?? process.env.NEXT_PUBLIC_POSTHOG_HOST
    const resolvedOptions = host ? { ...options, host } : options
    const client = await getOrCreateNodeClient(resolvedApiKey, resolvedOptions)
    const cookieStore = await cookies()

    if (!isOptedOut(cookieStore, resolvedApiKey)) {
        const state = readPostHogCookie(cookieStore, resolvedApiKey)
        const properties = cookieStateToProperties(state)
        client.enterContext({ distinctId: state?.distinctId, sessionId: state?.sessionId, properties })
    }

    return client
}
