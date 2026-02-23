import 'server-only'

import { PostHog } from 'posthog-node'
import type { PostHogOptions } from 'posthog-node'
import { readPostHogCookie, cookieStateToProperties } from '../shared/cookie'
import { generateAnonymousId } from '../shared/identity'
import { createScopedClient } from '../shared/scoped-client'
import type { PostHogServerClient } from '../shared/scoped-client'

/**
 * A cookie jar interface compatible with Next.js `cookies()`.
 * Accepts the return type of `cookies()` from `next/headers`.
 */
interface CookieStore {
    get(name: string): { name: string; value: string } | undefined
}

/**
 * Configuration options for the PostHog server client.
 * Extends the standard posthog-node options.
 */
export type PostHogServerOptions = Partial<PostHogOptions>

/**
 * PostHog server client factory for Next.js.
 *
 * Creates server-side PostHog clients that automatically read the user's identity
 * from the PostHog cookie set by posthog-js on the client side.
 *
 * @example
 * ```ts
 * // lib/posthog.ts
 * import { PostHogServer } from '@posthog/next/server'
 * export const phServer = new PostHogServer(process.env.NEXT_PUBLIC_POSTHOG_KEY!)
 *
 * // app/page.tsx (Server Component)
 * import { cookies } from 'next/headers'
 * import { phServer } from '@/lib/posthog'
 *
 * export default async function Page() {
 *   const ph = phServer.getClient(await cookies())
 *   const showNewFeature = await ph.isFeatureEnabled('new-feature')
 *   ph.capture('page_viewed', { page: 'home' })
 *   return <div>{showNewFeature ? <NewFeature /> : <OldFeature />}</div>
 * }
 * ```
 */
export class PostHogServer {
    private client: PostHog
    private apiKey: string

    constructor(apiKey: string, options?: PostHogServerOptions) {
        if (!apiKey) {
            throw new Error('[PostHog Next.js] apiKey is required')
        }
        this.apiKey = apiKey
        this.client = new PostHog(apiKey, options)
    }

    /**
     * Get a scoped PostHog client for the current request.
     *
     * Reads the user's distinct_id from the PostHog cookie.
     * If no cookie is found, a new anonymous distinct_id is generated.
     *
     * @param cookies - The cookie store from `cookies()` in `next/headers`
     * @returns A PostHogServerClient scoped to the user's distinct_id
     */
    getClient(cookies: CookieStore): PostHogServerClient {
        const state = readPostHogCookie(cookies, this.apiKey)
        const distinctId = state?.distinctId ?? generateAnonymousId()

        return createScopedClient(this.client, distinctId, cookieStateToProperties(state))
    }

    /**
     * Get a scoped PostHog client for a known distinct_id.
     *
     * Use this when you already know the user's identity (e.g., from a JWT
     * or session) and don't need to read it from the cookie.
     *
     * @param distinctId - The user's distinct_id
     * @returns A PostHogServerClient scoped to the given distinct_id
     */
    getClientForDistinctId(distinctId: string): PostHogServerClient {
        return createScopedClient(this.client, distinctId)
    }
}
