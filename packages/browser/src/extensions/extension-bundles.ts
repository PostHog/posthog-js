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
import { Toolbar } from './toolbar'
import { PostHogExceptions } from '../posthog-exceptions'
import { WebExperiments } from '../web-experiments'
import { PostHogConversations } from './conversations/posthog-conversations'
import { PostHogLogs } from '../posthog-logs'

type ExtensionClasses = NonNullable<PostHogConfig['__extensionClasses']>

/** Session replay. */
export const SessionReplayExtensions = {
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
    exceptions: PostHogExceptions,
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

/** PostHog toolbar for visual element inspection and action setup. */
export const ToolbarExtensions = {
    toolbar: Toolbar,
} as const satisfies ExtensionClasses

/** Web experiments. */
export const ExperimentsExtensions = {
    experiments: WebExperiments,
} as const satisfies ExtensionClasses

/** In-app conversations. */
export const ConversationsExtensions = {
    conversations: PostHogConversations,
} as const satisfies ExtensionClasses

/** Console log capture. */
export const LogsExtensions = {
    logs: PostHogLogs,
} as const satisfies ExtensionClasses

/** All extensions — equivalent to the default `posthog-js` bundle. */
export const AllExtensions = {
    ...SessionReplayExtensions,
    ...AnalyticsExtensions,
    ...ErrorTrackingExtensions,
    ...ProductToursExtensions,
    ...SiteAppsExtensions,
    ...TracingExtensions,
    ...SurveysExtensions,
    ...ToolbarExtensions,
    ...ExperimentsExtensions,
    ...ConversationsExtensions,
    ...LogsExtensions,
} as const satisfies ExtensionClasses
