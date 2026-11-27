import type {
  ErrorTracking,
  PostHogCoreOptions,
  ExceptionRateLimiterConfig,
  FeatureFlagValue,
  JsonType,
  Metrics,
  MetricsConfig,
  PostHogLogsConfig,
  PostHogFetchOptions,
  PostHogFetchResponse,
  PostHogEventProperties,
  PostHogFlagsAndPayloadsResponse,
  Properties,
  Span,
  StartSpanOptions,
  TracesConfig,
} from '@posthog/core'
import { ContextData, ContextOptions } from './extensions/context/types'
import type { V1EventOptions } from './capture-v1/types'

/** Processing options sent with an event to capture v1. */
export type EventOptions = V1EventOptions

import type { EmailReactRenderer, Emails } from './emails/types'
import type { FeatureFlagEvaluations } from './feature-flag-evaluations'
import type { FlagDefinitionCacheInput, FlagDefinitionCacheProvider } from './extensions/feature-flags/cache'

export type IdentifyMessage = {
  /** User distinct ID matching your frontend `posthog.identify()` call. */
  distinctId: string
  /** Person properties to set directly, or via `$set`, `$set_once`, and `$anon_distinct_id`. */
  properties?: Record<string | number, any>
  /** Overrides the client's `disableGeoip` setting for this event. */
  disableGeoip?: boolean
  /**
   * Processing options sent with this event to capture v1.
   */
  options?: EventOptions
}

export type SetPersonPropertiesMessage = {
  /** User distinct ID. Falls back to `withContext()` when missing or blank. */
  distinctId: string
  /** Person properties to overwrite (`$set`). */
  properties?: Record<string | number, any>
  /** Person properties to write only when unset (`$set_once`). */
  propertiesOnce?: Record<string | number, any>
  /**
   * Processing options sent with this event to capture v1.
   */
  options?: EventOptions
}

export type UnsetPersonPropertiesMessage = {
  /** User distinct ID. Falls back to `withContext()` when missing or blank. */
  distinctId: string
  /** Property name or list of property names to remove from the person profile (`$unset`). */
  properties: string | string[]
  /**
   * Processing options sent with this event to capture v1.
   */
  options?: EventOptions
}

export type SendFeatureFlagsOptions = {
  /** Skip remote `/flags` fallback and evaluate only against locally loaded flag definitions. */
  onlyEvaluateLocally?: boolean
  /** Person properties used during flag evaluation instead of stored server properties. */
  personProperties?: Properties
  /** Group properties keyed by group type for evaluating group-targeted flags. */
  groupProperties?: Record<string, Properties>
  /** Restrict evaluation to these flag keys. */
  flagKeys?: string[]
}

export type EventMessage = {
  /**
   * The event's distinct ID. When missing, empty, or whitespace, uses `withContext()`, else generates a UUIDv7 and sets `options.process_person_profile: false`.
   */
  distinctId?: string
  /** Event name (such as `'order_placed'` or `'$pageview'`). Must be 200 UTF-8 bytes or fewer. */
  event: string
  /** Event properties (also accepts `$set`, `$set_once`, and `$current_url`). */
  properties?: Record<string | number, any>
  /** Group types and keys to associate with this event (for example `{ company: 'acme' }`, up to 5 per project). */
  groups?: Record<string, string | number>
  /**
   * Attach feature flag values evaluated via `posthog.evaluateFlags()` to this event.
   * Prefer this over `sendFeatureFlags` so the event carries the exact values your code branched on without a hidden `/flags` request.
   */
  flags?: FeatureFlagEvaluations
  /**
   * @deprecated Use the `flags` option with a `FeatureFlagEvaluations` object obtained
   * from `posthog.evaluateFlags()` instead. `sendFeatureFlags` fires a separate `/flags`
   * request on capture and may return different values than the ones the code branched on.
   */
  sendFeatureFlags?: boolean | SendFeatureFlagsOptions
  /** If provided, overrides the auto-generated timestamp. UTC is preferred; non-UTC input is converted to UTC. */
  timestamp?: Date
  /** If provided overrides the auto-generated event UUID. Must be a valid UUID. */
  uuid?: string
  /** Overrides the client's `disableGeoip` setting for this event. */
  disableGeoip?: boolean
  /** Processing options sent with this event to capture v1. */
  options?: EventOptions
  /**
   * Internal flag set by captureException() to indicate this $exception
   * event originated from the proper exception capture path. Used to warn users who call
   * capture() with '$exception' directly.
   */
  _originatedFromCaptureException?: boolean
}

/** Options for `captureException()` and `captureExceptionImmediate()`. */
export type CaptureExceptionOptions = {
  /** The event's distinct id. Without one, the context distinct id is used, else a personless id. */
  distinctId?: string
  /**
   * Properties to add to the event. Exception properties the SDK or PostHog owns, such as
   * `$exception_list` and `$exception_level`, are ignored: use `level` to set the level.
   */
  properties?: Record<string | number, any>
  /** Per-event options, as in `capture()`. */
  options?: EventOptions
  /** Overrides the generated event UUID. Must be a valid UUID. */
  uuid?: string
  /** A `FeatureFlagEvaluations` snapshot to attach the same flag context as your other events. */
  flags?: FeatureFlagEvaluations
  /**
   * The exception's severity, sent as `$exception_level`. An unknown value is ignored.
   *
   * @default 'error'
   */
  level?: ErrorTracking.SeverityLevel
}

/**
 * An event as `prepareEventMessage()` builds it: the shape of `EventMessage`, with the distinct id
 * resolved and the properties and options filled from every layer, after `beforeSend`.
 */
export type PreparedEventMessage = {
  /** Resolved distinct ID after checking the call, `withContext()`, and personless fallback. */
  distinctId: string
  /** Final event name after SDK normalization (such as `$bot_pageview` preview renames). */
  event: string
  /** Merged event properties after context, `register()`, SDK defaults, and `beforeSend`. */
  properties: PostHogEventProperties
  /** The event's options, sent to capture unchanged. */
  options?: EventOptions
  /** Canonical event UUID. */
  uuid?: string
  /** Explicit event timestamp, if provided or set by `beforeSend`. */
  timestamp?: Date
  /** Per-call `disableGeoip` flag, if provided. */
  disableGeoip?: boolean
}

