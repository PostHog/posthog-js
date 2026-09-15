import type { AnalyticsConfiguration, AnalyticsOptions, LoadStrategy, PostHog, PostHogOptions } from './types'
import { createPostHogCore, type AutomaticAnalyticsSetup } from './posthog'

const snapshotAutomaticAnalytics = (options: PostHogOptions): AutomaticAnalyticsSetup | undefined => {
    let configuration: AnalyticsConfiguration | undefined
    try {
        configuration = options.analytics
    } catch {
        configuration = undefined
    }
    if (configuration === false) {
        return undefined
    }

    let strategy: LoadStrategy = 'lazy'
    let flushAt: number | undefined
    let flushInterval: number | undefined
    try {
        strategy = configuration?.load === 'eager' ? 'eager' : 'lazy'
    } catch {
        // Lazy loading remains the accessible default.
    }
    try {
        flushAt = configuration?.flushAt
    } catch {
        // The analytics constructor applies its default.
    }
    try {
        flushInterval = configuration?.flushInterval
    } catch {
        // The analytics constructor applies its default.
    }
    return {
        strategy,
        options: {
            ...(flushAt === undefined ? {} : { flushAt }),
            ...(flushInterval === undefined ? {} : { flushInterval }),
        },
        async load(analyticsOptions: AnalyticsOptions) {
            const { analytics } = await import('./analytics')
            return analytics(analyticsOptions)
        },
    }
}

/** Creates a browser client with first-party analytics loaded lazily by default. */
export const createPostHog = async (options: PostHogOptions): Promise<PostHog> =>
    createPostHogCore(options, options ? snapshotAutomaticAnalytics(options) : undefined)

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
