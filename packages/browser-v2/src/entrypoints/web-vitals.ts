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
 *   capturePerformance: { web_vitals_attribution: true }
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

export default postHogWebVitalsCallbacks
