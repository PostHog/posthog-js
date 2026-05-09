// Cookie helpers were lifted to `@posthog/core` so all SDKs (posthog-node,
// posthog-js-lite, etc.) can share them. This module re-exports the public
// surface for any internal `@posthog/next` imports — keep using these from
// `./shared/cookie` within next/, or import directly from `@posthog/core`.
export {
    cookieStateToProperties,
    cookieStoreFromHeader,
    getConsentCookieName,
    getPostHogCookieName,
    isOptedOut,
    parsePostHogCookie,
    readPostHogCookie,
    serializePostHogCookie,
} from '@posthog/core'
export type { ConsentConfig, ConsentCookieConfig, CookieStore, PostHogCookieState } from '@posthog/core'
