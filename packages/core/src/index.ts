export {
  getFeatureFlagValue,
  getEnabledFromValue,
  getVariantFromValue,
  parsePayload,
  flagDetailsToResults,
  MINIMAL_FLAG_CALLED_EVENT_CAMPAIGN_PROPERTIES,
  minimizeFlagCalledEventProperties,
} from './featureFlagUtils'
export {
  getFeatureFlagHash,
  getFeatureFlagVariant,
  getFeatureFlagVariantLookupTable,
  hashSHA1,
  InconclusiveMatchError,
  matchFeatureFlagProperty,
  parseFeatureFlagSemver,
  relativeDateParseForFeatureFlagMatching,
  resolveFeatureFlagPayload,
} from './featureFlagLocalEvaluation'
export type {
  FeatureFlagProperty,
  FeatureFlagPropertyValue,
  FeatureFlagSemverParsingPolicy,
  FeatureFlagVariant,
  FeatureFlagVariantLookupEntry,
  MatchFeatureFlagPropertyOptions,
} from './featureFlagLocalEvaluation'
export {
  gzipCompress,
  isGzipData,
  isGzipRequest,
  isGzipSupported,
  isNativeAsyncGzipError,
  isNativeAsyncGzipReadError,
} from './gzip'
export * from './utils'
export * as ErrorTracking from './error-tracking'
export {
  buildOtlpLogRecord,
  buildOtlpLogsPayload,
  buildResourceAttributes,
  getOtlpSeverityNumber,
  getOtlpSeverityText,
} from './logs/logs-utils'
export { toOtlpAnyValue, toOtlpKeyValueList } from './utils/otlp-any-value'
export { PostHogLogs } from './logs'
export type {
  BeforeSendLogFn,
  BufferedLogEntry,
  CaptureLogger,
  LogSdkContext,
  PostHogLogsConfig,
  ResolvedPostHogLogsConfig,
} from './logs/types'
// Re-export the user-facing OTLP log types straight from `@posthog/types`
// via the `logs/types` barrel so consumers don't have to import from two
// packages to type their `captureLog` calls.
export type { CaptureLogOptions, LogAttributeValue, LogAttributes, LogSeverityLevel } from './logs/types'
// Re-export the shared error tracking rate-limiter config type so SDKs built on core
// (e.g. posthog-node) don't have to depend on `@posthog/types` directly.
export type { ExceptionRateLimiterConfig } from '@posthog/types'
// Re-export the shared `Properties` type for the same reason, so SDKs can type
// person/group property bags consistently without importing `@posthog/types`.
export type { Property, Properties } from '@posthog/types'
export {
  PostHogMetrics,
  buildOtlpMetricsPayload,
  buildMetricsResourceAttributes,
  DEFAULT_HISTOGRAM_BOUNDS,
  resolveMetricsConfig,
} from './metrics'
export type {
  MetricsHost,
  PostHogMetricsConfig,
  ResolvedPostHogMetricsConfig,
  SendMetricsBatchOutcome,
} from './metrics'
// Same barrel convention as logs for the user-facing metric types.
export type {
  CaptureMetricOptions,
  MetricAttributes,
  MetricAttributeValue,
  MetricSample,
  MetricType,
  Metrics,
  MetricsConfig,
} from './metrics/types'
export { PostHogTraces } from './traces'
export { SyncSpanContextManager } from './traces/context'
export { NOOP_SPAN } from './traces/span'
export type {
  ResolvedTracesConfig,
  SendTracesBatchOutcome,
  SpanContextManager,
  TraceSdkContext,
  TracesHost,
} from './traces/types'
// Same barrel convention as logs and metrics for the user-facing tracing types.
export type {
  Span,
  SpanAttributes,
  SpanAttributeValue,
  SpanKind,
  SpanStatusCode,
  SpanTimeInput,
  StartSpanOptions,
  TracesConfig,
} from './traces/types'
export { uuidv7 } from './vendor/uuidv7'
export * from './cookie'
export * from './posthog-core'
export * from './posthog-core-stateless'
export * from './tracing-headers'
export * from './types'
export { getValidationError, getLengthFromRules, getRequirementsHint } from './surveys/validation'