export type GroupIdentifyMessage = {
  /** Group type name (such as `'company'`). Projects support up to 5 group types. */
  groupType: string
  /** Unique identifier for the group within `groupType`. */
  groupKey: string
  /** Group properties (`$group_set`). Set `name` for the display name in PostHog. */
  properties?: Record<string | number, any>
  /**
   * The event's distinct ID. When missing, empty, or whitespace, uses `withContext()`, then `$<groupType>_<groupKey>`.
   */
  distinctId?: string
  /** Overrides the client's `disableGeoip` setting for this event. */
  disableGeoip?: boolean
  /**
   * Processing options sent with this event to capture v1.
   */
  options?: EventOptions
}

export type PropertyGroup = {
  type: 'AND' | 'OR'
  values: PropertyGroup[] | FlagProperty[]
}

export type FlagProperty = {
  key: string
  type?: string
  value: FlagPropertyValue
  operator?: string
  negation?: boolean
  dependency_chain?: string[]
}

export type FlagPropertyValue = string | number | (string | number)[] | boolean

/**
 * Options for overriding feature flags.
 *
 * Supports multiple formats:
 * - `false` - Clear all overrides
 * - `string[]` - Enable a list of flags (sets them to `true`)
 * - `Record<string, FeatureFlagValue>` - Set specific flag values/variants
 * - `FeatureFlagOverrideOptions` - Set both flag values and payloads
 */
export type OverrideFeatureFlagsOptions =
  | false
  | string[]
  | Record<string, FeatureFlagValue>
  | FeatureFlagOverrideOptions

export type BaseFlagEvaluationOptions = {
  /** Group types and keys to evaluate group-targeted flags against (for example `{ company: 'acme' }`). */
  groups?: Record<string, string>
  /** Person properties used instead of stored server properties. Include `$geoip_*` keys (such as `$geoip_country_code` and `$geoip_subdivision_1_code`) to evaluate GeoIP flags using the client's location. */
  personProperties?: Properties
  /** Group properties keyed by group type for evaluating group-targeted flags. */
  groupProperties?: Record<string, Properties>
  /** Skip remote fallback and omit flags that local definitions cannot resolve. */
  onlyEvaluateLocally?: boolean
  /** Overrides the client's `disableGeoip` setting for this evaluation call. */
  disableGeoip?: boolean
}
export type FlagEvaluationOptions = BaseFlagEvaluationOptions & {
  /** Whether this call sends `$feature_flag_called`, overriding the client's `sendFeatureFlagEvent` option. */
  sendFeatureFlagEvents?: boolean
}

export type AllFlagsOptions = BaseFlagEvaluationOptions & {
  /**
   * Restrict local evaluation, the `/flags` request, and the returned snapshot to these keys.
   * An empty array returns an empty snapshot without evaluating flags; omitting this option
   * evaluates all flags. `evaluateFlags()` falls back remotely when a requested key is missing
   * from local definitions unless `onlyEvaluateLocally` is true. Remote evaluation responses are
   * not cached, so a key missing both locally and remotely costs one `/flags` request per call.
   */
  flagKeys?: string[]
}

export type FeatureFlagOverrideOptions = {
  /**
   * Flag overrides. Can be:
   * - `false` to clear flag overrides
   * - `string[]` to enable a list of flags
   * - `Record<string, FeatureFlagValue>` to set specific values/variants
   */
  flags?: false | string[] | Record<string, FeatureFlagValue>
  /**
   * Payload overrides for flags.
   * - `false` to clear payload overrides
   * - `Record<string, JsonType>` to set specific payloads
   */
  payloads?: false | Record<string, JsonType>
}

export type FeatureFlagCondition = {
  properties: FlagProperty[]
  rollout_percentage?: number
  variant?: string
  aggregation_group_type_index?: number | null
}

export type FeatureFlagBucketingIdentifier = 'distinct_id' | 'device_id' | '' | null

/**
 * Where a feature flag is meant to be evaluated. Set per flag in PostHog and carried on
 * every locally cached flag definition. `all` means the flag suits both client-side and
 * server-side evaluation, so it matches either runtime.
 */
export type FeatureFlagEvaluationRuntime = 'all' | 'client' | 'server'

/**
 * Why local evaluation couldn't resolve a flag.
 *
 * When more than one cause applies, the SDK reports the first matching reason in this order:
 *
 * | Reason | Cause |
 * | --- | --- |
 * | `experience_continuity` | The flag uses experience continuity, which local evaluation can't resolve. |
 * | `unsupported_definition` | The flag uses a rule local evaluation doesn't support, such as a static cohort, an unknown operator, or a circular or missing dependency. |
 * | `unresolved_dependency` | A dependency flag has a loaded definition but stayed unresolved. |
 * | `missing_context` | The call didn't pass a person property, group property, or device ID the flag needs, or passed an unusable value. |
 */
export type UnresolvedFlagReason =
  | 'experience_continuity'
  | 'unsupported_definition'
  | 'missing_context'
  | 'unresolved_dependency'

export type BeforeSendFn = (event: EventMessage) => EventMessage | null

export type PostHogOptions = Omit<
  PostHogCoreOptions,
  | 'before_send'
  | 'disable_capture_url_hashes'
  | 'disableGeoip'
  | 'flushInterval'
  | 'maxQueueSize'
  | 'fetchRetryCount'
  | 'fetchRetryDelay'
  | 'disableCompression'
  | 'requestTimeout'
