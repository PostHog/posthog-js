import { snapshotAutocaptureOptions } from './autocapture-options'
import { snapshotSurveysOptions } from './surveys-options'
import { snapshotLogsOptions } from './logs-options'
import type { Extension, PostHog, PostHogOptions } from './types'
import { createPostHogCore } from './posthog'
import { isAnalyticsExtension } from './analytics-internal'
import { analytics } from './automatic-analytics'

/** Creates a browser client with first-party analytics delivery loaded lazily by default. */
export const createPostHog = async (options: PostHogOptions): Promise<PostHog> => {
    const extensions = [...(options?.extensions ?? [])]
    const loadingErrors: Array<[string, unknown]> = []
    const install = (
        label: string,
        matches: (extension: Extension) => boolean,
        load: () => Extension | Promise<Extension> | undefined,
        prepend = false
    ): Promise<void> | undefined => {
        if (extensions.some(matches)) return
        const add = (extension: Extension): void => {
            if (prepend) extensions.unshift(extension)
            else extensions.push(extension)
        }
        const failed = (error: unknown): void => {
            if (error) loadingErrors.push([label, error])
        }
        try {
            const extension = load()
            if (extension instanceof Promise) return extension.then(add).catch(failed)
            if (extension) add(extension)
        } catch (error) {
            failed(error)
        }
    }
    install(
        'analytics',
        isAnalyticsExtension,
        () => {
            let configuration: PostHogOptions['analytics'] = { load: 'lazy' }
            try {
                configuration = options?.analytics ?? configuration
            } catch {
                // Unavailable configuration uses defaults.
            }
            return configuration === false ? undefined : analytics(configuration)
        },
        true
    )
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
    const flagsLoading = install(
        'flags',
        (extension) => extension.name === 'featureFlags',
        () => {
            const configuration = options?.flags
            if (configuration === false) return
            const snapshot = configuration && JSON.parse(JSON.stringify(configuration))
            return import('./flags').then(({ flags }) => flags(snapshot))
        }
    )
    if (flagsLoading) await flagsLoading
    const logsLoading = install(
        'logs',
        (extension) => extension.name === 'logs',
        () => {
            const configuration = options?.logs
            if (configuration === false) return
            const snapshot = snapshotLogsOptions(configuration)
            return import('./logs').then(({ logs }) => logs(snapshot))
        }
    )
    if (logsLoading) await logsLoading
    const surveysLoading = install(
        'surveys',
        (extension) => extension.name === 'surveys',
        () => {
            const configuration = options?.surveys
            if (configuration === false) return
            const snapshot = snapshotSurveysOptions(configuration)
            return import('./automatic-surveys').then(({ surveys }) => surveys(snapshot))
        }
    )
    if (surveysLoading) await surveysLoading
    const autocaptureLoading = install(
        'autocapture',
        (extension) => extension.name === 'autocapture',
        () => {
            if (!autocaptureOptions) return
            return import('./autocapture').then(({ autocapture }) => autocapture(autocaptureOptions))
        }
    )
    if (autocaptureLoading) await autocaptureLoading
    if (autocaptureError) loadingErrors.push(['autocapture', autocaptureError])
    const client = await createPostHogCore(options, extensions)
    for (const [label, error] of loadingErrors.reverse()) {
        client.logger.error(`Automatic ${label} loading failed`, error)
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
