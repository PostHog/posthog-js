import { COOKIE_PREFIX, COOKIE_SUFFIX } from './constants'

export interface PostHogCookieState {
    distinctId: string
    isIdentified: boolean
}

/**
 * Returns the PostHog cookie name for the given API key.
 *
 * PostHog-js stores state in a cookie named `ph_<sanitized_token>_posthog`.
 * The token is sanitized by replacing `+` with `PL`, `/` with `SL`, `=` with `EQ`.
 *
 * @param apiKey - The PostHog project API key
 * @returns The cookie name string
 */
export function getPostHogCookieName(apiKey: string): string {
    const sanitized = apiKey.replace(/\+/g, 'PL').replace(/\//g, 'SL').replace(/=/g, 'EQ')
    return `${COOKIE_PREFIX}${sanitized}${COOKIE_SUFFIX}`
}

/**
 * Parses a PostHog cookie value and extracts identity information.
 *
 * The cookie value is a JSON object containing `distinct_id` and `$user_state`.
 * A user is considered identified if `$user_state` is `'identified'`.
 *
 * @param cookieValue - The raw cookie string value
 * @returns Parsed identity state, or null if the cookie is missing/invalid
 */
/**
 * Serializes an anonymous ID into the JSON format posthog-js expects.
 *
 * When `distinct_id === $device_id`, posthog-js treats the user as anonymous.
 *
 * @param anonymousId - The anonymous distinct ID to serialize
 * @returns JSON string suitable for the PostHog cookie value
 */
export function serializePostHogCookie(anonymousId: string): string {
    return JSON.stringify({
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $user_state: 'anonymous',
    })
}

/**
 * Reads and parses the PostHog cookie from a cookie store.
 *
 * Compatible with Next.js `cookies()`, `request.cookies`, and any object
 * with a `get(name)` method that returns `{ value: string } | undefined`.
 */
export function readPostHogCookie(
    cookies: { get(name: string): { value: string } | undefined },
    apiKey: string
): PostHogCookieState | null {
    const cookieName = getPostHogCookieName(apiKey)
    const cookie = cookies.get(cookieName)
    return cookie ? parsePostHogCookie(cookie.value) : null
}

export function parsePostHogCookie(cookieValue: string): PostHogCookieState | null {
    if (!cookieValue) {
        return null
    }

    try {
        const parsed = JSON.parse(cookieValue)
        if (!parsed || typeof parsed !== 'object' || !parsed.distinct_id) {
            return null
        }

        return {
            distinctId: String(parsed.distinct_id),
            isIdentified: parsed.$user_state === 'identified',
        }
    } catch {
        return null
    }
}
