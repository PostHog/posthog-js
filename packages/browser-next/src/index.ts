import type { PostHog, PostHogOptions } from './types'
import { createPostHogCore } from './posthog'
import { isAnalyticsExtension } from './analytics-internal'
import { createChunkLoader } from './chunk-loader'

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
            const automaticAnalytics = createChunkLoader(async () => {
                const { analytics } = await import('./automatic-analytics')
                return analytics(configuration)
            })
            try {
                extensions.unshift(await automaticAnalytics.load(() => true))
            } catch (error) {
                loadingError = error
            }
        }
    }
    const client = await createPostHogCore(options, extensions)
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
