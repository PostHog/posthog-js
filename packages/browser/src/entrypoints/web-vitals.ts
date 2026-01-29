/**
 * Web Vitals entrypoint (without attribution)
 *
 * This is the default, lighter bundle (~6KB) that captures core web vitals metrics
 * without attribution data. Attribution data includes debugging information like
 * which elements caused layout shifts, timing breakdowns, etc.
 *
 * We split this into two bundles because:
 * 1. Attribution code adds ~6KB to the bundle size
 * 2. Attribution can cause memory issues in SPAs (onCLS holds references to detached DOM elements)
 * 3. Most users only need aggregate metrics, not debugging attribution data
 *
 * For attribution data, use web-vitals-with-attribution.ts instead by setting:
 *   capture_performance: { web_vitals_attribution: true }
 *
 * @see web-vitals-with-attribution.ts
 */
import { assignableWindow } from '../utils/globals'

import { onINP, onLCP, onCLS, onFCP } from 'web-vitals'

const postHogWebVitalsCallbacks = {
    onLCP,
    onCLS,
    onFCP,
    onINP,
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
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
