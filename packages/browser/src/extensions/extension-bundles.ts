/**
 * Pre-grouped extension bundles for tree-shaking support.
 *
 * Use these with `__extensionClasses` to control which extensions are included in your bundle.
 * The default `posthog-js` entrypoint includes all extensions. When using `posthog-js/slim`,
 * you can import only the bundles you need:
 *
 * @example
 * ```ts
 * import posthog from 'posthog-js/slim'
 * import { ReplayExtensions, AnalyticsExtensions } from 'posthog-js/extensions'
 *
 * posthog.init('ph_key', {
 *   __extensionClasses: {
 *     ...ReplayExtensions,
 *     ...AnalyticsExtensions,
 *   }
 * })
 * ```
 *
 * @module
 */

import { Autocapture } from '../autocapture'
import { DeadClicksAutocapture } from './dead-clicks-autocapture'
import { ExceptionObserver } from './exception-autocapture'
import { HistoryAutocapture } from './history-autocapture'
import { TracingHeaders } from './tracing-headers'
import { WebVitalsAutocapture } from './web-vitals'
import { SessionRecording } from './replay/session-recording'
import { Heatmaps } from '../heatmaps'
import { PostHogProductTours } from '../posthog-product-tours'
import { SiteApps } from '../site-apps'
import { PostHogConfig } from '../types'
import { PostHogSurveys } from '../posthog-surveys'

type ExtensionClasses = NonNullable<PostHogConfig['__extensionClasses']>

/** Session replay and related extensions. */
export const ReplayExtensions = {
    sessionRecording: SessionRecording,
} as const satisfies ExtensionClasses

/** Autocapture, click tracking, heatmaps, and web vitals. */
export const AnalyticsExtensions = {
    autocapture: Autocapture,
    historyAutocapture: HistoryAutocapture,
    heatmaps: Heatmaps,
    deadClicksAutocapture: DeadClicksAutocapture,
    webVitalsAutocapture: WebVitalsAutocapture,
} as const satisfies ExtensionClasses

/** Automatic exception and error capture. */
export const ErrorTrackingExtensions = {
    exceptionObserver: ExceptionObserver,
} as const satisfies ExtensionClasses

/** In-app product tours. */
export const ProductToursExtensions = {
    productTours: PostHogProductTours,
} as const satisfies ExtensionClasses

/** Site apps support. */
export const SiteAppsExtensions = {
    siteApps: SiteApps,
} as const satisfies ExtensionClasses

/** Distributed tracing header injection. */
export const TracingExtensions = {
    tracingHeaders: TracingHeaders,
} as const satisfies ExtensionClasses

/** In-app surveys. */
export const SurveysExtensions = {
    surveys: PostHogSurveys,
} as const satisfies ExtensionClasses

/** All extensions — equivalent to the default `posthog-js` bundle. */
export const AllExtensions = {
    ...AnalyticsExtensions,
    ...ErrorTrackingExtensions,
    ...ProductToursExtensions,
    ...ReplayExtensions,
    ...SiteAppsExtensions,
    ...SurveysExtensions,
    ...TracingExtensions,
} as const satisfies ExtensionClasses
