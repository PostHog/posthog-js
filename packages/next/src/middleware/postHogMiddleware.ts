import 'server-only'

import { NextResponse } from 'next/server.js'
import type { NextRequest } from 'next/server.js'
import { getPostHogCookieName, readPostHogCookie, serializePostHogCookie, isOptedOut } from '../shared/cookie.js'
import { generateAnonymousId } from '../shared/identity.js'
import { resolveApiKey, resolveHostOrDefault } from '../shared/config.js'
import { COOKIE_MAX_AGE_SECONDS, DEFAULT_INGEST_PATH } from '../shared/constants.js'

export interface PostHogProxyOptions {
    /** Path prefix to intercept. Default: '/ingest'. */
    pathPrefix?: string
    /** PostHog ingest host to rewrite to. Default: 'https://us.i.posthog.com' */
    host?: string
}

/**
 * Configuration for the PostHog middleware.
 */
export interface PostHogMiddlewareOptions {
    /**
     * PostHog project API key (starts with phc_).
     * If omitted, reads from `NEXT_PUBLIC_POSTHOG_KEY` env var.
     */
    apiKey?: string
    /** Cookie max age in seconds. Default: 365 days. */
    cookieMaxAgeSeconds?: number
    /**
     * An existing response to seed the PostHog cookie on.
     *
     * When provided, the middleware seeds the identity cookie on this response
     * instead of creating a new one via `NextResponse.next()`. This enables
     * composition with other middleware.
     *
     * @example
     * ```ts
     * export default async function middleware(request: NextRequest) {
     *     const response = NextResponse.next()
     *     response.headers.set('x-custom', 'value')
     *     return postHogMiddleware({ response })(request)
     * }
     * ```
     */
    response?: NextResponse
    /**
     * Whether the middleware seeds the anonymous identity cookie on first visit.
     *
     * When `true` (the default), the middleware generates a UUIDv7 anonymous ID
     * and sets the `ph_<key>_posthog` cookie on the first request so that server
     * and client share the same identity from the first render.
     *
     * Set to `false` if you need user consent before setting any cookies. The
     * middleware will not set the cookie and it will only be created by the
     * client SDK.
     */
    seedAnonymousCookie?: boolean
    /**
     * Custom name for the consent cookie.
     * Mirrors the client-side `consent_persistence_name` option.
     */
    consentCookieName?: string
    /**
     * Custom prefix for the consent cookie (appended with apiKey).
     * Mirrors the client-side `opt_out_capturing_cookie_prefix` option.
     */
    consentCookiePrefix?: string
    /**
     * Proxy PostHog API requests through your app's domain.
     *
     * When enabled, requests matching the path prefix (default: `/ingest`)
     * are rewritten to the PostHog ingest host, allowing SDK traffic to
     * flow through your app's domain.
     *
     * Set to `true` for defaults, or pass an object to customize the path
     * prefix and/or target host.
     *
     * When using the proxy, set `api_host` to the path prefix (e.g. `/ingest`)
     * in your PostHogProvider options so the client SDK sends requests to
     * your app's domain.
     */
    proxy?: boolean | PostHogProxyOptions
}

interface ResolvedRewriteConfig {
    pathPrefix: string
    host: string
}

function resolveProxyConfig(proxy: boolean | PostHogProxyOptions | undefined): ResolvedRewriteConfig | null {
    if (!proxy) {
        return null
    }
    const options = typeof proxy === 'object' ? proxy : {}
    const prefix = options.pathPrefix ?? DEFAULT_INGEST_PATH
    return {
        pathPrefix: prefix.startsWith('/') ? prefix : `/${prefix}`,
        host: resolveHostOrDefault(options.host),
    }
}

function rewriteToPostHog(request: NextRequest, config: ResolvedRewriteConfig): NextResponse {
    const pathname = request.nextUrl.pathname.slice(config.pathPrefix.length) || '/'
    // eslint-disable-next-line compat/compat
    const url = new URL(pathname, config.host)
    url.search = request.nextUrl.search
    return NextResponse.rewrite(url)
}

/**
 * Creates a Next.js middleware that seeds the PostHog identity cookie
 * on first visit and optionally rewrites API requests to PostHog's
 * ingest host.
 *
 * @example Standalone (simplest — reads apiKey from NEXT_PUBLIC_POSTHOG_KEY)
 * ```ts
 * // middleware.ts
 * import { postHogMiddleware } from '@posthog/next'
 *
 * export default postHogMiddleware({ proxy: true })
 *
 * export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
 * ```
 *
 * @example Composed with other middleware
 * ```ts
 * import { postHogMiddleware } from '@posthog/next'
 *
 * export default async function middleware(request: NextRequest) {
 *   const response = otherMiddleware(request)
 *   return postHogMiddleware({ proxy: true, response })(request)
 * }
 * ```
 */
export function postHogMiddleware(config: PostHogMiddlewareOptions = {}) {
    const apiKey = resolveApiKey(config.apiKey)
    const proxyConfig = resolveProxyConfig(config.proxy)

    return async function middleware(request: NextRequest) {
        // Proxy ingest requests to PostHog's host. These are API calls
        // from the browser SDK and don't need cookie seeding.
        if (proxyConfig && request.nextUrl.pathname.startsWith(proxyConfig.pathPrefix)) {
            return rewriteToPostHog(request, proxyConfig)
        }

        const cookieName = getPostHogCookieName(apiKey)
        const state = readPostHogCookie(request.cookies, apiKey)
        const response = config.response ?? NextResponse.next()

        const shouldSeed = config.seedAnonymousCookie ?? true
        const optedOut = isOptedOut(request.cookies, apiKey, {
            opt_out_capturing_by_default: !shouldSeed,
            consent_persistence_name: config.consentCookieName,
            opt_out_capturing_cookie_prefix: config.consentCookiePrefix,
        })

        if (optedOut) {
            if (state) {
                response.cookies.delete(cookieName)
            }
            return response
        }

        // Seed the PostHog cookie on first visit so server and client
        // share the same identity from the first render.
        if (!state) {
            const distinctId = generateAnonymousId()
            response.cookies.set(cookieName, serializePostHogCookie(distinctId), {
                path: '/',
                sameSite: 'lax',
                secure: request.nextUrl.protocol === 'https:',
                maxAge: config.cookieMaxAgeSeconds ?? COOKIE_MAX_AGE_SECONDS,
                httpOnly: false,
            })
        }

        return response
    }
}
