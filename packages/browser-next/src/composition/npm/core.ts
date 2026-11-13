import type { CorePostHogOptions, IPostHog } from '../../core/types'
import { createPostHogCore } from '../../core/posthog'

/** Creates a host with only explicitly supplied products and no automatic product imports. */
export const createPostHog = async (options: CorePostHogOptions): Promise<IPostHog> => createPostHogCore(options)

export { version } from '../../primitives/version'
export { FeatureFlagsExtension, type IFeatureFlags } from '../../products/flags/flags-token'
export type { IPostHogInternal, BrowserExtension, IdentifyInfo, GroupInfo } from '../../core/context/browser-client'
export type { IAnalytics } from '../../products/analytics/analytics-api'
export type {
    AnalyticsOptions,
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
    SessionContext,
    StorageLike,
} from '../../core/types'

export type { PersonProfileMode } from '../../products/analytics/analytics-options'
