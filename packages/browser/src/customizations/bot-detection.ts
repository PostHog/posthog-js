/**
 * Opt-in heuristic that flags user agents whose Chrome token appears without
 * the usual AppleWebKit / Safari tokens that real Chrome always emits. Legit
 * mobile WebViews and custom WebView apps CAN omit these, so this is a
 * client-side-only signal — intended for callers who want to filter or tag
 * events in `before_send`, not a universal blocklist entry.
 *
 * This is deliberately a standalone utility (not wired into the default
 * blocklist) so default SDK behavior is unchanged. Server-side rules remain
 * the primary bot-detection surface — see posthog/posthog#109617 and #109620.
 *
 * @example
 * ```ts
 * import { isLikelyWebViewBot } from 'posthog-js/customizations'
 *
 * posthog.init('PROJECT_TOKEN', {
 *   before_send: (event) => {
 *     if (event && isLikelyWebViewBot(navigator.userAgent)) {
 *       event.properties.$suspected_webview_bot = true
 *     }
 *     return event
 *   },
 * })
 * ```
 */
export function isLikelyWebViewBot(ua: string | undefined): boolean {
    if (!ua) {
        return false
    }
    const uaLower = ua.toLowerCase()
    const hasChrome = uaLower.indexOf('chrome/') !== -1
    const hasWebKit = uaLower.indexOf('applewebkit/') !== -1
    const hasSafari = uaLower.indexOf('safari/') !== -1
    // A Chrome token without BOTH WebKit and Safari tokens is unusual for a
    // real browser; most legitimate WebViews still carry the full triple.
    return hasChrome && (!hasWebKit || !hasSafari)
}
