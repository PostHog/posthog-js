// Edge-runtime exports (middleware and request-error capture). Excludes
// PostHogProvider, which relies on Next.js server rendering APIs.
export { postHogMiddleware } from './middleware/postHogMiddleware.js'
export { captureRequestError, createOnRequestError, onRequestError } from './server.edge.js'
export { PostHogPageView } from './client/PostHogPageView.js'
export { DEFAULT_INGEST_PATH } from './shared/constants.js'
export { usePostHog, useFeatureFlag, useActiveFeatureFlags, PostHogFeature } from './client/hooks.js'

// Re-export types (type-only, erased at build time)
export type { PostHogProviderProps, BootstrapFlagsConfig } from './app/PostHogProvider.js'
export type { PostHogProviderIdentity } from './shared/identity.js'
export type { PostHogMiddlewareOptions, PostHogProxyOptions } from './middleware/postHogMiddleware.js'
export type {
    NextOnRequestError,
    NextRequestError,
    NextRequestErrorContext,
    NextRequestErrorRequest,
    OnRequestErrorBeforeCaptureContext,
    OnRequestErrorOptions,
} from './server.edge.js'