> & {
  /** Storage backend for client opt-out state and super properties. Node holds state in memory only, so it resets on restart. */
  persistence?: 'memory'
  /**
   * Whether to strip URL fragments (`#...`) from automatically captured request URLs.
   *
   * @default false
   */
  disableCaptureUrlHashes?: boolean
  /**
   * @deprecated Use `disableCaptureUrlHashes` instead. This property will be removed in the next major version.
   */
  disable_capture_url_hashes?: boolean
  /**
   * Whether to disable GeoIP lookups for events and feature flag requests. When `true`, every event gets `$geoip_disable: true` unless the event, its context, or `register()` sets `$geoip_disable`.
   *
   * Pass `disableGeoip: false` (here or per call) and set `$ip` in event `properties` to geolocate from a client IP. Setting `$ip` alone still skips GeoIP while `disableGeoip` is `true`.
   *
   * @default true
   */
  disableGeoip?: boolean
  /**
   * The interval in milliseconds between periodic flushes
   *
   * @default 5000
   */
  flushInterval?: number
  /**
   * The maximum number of analytics events held in memory waiting to be sent (must be higher than `flushAt`).
   * When the queue is full, the oldest event is dropped and reported through the `'error'` event.
   * `captureAi` events have their own queue, sized by `captureAiMaxQueueSize`, and do not count toward this limit.
   *
   * @default 10000
   */
  maxQueueSize?: number
  /**
   * Whether the Express, NestJS, Hono, and `instrumentRequest` integrations read the `X-POSTHOG-DISTINCT-ID` and
   * `X-POSTHOG-SESSION-ID` request headers into the request context. A distinct id or session id
   * you pass explicitly always wins over these headers, and they are never used for authentication.
   * Turning it off does not turn off `readPostHogCookie`. To stop all request linking, set
   * `captureTracingHeaders: false` and leave `readPostHogCookie` off (its default).
   *
   * @default true
   */
  captureTracingHeaders?: boolean
  /**
   * How many times a capture request is retried after its first attempt, on both capture lanes.
   * Waits start at 100 ms and double each retry, with jitter, up to 30 seconds; a `Retry-After`
   * header can raise a wait. Only HTTP 404, 408, 429, 500, 502, 503 and 504 and network errors are retried.
   * When not set, `fetchRetryCount` is used.
   *
   * @default 3
   */
  captureMaxRetries?: number
  /**
   * How many times HTTP requests are retried. Capture requests use `captureMaxRetries` when it is set.
   *
   * @default 3
   */
  fetchRetryCount?: number
  /**
   * The delay between HTTP request retries in milliseconds. Capture requests do not use it:
   * see `captureMaxRetries` for their retry waits.
   *
   * @default 3000
   */
  fetchRetryDelay?: number
  /**
   * How analytics capture requests compress their body. `'deflate'` is zlib-wrapped. `'zstd'` needs
   * Node 22.15 or later and falls back to `'gzip'` elsewhere, including the edge build. When not set,
   * `disableCompression: true` means `'none'`.
   *
   * @default 'gzip'
   */
  captureCompression?: 'none' | 'gzip' | 'deflate' | 'zstd'
  /**
   * How `captureAi` requests compress their body, with the same values as `captureCompression`.
   * It does not read `captureCompression` or `disableCompression`.
   *
   * @default 'gzip'
   */
  captureAiCompression?: 'none' | 'gzip' | 'deflate' | 'zstd'
  /**
   * Timeout in milliseconds for any calls. `captureAi` requests use `captureAiRequestTimeoutMs`.
   *
   * @default 10000
   */
  requestTimeout?: number
  /**
   * The maximum number of `captureAi` events held in memory waiting to be sent. When the queue is
   * full, the oldest AI event is dropped and reported through the `'error'` event.
   *
   * @default 1000
   */
  captureAiMaxQueueSize?: number
  /**
   * Timeout in milliseconds for each `captureAi` request. Analytics capture requests use `requestTimeout`.
   *
   * @default 30000
   */
  captureAiRequestTimeoutMs?: number
  /**
   * Whether to disable GZIP compression. Analytics capture requests use `captureCompression` when it
   * is set, and `captureAi` requests use `captureAiCompression`.
   *
   * @default false
   */
  disableCompression?: boolean
  /**
   * Lets the Express, NestJS, Hono and `instrumentRequest` integrations read the session ID, and the distinct ID of an
   * identified user, from the posthog-js cookie when a request has neither tracing header.
   * `createReactRouterErrorHandler` also reads an anonymous visitor's distinct ID, and sends their exceptions personless.
   *
   * Turn it on only when posthog-js stores opt-out consent in a cookie, or when you do not use opt-out: the server
   * cannot read an opt-out that posthog-js keeps in localStorage (its default).
   *
   * It needs cookie-backed posthog-js persistence (the default `localStorage+cookie`, or `cookie`), the default cookie
   * name (no `persistence_name`), and the default `__ph_opt_in_out_<token>` consent cookie name. Set
   * `sessionIdleTimeoutSeconds` when posthog-js uses a custom `session_idle_timeout_seconds`, and set
   * `optOutCapturingByDefault` when posthog-js uses `opt_out_capturing_by_default`, so a visitor with no consent cookie
   * counts as opted out. A request sent right
   * after `identify()` or `reset()` can still carry the previous identity, because posthog-js saves the cookie with a
   * short delay. When `captureTracingHeaders` is `false`, the tracing headers are ignored and every request falls
   * back to the cookie. To stop all request linking, also leave this option off.
   *
   * @default false
   */
  readPostHogCookie?: boolean | { sessionIdleTimeoutSeconds?: number; optOutCapturingByDefault?: boolean }
  /**
   * Configuration for the `posthog.metrics` API (count, gauge, histogram).
   * Set `serviceName` so series can be filtered per service in the Metrics UI.
   *
   * @example
   * ```ts
   * const client = new PostHog('phc_...', { metrics: { serviceName: 'billing-worker' } })
   * client.metrics.count('invoices.processed')
   * ```
   */
  metrics?: MetricsConfig
  /**
   * Configuration for the `posthog.logger` / `posthog.captureLog` logs API. Logs are sent
   * to PostHog Logs as OTLP records, with no OpenTelemetry packages needed.
   *
   * Each record carries the active span's `trace_id` / `span_id` and, inside `withContext`,
   * the `distinctId` and `sessionId`, so logs join back to traces, persons and replays.
   * `serviceName` defaults to the `traces` / `metrics` `serviceName`.
   *
   * @example
   * ```ts
   * const client = new PostHog('phc_...', { logs: { serviceName: 'checkout-api' } })
   * client.logger.info('order placed', { order_id: 'ord_1' })
   * ```
   */
  logs?: PostHogLogsConfig
  /**
   * Configuration for distributed tracing (`startSpan` / `withSpan`). Tracing is
   * off until this is set; supplying it is all that's needed to turn it on.
   *
   * Set `serviceName` so spans can be attributed and grouped per service — the
   * product aggregates operations by service and span name.
   *
   * `shutdown()` drains spans that have already ended, within the shutdown
   * timeout; spans still open at that point are discarded.
   *
   * @example
   * ```ts
   * const client = new PostHog('phc_...', { traces: { serviceName: 'checkout-api' } })
   * await client.withSpan('charge', () => stripe.charge(order))
   * ```
   *
   * @experimental Subject to change in a minor release.
   */
  traces?: TracesConfig
  /**
   * Credential for fetching local feature flag definitions, decrypting remote config and
   * sending email.
   *
   * Accepts either a Personal API Key (`phx_...`) or a Project Secret API Key (`phs_...`).
   * Local evaluation can also use definitions from `flagDefinitionCacheProvider` without
   * this credential. Remote config payload decryption via `getRemoteConfigPayload`
   * still requires it. `emails.send` needs a Project Secret API Key with the
   * `transactional_email:write` scope; set `enableLocalEvaluation: false` when the key is only for email.
   * Prefer this over the deprecated
   * `personalApiKey` option; when both are set, `secretKey` takes precedence.
   *
   * @example
   * ```ts
   * const client = new PostHog('phc_...', { secretKey: 'phs_...' })
   * ```
   */
  secretKey?: string
  /**
   * @deprecated Use `secretKey` instead.
   */
  personalApiKey?: string
  /**
   * Your PostHog app host, such as `https://posthog.example.com`. `emails.send` sends there.
   *
   * Needed only when `host` is not PostHog Cloud, for example a reverse proxy, which must not
   * receive the secret key. On PostHog Cloud, the client derives `https://us.posthog.com` or
   * `https://eu.posthog.com` from `host`.
   */
  appHost?: string
  /**
   * Timeout in milliseconds for each `emails.send` request. Each attachment upload is one request,
   * so raise it when large files upload slowly.
   *
   * @default 15000
   */
  emailRequestTimeoutMs?: number
  /**
   * Number of retries for an `emails.send` after a network error, a rate limit, or an
   * unavailable service. Every retry sends the same idempotency key. Set to 0 when a job
   * runner already retries the send.
   *
   * @default 2
   */
  emailRequestMaxRetries?: number
  /** The provider your email moved from, such as `'resend'`. Sent with every `posthog.emails` request. */
  migratedFrom?: string
  /**
   * Renders the `react` element of an `emails.send`. Set it when you bundle your app, such as
   * for Cloudflare Workers, Convex, or Vercel Edge: posthog-node doesn't bundle `@react-email/render`,
   * so apps that never send `react` don't carry it. Without it, posthog-node loads
   * `@react-email/render` from `node_modules` when a send has `react`.
   *
   * @example
   * ```ts
   * const client = new PostHog('phc_...', { reactEmailRenderer: await import('@react-email/render') })
   * ```
   */
  reactEmailRenderer?: EmailReactRenderer
  /**
   * Redact prompts, outputs and error details from every event that the PostHog AI
   * integrations (`@posthog/ai`) capture with this client. Per-call privacy settings
   * can only add redaction. Defaults to false.
   */
  privacyMode?: boolean
  /**
   * Attach process `uncaughtException` and `unhandledRejection` listeners to capture unhandled errors automatically.
   *
   * @default false
   */
  enableExceptionAutocapture?: boolean
  /**
   * The interval in milliseconds between polls for refreshing feature flag definitions. Defaults to 30 seconds.
   * The minimum is 100 ms, and a lower value is raised to it.
   * Set to null to disable automatic polling. Definitions are still loaded on initialization;
   * call reloadFeatureFlags() to refresh them manually. Until refreshed, local evaluation uses the last loaded definitions.
   */
  featureFlagsPollingInterval?: number | null
  /**
   * Maximum number of distinct ids held in the cache that deduplicates $feature_flag_called calls
   * per user. When the cache is full the least recently used distinct ids are evicted. Defaults to 50000.
   */
  maxCacheSize?: number
  /**
   * Custom HTTP transport replacing global `fetch`. Capture requests pass `redirect: 'manual'` and follow up to 5 same-origin `307` or `308` redirects, and a custom `fetch` that follows redirects itself still works.
   */
  fetch?: (url: string, options: PostHogFetchOptions) => Promise<PostHogFetchResponse>
  /**
   * Whether to poll feature flag definitions for local evaluation when `secretKey`, `personalApiKey`, or `flagDefinitionCacheProvider` is set. Set to `false` when `secretKey` is only for `getRemoteConfigPayload()` or `emails`.
   *
   * @default true
   */
  enableLocalEvaluation?: boolean
  /**
   * Optional cache provider for feature flag definitions.
   *
   * Allows custom caching strategies (Redis, database, etc.) for flag definitions
   * in multi-worker environments. If not provided, defaults to in-memory cache.
   *
   * Without a secretKey or personalApiKey, this instance only reads cached definitions on
   * each refresh; it does not call shouldFetchFlagDefinitions or publish definitions.
   * With a credential, it uses the provider's fetch decision to coordinate fetching
   * fresh definitions from PostHog and publishing them to the cache.
   *
   * This enables distributed coordination where only one worker fetches flags while
   * others use cached data, reducing API calls and improving performance.
   *
   * @example
   * ```typescript
   * import type { FlagDefinitionCacheProvider } from 'posthog-node'
   *
   * class RedisCacheProvider implements FlagDefinitionCacheProvider {
   *   // ... implementation
   * }
   *
   * const client = new PostHog('api-key', {
   *   flagDefinitionCacheProvider: new RedisCacheProvider(redis)
   * })
   * ```
   */
  flagDefinitionCacheProvider?: FlagDefinitionCacheProvider<FlagDefinitionCacheInput>
  /**
   * Allows modification or dropping of events before they're sent to PostHog.
   * If an array is provided, the functions are run in order.
   * If a function returns null, the event will be dropped.
   *
   * @remarks
   * The hook gets a copy of the finished event: the event's own values, then the values filled
   * from context, `register()` and `registerOptions()`, then the values the SDK adds (such as
   * `$is_server`, `$geoip_disable`, feature flag properties and `options.process_person_profile`).
   * It has the final say: it can change or remove any of them, and nothing is added after it.
   * Set `$geoip_disable` in `properties` to change GeoIP; the `disableGeoip` and `groups` fields
   * are already applied to the properties it sees.
   *
   * On `$identify`, `$create_alias`, `$merge_dangerously`, `$groupidentify`, `$set` and `$set_once`
   * events it sees `options.process_person_profile` and no `$process_person_profile` property.
   * Those events get their default from the event name the call used, so a hook that renames an
   * event to one of them must set `options.process_person_profile` itself.
   */
  beforeSend?: BeforeSendFn | BeforeSendFn[]
  /**
   * @deprecated Use `beforeSend` instead. This property will be removed in the next major version.
   */
  before_send?: BeforeSendFn | BeforeSendFn[]
  /**
   * Evaluation contexts for feature flags.
   * When set, only feature flags that have at least one matching evaluation tag
   * will be evaluated for this SDK instance. Feature flags with no evaluation tags
   * will always be evaluated.
   *
   * Examples: ['production', 'backend', 'api']
   *
   * @default undefined
   */
  evaluationContexts?: readonly string[]
  /**
   * Evaluation environments for feature flags.
   * @deprecated Use evaluationContexts instead. This property will be removed in a future version.
   */
  evaluationEnvironments?: readonly string[]
  /**
   * Additional user agent strings to block from being tracked.
   * These are combined with the default list of blocked user agents.
   *
   * @default []
   */
  customBlockedUserAgents?: string[]
  /**
   * @deprecated Use `customBlockedUserAgents` instead. This property will be removed in the next major version.
   */
  custom_blocked_useragents?: string[]
  /**
   * PREVIEW - MAY CHANGE WITHOUT WARNING - DO NOT USE IN PRODUCTION
   * Enables collection of bot traffic as $bot_pageview events instead of dropping them.
   * When enabled, events with a $raw_user_agent property that matches the bot detection list
   * will have their $pageview event renamed to $bot_pageview.
   *
   * To use this feature, pass the user agent in event properties:
   * ```ts
   * client.capture({
   *   distinctId: 'user_123',
   *   event: '$pageview',
   *   properties: {
   *     $raw_user_agent: req.headers['user-agent']
   *   }
   * })
   * ```
   */
  __previewCaptureBotPageviews?: boolean
  /**
   * @deprecated Use `__previewCaptureBotPageviews` instead. This property will be removed in the next major version.
   */
  __preview_capture_bot_pageviews?: boolean
  /**
   * When enabled, all feature flag evaluations will use local evaluation only,
   * never falling back to server-side evaluation. This prevents unexpected server
   * requests and associated costs when using local evaluation.
   *
   * Flags that cannot be evaluated locally (e.g., those with experience continuity)
   * will return `undefined` instead of making a server request.
   *
   * @default false
   */
  strictLocalEvaluation?: boolean
  /**
   * Controls whether `FeatureFlagEvaluations` filter helpers (`onlyAccessed()` and
   * `only()`) log warnings when their input is unexpected — for example, calling
   * `onlyAccessed()` before accessing any flags, or passing unknown keys to `only()`.
   *
   * @default true
   */
  featureFlagsLogWarnings?: boolean
  /**
   * Provides the API to extend the lifetime of a serverless invocation until
   * background work (like flushing analytics events) completes after the response
   * is sent.
   *
   * @experimental Subject to change in a minor release.
   *
   * @example
   * // Vercel
   * import { waitUntil } from '@vercel/functions'
   * new PostHog('key', { waitUntil })
   */
  waitUntil?: (promise: Promise<unknown>) => void
  /**
   * Debounce interval in milliseconds for the `waitUntil`-based flush.
   * After the last event is enqueued, the SDK waits this long before flushing.
   *
   * @experimental Subject to change in a minor release.
   * @default 50
   */
  waitUntilDebounceMs?: number
  /**
   * Maximum time in milliseconds to debounce before forcing a flush.
   * Prevents starvation from rapid concurrent captures.
   *
   * @experimental Subject to change in a minor release.
   * @default 500
   */
  waitUntilMaxWaitMs?: number
  /**
   * Whether to attach the `$is_server: true` property to every captured event.
   *
   * @remarks
   * Defaults to `true` because this SDK is intended for server-side use, where
   * the property lets PostHog distinguish server events from browser and
   * react-native events. Set this to `false` when running the SDK as a
   * client/CLI so the event is attributed to the device OS normally instead of
   * being marked as a server event. When `false`, the `$is_server` property is
   * omitted entirely. A `$is_server` value set on the event, in context or with
   * `register()` wins over this setting.
   *
   * @default true
   * @example
   * // CLI usage: don't mark events as server-side
   * new PostHog('key', { isServer: false })
   */
  isServer?: boolean
  /**
   * Capture full AI content: PostHog AI wrapper events route through the
   * dedicated AI capture endpoint, skip string truncation, and pass media
   * (base64 / data URIs) through unredacted. Privacy mode always wins.
   * Defaults to false.
   */
  enableFullAiCapture?: boolean
} & ExceptionRateLimiterConfig

