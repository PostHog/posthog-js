/**
 * Web Vitals entrypoint (with attribution)
 *
 * This bundle includes both attributed and unattributed observers so the SDK can
 * select attribution per metric. INP and LCP use attribution by default; CLS and
 * FCP use the unattributed observers unless explicitly configured otherwise.
 *
 * This bundle is ~18KB (vs ~6KB for the non-attribution version).
 *
 * Note: Attribution can cause memory issues in SPAs because the attributed onCLS
 * callback holds references to DOM elements that may be detached during navigation.
 *
 * Set capture_performance.web_vitals_attribution to true to attribute every metric,
 * false to load the lighter bundle, or an array to select individual metrics.
 *
 * @see web-vitals.ts for the lighter bundle
 */
// Must be first: installs an Array.prototype.at polyfill before web-vitals (which uses it
// internally) is evaluated, so the bundle doesn't throw on browsers that predate `.at()`.
import '@posthog/browser-common/utils/array-at-polyfill'

import { assignableWindow, type WebVitalsCallbacks } from '../utils/globals'

import {
    onINP as onINPWithAttribution,
    onLCP as onLCPWithAttribution,
    onCLS as onCLSWithAttribution,
    onFCP as onFCPWithAttribution,
} from 'web-vitals/attribution'
import { onINP, onLCP, onCLS, onFCP } from 'web-vitals'

const postHogWebVitalsCallbacks: WebVitalsCallbacks = {
    onLCP: onLCPWithAttribution,
    onCLS: onCLSWithAttribution,
    onFCP: onFCPWithAttribution,
    onINP: onINPWithAttribution,
    withoutAttribution: { onLCP, onCLS, onFCP, onINP },
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.postHogWebVitalsCallbacksByFlavor =
    assignableWindow.__PosthogExtensions__.postHogWebVitalsCallbacksByFlavor || {}
assignableWindow.__PosthogExtensions__.postHogWebVitalsCallbacksByFlavor['web-vitals-with-attribution'] =
    postHogWebVitalsCallbacks
assignableWindow.__PosthogExtensions__.postHogWebVitalsCallbacks = postHogWebVitalsCallbacks

// we used to put posthogWebVitalsCallbacks on window, and now we put it on __PosthogExtensions__
// but that means that old clients which lazily load this extension are looking in the wrong place
// yuck,
// so we also put it directly on the window
// when 1.161.1 is the oldest version seen in production we can remove this
assignableWindow.postHogWebVitalsCallbacks = postHogWebVitalsCallbacks

export default postHogWebVitalsCallbacks
