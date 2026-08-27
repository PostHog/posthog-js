import type { CorePostHogOptions, PostHog } from './types'
import { createPostHogCore } from './posthog'

/** Creates the analytics-free core client. Pass client-owned delivery through `extensions`. */
export const createPostHog = async (options: CorePostHogOptions): Promise<PostHog> => createPostHogCore(options)

export { version } from './version'
export type {
    AnalyticsOptions,
    ApiResponse,
    BrowserFetch,
    BrowserNavigator,
    CaptureOptions,
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
