import { snapshotAutocaptureOptions } from './autocapture-options'
import { snapshotReplayOptions } from './replay-options'
import { snapshotSurveysOptions } from './surveys-options'
import { snapshotLogsOptions } from './logs-options'
import type { PostHog, PostHogOptions } from './types'
import { createPostHogCore } from './posthog'
import { isAnalyticsExtension } from './analytics-internal'
import { analytics } from './automatic-analytics'

/** Creates a browser client with first-party analytics delivery loaded lazily by default. */
export const createPostHog = async (options: PostHogOptions): Promise<PostHog> => {
    const extensions = [...(options?.extensions ?? [])]
    let loadingError: unknown
    if (!extensions.some(isAnalyticsExtension)) {
        let configuration: PostHogOptions['analytics'] = { load: 'lazy' }
        try {
            configuration = options?.analytics ?? configuration
        } catch {
            // Unavailable configuration uses defaults.
        }
        if (configuration !== false) {
            try {
                extensions.unshift(analytics(configuration))
            } catch (error) {
                loadingError = error
            }
        }
    }
    let autocaptureError: unknown
    let autocaptureOptions: ReturnType<typeof snapshotAutocaptureOptions> | undefined
    if (!extensions.some((extension) => extension.name === 'autocapture')) {
        try {
            const configuration = options?.autocapture
            if (configuration !== false) autocaptureOptions = snapshotAutocaptureOptions(configuration)
        } catch (error) {
            autocaptureError = error
        }
    }
    let flagsError: unknown
    if (!extensions.some((extension) => extension.name === 'featureFlags')) {
        try {
            const configuration = options?.flags
            if (configuration !== false) {
                const snapshot = configuration && JSON.parse(JSON.stringify(configuration))
                const { flags } = await import('./flags')
                extensions.push(flags(snapshot))
            }
        } catch (error) {
            flagsError = error
        }
    }
    let logsError: unknown
    if (!extensions.some((extension) => extension.name === 'logs')) {
        try {
            const configuration = options?.logs
            if (configuration !== false) {
                const snapshot = snapshotLogsOptions(configuration)
                const { logs } = await import('./logs')
                extensions.push(logs(snapshot))
            }
        } catch (error) {
            logsError = error
        }
    }
    let surveysError: unknown
    if (!extensions.some((extension) => extension.name === 'surveys')) {
        try {
            const configuration = options?.surveys
            if (configuration !== false) {
                const snapshot = snapshotSurveysOptions(configuration)
                const { surveys } = await import('./automatic-surveys')
                extensions.push(surveys(snapshot))
            }
        } catch (error) {
            surveysError = error
        }
    }
    if (autocaptureOptions) {
        try {
            const { autocapture } = await import('./autocapture')
            extensions.push(autocapture(autocaptureOptions))
        } catch (error) {
            autocaptureError = error
        }
    }
    let replayError: unknown
    if (!extensions.some((extension) => extension.name === 'sessionRecording')) {
        try {
            const configuration = options?.replay
            if (configuration !== false) {
                const snapshot = snapshotReplayOptions(configuration)
                const { replay } = await import('./replay')
                extensions.push(replay(snapshot))
            }
        } catch (error) {
            replayError = error
        }
    }
    const client = await createPostHogCore(options, extensions)
    if (replayError) client.logger.error('Automatic replay loading failed', replayError)
    if (autocaptureError) client.logger.error('Automatic autocapture loading failed', autocaptureError)
    if (surveysError) client.logger.error('Automatic surveys loading failed', surveysError)
    if (logsError) client.logger.error('Automatic logs loading failed', logsError)
    if (flagsError) client.logger.error('Automatic flags loading failed', flagsError)
    if (loadingError) {
        client.logger.error('Automatic analytics loading failed', loadingError)
    }
    return client
}

export { version } from './version'
export { FeatureFlagsExtension, type FeatureFlags } from './flags-token'
export type { BrowserClient, IdentifyInfo, GroupInfo } from './browser-client'
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
    PostHog,
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
export type { ReplayOptions, ReplayConfiguration } from './replay-options'
