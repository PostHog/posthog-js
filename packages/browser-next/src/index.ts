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
    const client = await createPostHogCore(options, extensions)
    if (flagsError) client.logger.error('Automatic flags loading failed', flagsError)
    if (loadingError) {
        client.logger.error('Automatic analytics loading failed', loadingError)
    }
    return client
}

export { version } from './version'
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

export type { FlagsOptions, FlagsConfiguration, FlagsCallback, FeatureFlagResult } from './flags-options'