export type PostHogFeatureFlag = {
  id: number
  name: string
  key: string
  bucketing_identifier?: FeatureFlagBucketingIdentifier
  filters?: {
    aggregation_group_type_index?: number
    groups?: FeatureFlagCondition[]
    multivariate?: {
      variants: {
        key: string
        rollout_percentage: number
      }[]
    }
    payloads?: Record<string, string>
    // Experiment holdout. Resolved before the release conditions, so a held-out value is
    // excluded from the flag's targeting entirely.
    holdout?: {
      id: number
      exclusion_percentage: number
    } | null
    // Flag-level toggle: when true, condition evaluation stops and returns false as soon as a
    // group's property filters match but the rollout percentage excludes the user, rather than
    // continuing to evaluate later groups.
    early_exit?: boolean
    /**
     * Early-access feature flag. The person's opt-in, stored in the person property
     * `$feature_enrollment/<flag key>`, decides the flag before holdouts and release conditions.
     */
    feature_enrollment?: boolean | null
  }
  deleted: boolean
  active: boolean
  rollout_percentage: null | number
  ensure_experience_continuity: boolean
  experiment_set: number[]
  /** Whether the flag is linked to an experiment. Absent when the server does not report it. */
  has_experiment?: boolean
  /**
   * Evaluation context tags set on the flag. The local evaluation poller keeps a flag only
   * when this list is empty or shares at least one entry with the SDK's `evaluationContexts`.
   * Absent when the server does not report it.
   */
  evaluation_contexts?: string[]
  /**
   * Legacy name for `evaluation_contexts`. Servers older than the field rename (PostHog,
   * 2026-03-11) expose the same list under this key on `/flags/definitions`. Read as a
   * fallback so local-evaluation context filtering still works against those servers.
   */
  evaluation_tags?: string[]
  /**
   * Where the flag is meant to be evaluated. Absent or null on a flag that does not set a
   * runtime, and on servers older than the field; both mean `all`, the default PostHog applies.
   */
  evaluation_runtime?: FeatureFlagEvaluationRuntime | null
}

