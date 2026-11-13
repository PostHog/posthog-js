import type { IPostHog, PostHogOptions } from './types'
import { createPostHogCore } from './posthog'
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

export type { IAnalytics } from './analytics-api'
export { version } from './version'
export { FeatureFlagsExtension, type FeatureFlags } from './flags-token'
export type { IPostHogInternal, BrowserExtension, IdentifyInfo, GroupInfo } from './browser-client'
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
} from './types'

export type {
    FlagsOptions,
    FlagsConfiguration,
    FlagsCallback,
    FeatureFlagResult,
    FeatureFlagsReloadResult,
} from './flags-options'

export type { LogsOptions, LogsConfiguration, CaptureLogOptions } from './logs-options'

export type {
    SurveysOptions,
    SurveysConfiguration,
    Survey,
    SurveyCallback,
    DisplaySurveyOptions,
    SurveyRenderReason,
} from './surveys-options'

export type { AutocaptureOptions, AutocaptureConfiguration, RageclickOptions } from './autocapture-options'
