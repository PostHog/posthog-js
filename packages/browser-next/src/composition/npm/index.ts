import type { IPostHog, PostHogOptions } from '../../core/types'
import { createPostHogCore } from '../../core/posthog'
import { createProductComposition } from './root-composition'

/** Creates a browser host with on-demand first-party analytics acquisition. */
export const createPostHog = async (options: PostHogOptions): Promise<IPostHog> => {
    const { extensions, loaders, automatic, loadingErrors } = createProductComposition(options)
    const client = await createPostHogCore(options, extensions, loaders, automatic)
    for (const [label, error] of loadingErrors.reverse()) {
        client.logger.error(`Automatic ${label} loading failed`, error)
    }
    return client
}

export type { IAnalytics } from '../../products/analytics/analytics-api'
export { version } from '../../primitives/version'
export { FeatureFlagsExtension, type FeatureFlags } from '../../products/flags/flags-token'
export type { IPostHogInternal, BrowserExtension, IdentifyInfo, GroupInfo } from '../../core/context/browser-client'
export type {
    AnalyticsConfiguration,
    AnalyticsOptions,
    ApiResponse,
    AutomaticAnalyticsOptions,
    BrowserFetch,
    BrowserNavigator,
    CaptureOptions,
    CaptureOutcome,
    CaptureOutcomeStatus,
    CaptureSummary,
    CorePostHogOptions,
    Disposable,
    Extension,
    LoadStrategy,
    NewSessionInfo,
    NewSessionReason,
    IPostHog,
    PostHogOptions,
    RemoteConfig,
    SendRequestInit,
    SessionContext,
    StorageLike,
} from '../../core/types'

export type {
    FlagsOptions,
    FlagsConfiguration,
    FlagsCallback,
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

export type { PersonProfileMode } from '../../products/analytics/analytics-options'
