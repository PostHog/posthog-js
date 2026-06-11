/**
 * Pre-grouped extension bundles for tree-shaking support.
 *
 * Each bundle is self-contained: a feature plus its runtime dependencies.
 * Use these with `__extensionClasses` to control which extensions are included in your bundle.
 * The default `posthog-js` entrypoint includes all extensions. When using `posthog-js/slim`,
 * you can import only the bundles you need:
 *
 * @example
 * ```ts
 * import posthog from 'posthog-js/slim'
 * import { SessionReplayExtensions, AnalyticsExtensions } from 'posthog-js/extensions'
 *
 * posthog.init('ph_key', {
 *   __extensionClasses: {
 *     ...SessionReplayExtensions,
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
import { PostHogFeatureFlags } from '../posthog-featureflags'
import { PostHogExceptions } from '../posthog-exceptions'
import { WebExperiments } from '../web-experiments'
import { PostHogConversations } from './conversations/posthog-conversations'
import { PostHogLogs } from '../posthog-logs'

type ExtensionClasses = NonNullable<PostHogConfig['__extensionClasses']>

/** Feature flags. */
export const FeatureFlagsExtensions = {
    featureFlags: PostHogFeatureFlags,
} as const satisfies ExtensionClasses

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

/** Exception and error capture. Requires both the observer (capture hook) and exceptions (forwarding). */
export const ErrorTrackingExtensions = {
    exceptionObserver: ExceptionObserver,
    exceptions: PostHogExceptions,
} as const satisfies ExtensionClasses

/** In-app product tours. Includes feature flags for targeting. */
export const ProductToursExtensions = {
    productTours: PostHogProductTours,
    ...FeatureFlagsExtensions,
} as const satisfies ExtensionClasses

/** Site apps support. */
export const SiteAppsExtensions = {
    siteApps: SiteApps,
} as const satisfies ExtensionClasses

/** Distributed tracing header injection. */
export const TracingExtensions = {
    tracingHeaders: TracingHeaders,
} as const satisfies ExtensionClasses

/** In-app surveys. Includes feature flags for targeting. */
export const SurveysExtensions = {
    surveys: PostHogSurveys,
    ...FeatureFlagsExtensions,
} as const satisfies ExtensionClasses

/** PostHog toolbar for visual element inspection and action setup. */
export const ToolbarExtensions = {
    toolbar: Toolbar,
} as const satisfies ExtensionClasses

/** Web experiments. Includes feature flags for variant evaluation. */
export const ExperimentsExtensions = {
    experiments: WebExperiments,
    ...FeatureFlagsExtensions,
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
    ...FeatureFlagsExtensions,
    ...SessionReplayExtensions,
    ...AnalyticsExtensions,
    ...ErrorTrackingExtensions,
    ...ProductToursExtensions,
    ...SiteAppsExtensions,
    ...SurveysExtensions,
    ...TracingExtensions,
    ...ToolbarExtensions,
    ...ExperimentsExtensions,
    ...ConversationsExtensions,
    ...LogsExtensions,
} as const satisfies ExtensionClasses
