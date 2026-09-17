import type { CorePostHogOptions, PostHog } from './types'
import { createPostHogCore } from './posthog'

/** Creates a buffer-only client unless analytics delivery is supplied through `extensions`. */
export const createPostHog = async (options: CorePostHogOptions): Promise<PostHog> => createPostHogCore(options)

export { version } from './version'
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
    PostHog,
    RemoteConfig,
    SendRequestInit,
    SessionContext,
    StorageLike,
} from './types'
