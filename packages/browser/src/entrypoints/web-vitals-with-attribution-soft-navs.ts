/**
 * Web Vitals entrypoint (soft navigations, with attribution)
 *
 * Identical to web-vitals-with-attribution.ts, but built against a soft-navs build
 * of the web-vitals library so the observers understand the `reportSoftNavs` option.
 * That option scopes each metric to the browser's Soft Navigation entries, so on a
 * single-page app the measurement window restarts on client-side route changes
 * instead of accumulating against the original hard-navigation timestamp.
 *
 * This is loaded lazily only when both `web_vitals_attribution` and
 * `web_vitals_soft_navs` are enabled. The feature relies on Chrome's experimental
 * Soft Navigation Detection API.
 *
 * Note: as with the non-soft-navs attribution build, attribution can cause memory
 * issues in SPAs because the onCLS callback holds references to DOM elements that
 * may be detached during navigation.
 *
 * @see web-vitals-soft-navs.ts for the lighter soft-navs bundle
 * @see web-vitals-with-attribution.ts for the default attribution bundle
 */
// Must be first: installs an Array.prototype.at polyfill before web-vitals (which uses it
// internally) is evaluated, so the bundle doesn't throw on browsers that predate `.at()`.
import '@posthog/browser-common/utils/array-at-polyfill'

import { assignableWindow } from '../utils/globals'

import {
    onINP as onINPWithAttribution,
    onLCP as onLCPWithAttribution,
    onCLS as onCLSWithAttribution,
    onFCP as onFCPWithAttribution,
} from 'web-vitals-soft-navs/attribution'

const postHogWebVitalsCallbacks = {
    onLCP: onLCPWithAttribution,
    onCLS: onCLSWithAttribution,
    onFCP: onFCPWithAttribution,
    onINP: onINPWithAttribution,
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.postHogWebVitalsCallbacks = postHogWebVitalsCallbacks

// we used to put posthogWebVitalsCallbacks on window, and now we put it on __PosthogExtensions__
// but that means that old clients which lazily load this extension are looking in the wrong place
// yuck,
// so we also put it directly on the window
// when 1.161.1 is the oldest version seen in production we can remove this
assignableWindow.postHogWebVitalsCallbacks = postHogWebVitalsCallbacks

export default postHogWebVitalsCallbacks
