import type { GetServerSideProps, GetServerSidePropsContext, GetServerSidePropsResult } from 'next'
import { PostHog } from 'posthog-node'
import type { PostHogOptions } from 'posthog-node'
import { getPostHogCookieName, parsePostHogCookie } from '../shared/cookie'
import { generateAnonymousId } from '../shared/identity'
import { createScopedClient } from '../shared/scoped-client'
import type { PostHogServerClient } from '../shared/scoped-client'

function parseCookiesFromHeader(cookieHeader: string): Record<string, string> {
    const cookies: Record<string, string> = {}
    if (!cookieHeader) return cookies

    for (const pair of cookieHeader.split(';')) {
        const [key, ...valueParts] = pair.trim().split('=')
        if (key) {
            cookies[key.trim()] = decodeURIComponent(valueParts.join('=').trim())
        }
    }
    return cookies
}

/**
 * Wraps a `getServerSideProps` function with a PostHog server client.
 *
 * The client automatically reads the user's distinct_id from the PostHog
 * cookie in the request headers, so all analytics calls are scoped to
 * the correct user.
 *
 * @param apiKey - PostHog project API key
 * @param handler - Your getServerSideProps function, enhanced with a PostHog client
 * @param options - Optional posthog-node configuration
 *
 * @example
 * ```tsx
 * // pages/dashboard.tsx
 * import { withPostHogServerProps } from '@posthog/next/pages'
 *
 * export const getServerSideProps = withPostHogServerProps(
 *   process.env.NEXT_PUBLIC_POSTHOG_KEY!,
 *   async (ctx, posthog) => {
 *     const showNewDashboard = await posthog.isFeatureEnabled('new-dashboard')
 *     posthog.capture('dashboard_viewed')
 *     return { props: { showNewDashboard } }
 *   }
 * )
 * ```
 */
export function withPostHogServerProps<P extends Record<string, unknown>>(
    apiKey: string,
    handler: (context: GetServerSidePropsContext, posthog: PostHogServerClient) => Promise<GetServerSidePropsResult<P>>,
    options?: Partial<PostHogOptions>
): GetServerSideProps<P> {
    return async (context: GetServerSidePropsContext) => {
        const client = new PostHog(apiKey, options)

        // Parse cookie from request headers
        const cookieHeader = context.req.headers.cookie || ''
        const cookies = parseCookiesFromHeader(cookieHeader)
        const cookieName = getPostHogCookieName(apiKey)
        const cookieValue = cookies[cookieName]
        const state = cookieValue ? parsePostHogCookie(cookieValue) : null
        const distinctId = state?.distinctId ?? generateAnonymousId()

        const scopedClient = createScopedClient(client, distinctId)

        return handler(context, scopedClient)
    }
}
