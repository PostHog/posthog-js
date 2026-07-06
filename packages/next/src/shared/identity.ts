import { isNullish, isNumber, uuidv7 } from '@posthog/core'
import type { GetServerSidePropsContext } from 'next'

/**
 * Generates a random anonymous distinct_id using UUIDv7.
 * Used as a fallback when no PostHog cookie is available.
 */
export function generateAnonymousId(): string {
    return uuidv7()
}

/**
 * Resolves the distinct id of the user making the current request, from a
 * server-side source of truth (e.g. the app's auth session).
 *
 * Called once per `getPostHog()` / `getServerSidePostHog()` call, so it may
 * read request-scoped state such as `cookies()` / `headers()` or auth helpers
 * like next-auth's `auth()`. When called from `getServerSidePostHog()`, the
 * `GetServerSidePropsContext` is passed so Pages Router auth helpers (e.g.
 * `getServerSession(ctx.req, ctx.res, ...)`) can be used; in App Router it is
 * `undefined`. Return `null`/`undefined` when there is no authenticated user
 * to fall back to the client-provided identity (PostHog cookie / tracing
 * headers).
 */
export type PostHogDistinctIdResolver = (
    ctx?: GetServerSidePropsContext
) => string | null | undefined | Promise<string | null | undefined>

/**
 * Next.js implements redirect()/notFound() and dynamic-rendering bailouts as
 * thrown errors carrying a `digest` marker. They must propagate to the
 * framework, never be swallowed. Checked by digest rather than
 * `unstable_rethrow` because that API doesn't exist across the supported
 * `next >= 13` peer range.
 */
function isNextControlFlowError(error: unknown): boolean {
    const digest = (error as { digest?: unknown } | null | undefined)?.digest
    return (
        typeof digest === 'string' &&
        (digest.startsWith('NEXT_REDIRECT') ||
            digest === 'NEXT_NOT_FOUND' ||
            digest.startsWith('NEXT_HTTP_ERROR_FALLBACK') ||
            digest === 'DYNAMIC_SERVER_USAGE' ||
            digest === 'BAILOUT_TO_CLIENT_SIDE_RENDERING')
    )
}

/**
 * Runs a distinct id resolver, tolerating failures.
 *
 * Returns undefined for empty/blank/non-string ids (numbers are converted,
 * matching posthog-js `identify()`), and on error warns and returns undefined
 * so identity falls back to the client-provided values — a broken resolver
 * must not break the app's request handling. Next.js control-flow errors
 * (redirect, notFound, dynamic bailouts) are rethrown.
 */
export async function resolveServerDistinctId(
    resolver: PostHogDistinctIdResolver,
    ctx?: GetServerSidePropsContext
): Promise<string | undefined> {
    try {
        const distinctId = await resolver(ctx)
        if (isNullish(distinctId)) {
            return undefined
        }
        if (isNumber(distinctId)) {
            // eslint-disable-next-line no-console
            console.warn(
                '[PostHog Next.js] getDistinctId returned a number, but it should be a string. It has been converted to a string.'
            )
            return String(distinctId)
        }
        if (typeof distinctId !== 'string') {
            // eslint-disable-next-line no-console
            console.warn(
                '[PostHog Next.js] getDistinctId returned a non-string value — falling back to client-provided identity'
            )
            return undefined
        }
        return distinctId.trim() !== '' ? distinctId : undefined
    } catch (error) {
        if (isNextControlFlowError(error)) {
            throw error
        }
        // eslint-disable-next-line no-console
        console.warn('[PostHog Next.js] getDistinctId threw — falling back to client-provided identity', error)
        return undefined
    }
}
