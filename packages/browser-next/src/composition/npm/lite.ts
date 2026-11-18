import type { CorePostHogOptions, IPostHog } from '../../core/types'
import { createPostHogCore } from '../../core/posthog'
import { createLiteDelivery } from '../../products/analytics/delivery/lite-delivery'

/**
 * Creates the browser client with best-effort delivery: no retries, compression, payload splitting or
 * immediate capture. Identity, sessions, consent and persistence are the same as the default client.
 */
export const createPostHog = async (options: CorePostHogOptions): Promise<IPostHog> =>
    createPostHogCore(options, createLiteDelivery)

export { version } from '../../primitives/version'
export { FeatureFlagsExtension, type FeatureFlags } from '../../products/flags/flags-token'
export type { BrowserExtension, IdentifyInfo, GroupInfo } from '../../core/context/browser-client'
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
} from '../../core/types'

export type { PersonProfileMode } from '../../products/analytics/analytics-options'