/**
 * Error type constants for the $feature_flag_error property.
 *
 * These values are sent in analytics events to track flag evaluation failures.
 * They should not be changed without considering impact on existing dashboards
 * and queries that filter on these values.
 *
 * Error values:
 *   ERRORS_WHILE_COMPUTING: Server returned errorsWhileComputingFlags=true
 *   FLAG_MISSING: Requested flag not in API response
 *   LOCAL_EVALUATION_INCONCLUSIVE: Flag has a loaded local definition but local evaluation could not resolve it
 *   QUOTA_LIMITED: Rate/quota limit exceeded
 *   UNKNOWN_ERROR: Unexpected exceptions
 */
export const FeatureFlagError = {
  ERRORS_WHILE_COMPUTING: 'errors_while_computing_flags',
  FLAG_MISSING: 'flag_missing',
  EVALUATION_FAILED: 'evaluation_failed',
  LOCAL_EVALUATION_INCONCLUSIVE: 'local_evaluation_inconclusive',
  QUOTA_LIMITED: 'quota_limited',
  UNKNOWN_ERROR: 'unknown_error',
} as const

export type FeatureFlagErrorType = (typeof FeatureFlagError)[keyof typeof FeatureFlagError] | string

/**
 * Result of evaluating a feature flag, including its value and payload.
 */
