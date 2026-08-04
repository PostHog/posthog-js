/**
 * Web Vitals entrypoint (soft navigations, without attribution)
 *
 * Identical to web-vitals.ts, but built against pinned stable web-vitals 6.x.
 * That build understands the `reportSoftNavs` option, which
 * scopes each metric to the browser's Soft Navigation entries. On a single-page
 * app this restarts the measurement window on client-side route changes instead
 * of accumulating against the original hard-navigation timestamp (which otherwise
 * inflates LCP and friends).
 *
 * This is loaded lazily only when `capture_performance: { __preview_web_vitals_soft_navs: true }`
 * is set, so the standard bundle and its consumers are unaffected. The feature relies
 * on Chrome's experimental Soft Navigation Detection API.
 *
 * @see web-vitals.ts for the default bundle
 * @see web-vitals-with-attribution-soft-navs.ts for the attribution variant
 */
// Must be first: installs an Array.prototype.at polyfill before web-vitals (which uses it
// internally) is evaluated, so the bundle doesn't throw on browsers that predate `.at()`.
import '@posthog/browser-common/utils/array-at-polyfill'

import { assignableWindow, type WebVitalsCallbacks } from '../utils/globals'

import { onINP, onLCP, onCLS, onFCP } from 'web-vitals-soft-navs'

const postHogWebVitalsCallbacks: WebVitalsCallbacks = {
    onLCP,
    onCLS,
    onFCP,
    onINP,
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.postHogWebVitalsCallbacksByFlavor =
    assignableWindow.__PosthogExtensions__.postHogWebVitalsCallbacksByFlavor || {}
assignableWindow.__PosthogExtensions__.postHogWebVitalsCallbacksByFlavor['web-vitals-soft-navs'] =
    postHogWebVitalsCallbacks
assignableWindow.__PosthogExtensions__.postHogWebVitalsCallbacks = postHogWebVitalsCallbacks

// we used to put posthogWebVitalsCallbacks on window, and now we put it on __PosthogExtensions__
// but that means that old clients which lazily load this extension are looking in the wrong place
// yuck,
// so we also put it directly on the window
// when 1.161.1 is the oldest version seen in production we can remove this
assignableWindow.postHogWebVitalsCallbacks = postHogWebVitalsCallbacks
// deprecated function kept for backwards compatibility
assignableWindow.__PosthogExtensions__.loadWebVitalsCallbacks = () => postHogWebVitalsCallbacks

export default postHogWebVitalsCallbacks
