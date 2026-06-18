export { instrument } from './extensions/instrumentation'
export { detectAgent, detectCi, type DetectAgentOptions } from './extensions/agent-detection'
export { isTelemetryEnabled, isDebugMode } from './extensions/consent'
export { resolveIdentity, type IdentityStore } from './extensions/identity'
export { collectEnvironment } from './extensions/environment'
export { INTENT_ENV } from './extensions/intent'
export {
    POSTHOG_CLI_ANALYTICS_SOURCE,
    PostHogCliAnalyticsEvent,
    PostHogCliAnalyticsProperty,
    DO_NOT_TRACK_ENV,
    TELEMETRY_DISABLED_ENV,
    TELEMETRY_DEBUG_ENV,
} from './extensions/constants'
export type {
    AgentDetectionSource,
    AgentInfo,
    BeforeSendFn,
    CliAnalytics,
    CliAnalyticsOptions,
    CliInfo,
    CliIntentSource,
    CommandCaptureData,
    CommandOptions,
    CommandOutcome,
    CommandTracker,
    EnvironmentInfo,
    JsonRecord,
    PostHogCaptureEvent,
    UserIdentity,
} from './types'