export type FeatureFlagResult = {
  key: string
  /** Whether the returned feature flag evaluation is enabled. `false` is a conclusive off result. */
  enabled: boolean
  variant: string | undefined
  payload: JsonType | undefined
  /** PostHog's evaluation explanation, when available. */
  reason?: string
  /** Stable evaluation reason code, when available (for example, `flag_disabled`). */
  reasonCode?: string
}

export interface IPostHog {
  /**
   * Queue a custom event in memory to send asynchronously.
   *
   * @param props - Event payload including `event`, optional `distinctId`, `properties`, `groups`, `flags`, and `options`
   */
  capture(props: EventMessage): void

  /**
   * Capture an event and wait for the HTTP send attempt to settle. Use in short-lived runtimes where the process can freeze before a background flush.
   *
   * Don't mix queued `capture()` and `captureImmediate()` when event order matters.
   *
   * @param props - Event payload including `event`, optional `distinctId`, `properties`, `groups`, `flags`, and `options`
   */
  captureImmediate(props: EventMessage): Promise<void>

  /**
   * @description Capture an exception as a $exception event.
   * @param error The error to capture.
   * @param options Optional distinct id, properties, options, uuid, flags snapshot and level.
   */
  captureException(error: unknown, options?: CaptureExceptionOptions): void

  /**
   * @description Capture an exception as a $exception event immediately.
   * @param error The error to capture.
   * @param options Optional distinct id, properties, options, uuid, flags snapshot and level.
   */
  captureExceptionImmediate(error: unknown, options?: CaptureExceptionOptions): Promise<void>

  /**
   * Capture an AI event on the dedicated AI capture endpoint (`/i/v1/ai/events`).
   *
   * Beta: the signature is stable, while operational limits (per-event size cap, batching, endpoint) may change without notice. Delivery is async with no redaction or truncation.
   *
   * @param props - AI event payload including `event`, optional `distinctId`, `properties`, `groups`, `flags`, and `options`
   * @returns The event UUID, or `undefined` when the client is disabled
   */
  captureAi(props: EventMessage): string | undefined

  /**
   * Capture an AI event on the dedicated AI capture endpoint (`/i/v1/ai/events`) and wait for the send attempt to settle.
   *
   * @param props - AI event payload including `event`, optional `distinctId`, `properties`, `groups`, `flags`, and `options`
   * @returns The event UUID, or `undefined` when the client is disabled
   */
  captureAiImmediate(props: EventMessage): Promise<string | undefined>

  /**
   * Queue an `$identify` event setting person properties for `distinctId`. Match the `distinctId` passed to frontend `posthog.identify()` so client and server activity join to one person.
   *
   * @param data - Identify payload with `distinctId` and optional `properties` (`$set`, `$set_once`, `$anon_distinct_id`)
   */
  identify(data: IdentifyMessage): void

  /**
   * Send an `$identify` event immediately and wait for the HTTP send attempt to settle.
   *
   * @param data - Identify payload with `distinctId` and optional `properties` (`$set`, `$set_once`, `$anon_distinct_id`)
   */
  identifyImmediate(data: IdentifyMessage): Promise<void>

  /**
   * Queue a `$set` event to set or set-once properties on a person profile.
   *
   * @param data - Distinct ID and properties (`properties` for `$set`, `propertiesOnce` for `$set_once`)
   */
  setPersonProperties(data: SetPersonPropertiesMessage): void

  /**
   * Queue a `$set` event carrying `$unset` to remove properties from a person profile.
   *
   * @param data - Distinct ID and property key or array of keys to remove
   */
  unsetPersonProperties(data: UnsetPersonPropertiesMessage): void

  /**
   * Queue a `$create_alias` event linking `alias` (the previous or secondary ID) to `distinctId` (the primary user ID).
   *
   * @param data - Primary `distinctId`, previous `alias`, and optional `disableGeoip` or `options`
   */
  alias(data: { distinctId: string; alias: string; disableGeoip?: boolean; options?: EventOptions }): void

  /**
   * Send a `$create_alias` event immediately to link `alias` to `distinctId`.
   *
   * @param data - Primary `distinctId`, previous `alias`, and optional `disableGeoip` or `options`
   */
  aliasImmediate(data: {
    distinctId: string
    alias: string
    disableGeoip?: boolean
    options?: EventOptions
  }): Promise<void>

