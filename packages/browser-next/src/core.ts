import type { CorePostHogOptions, IPostHog } from './types'
import { createPostHogCore } from './posthog'

/** Creates a host with only explicitly supplied products and no automatic product imports. */
export const createPostHog = async (options: CorePostHogOptions): Promise<IPostHog> => createPostHogCore(options)

export { version } from './version'
export { FeatureFlagsExtension, type FeatureFlags } from './flags-token'
export type { IPostHogInternal, BrowserExtension, IdentifyInfo, GroupInfo } from './browser-client'
export type { IAnalytics } from './analytics-api'
export type {
    AnalyticsOptions,
    ApiResponse,
    BrowserFetch,
    BrowserNavigator,
    CaptureOptions,
    CaptureOutcome,
    CaptureOutcomeStatus,
    CaptureSummary,
    CorePostHogOptions,
    Disposable,
    Extension,
    NewSessionInfo,
    NewSessionReason,
    IPostHog,
    RemoteConfig,
    SendRequestInit,
    SessionContext,
    StorageLike,
} from './types'
