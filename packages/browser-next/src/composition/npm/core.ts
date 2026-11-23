import type { CorePostHogOptions, IPostHog } from '../../core/types'
import { createPostHogCore } from '../../core/posthog'
import { createAnalyticsDelivery } from '../../products/analytics/delivery/analytics-delivery'

/** Creates the browser client with durable delivery and only explicitly supplied products. */
export const createPostHog = async (options: CorePostHogOptions): Promise<IPostHog> =>
    createPostHogCore(options, createAnalyticsDelivery)

export { version } from '../../primitives/version'
export { FeatureFlagsExtension, type FeatureFlags } from '../../products/flags/flags-token'
export type { BrowserExtension, IdentifyInfo, GroupInfo } from '../../core/context/browser-client'
export type {
    AnalyticsOptions,
    ApiResponse,
    BrowserFetch,
    BootstrapOptions,
    BrowserNavigator,
    CaptureOptions,
    CaptureOutcome,
    CaptureOutcomeStatus,
    CaptureSummary,
    CorePostHogOptions,
    Disposable,
    ExplicitConsentStatus,
    Extension,
    NewSessionInfo,
    NewSessionReason,
    IPostHog,
    IPostHogExtensionHost,
    RemoteConfig,
    ResetOptions,
    RuntimeOptions,
    SendRequestInit,
    SessionContext,
    StorageLike,
    UrlSanitizationOptions,
} from '../../core/types'

export type { PersonProfileMode } from '../../products/analytics/analytics-options'
