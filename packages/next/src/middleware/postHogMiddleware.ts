import 'server-only'

import { PostHog } from 'posthog-node'
import type { PostHogOptions } from 'posthog-node'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getPostHogCookieName, parsePostHogCookie, serializePostHogCookie } from '../shared/cookie'
import { generateAnonymousId } from '../shared/identity'
import { COOKIE_MAX_AGE_SECONDS } from '../shared/constants'

/**
 * Configuration for the PostHog middleware.
 */
export interface PostHogMiddlewareOptions {
    /** PostHog project API key */
    apiKey: string
    /** Optional posthog-node configuration overrides */
    options?: Partial<PostHogOptions>
    /**
     * Feature flags to evaluate in middleware.
     * Results are set as `x-posthog-flag-<name>` response headers,
     * accessible in Server Components via `headers()`.
     */
    evaluateFlags?: string[]
    /**
     * URL rewrites based on feature flag values.
     * Maps flag keys to objects mapping flag values to rewrite paths.
     *
     * @example
     * ```ts
     * rewrites: {
     *   'new-landing-page': {
     *     'true': '/landing-v2',
     *     'variant-a': '/landing-a',
     *   }
     * }
     * ```
     */
    rewrites?: Record<string, Record<string, string>>
}

/**
 * Creates a Next.js middleware that evaluates PostHog feature flags
 * and optionally rewrites URLs based on flag values.
 *
 * On first visit (no PostHog cookie), the middleware seeds a cookie with a
 * UUIDv7 anonymous ID so that server and client share the same identity
 * from the first render.
 *
 * @example
 * ```ts
 * // middleware.ts
 * import { postHogMiddleware } from '@posthog/next/middleware'
 *
 * export default postHogMiddleware({
 *   apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY!,
 *   evaluateFlags: ['new-landing-page'],
 *   rewrites: {
 *     'new-landing-page': { 'true': '/landing-v2' }
 *   },
 * })
 *
 * export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
 * ```
 */
export function postHogMiddleware(config: PostHogMiddlewareOptions) {
    // Only create a PostHog client if we need to evaluate flags
    const hasFlags = config.evaluateFlags && config.evaluateFlags.length > 0
    const client = hasFlags ? new PostHog(config.apiKey, config.options) : null

    return async function middleware(request: NextRequest) {
        const cookieName = getPostHogCookieName(config.apiKey)
        const existingCookie = request.cookies.get(cookieName)
        const state = existingCookie ? parsePostHogCookie(existingCookie.value) : null

        // Determine distinct_id: use existing cookie or generate a new one
        const isNewVisitor = !state
        const distinctId = state?.distinctId ?? generateAnonymousId()

        /** Sets the PostHog cookie on the response if this is a first visit. */
        function seedCookie(response: NextResponse): void {
            if (isNewVisitor) {
                response.cookies.set(cookieName, serializePostHogCookie(distinctId), {
                    path: '/',
                    sameSite: 'lax',
                    maxAge: COOKIE_MAX_AGE_SECONDS,
                    httpOnly: false,
                })
            }
        }

        // No flags to evaluate — just seed cookie and pass through
        if (!hasFlags || !client) {
            const response = NextResponse.next()
            seedCookie(response)
            return response
        }

        // Evaluate feature flags
        let flags: Record<string, string | boolean> = {}
        try {
            flags = await client.getAllFlags(distinctId, {})
        } catch (error) {
            console.warn(`[PostHog Next.js] Failed to evaluate feature flags in middleware: ${error}`)
            const response = NextResponse.next()
            seedCookie(response)
            return response
        }

        // Check for rewrites
        if (config.rewrites) {
            for (const [flagKey, rewriteMap] of Object.entries(config.rewrites)) {
                const flagValue = String(flags[flagKey] ?? '')
                if (flagValue in rewriteMap) {
                    const url = request.nextUrl.clone()
                    url.pathname = rewriteMap[flagValue]
                    const response = NextResponse.rewrite(url)
                    setFlagHeaders(response.headers, flags, config.evaluateFlags!)
                    seedCookie(response)
                    return response
                }
            }
        }

        // No rewrite matched — pass through with flag headers
        const response = NextResponse.next()
        setFlagHeaders(response.headers, flags, config.evaluateFlags!)
        seedCookie(response)
        return response
    }
}

function setFlagHeaders(
    headers: Headers | Map<string, string>,
    flags: Record<string, string | boolean>,
    evaluateFlags: string[]
) {
    for (const flagKey of evaluateFlags) {
        const value = flags[flagKey]
        if (value !== undefined) {
            if (typeof headers.set === 'function') {
                headers.set(`x-posthog-flag-${flagKey}`, String(value))
            }
        }
    }
}