  /**
   * @description PostHog feature flags (https://posthog.com/docs/features/feature-flags)
   * allow you to safely deploy and roll back new features. Once you've created a feature flag in PostHog,
   * you can use this method to check if the flag is on for a given user, allowing you to create logic to turn
   * features on and off for different user groups or individual users.
   * @param key the unique key of your feature flag
   * @param distinctId the current unique id
   * @param options: dict with optional parameters below
   * @param groups optional - what groups are currently active (group analytics). Required if the flag depends on groups.
   * @param personProperties optional - what person properties are known. Used to compute flags locally when definitions are available.
   * @param groupProperties optional - what group properties are known. Used to compute flags locally when definitions are available.
   * @param onlyEvaluateLocally optional - whether to only evaluate the flag locally. Defaults to false.
   * @param sendFeatureFlagEvents optional - whether to send feature flag events. Used for Experiments. Defaults to true.
   *
   * @returns true if the flag evaluates on, false if it conclusively evaluates off, or undefined if no result is available. Local evaluation resolves cached inactive definitions to false; remote evaluation omits globally inactive flags, leaving no result.
   *
   * @deprecated Use {@link IPostHog.evaluateFlags} and call `flags.isEnabled(key)` on the
   *   returned snapshot. Will be removed in the next major version.
   */
  isFeatureEnabled(
    key: string,
    distinctId: string,
    options?: {
      groups?: Record<string, string>
      personProperties?: Properties
      groupProperties?: Record<string, Properties>
      onlyEvaluateLocally?: boolean
      sendFeatureFlagEvents?: boolean
    }
  ): Promise<boolean | undefined>

  /**
   * @description PostHog feature flags (https://posthog.com/docs/features/feature-flags)
   * allow you to safely deploy and roll back new features. Once you've created a feature flag in PostHog,
   * you can use this method to check if the flag is on for a given user, allowing you to create logic to turn
   * features on and off for different user groups or individual users.
   * @param key the unique key of your feature flag
   * @param distinctId the current unique id
   * @param options: dict with optional parameters below
   * @param groups optional - what groups are currently active (group analytics). Required if the flag depends on groups.
   * @param personProperties optional - what person properties are known. Used to compute flags locally when definitions are available.
   * @param groupProperties optional - what group properties are known. Used to compute flags locally when definitions are available.
   * @param onlyEvaluateLocally optional - whether to only evaluate the flag locally. Defaults to false.
   * @param sendFeatureFlagEvents optional - whether to send feature flag events. Used for Experiments. Defaults to true.
   *
   * @returns true or a variant string if the flag evaluates on, false if it conclusively evaluates off, or undefined if no result is available. Local evaluation resolves cached inactive definitions to false; remote evaluation omits globally inactive flags, leaving no result.
   *
   * @deprecated Use {@link IPostHog.evaluateFlags} and call `flags.getFlag(key)` on the
   *   returned snapshot. Will be removed in the next major version.
   */
  getFeatureFlag(
    key: string,
    distinctId: string,
    options?: {
      groups?: Record<string, string>
      personProperties?: Properties
      groupProperties?: Record<string, Properties>
      onlyEvaluateLocally?: boolean
      sendFeatureFlagEvents?: boolean
    }
  ): Promise<FeatureFlagValue | undefined>

  /**
   * @description Retrieves payload associated with the specified flag and matched value that is passed in.
   *
   * IMPORTANT: The `matchValue` parameter should be the value you previously obtained from `getFeatureFlag()`.
   * If matchValue isn't passed (or is undefined), this method will automatically call `getFeatureFlag()`
   * internally to fetch the flag value, which could result in a network call to the PostHog server if this flag can
   * not be evaluated locally. This means that omitting `matchValue` will potentially:
   * - Bypass local evaluation
   * - Count as an additional flag evaluation against your quota
   * - Impact performance due to the extra network request
   *
   * Example usage:
   * ```js
   * const flagValue = await client.getFeatureFlag('my-flag', distinctId);
   * const payload = await client.getFeatureFlagPayload('my-flag', distinctId, flagValue);
   * ```
   *
   * @param key the unique key of your feature flag
   * @param distinctId the current unique id
   * @param matchValue The flag value previously obtained from calling `getFeatureFlag()`. Can be a string or boolean.
   *                   To avoid extra network calls, pass this parameter when you can.
   * @param options: dict with optional parameters below
   * @param onlyEvaluateLocally optional - whether to only evaluate the flag locally. Defaults to false.
   *
   * @returns payload of a json type object
   *
   * @deprecated Use {@link IPostHog.evaluateFlags} and call `flags.getFlagPayload(key)` on
   *   the returned snapshot. Will be removed in the next major version.
   */
  getFeatureFlagPayload(
    key: string,
    distinctId: string,
    matchValue?: FeatureFlagValue,
    options?: {
      onlyEvaluateLocally?: boolean
    }
  ): Promise<JsonType | undefined>

  /**
   * @description Get all feature flag values using distinctId from withContext().
   */
  getAllFlags(options?: AllFlagsOptions): Promise<Record<string, FeatureFlagValue>>

  /**
   * @description Get all feature flag values for a specific user.
   *
   * @param distinctId - The user's distinct ID
   * @param options - Optional configuration for flag evaluation
   * @returns Promise that resolves to a record of flag keys and their values
   */
  getAllFlags(distinctId: string, options?: AllFlagsOptions): Promise<Record<string, FeatureFlagValue>>

  /**
   * @description Get all feature flag values and payloads using distinctId from withContext().
   */
  getAllFlagsAndPayloads(options?: AllFlagsOptions): Promise<PostHogFlagsAndPayloadsResponse>

  /**
   * @description Get all feature flag values and payloads for a specific user.
   *
   * @param distinctId - The user's distinct ID
   * @param options - Optional configuration for flag evaluation
   * @returns Promise that resolves to flags and payloads
   */
  getAllFlagsAndPayloads(distinctId: string, options?: AllFlagsOptions): Promise<PostHogFlagsAndPayloadsResponse>

  /**
   * @description Get a feature flag result using distinctId from withContext().
   */
  getFeatureFlagResult(key: string, options?: FlagEvaluationOptions): Promise<FeatureFlagResult | undefined>

  /**
   * @description Get the result of evaluating a feature flag, including its value and payload.
   * This is more efficient than calling getFeatureFlag and getFeatureFlagPayload separately when you need both.
   *
   * @example
   * ```ts
   * const result = await client.getFeatureFlagResult('my-flag', 'user_123')
   * if (result) {
   *   console.log('Flag enabled:', result.enabled)
   *   console.log('Variant:', result.variant)
   *   console.log('Payload:', result.payload)
   * }
   * ```
   *
   * @param key - The feature flag key
   * @param distinctId - The user's distinct ID
   * @param options - Optional configuration for flag evaluation
   * @returns Promise that resolves to the flag result or undefined
   */
  getFeatureFlagResult(
    key: string,
    distinctId: string,
    options?: FlagEvaluationOptions
  ): Promise<FeatureFlagResult | undefined>

