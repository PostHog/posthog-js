import type { IPostHog, PostHogOptions } from '../../core/types'
import { createPostHogCore } from '../../core/posthog'
import { createAnalyticsDelivery } from '../../products/analytics/delivery/analytics-delivery'
import { createProductComposition } from './root-composition'

/** Creates the browser client with durable delivery and on-demand products. */
export const createPostHog = async (options: PostHogOptions): Promise<IPostHog> => {
    const { extensions, loaders, automatic, loadingErrors } = createProductComposition(options)
    const client = await createPostHogCore(options, createAnalyticsDelivery, extensions, loaders, automatic)
    for (const [label, error] of loadingErrors.reverse()) {
        client.logger.error(`Automatic ${label} loading failed`, error)
    }
    return client
}

export { version } from '../../primitives/version'
export { FeatureFlagsExtension, type FeatureFlags } from '../../products/flags/flags-token'
export type { BrowserExtension, IdentifyInfo, GroupInfo } from '../../core/context/browser-client'
export type {
    AnalyticsOptions,
    ApiResponse,
    BrowserFetch,
    BootstrapOptions,
    BrowserNavigator,
    CaptureOptions,
    CaptureOutcome,
    CaptureOutcomeStatus,
    CaptureSummary,
    CorePostHogOptions,
    Disposable,
    ExplicitConsentStatus,
    Extension,
    NewSessionInfo,
    NewSessionReason,
    IPostHog,
    PostHogOptions,
    RemoteConfig,
    ResetOptions,
    RuntimeOptions,
    SendRequestInit,
    SessionContext,
    StorageLike,
} from '../../core/types'

export type {
    EarlyAccessFeature,
    EarlyAccessFeatureCallback,
    EarlyAccessFeatureStage,
    FlagsOptions,
    FlagsConfiguration,
    FlagsCallback,
    FlagsReadOptions,
    FeatureFlagResult,
    FeatureFlagsReloadResult,
} from '../../products/flags/flags-options'

export type { LogsOptions, LogsConfiguration, CaptureLogOptions } from '../../products/logs/logs-options'

export type {
    SurveysOptions,
    SurveysConfiguration,
    Survey,
    SurveyCallback,
    DisplaySurveyOptions,
    SurveyRenderReason,
} from '../../products/surveys/surveys-options'

export type {
    AutocaptureOptions,
    AutocaptureConfiguration,
    RageclickOptions,
} from '../../products/autocapture/autocapture-options'

export type {
    WebVitalsOptions,
    WebVitalsConfiguration,
    WebVitalsMetric,
} from '../../products/web-vitals/web-vitals-options'
export type { TracingHeadersOptions } from '../../products/tracing-headers/tracing-headers-options'
export type {
    ErrorTrackingOptions,
    ErrorTrackingConfiguration,
    ExceptionAutocaptureOptions,
    ExceptionStepsOptions,
} from '../../products/error-tracking/error-tracking-options'
export type {
    ToolbarOptions,
    ToolbarConfiguration,
    ToolbarExtension,
    ToolbarParams,
} from '../../products/toolbar/toolbar-options'

export type {
    ConversationsConfiguration,
    ConversationsExtension,
    ConversationsIdentity,
    ConversationsOptions,
    ConversationsTheme,
    ConversationsUnavailableReason,
} from '../../products/conversations/conversations-options'
export type {
    SessionRecordingOptions,
    SessionRecordingConfiguration,
} from '../../products/session-recording/session-recording-options'
export type {
    SessionRecordingExtension,
    SessionRecordingOverride,
    SessionReplayUrlOptions,
} from '../../products/session-recording/session-recording-internal'

export type { PersonProfileMode } from '../../products/analytics/analytics-options'
