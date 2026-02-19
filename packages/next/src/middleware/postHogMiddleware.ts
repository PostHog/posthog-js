import 'server-only'

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
    /** Cookie max age in seconds. Default: 365 days. */
    cookieMaxAgeSeconds?: number
}

/**
 * Creates a Next.js middleware that seeds the PostHog identity cookie
 * on first visit.
 *
 * This ensures server and client share the same anonymous ID from the
 * first render, so that `PostHogProvider` can bootstrap feature flags
 * with the correct identity.
 *
 * @example
 * ```ts
 * // middleware.ts
 * import { postHogMiddleware } from '@posthog/next/middleware'
 *
 * export default postHogMiddleware({
 *   apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY!,
 * })
 *
 * export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
 * ```
 */
export function postHogMiddleware(config: PostHogMiddlewareOptions) {
    return async function middleware(request: NextRequest) {
        const cookieName = getPostHogCookieName(config.apiKey)
        const existingCookie = request.cookies.get(cookieName)
        const state = existingCookie ? parsePostHogCookie(existingCookie.value) : null

        const response = NextResponse.next()

        // Seed the PostHog cookie on first visit so server and client
        // share the same identity from the first render.
        if (!state) {
            const distinctId = generateAnonymousId()
            response.cookies.set(cookieName, serializePostHogCookie(distinctId), {
                path: '/',
                sameSite: 'lax',
                maxAge: config.cookieMaxAgeSeconds ?? COOKIE_MAX_AGE_SECONDS,
                httpOnly: false,
            })
        }

        return response
    }
}