  /**
   * @description Evaluate all feature flags for a user in a single call and return a
   * {@link FeatureFlagEvaluations} snapshot. Branch on `.isEnabled()` / `.getFlag()`,
   * then pass the same snapshot to `capture()` via the `flags` option so events carry
   * the exact flag values the code branched on.
   *
   * Prefer this over calling `isFeatureEnabled()` / `getFeatureFlag()` repeatedly and
   * over `capture({ sendFeatureFlags: true })` — it avoids multiple `/flags` requests
   * per incoming request.
   *
   * @example
   * ```ts
   * const flags = await posthog.evaluateFlags('user_123', { personProperties: { plan: 'enterprise' } })
   * if (flags.isEnabled('new-dashboard')) {
   *   renderNewDashboard()
   * }
   * posthog.capture({ distinctId: 'user_123', event: 'page_viewed', flags })
   * ```
   *
   * Local evaluation resolves cached inactive definitions to `false`. Remote evaluation omits
   * globally inactive flags, so those keys are absent when no local definition is available.
   *
   * @param options - Optional configuration for flag evaluation. `flagKeys` scopes local evaluation, the `/flags` request, and the returned snapshot. Missing local keys trigger fallback unless `onlyEvaluateLocally` is true.
   */
  evaluateFlags(options?: AllFlagsOptions): Promise<FeatureFlagEvaluations>
  /**
   * @description Evaluate all feature flags for a specific user.
   *
   * @param distinctId - The user's distinct ID
   * @param options - Optional configuration for flag evaluation. `flagKeys` scopes local evaluation, the `/flags` request, and the returned snapshot. Missing local keys trigger fallback unless `onlyEvaluateLocally` is true.
   */
  evaluateFlags(distinctId: string, options?: AllFlagsOptions): Promise<FeatureFlagEvaluations>

  /**
   * Queue a `$groupidentify` event to create or update group properties (up to 5 group types per project). Set `name` in `properties` for the UI display name.
   *
   * @param data - Group identify payload with `groupType`, `groupKey`, optional `properties`, `distinctId`, and `options`
   */
  groupIdentify(data: GroupIdentifyMessage): void

  /**
   * Send a `$groupidentify` event immediately and wait for the HTTP send attempt to settle.
   *
   * @param data - Group identify payload with `groupType`, `groupKey`, optional `properties`, `distinctId`, and `options`
   */
  groupIdentifyImmediate(data: GroupIdentifyMessage): Promise<void>

  /**
   * @description Force an immediate reload of the polled feature flags. Please note that they are
   * already polled automatically at a regular interval.
   */
  reloadFeatureFlags(): Promise<void>

  /**
   * @description Override feature flags locally. Useful for testing and local development.
   * Overridden flags take precedence over both local evaluation and remote evaluation.
   *
   * @example
   * ```ts
   * // Clear all overrides
   * posthog.overrideFeatureFlags(false)
   *
   * // Enable a list of flags (sets them to true)
   * posthog.overrideFeatureFlags(['flag-a', 'flag-b'])
   *
   * // Set specific flag values/variants
   * posthog.overrideFeatureFlags({ 'my-flag': 'variant-a', 'other-flag': true })
   *
   * // Set both flags and payloads
   * posthog.overrideFeatureFlags({
   *   flags: { 'my-flag': 'variant-a' },
   *   payloads: { 'my-flag': { discount: 20 } }
   * })
   * ```
   *
   * @param overrides - Flag overrides configuration
   */
  overrideFeatureFlags(overrides: OverrideFeatureFlagsOptions): void

  /**
   * @description Run a function with specific context that will be applied to all events captured within that context.
   * @param data Context data to apply (sessionId, distinctId, properties, options)
   * @param fn Function to run with the context
   * @param options Context options (fresh)
   * @returns The return value of the function
   */
  withContext<T>(data: Partial<ContextData>, fn: () => T, options?: ContextOptions): T

  /**
   * @description Get the current context data.
   * @returns The current context data, or undefined if no context is set
   */
  getContext(): ContextData | undefined

  /**
   * @description The `posthog.metrics` API: a statsd-style pre-aggregating metrics client (count,
   * gauge, histogram) — alpha. Samples are folded into per-series aggregates in memory and flushed
   * periodically. Configure via the `metrics` client option.
   */
  readonly metrics: Metrics

  /**
   * @description The `posthog.emails` API: sends transactional email from PostHog email templates.
   * Needs `secretKey`, a project secret API key with the `transactional_email:write` scope.
   */
  readonly emails: Emails

  /**
   * @description Starts a span without making it active, for work that can't wrap a callback.
   * Prefer `withSpan`. Always returns a handle — an inert one when tracing is off — so calling
   * code never has to branch.
   * @experimental Subject to change in a minor release.
   */
  startSpan(name: string, options?: StartSpanOptions): Span

  /**
   * @description Runs a callback with a span active for its duration and ends the span at return
   * (sync) or settle (async). Spans started inside nest automatically; a throw or rejection is
   * recorded on the span and rethrown unchanged.
   * @experimental Subject to change in a minor release.
   */
  withSpan<T>(name: string, fn: (span: Span) => T): T
  withSpan<T>(name: string, options: StartSpanOptions, fn: (span: Span) => T): T

  /**
   * @description The span currently active on this async execution path, or null outside any
   * `withSpan` callback.
   * @experimental Subject to change in a minor release.
   */
  getActiveSpan(): Span | null

  /**
   * @description Flushes the events still in the queue and clears the feature flags poller to allow for
   * a clean shutdown.
   *
   * @param shutdownTimeoutMs The shutdown timeout, in milliseconds. Defaults to 30000 (30s).
   */
  shutdown(shutdownTimeoutMs?: number): Promise<void>

  /**
   * @description Waits for local evaluation to be ready, with an optional timeout.
   * @param timeoutMs - Maximum time to wait in milliseconds. Defaults to 30 seconds.
   * @returns A promise that resolves to true if local evaluation is ready, false if the timeout was reached.
   */
  waitForLocalEvaluationReady(timeoutMs?: number): Promise<boolean>

  /**
   * @description Returns true if local evaluation is ready, false if it's not.
   * @returns true if local evaluation is ready, false if it's not.
   */
  isLocalEvaluationReady(): boolean
}
