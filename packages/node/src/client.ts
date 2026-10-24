import { version } from './version'

import {
  allSettled,
  ErrorTracking as CoreErrorTracking,
  FeatureFlagValue,
  isBlockedUA,
  isPlainObject,
  JsonType,
  minimizeFlagCalledEventProperties,
  PostHogCaptureOptions,
  PostHogCoreStateless,
  PostHogEventProperties,
  PostHogFetchOptions,
  PostHogFetchResponse,
  PostHogFlagsAndPayloadsResponse,
  PostHogFlagsResponse,
  PostHogMetrics,
  PostHogPersistedProperty,
  PostHogTraces,
  inertSpan,
  Properties,
  resolveMetricsConfig,
  resolveTracesConfig,
  runWithActiveSpan,
  raceWithTimeout,
  safeSetTimeout,
  SyncSpanContextManager,
  uuidv7,
} from '@posthog/core'
import type {
  Metrics,
  Span,
  SpanContextManager,
  StartSpanOptions,
  TraceSdkContext,
  UnresolvedFlagReason,
} from '@posthog/core'
import {
  AllFlagsOptions,
  EventMessage,
  FeatureFlagError,
  FeatureFlagErrorType,
  FeatureFlagEvaluationRuntime,
  FeatureFlagOverrideOptions,
  FeatureFlagResult,
  FlagEvaluationOptions,
  GroupIdentifyMessage,
  IdentifyMessage,
  IPostHog,
  OverrideFeatureFlagsOptions,
  PostHogOptions,
  SendFeatureFlagsOptions,
  SetPersonPropertiesMessage,
  UnsetPersonPropertiesMessage,
} from './types'
import {
  EvaluatedFlagRecord,
  FeatureFlagEvaluations,
  FeatureFlagEvaluationsHost,
  FlagCalledEventParams,
} from './feature-flag-evaluations'
import {
  type FeatureFlagEvaluationContext,
  FeatureFlagsPoller,
  InconclusiveMatchError,
  RequiresServerEvaluation,
} from './extensions/feature-flags/feature-flags'
import ErrorTracking from './extensions/error-tracking'
import { getActiveTraceProperties } from './extensions/error-tracking/trace-context'
import { PostHogMemoryStorage } from './storage-memory'
import { ContextData, ContextOptions, IPostHogContext } from './extensions/context/types'
import { V1CaptureSender, type V1CaptureSenderConfig } from './capture-v1/sender'
import { AI_CAPTURE_ENDPOINT, ANALYTICS_CAPTURE_ENDPOINT, type CaptureEndpoint } from './capture-v1/types'
import type { CaptureError } from './capture-v1/errors'
import { CaptureLane, type CaptureLaneConfig } from './capture-lane/lane'
import { AI_MAX_PROPERTIES_BYTES, ANALYTICS_MAX_EVENT_BYTES, CAPTURE_BATCH_TARGET_BYTES } from './capture-lane/limits'
import { type CaptureSettings, resolveCaptureSettings } from './capture-lane/settings'
import { type CaptureCompressor, resolveCaptureCodec, webCompressor } from './capture-v1/compression'
import { canonicalizeUuid } from './capture-v1/uuid'
import { readEventOptions } from './capture-v1/transform'
import { fillOptions, fillProperties, isUnsetProperty, snapshotLayer } from './event-defaults'
import { AI_CAPTURE_ROUTE } from './ai-capture/routing'

// Standard local evaluation rate limit is 600 per minute (10 per second),
// so the fastest a poller should ever be set is 100ms.
const MINIMUM_POLLING_INTERVAL = 100
const THIRTY_SECONDS = 30 * 1000
const MAX_CACHE_SIZE = 50 * 1000

const WAITUNTIL_DEBOUNCE_MS = 50
const WAITUNTIL_MAX_WAIT_MS = 500
const DEFAULT_NODE_HOST = 'https://us.i.posthog.com'

// Process-wide dedup for deprecation warnings — without this, calling a deprecated
// method in a loop would spam logs. Matches Python's `warnings.warn` default-dedup behavior.
const _emittedDeprecations = new Set<string>()

function emitDeprecationWarningOnce(id: string, message: string): void {
  if (_emittedDeprecations.has(id)) {
    return
  }
  _emittedDeprecations.add(id)
  console.warn(`[PostHog] ${message}`)
}

/**
 * @internal — clears the process-wide deprecation dedup set. Test-only.
 */
export function _resetDeprecationWarningsForTests(): void {
  _emittedDeprecations.clear()
}

function normalizeApiKey(value?: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePersonalApiKey(value?: unknown): string | undefined {
  const normalizedValue = typeof value === 'string' ? value.trim() : ''
  return normalizedValue || undefined
}

function normalizeHost(value?: unknown): string {
  const normalizedValue = typeof value === 'string' ? value.trim() : ''
  return normalizedValue || DEFAULT_NODE_HOST
}

/** Properties that set an option or a session field, kept on a minimal `$feature_flag_called` event. */
const FLAG_CALLED_OPTION_SOURCE_PROPERTIES = [
  '$cookieless_mode',
  '$ignore_sent_at',
  '$product_tour_id',
  '$process_person_profile',
  '$session_id',
  '$window_id',
]

/** Property values the SDK passes to `before_send` by reference unless copied. */
const NESTED_HOOK_PROPERTIES = ['$set', '$set_once', '$groups', '$group_set']

/**
 * A copy of the event for `before_send`, so a hook that mutates its properties, options or groups
 * cannot change the caller's objects or the defaults they were filled from.
 */
function isolateForBeforeSend(eventMessage: EventMessage): EventMessage {
  const isolated: EventMessage = { ...eventMessage }
  if (isPlainObject(eventMessage.options)) {
    isolated.options = { ...eventMessage.options }
  }
  if (isPlainObject(eventMessage.groups)) {
    isolated.groups = { ...eventMessage.groups }
  }
  if (isPlainObject(eventMessage.properties)) {
    const properties = { ...eventMessage.properties }
    for (const key of NESTED_HOOK_PROPERTIES) {
      if (isPlainObject(properties[key])) {
        properties[key] = { ...properties[key] }
      }
    }
    isolated.properties = properties
  }
  return isolated
}

/**
 * The `$identify` properties: `$set` is the caller's `$set`, or every other property when there is
 * none; `$set_once` only when the caller gave one.
 */
function identifyEventProperties(properties: Record<string | number, any>): PostHogEventProperties {
  const { $set, $set_once, $anon_distinct_id, ...rest } = properties
  return {
    $set: $set || rest,
    ...($set_once !== undefined && $set_once !== null ? { $set_once } : {}),
    $anon_distinct_id: $anon_distinct_id ?? undefined,
  }
}

/** How one message type resolves identity and which layers may set which keys. */
type PrepareEventOptions = {
  /** The distinct id when neither the call nor the context gives one; otherwise a personless id is generated. */
  fallbackDistinctId?: string
  /** Whether the context session id fills `$session_id`. */
  contextSession?: boolean
  /** Properties that only the call sets: no layer fills them. */
  callOnlyProperties?: readonly string[]
  /** Set the `distinct_id` property to the resolved distinct id. */
  distinctIdProperty?: boolean
}

/** `alias` never takes its target from a context or default, and reports the resolved id. */
const ALIAS_PREPARE_OPTIONS: PrepareEventOptions = { callOnlyProperties: ['alias'], distinctIdProperty: true }

/** The id, or undefined when it is missing, empty or only whitespace. */
function presentDistinctId(value: unknown): string | undefined {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return undefined
  }
  return value as string
}

function normalizeUnsetPersonProperties(value: string | string[]): string[] {
  const propertyNames = Array.isArray(value) ? value : [value]
  return propertyNames.filter(
    (propertyName): propertyName is string => typeof propertyName === 'string' && propertyName.trim().length > 0
  )
}

/**
 * Derive `$feature/{key}` and `$active_feature_flags` event properties from a flat
 * `{ key: value }` map returned by the legacy `sendFeatureFlags` path.
 */
function buildFlagEventProperties(flagValues: Record<string, FeatureFlagValue> | undefined): Record<string, any> {
  if (!flagValues) {
    return {}
  }
  const additionalProperties: Record<string, any> = {}
  for (const [feature, variant] of Object.entries(flagValues)) {
    additionalProperties[`$feature/${feature}`] = variant
  }
  const activeFlags = Object.keys(flagValues)
    .filter((flag) => flagValues[flag] !== false)
    .sort()
  if (activeFlags.length > 0) {
    additionalProperties['$active_feature_flags'] = activeFlags
  }
  return additionalProperties
}

// The actual exported Nodejs API.
export abstract class PostHogBackendClient extends PostHogCoreStateless implements IPostHog {
  private _memoryStorage = new PostHogMemoryStorage()

  private featureFlagsPoller?: FeatureFlagsPoller
  protected errorTracking: ErrorTracking
  private maxCacheSize: number
  public readonly options: PostHogOptions
  protected readonly context?: IPostHogContext
  private _metrics?: PostHogMetrics
  private _traces?: PostHogTraces
  private _spanContext?: SpanContextManager

  // Created on first use, so a client that never calls captureAi has no AI lane.
  private readonly _captureLanes = new Map<CaptureEndpoint, CaptureLane>()
  private readonly _captureSettings: CaptureSettings
  /** Whether this client captures full AI content: see `enableFullAiCapture` in `PostHogOptions`. */
  public readonly enableFullAiCapture: boolean
  /** Whether PostHog AI integrations redact content: see `privacyMode` in `PostHogOptions`. */
  public readonly privacyMode: boolean

  // Options from registerOptions(). Replaced, never mutated, so an event can keep the object it read.
  private _globalOptions: Record<string, JsonType> = {}

  // Feature flag overrides for local testing/development
  private _flagOverrides?: Record<string, FeatureFlagValue>
  private _payloadOverrides?: Record<string, JsonType>

  // Server-controlled gate for minimal $feature_flag_called events. Single client-level gate,
  // last-writer-wins across the two signal sources (v2 /flags responses and the poller's
  // flag-definition loads) — both derive from the same per-team server config and converge.
  private _minimalFlagCalledEvents: boolean = false

  // Insertion-ordered LRU of the `$feature_flag_called` keys already reported per distinct id.
  // Map iteration order is insertion order, so the first entry is always the least recently used.
  private _distinctIdHasSentFlagCalls: Map<string, Set<string>>

  /**
   * Snapshot of the `$feature_flag_called` dedupe state, keyed by distinct id.
   * Adding or deleting keys on the returned object does not affect deduplication;
   * assigning a whole object replaces the tracker.
   * @internal
   * @deprecated Not part of the public API; kept for backwards compatibility.
   */
  get distinctIdHasSentFlagCalls(): Record<string, Set<string>> {
    return Object.fromEntries(this._distinctIdHasSentFlagCalls)
  }

  set distinctIdHasSentFlagCalls(value: Record<string, Set<string>>) {
    this._distinctIdHasSentFlagCalls = new Map(Object.entries(value ?? {}))
  }

  // waitUntil debounce state (per-instance)
  private _waitUntilCycle?: {
    resolve: () => void
    startedAt: number
    timer: ReturnType<typeof setTimeout> | undefined
  }

  /**
   * Initialize a new PostHog client instance.
   *
   * @example
   * ```ts
   * // Basic initialization
   * const client = new PostHogBackendClient(
   *   'your-api-key',
   *   { host: 'https://app.posthog.com' }
   * )
   * ```
   *
   * @example
   * ```ts
   * // With a secret key (Personal API Key or Project Secret API Key) for local evaluation
   * const client = new PostHogBackendClient(
   *   'your-api-key',
   *   {
   *     host: 'https://app.posthog.com',
   *     secretKey: 'your-secret-key'
   *   }
   * )
   * ```
   *
   * {@label Initialization}
   *
   * @param apiKey - Your PostHog project API key
   * @param options - Configuration options for the client
   */
  constructor(apiKey: string, options: PostHogOptions = {}) {
    const normalizedApiKey = normalizeApiKey(apiKey)
    const normalizedOptions = {
      ...options,
      // Node's default is higher than the shared core default (1000) because backend
      // workloads are more likely to burst-enqueue synchronously ahead of a flush.
      // Applied after the spread with a nullish fallback so a wrapper forwarding
      // `maxQueueSize: undefined` still gets the Node default, not the core one.
      maxQueueSize: options.maxQueueSize ?? 10000,
      flushInterval: options.flushInterval ?? 5000,
      host: normalizeHost(options.host),
      personalApiKey: normalizePersonalApiKey(options.secretKey ?? options.personalApiKey),
    }

    super(normalizedApiKey, normalizedOptions)

    this.options = normalizedOptions
    this.warnIfCaptureModeSet()
    // console.error, not this._logger: the logger only prints in debug mode, and a bad option changes delivery.
    this._captureSettings = resolveCaptureSettings(normalizedOptions, (message) =>
      console.error(`[PostHog] ${message}`)
    )
    this.enableFullAiCapture = normalizedOptions.enableFullAiCapture === true
    this.privacyMode = normalizedOptions.privacyMode === true
    this.context = this.initializeContext()

    this.options.featureFlagsPollingInterval =
      typeof normalizedOptions.featureFlagsPollingInterval === 'number'
        ? Math.max(normalizedOptions.featureFlagsPollingInterval, MINIMUM_POLLING_INTERVAL)
        : normalizedOptions.featureFlagsPollingInterval === null
          ? null
          : THIRTY_SECONDS

    if (typeof normalizedOptions.waitUntilDebounceMs === 'number') {
      this.options.waitUntilDebounceMs = Math.max(normalizedOptions.waitUntilDebounceMs, 0)
    }
    if (typeof normalizedOptions.waitUntilMaxWaitMs === 'number') {
      this.options.waitUntilMaxWaitMs = Math.max(normalizedOptions.waitUntilMaxWaitMs, 0)
    }

    if (!this.disabled && (normalizedOptions.personalApiKey || normalizedOptions.flagDefinitionCacheProvider)) {
      if (normalizedOptions.personalApiKey?.includes('phc_')) {
        throw new Error(
          'A project API key ("phc_...") was provided as secretKey or personalApiKey. Pass the project API key as the first constructor argument. For local evaluation, set secretKey (or the deprecated personalApiKey alias) to a server-only Project Secret API Key ("phs_...") or Personal API Key ("phx_...") with feature flag read access.'
        )
      }

      // Only start the poller if local evaluation is enabled (defaults to true for backward compatibility)
      const shouldEnableLocalEvaluation = normalizedOptions.enableLocalEvaluation !== false

      if (shouldEnableLocalEvaluation) {
        this.featureFlagsPoller = new FeatureFlagsPoller({
          pollingInterval: this.options.featureFlagsPollingInterval,
          personalApiKey: normalizedOptions.personalApiKey,
          projectApiKey: normalizedApiKey,
          timeout: normalizedOptions.requestTimeout ?? 10000, // 10 seconds
          host: this.host,
          fetch: normalizedOptions.fetch,
          onError: (err: Error) => {
            this._events.emit('error', err)
          },
          onLoad: (count: number) => {
            this._events.emit('localEvaluationFlagsLoaded', count)
          },
          onMinimalFlagCalledEvents: (enabled: boolean) => {
            this._minimalFlagCalledEvents = enabled
          },
          customHeaders: this.getCustomHeaders(),
          cacheProvider: normalizedOptions.flagDefinitionCacheProvider,
          strictLocalEvaluation: normalizedOptions.strictLocalEvaluation,
          evaluationContexts: normalizedOptions.evaluationContexts ?? normalizedOptions.evaluationEnvironments,
        })
      }
    }

    this.errorTracking = new ErrorTracking(this, normalizedOptions, this._logger)
    this._distinctIdHasSentFlagCalls = new Map()
    this.maxCacheSize = normalizedOptions.maxCacheSize || MAX_CACHE_SIZE
  }

  /** Queues the event on its capture lane instead of the core queue. */
  protected override enqueue(
    type: string,
    message: any,
    options?: PostHogCaptureOptions,
    explicitRoute?: string
  ): void {
    this.wrap(() => {
      if (this.optedOut) {
        this._events.emit(type, `Library is disabled. Not sending event. To re-enable, call posthog.optIn()`)
        return
      }
      const prepared = this._prepareLaneMessage(message, options)
      if (prepared === null) {
        return
      }
      this._captureLane(explicitRoute).enqueue(prepared)
      this._events.emit(type, prepared)
    })
    this.scheduleDebouncedFlush()
  }

  /** Sends the event through its capture lane's sender, without queueing it. */
  protected override async sendImmediate(
    type: string,
    message: any,
    options?: PostHogCaptureOptions,
    explicitRoute?: string
  ): Promise<void> {
    if (this.disabled) {
      this._logger.warn('The client is disabled')
      return
    }
    if (!this._isInitialized) {
      await this._initPromise
    }
    if (this.optedOut) {
      this._events.emit(type, `Library is disabled. Not sending event. To re-enable, call posthog.optIn()`)
      return
    }
    const prepared = this._prepareLaneMessage(message, options)
    if (prepared === null) {
      return
    }
    try {
      await this._captureLane(explicitRoute).sendImmediate(prepared)
    } catch (err) {
      this._events.emit('error', err)
    }
  }

  private _prepareLaneMessage(message: any, options?: PostHogCaptureOptions): PostHogEventProperties | null {
    // Runs after before_send, which can change the uuid.
    const uuid = this._canonicalEventUuid(options?.uuid)
    const prepared = this.processBeforeEnqueue(this.prepareMessage(message, { ...options, uuid }))
    return prepared === null ? null : this.normalizeMessage(prepared)
  }

  /**
   * The canonical form of a caller's event uuid, or undefined when there is none to keep. An
   * invalid uuid is replaced with a generated one and a warning that never repeats the value.
   */
  private _canonicalEventUuid(uuid: unknown): string | undefined {
    if (uuid === undefined || uuid === null || uuid === '') {
      return undefined
    }
    const canonical = typeof uuid === 'string' ? canonicalizeUuid(uuid) : undefined
    if (canonical !== undefined) {
      return canonical
    }
    // console.warn, not this._logger: the logger only prints in debug mode, and the event loses its uuid.
    console.warn('[PostHog] Replaced an invalid event uuid with a generated one; uuids must be RFC 4122 strings')
    return uuidv7()
  }

  /**
   * Concurrent so a serverless handler waits for one round trip, not two. A
   * failed span export leaves the spans queued rather than rejecting, since
   * callers already treat `flush()` as safe to leave unwrapped.
   */
  private _flushEventsAndSpans(): Promise<void> {
    // Pending captures land on their lanes first, so this flush sends them too.
    const events = this.flushWithPendingPromises().then(() => this._flushCaptureLanes())
    if (!this._traces) {
      return events
    }
    // Settled, not `all`: `all` rejects the moment the event flush does, and a
    // serverless host that treats this promise as the end of the invocation can
    // freeze it with the span request still open. The events rejection is still
    // the one the caller sees.
    return allSettled([events, this._traces.flush().catch(() => {})]).then(([eventsResult]) => {
      if (eventsResult.status === 'rejected') {
        throw eventsResult.reason
      }
    })
  }

  /**
   * Sends all queued events and spans, and resolves when every send has finished.
   * It does not reject when delivery fails: those failures arrive on the `'error'` event.
   */
  override async flush(): Promise<void> {
    return this._keepRuntimeAlive(this._flushEventsAndSpans())
  }

  /** Every lane flushes concurrently, so a slow lane only delays this promise, not the other lanes' sends. */
  private _flushCaptureLanes(): Promise<void> {
    return Promise.all([...this._captureLanes.values()].map((lane) => lane.flush())).then(() => {})
  }

  /** A flush a lane started on its own, from its timer or `flushAt`. */
  private _onLaneBackgroundFlush(laneFlush: Promise<void>): void {
    // Spans ride along, except while the traces queue is honouring a `Retry-After`
    // window; its own timer picks them up when the window closes.
    const traces = this._traces
    const flush =
      traces && !traces.throttled ? allSettled([laneFlush, traces.flush().catch(() => {})]).then(() => {}) : laneFlush
    void this._keepRuntimeAlive(flush)
  }

  private _keepRuntimeAlive(flushPromise: Promise<void>): Promise<void> {
    const waitUntil = this.options.waitUntil
    // Only register when no debounce promise is already keeping runtime alive
    if (waitUntil && !this._waitUntilCycle) {
      try {
        waitUntil(flushPromise.catch(() => {}))
      } catch {
        // waitUntil may throw outside request context
      }
    }
    return flushPromise
  }

  private scheduleDebouncedFlush(): void {
    // `waitUntil` is a serverless construct
    // if it doesn't exist, we can skip all the debounce logic and flush as normal
    const waitUntil = this.options.waitUntil
    if (!waitUntil) {
      return
    }

    if (this.disabled || this.optedOut) {
      return
    }

    if (!this._waitUntilCycle) {
      let resolve: () => void
      const promise = new Promise<void>((r) => {
        resolve = r
      })
      try {
        waitUntil(promise)
      } catch {
        // waitUntil may throw outside request context
        return
      }
      this._waitUntilCycle = { resolve: resolve!, startedAt: Date.now(), timer: undefined }
    }

    // Max time cap: if we've been debouncing too long, flush now to prevent
    // starvation from rapid concurrent captures. I.e., don't let a steady
    // stream of captures keep pushing the flush back indefinitely.
    const elapsed = Date.now() - this._waitUntilCycle.startedAt
    const maxWaitMs = this.options.waitUntilMaxWaitMs ?? WAITUNTIL_MAX_WAIT_MS
    const flushNow = elapsed >= maxWaitMs

    if (this._waitUntilCycle.timer !== undefined) {
      clearTimeout(this._waitUntilCycle.timer)
    }

    if (flushNow) {
      void this.resolveWaitUntilFlush()
      return
    }

    const debounceMs = this.options.waitUntilDebounceMs ?? WAITUNTIL_DEBOUNCE_MS
    this._waitUntilCycle.timer = safeSetTimeout(() => {
      void this.resolveWaitUntilFlush()
    }, debounceMs)
  }

  private _consumeWaitUntilCycle(): (() => void) | undefined {
    const cycle = this._waitUntilCycle
    if (cycle) {
      clearTimeout(cycle.timer)
      this._waitUntilCycle = undefined
    }
    return cycle?.resolve
  }

  private async resolveWaitUntilFlush(): Promise<void> {
    const resolve = this._consumeWaitUntilCycle()
    try {
      await this._flushEventsAndSpans()
    } catch {
      // Flush errors are already logged by flush() internals
    } finally {
      resolve?.()
    }
  }

  /**
   * Get a persisted property value from memory storage.
   *
   * @example
   * ```ts
   * // Get user ID
   * const userId = client.getPersistedProperty('userId')
   * ```
   *
   * @example
   * ```ts
   * // Get session ID
   * const sessionId = client.getPersistedProperty('sessionId')
   * ```
   *
   * {@label Initialization}
   *
   * @param key - The property key to retrieve
   * @returns The stored property value or undefined if not found
   */
  getPersistedProperty(key: PostHogPersistedProperty): any | undefined {
    return this._memoryStorage.getProperty(key)
  }

  /**
   * Set a persisted property value in memory storage.
   *
   * @example
   * ```ts
   * // Set user ID
   * client.setPersistedProperty('userId', 'user_123')
   * ```
   *
   * @example
   * ```ts
   * // Set session ID
   * client.setPersistedProperty('sessionId', 'session_456')
   * ```
   *
   * {@label Initialization}
   *
   * @param key - The property key to set
   * @param value - The value to store (null to remove)
   */
  setPersistedProperty(key: PostHogPersistedProperty, value: any | null): void {
    return this._memoryStorage.setProperty(key, value)
  }

  /**
   * Make an HTTP request using the configured fetch function or default fetch.
   *
   * @example
   * ```ts
   * // POST request
   * const response = await client.fetch('/api/endpoint', {
   *   method: 'POST',
   *   headers: { 'Content-Type': 'application/json' },
   *   body: JSON.stringify(data)
   * })
   * ```
   *
   * @internal
   *
   * {@label Initialization}
   *
   * @param url - The URL to fetch
   * @param options - Fetch options
   * @returns Promise resolving to the fetch response
   */
  fetch(url: string, options: PostHogFetchOptions): Promise<PostHogFetchResponse> {
    return this.options.fetch ? this.options.fetch(url, options) : fetch(url, options)
  }

  /** The lane for `route`; `captureAi` events use the AI lane, every other event the analytics lane. */
  private _captureLane(route?: string): CaptureLane {
    const endpoint = route === AI_CAPTURE_ROUTE ? AI_CAPTURE_ENDPOINT : ANALYTICS_CAPTURE_ENDPOINT
    let lane = this._captureLanes.get(endpoint)
    if (!lane) {
      const compressor = this.captureCompressor()
      lane = new CaptureLane(this._captureLaneConfig(endpoint), {
        sender: new V1CaptureSender(this.captureSenderConfig(endpoint, compressor), {
          fetch: (url, fetchOptions) => this.fetch(url, fetchOptions),
          onError: (error, summary) => this._reportCaptureLoss([error], summary),
          compress: (payload, codec) => compressor.compress(payload, codec),
        }),
        onLocalDrops: (errors, summary) => this._reportCaptureLoss(errors, summary),
        onError: (error) => this._events.emit('error', error),
        onFlush: (messages) => this._events.emit('flush', messages),
        onBackgroundFlush: (flush) => this._onLaneBackgroundFlush(flush),
        logger: this._logger,
      })
      this._captureLanes.set(endpoint, lane)
    }
    return lane
  }

  private _captureLaneConfig(endpoint: CaptureEndpoint): CaptureLaneConfig {
    const isAi = endpoint === AI_CAPTURE_ENDPOINT
    return {
      endpoint,
      flushAt: this.flushAt,
      flushIntervalMs: this.options.flushInterval ?? 5000,
      maxBatchSize: Math.max(this.flushAt, this.options.maxBatchSize ?? 100),
      // Never below flushAt, or the flushAt trigger could never fire.
      maxQueueSize: Math.max(
        this.flushAt,
        isAi ? this._captureSettings.ai.maxQueueSize : (this.options.maxQueueSize ?? 10000)
      ),
      targetBatchBytes: CAPTURE_BATCH_TARGET_BYTES,
      maxEventBytes: isAi ? AI_MAX_PROPERTIES_BYTES : ANALYTICS_MAX_EVENT_BYTES,
      maxEventBytesOf: isAi ? 'properties' : 'event',
    }
  }

  /** Emits each error; with no `'error'` listener, logs `summary` once instead, since the events are lost. */
  private _reportCaptureLoss(errors: CaptureError[], summary: string): void {
    const errorListeners = this._events.events['error']?.length ?? 0
    for (const error of errors) {
      this._events.emit('error', error)
    }
    if (errorListeners === 0) {
      // console.warn, not this._logger: the logger only prints in debug mode.
      console.warn(`[PostHog] ${summary}`)
    }
  }

  /**
   * Compresses capture request bodies. The edge build uses CompressionStream; the Node
   * entrypoint overrides this with node:zlib.
   */
  protected captureCompressor(): CaptureCompressor {
    return webCompressor
  }

  private captureSenderConfig(path: CaptureEndpoint, compressor: CaptureCompressor): V1CaptureSenderConfig {
    const laneSettings = path === AI_CAPTURE_ENDPOINT ? this._captureSettings.ai : this._captureSettings.analytics
    const compression = resolveCaptureCodec(laneSettings.compression, compressor, (fallback) =>
      this._logger.debug(`zstd compression is not available in this runtime; ${path} uses ${fallback} instead`)
    )
    return {
      host: this.host,
      path,
      apiKey: this.apiKey,
      libraryId: this.getLibraryId(),
      libraryVersion: this.getLibraryVersion(),
      userAgent: this.getCustomUserAgent() || undefined,
      historicalMigration: this.historicalMigration,
      compression,
      requestTimeoutMs: laneSettings.requestTimeoutMs,
      maxRetries: this._captureSettings.maxRetries,
      isDebug: this.isDebug,
    }
  }

  private warnIfCaptureModeSet(): void {
    const captureMode = typeof process !== 'undefined' ? process.env?.POSTHOG_CAPTURE_MODE : undefined
    if (captureMode !== undefined) {
      // console.warn, not this._logger: the logger only prints in debug mode, which cannot be on yet.
      console.warn('[PostHog] POSTHOG_CAPTURE_MODE is no longer read. Capture always uses capture v1.')
    }
  }

  /**
   * Get the library version from package.json.
   *
   * @example
   * ```ts
   * // Get version
   * const version = client.getLibraryVersion()
   * console.log(`Using PostHog SDK version: ${version}`)
   * ```
   *
   * {@label Initialization}
   *
   * @returns The current library version string
   */
  getLibraryVersion(): string {
    return version
  }

  /**
   * The `posthog.metrics` API: a statsd-style pre-aggregating metrics client — alpha.
   * Samples are folded into per-series aggregates in memory and flushed
   * periodically as one OTLP data point per series per window, so recording
   * from hot paths is cheap. Configure via the `metrics` client option.
   *
   * @example
   * ```ts
   * client.metrics.count('jobs.processed', 1, { attributes: { queue: 'default' } })
   * client.metrics.gauge('queue.depth', 42)
   * client.metrics.histogram('job.duration', 187, { unit: 'ms' })
   * ```
   *
   * {@label Metrics}
   */
  public get metrics(): Metrics {
    if (!this._metrics) {
      // Lazy: `this` is the MetricsHost (isDisabled/optedOut/_sendMetricsBatch
      // live on PostHogCoreStateless), so nothing is set up until first use.
      this._metrics = new PostHogMetrics(this, resolveMetricsConfig(this.options.metrics), this._logger)
    }
    return this._metrics
  }

  /**
   * Active-span tracking. Overridden by the Node entrypoint with an
   * `AsyncLocalStorage`-backed manager; the edge build keeps this synchronous
   * fallback, matching how `initializeContext` already differs between them.
   */
  protected initializeSpanContextManager(): SpanContextManager {
    return new SyncSpanContextManager()
  }

  /**
   * Runtime-detected OTLP resource attributes for every span. Overridden by the
   * Node entrypoint with the host OS; the edge build contributes none, keeping
   * `node:os` out of an edge bundle, which cannot resolve it.
   */
  protected hostResourceAttributes(): Record<string, string> {
    return {}
  }

  /**
   * Active-span tracking, built on first use. Lives on the client rather than
   * on the traces pipeline because a client with tracing off still activates a
   * pass-through span, so it needs the same store the pipeline would use.
   */
  private get _spanContextManager(): SpanContextManager {
    if (!this._spanContext) {
      this._spanContext = this.initializeSpanContextManager()
    }
    return this._spanContext
  }

  /**
   * The traces pipeline, built on first use. Returns `undefined` when the
   * `traces` client option is absent — tracing is off until configured.
   */
  private get _tracesPipeline(): PostHogTraces | undefined {
    if (!this.options.traces) {
      return undefined
    }
    if (!this._traces) {
      this._traces = new PostHogTraces(
        this,
        resolveTracesConfig(this.options.traces, this.hostResourceAttributes(), this._logger),
        this._logger,
        () => this._tracingContext(),
        this._spanContextManager,
        // A handler that only traces still has to hold the invocation open.
        () => this.scheduleDebouncedFlush()
      )
    }
    return this._traces
  }

  /**
   * PostHog context attached to every span, so traces join back to persons and
   * sessions. A server process has no ambient identity, so these come from the
   * current request context — the Express/NestJS middleware or `withContext`.
   */
  private _tracingContext(): TraceSdkContext {
    const context = this.context?.get()
    return { distinctId: context?.distinctId, sessionId: context?.sessionId }
  }

  /**
   * Starts a span without making it active — for work that can't wrap a
   * callback. Prefer `withSpan`, which ends the span for you.
   *
   * Always returns a handle, so calling code never has to branch: when the
   * `traces` option is absent, the SDK is disabled, or the user has opted out,
   * the handle is inert and nothing is exported. An inert handle given a
   * `parent` header still returns it from `traceparent()`, so a service with
   * tracing off passes a distributed trace through instead of severing it.
   *
   * {@label Traces}
   *
   * @experimental Subject to change in a minor release.
   *
   * @example
   * ```ts
   * const span = posthog.startSpan('checkout', { attributes: { plan: 'pro' } })
   * span.setAttribute('cart.items', 3)
   * span.end()
   * ```
   */
  startSpan(name: string, options?: StartSpanOptions): Span {
    return this._tracesPipeline?.startSpan(name, options) ?? inertSpan(options, this._spanContextManager.active())
  }

  /**
   * Runs a callback with a span active for its duration and ends the span for
   * you — at return for a sync callback, at settle for an async one. Takes an
   * optional `StartSpanOptions` between the name and the callback:
   * `withSpan(name, fn)` or `withSpan(name, options, fn)`.
   *
   * Spans started inside the callback nest under it automatically. If the
   * callback throws or rejects, the span records the exception and the original
   * error is rethrown unchanged. A callback that ends the span itself gets the
   * rethrow but not the recording, since the span is already exported by then.
   *
   * Spans nest across `await` only on the Node runtime, which tracks the active
   * span with `AsyncLocalStorage`. The edge build restores the active span when
   * the callback returns its promise, so spans started after an `await` there
   * begin a new trace.
   *
   * {@label Traces}
   *
   * @experimental Subject to change in a minor release.
   *
   * @example
   * ```ts
   * await posthog.withSpan('POST /checkout', { parent: req.get('traceparent') }, async (span) => {
   *   span.setAttribute('plan', user.plan)
   *   return processOrder()
   * })
   * ```
   */
  withSpan<T>(name: string, fn: (span: Span) => T): T
  withSpan<T>(name: string, options: StartSpanOptions, fn: (span: Span) => T): T
  withSpan<T>(name: string, optionsOrFn: StartSpanOptions | ((span: Span) => T), maybeFn?: (span: Span) => T): T {
    const options = typeof optionsOrFn === 'function' ? undefined : optionsOrFn
    const fn = (typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn) as (span: Span) => T

    const pipeline = this._tracesPipeline
    if (!pipeline) {
      // Tracing off: still run the callback exactly once, with an inert handle.
      // A handle carrying an inbound `parent` is activated, so `getActiveSpan()`
      // inside the callback can propagate the trace onward.
      return runWithActiveSpan(this._spanContextManager, inertSpan(options, this._spanContextManager.active()), fn)
    }
    return options ? pipeline.withSpan(name, options, fn) : pipeline.withSpan(name, fn)
  }

  /**
   * The span currently active on this async execution path, or `null` outside
   * any `withSpan` callback.
   *
   * On the edge build this returns `null` after an `await`, because the active
   * span is tracked synchronously there.
   *
   * {@label Traces}
   *
   * @experimental Subject to change in a minor release.
   *
   * @example
   * ```ts
   * // Propagate the trace to another service
   * const traceparent = posthog.getActiveSpan()?.traceparent()
   * await fetch(url, { headers: traceparent ? { traceparent } : {} })
   * ```
   */
  getActiveSpan(): Span | null {
    // Read from the store directly rather than through the pipeline: the two
    // share one manager, and with tracing off there is no pipeline to ask.
    return this._spanContextManager.active() ?? null
  }

  /**
   * Get the custom user agent string for this client.
   *
   * @example
   * ```ts
   * // Get user agent
   * const userAgent = client.getCustomUserAgent()
   * // Returns: "posthog-node/5.7.0"
   * ```
   *
   * {@label Identification}
   *
   * @returns The formatted user agent string
   */
  getCustomUserAgent(): string {
    return `${this.getLibraryId()}/${this.getLibraryVersion()}`
  }

  /**
   * posthog-node and posthog-edge are server runtimes, so `/flags` requests declare
   * `evaluation_runtime: 'server'` and receive `server` and `all` flags. This matches what the
   * server already infers from a recognized `posthog-node` / `posthog-edge` User-Agent, but
   * does not depend on that header surviving proxies, gateways, or edge runtimes.
   */
  protected override getEvaluationRuntime(): 'server' {
    return 'server'
  }

  /**
   * The properties the SDK adds to an event: `$is_server` (unless the `isServer` option is
   * `false`), `$geoip_disable` (when the `disableGeoip` option is on), feature flag properties,
   * and for `$exception` events the active OpenTelemetry trace ids and the injected release id.
   * They fill only the keys every other layer left unset.
   */
  private async _sdkEventProperties(
    event: string,
    properties: PostHogEventProperties,
    distinctId: string,
    flagInputs: Pick<EventMessage, 'groups' | 'flags' | 'sendFeatureFlags' | 'disableGeoip'>
  ): Promise<PostHogEventProperties> {
    const sdkProperties: PostHogEventProperties = await this._flagEventProperties(distinctId, flagInputs)
    if (this.options.isServer ?? true) {
      sdkProperties.$is_server = true
    }
    if (this.options.disableGeoip ?? true) {
      sdkProperties.$geoip_disable = true
    }
    if (event === '$exception') {
      // Both ids or neither, so a trace id is never paired with another trace's span id.
      if (isUnsetProperty(properties, '$trace_id') && isUnsetProperty(properties, '$span_id')) {
        Object.assign(sdkProperties, await getActiveTraceProperties())
      }
      const releaseId = CoreErrorTracking.getInjectedReleaseId()
      if (releaseId) {
        sdkProperties.$release_id = releaseId
      }
    }
    return sdkProperties
  }

  /**
   * `$feature/<key>` and `$active_feature_flags` from a `flags` snapshot or, when there is none,
   * from `sendFeatureFlags`. Any failure gives no flag properties, and the event is still sent.
   */
  private async _flagEventProperties(
    distinctId: string,
    {
      groups,
      flags,
      sendFeatureFlags,
      disableGeoip,
    }: Pick<EventMessage, 'groups' | 'flags' | 'sendFeatureFlags' | 'disableGeoip'>
  ): Promise<PostHogEventProperties> {
    try {
      // An explicit `flags` snapshot always wins: the event carries the values the code branched
      // on, with no additional network call.
      if (flags) {
        if (sendFeatureFlags) {
          console.warn(
            '[PostHog] Both `flags` and `sendFeatureFlags` were passed to capture(); using `flags` and ignoring `sendFeatureFlags`.'
          )
        }
        return flags._getEventProperties()
      }

      if (sendFeatureFlags) {
        emitDeprecationWarningOnce(
          'sendFeatureFlags',
          '`sendFeatureFlags` is deprecated and will be removed in a future major version. ' +
            'Pass a `flags` snapshot from `posthog.evaluateFlags(...)` instead — it avoids a ' +
            'second `/flags` request per capture and guarantees the event carries the exact ' +
            'flag values your code branched on.'
        )
        // If we are sending feature flags, we evaluate them locally if the user prefers it, otherwise we fall back to remote evaluation
        const sendFeatureFlagsOptions = typeof sendFeatureFlags === 'object' ? sendFeatureFlags : undefined
        const flagValues = await this.getFeatureFlagsForEvent(distinctId, groups, disableGeoip, sendFeatureFlagsOptions)
        return buildFlagEventProperties(flagValues)
      }
    } catch {
      return {}
    }

    // $feature_flag_called events are not enriched with cached flags — the flags
    // on that event should reflect the specific call, not a potentially stale snapshot.
    return {}
  }

  /**
   * Enable the PostHog client (opt-in).
   *
   * @example
   * ```ts
   * // Enable client
   * await client.enable()
   * // Client is now enabled and will capture events
   * ```
   *
   * {@label Privacy}
   *
   * @returns Promise that resolves when the client is enabled
   */
  enable(): Promise<void> {
    return super.optIn()
  }

  /**
   * Disable the PostHog client (opt-out).
   *
   * @example
   * ```ts
   * // Disable client
   * await client.disable()
   * // Client is now disabled and will not capture events
   * ```
   *
   * {@label Privacy}
   *
   * @returns Promise that resolves when the client is disabled
   */
  disable(): Promise<void> {
    return super.optOut()
  }

  /**
   * Enable or disable debug logging.
   *
   * @example
   * ```ts
   * // Enable debug logging
   * client.debug(true)
   * ```
   *
   * @example
   * ```ts
   * // Disable debug logging
   * client.debug(false)
   * ```
   *
   * {@label Initialization}
   *
   * @param enabled - Whether to enable debug logging
   */
  debug(enabled: boolean = true): void {
    super.debug(enabled)
    this.featureFlagsPoller?.debug(enabled)
  }

  private _warnIfInvalidCapture(
    props: EventMessage,
    stringArgumentWarning: string,
    exceptionCaptureWarning: string
  ): void {
    if (typeof props === 'string') {
      this._logger.warn(stringArgumentWarning)
    }
    if (props.event === '$exception' && !props._originatedFromCaptureException) {
      this._logger.warn(exceptionCaptureWarning)
    }
  }

  private _sendPreparedEvent(
    type: string,
    props: EventMessage,
    immediate: boolean,
    prepareOptions?: PrepareEventOptions,
    explicitRoute?: string
  ): Promise<void> {
    const uuid = this._canonicalEventUuid(props.uuid)
    if (uuid !== props.uuid) {
      props = { ...props, uuid }
    }
    return this.addPendingPromise(
      this._prepareEventMessage(props, prepareOptions)
        .then(({ distinctId, event, properties, options, eventOptions }) => {
          const captureOptions: PostHogCaptureOptions = {
            timestamp: options.timestamp,
            // `$geoip_disable` is already set before before_send; core must not add it after.
            disableGeoip: false,
            uuid: options.uuid,
          }
          const message = {
            distinctId,
            event,
            properties,
            ...(eventOptions !== undefined ? { options: eventOptions } : {}),
          }
          return immediate
            ? this.sendImmediate(type, message, captureOptions, explicitRoute)
            : this.enqueue(type, message, captureOptions, explicitRoute)
        })
        .catch((err) => {
          if (err) {
            console.error(err)
          }
        })
    )
  }

  _capturePreparedEvent(props: EventMessage, immediate: boolean): Promise<void> {
    return this._sendPreparedEvent('capture', props, immediate)
  }

  /**
   * Capture an event manually.
   *
   * @example
   * ```ts
   * // Basic capture
   * client.capture({
   *   distinctId: 'user_123',
   *   event: 'button_clicked',
   *   properties: { button_color: 'red' }
   * })
   * ```
   *
   * {@label Capture}
   *
   * @param props - The event properties
   * @returns void
   */
  capture(props: EventMessage): void {
    this._warnIfInvalidCapture(
      props,
      'Called capture() with a string as the first argument when an object was expected.',
      "Using `posthog.capture('$exception')` is unreliable because it does not attach required metadata. Use `posthog.captureException(error)` instead, which attaches required metadata automatically."
    )
    this._capturePreparedEvent(props, false)
  }

  /**
   * Capture an event immediately (synchronously).
   *
   * @example
   * ```ts
   * // Basic immediate capture
   * await client.captureImmediate({
   *   distinctId: 'user_123',
   *   event: 'button_clicked',
   *   properties: { button_color: 'red' }
   * })
   * ```
   *
   * @example
   * ```ts
   * // With feature flags
   * await client.captureImmediate({
   *   distinctId: 'user_123',
   *   event: 'user_action',
   *   sendFeatureFlags: true
   * })
   * ```
   *
   * @example
   * ```ts
   * // With custom feature flags options
   * await client.captureImmediate({
   *   distinctId: 'user_123',
   *   event: 'user_action',
   *   sendFeatureFlags: {
   *     onlyEvaluateLocally: true,
   *     personProperties: { plan: 'premium' },
   *     groupProperties: { org: { tier: 'enterprise' } }
   *     flagKeys: ['flag1', 'flag2']
   *   }
   * })
   * ```
   *
   * {@label Capture}
   *
   * @param props - The event properties
   * @returns Promise that resolves when the event is captured
   */
  async captureImmediate(props: EventMessage): Promise<void> {
    this._warnIfInvalidCapture(
      props,
      'Called captureImmediate() with a string as the first argument when an object was expected.',
      "Capturing a `$exception` event via `posthog.captureImmediate('$exception')` is unreliable because it does not attach required metadata. Use `posthog.captureExceptionImmediate(error)` instead, which attaches this metadata by default."
    )
    return this._capturePreparedEvent(props, true)
  }

  /**
   * Capture an AI event on the dedicated AI capture endpoint.
   *
   * Beta: the signature is stable; operational limits (per-event size cap,
   * batching, endpoint) may change without notice. Delivery is async, and no
   * redaction or truncation is applied to the payload.
   *
   * {@label Capture}
   *
   * @param props - The event properties
   * @returns The event UUID, or `undefined` when the client is disabled
   */
  captureAi(props: EventMessage): string | undefined {
    if (this.disabled) {
      return undefined
    }
    const uuid = this._canonicalEventUuid(props.uuid) ?? uuidv7()
    void this._sendPreparedAiEvent({ ...props, uuid }, false)
    return uuid
  }

  /**
   * Capture an AI event on the dedicated AI capture endpoint, resolving after
   * the send completes. Use in short-lived processes (serverless) where the
   * runtime may freeze before a background flush runs.
   *
   * {@label Capture}
   *
   * @param props - The event properties
   * @returns The event UUID, or `undefined` when the client is disabled
   */
  async captureAiImmediate(props: EventMessage): Promise<string | undefined> {
    if (this.disabled) {
      return undefined
    }
    const uuid = this._canonicalEventUuid(props.uuid) ?? uuidv7()
    await this._sendPreparedAiEvent({ ...props, uuid }, true)
    return uuid
  }

  private _sendPreparedAiEvent(props: EventMessage, immediate: boolean): Promise<void> {
    if (typeof props?.event === 'string' && !props.event.startsWith('$ai_')) {
      this._logger.debug(`captureAi called with non-AI event ${props.event}; routing it to the AI endpoint anyway.`)
    }
    return this._sendPreparedEvent('capture', props, immediate, undefined, AI_CAPTURE_ROUTE)
  }

  /**
   * Identify a user and set their properties.
   *
   * @example
   * ```ts
   * // Basic identify with properties
   * client.identify({
   *   distinctId: 'user_123',
   *   properties: {
   *     name: 'John Doe',
   *     email: 'john@example.com',
   *     plan: 'premium'
   *   }
   * })
   * ```
   *
   * @example
   * ```ts
   * // Using $set and $set_once
   * client.identify({
   *   distinctId: 'user_123',
   *   properties: {
   *     $set: { name: 'John Doe', email: 'john@example.com' },
   *     $set_once: { first_login: new Date().toISOString() }
   *     $anon_distinct_id: 'anonymous_user_456'
   *   }
   * })
   * ```
   *
   * {@label Identification}
   *
   * @param data - The identify data containing distinctId and properties
   */
  identify({ distinctId, properties = {}, disableGeoip, options }: IdentifyMessage): void {
    const eventProperties = identifyEventProperties(properties)
    this._sendPreparedEvent(
      'identify',
      { distinctId, event: '$identify', properties: eventProperties, disableGeoip, options },
      false
    )
  }

  /**
   * Identify a user and set their properties immediately (synchronously).
   *
   * @example
   * ```ts
   * // Basic immediate identify
   * await client.identifyImmediate({
   *   distinctId: 'user_123',
   *   properties: {
   *     name: 'John Doe',
   *     email: 'john@example.com'
   *   }
   * })
   * ```
   *
   * {@label Identification}
   *
   * @param data - The identify data containing distinctId and properties
   * @returns Promise that resolves when the identify is processed
   */
  async identifyImmediate({ distinctId, properties = {}, disableGeoip, options }: IdentifyMessage): Promise<void> {
    const eventProperties = identifyEventProperties(properties)
    await this._sendPreparedEvent(
      'identify',
      { distinctId, event: '$identify', properties: eventProperties, disableGeoip, options },
      true
    )
  }

  /**
   * Set properties on a person profile.
   *
   * @example
   * ```ts
   * client.setPersonProperties({
   *   distinctId: 'user_123',
   *   properties: { plan: 'premium' },
   *   propertiesOnce: { first_seen: '2026-06-15' }
   * })
   * ```
   *
   * {@label Identification}
   *
   * @param data - The data containing distinctId and properties to set
   */
  setPersonProperties({ distinctId, properties = {}, propertiesOnce = {}, options }: SetPersonPropertiesMessage): void {
    if (Object.keys(properties).length === 0 && Object.keys(propertiesOnce).length === 0) {
      return
    }

    const eventProperties: Record<string, any> = {}
    if (Object.keys(properties).length > 0) {
      eventProperties.$set = properties
    }
    if (Object.keys(propertiesOnce).length > 0) {
      eventProperties.$set_once = propertiesOnce
    }

    this.capture({
      distinctId,
      event: '$set',
      properties: eventProperties,
      options,
    })
  }

  /**
   * Remove properties from a person profile.
   *
   * @example
   * ```ts
   * client.unsetPersonProperties({
   *   distinctId: 'user_123',
   *   properties: ['plan', 'email']
   * })
   * ```
   *
   * {@label Identification}
   *
   * @param data - The data containing distinctId and property names to unset
   */
  unsetPersonProperties({ distinctId, properties, options }: UnsetPersonPropertiesMessage): void {
    const propertyNames = normalizeUnsetPersonProperties(properties)
    if (propertyNames.length === 0) {
      return
    }

    this.capture({ distinctId, event: '$set', properties: { $unset: propertyNames }, options })
  }

  /**
   * Create an alias to link two distinct IDs together.
   *
   * @example
   * ```ts
   * // Link an anonymous user to an identified user
   * client.alias({
   *   distinctId: 'anonymous_123',
   *   alias: 'user_456'
   * })
   * ```
   *
   * {@label Identification}
   *
   * @param data - The alias data containing distinctId and alias
   */
  alias(data: { distinctId: string; alias: string; disableGeoip?: boolean; options?: Record<string, JsonType> }): void {
    this._sendPreparedEvent(
      'alias',
      {
        distinctId: data.distinctId,
        event: '$create_alias',
        properties: { alias: data.alias },
        disableGeoip: data.disableGeoip,
        options: data.options,
      },
      false,
      ALIAS_PREPARE_OPTIONS
    )
  }

  /**
   * Create an alias to link two distinct IDs together immediately (synchronously).
   *
   * @example
   * ```ts
   * // Link an anonymous user to an identified user immediately
   * await client.aliasImmediate({
   *   distinctId: 'anonymous_123',
   *   alias: 'user_456'
   * })
   * ```
   *
   * {@label Identification}
   *
   * @param data - The alias data containing distinctId and alias
   * @returns Promise that resolves when the alias is processed
   */
  async aliasImmediate(data: {
    distinctId: string
    alias: string
    disableGeoip?: boolean
    options?: Record<string, JsonType>
  }): Promise<void> {
    await this._sendPreparedEvent(
      'alias',
      {
        distinctId: data.distinctId,
        event: '$create_alias',
        properties: { alias: data.alias },
        disableGeoip: data.disableGeoip,
        options: data.options,
      },
      true,
      ALIAS_PREPARE_OPTIONS
    )
  }

  /**
   * Check if local evaluation of feature flags is ready.
   *
   * @example
   * ```ts
   * // Check if ready
   * if (client.isLocalEvaluationReady()) {
   *   // Local evaluation is ready, can evaluate flags locally
   *   const flag = await client.getFeatureFlag('flag-key', 'user_123')
   * } else {
   *   // Local evaluation not ready, will use remote evaluation
   *   const flag = await client.getFeatureFlag('flag-key', 'user_123')
   * }
   * ```
   *
   * {@label Feature flags}
   *
   * @returns true if local evaluation is ready, false otherwise
   */
  isLocalEvaluationReady(): boolean {
    return this.featureFlagsPoller?.isLocalEvaluationReady() ?? false
  }

  /**
   * Get where a locally loaded feature flag is meant to be evaluated.
   *
   * @remarks
   * Read from the definitions local evaluation already holds, so no request is made. A
   * definition that carries no runtime reports `all`, the default PostHog applies.
   *
   * @example
   * ```ts
   * const runtime = client.getFeatureFlagEvaluationRuntime('my-flag')
   * // Returns: 'client'
   * ```
   *
   * {@label Feature flags}
   *
   * @param key - The feature flag key
   * @returns The flag's evaluation runtime, or undefined when local evaluation has not loaded a
   * definition for this key
   */
  getFeatureFlagEvaluationRuntime(key: string): FeatureFlagEvaluationRuntime | undefined {
    return this.featureFlagsPoller?.getEvaluationRuntimeForFlag(key)
  }

  /**
   * Get the keys of locally loaded flags that a runtime can evaluate.
   *
   * @remarks
   * A flag set to `all` suits either runtime, so it is returned for `client` and for `server`,
   * and asking for `all` returns every loaded flag. Use this to decide which flags to hand to a
   * browser when a backend serves flags to its own frontend.
   *
   * @example
   * ```ts
   * const clientKeys = client.getFeatureFlagKeysByEvaluationRuntime('client')
   * // Returns: ['web-banner', 'shared-copy']
   * ```
   *
   * {@label Feature flags}
   *
   * @param evaluationRuntime - The runtime to match
   * @returns The matching flag keys, in the order local evaluation loaded them. Empty when no
   * definitions are loaded
   */
  getFeatureFlagKeysByEvaluationRuntime(evaluationRuntime: FeatureFlagEvaluationRuntime): string[] {
    return this.featureFlagsPoller?.getFlagKeysByEvaluationRuntime(evaluationRuntime) ?? []
  }

  /**
   * Wait for local evaluation of feature flags to be ready.
   *
   * @example
   * ```ts
   * // Wait for local evaluation
   * const isReady = await client.waitForLocalEvaluationReady()
   * if (isReady) {
   *   console.log('Local evaluation is ready')
   * } else {
   *   console.log('Local evaluation timed out')
   * }
   * ```
   *
   * @example
   * ```ts
   * // Wait with custom timeout
   * const isReady = await client.waitForLocalEvaluationReady(10000) // 10 seconds
   * ```
   *
   * {@label Feature flags}
   *
   * @param timeoutMs - Timeout in milliseconds (default: 30000)
   * @returns Promise that resolves to true if ready, false if timed out
   */
  async waitForLocalEvaluationReady(timeoutMs: number = THIRTY_SECONDS): Promise<boolean> {
    if (this.isLocalEvaluationReady()) {
      return true
    }

    if (this.featureFlagsPoller === undefined) {
      return false
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup()
        resolve(false)
      }, timeoutMs)

      const cleanup = this._events.on('localEvaluationFlagsLoaded', (count: number) => {
        clearTimeout(timeout)
        cleanup()
        resolve(count > 0)
      })
    })
  }

  private _resolveDistinctId<T>(
    distinctIdOrOptions: string | T | undefined,
    options: T | undefined
  ): { distinctId: string | undefined; options: T | undefined } {
    if (typeof distinctIdOrOptions === 'string') {
      return { distinctId: distinctIdOrOptions, options }
    }
    return { distinctId: this.context?.get()?.distinctId, options: distinctIdOrOptions }
  }

  /**
   * Internal method that handles feature flag evaluation with full details.
   * Used by getFeatureFlag, getFeatureFlagPayload, and getFeatureFlagResult.
   *
   * @param key - The feature flag key
   * @param distinctId - The user's distinct ID
   * @param options - Evaluation options (includes sendFeatureFlagEvents, defaults to true)
   * @param matchValue - Optional match value for payload lookup (used by getFeatureFlagPayload)
   * @returns Promise that resolves to the flag result, or undefined when no evaluation is available
   */
  private async _getFeatureFlagResult(
    key: string,
    distinctId: string,
    options: {
      groups?: Record<string, string>
      personProperties?: Properties
      groupProperties?: Record<string, Properties>
      onlyEvaluateLocally?: boolean
      sendFeatureFlagEvents?: boolean
      disableGeoip?: boolean
    } = {},
    matchValue?: FeatureFlagValue
  ): Promise<FeatureFlagResult | undefined> {
    if (this.disabled) {
      this._logger.warn('The client is disabled')
      return undefined
    }

    const sendFeatureFlagEvents = options.sendFeatureFlagEvents ?? true
    // Check for overrides first - they take precedence over all evaluation
    if (this._flagOverrides !== undefined && key in this._flagOverrides) {
      const overrideValue = this._flagOverrides[key]
      // undefined override simulates "flag doesn't exist"
      if (overrideValue === undefined) {
        return undefined
      }
      const overridePayload = this._payloadOverrides?.[key]
      return {
        key,
        enabled: overrideValue !== false,
        variant: typeof overrideValue === 'string' ? overrideValue : undefined,
        payload: overridePayload,
      }
    }

    const { groups, disableGeoip } = options
    let { onlyEvaluateLocally, personProperties, groupProperties } = options

    const adjustedProperties = this.addLocalPersonAndGroupProperties(
      distinctId,
      groups,
      personProperties,
      groupProperties
    )

    personProperties = adjustedProperties.allPersonProperties
    groupProperties = adjustedProperties.allGroupProperties
    const evaluationContext = this.createFeatureFlagEvaluationContext(
      distinctId,
      groups,
      this.personPropertiesForLocalEvaluation(distinctId, personProperties),
      groupProperties
    )

    // set defaults
    if (onlyEvaluateLocally == undefined) {
      onlyEvaluateLocally = this.options.strictLocalEvaluation ?? false
    }

    let result: FeatureFlagResult | undefined = undefined
    let flagWasLocallyEvaluated = false
    let requestId: string | undefined = undefined
    let evaluatedAt: number | undefined = undefined
    let featureFlagError: FeatureFlagErrorType | undefined = undefined
    // Track metadata for feature-flag-called events.
    let flagId: number | undefined = undefined
    let flagVersion: number | undefined = undefined
    let flagReason: string | undefined = undefined
    let flagHasExperiment: boolean | undefined = undefined

    // Try local evaluation first
    const localEvaluationEnabled = this.featureFlagsPoller !== undefined
    if (localEvaluationEnabled) {
      await this.featureFlagsPoller?.loadFeatureFlags()

      const flag = this.featureFlagsPoller?.featureFlagsByKey[key]
      if (flag) {
        try {
          const localResult = await this.featureFlagsPoller?.computeFlagAndPayloadLocally(flag, evaluationContext, {
            matchValue,
          })
          if (localResult) {
            flagWasLocallyEvaluated = true
            const value = localResult.value
            flagId = flag.id
            flagReason = 'Evaluated locally'
            flagHasExperiment = flag.has_experiment
            result = {
              key,
              enabled: value !== false,
              variant: typeof value === 'string' ? value : undefined,
              payload: localResult.payload ?? undefined,
              reason: flagReason,
              reasonCode: flag.active === false ? 'flag_disabled' : undefined,
            }
          }
        } catch (e) {
          if (e instanceof RequiresServerEvaluation || e instanceof InconclusiveMatchError) {
            // Fall through to server evaluation
            this._logger?.info(`${e.name} when computing flag locally: ${key}: ${e.message}`)
          } else {
            throw e
          }
        }
      }
    }

    // Fall back to remote evaluation if needed
    if (!flagWasLocallyEvaluated && !onlyEvaluateLocally) {
      const flagsResponse = await super.getFeatureFlagDetailsStateless(
        evaluationContext.distinctId,
        evaluationContext.groups,
        personProperties,
        groupProperties,
        disableGeoip,
        [key]
      )

      if (flagsResponse === undefined) {
        featureFlagError = FeatureFlagError.UNKNOWN_ERROR
      } else {
        this._minimalFlagCalledEvents = flagsResponse.minimalFlagCalledEvents === true
        requestId = flagsResponse.requestId
        evaluatedAt = flagsResponse.evaluatedAt

        const errors: string[] = []

        if (flagsResponse.errorsWhileComputingFlags) {
          errors.push(FeatureFlagError.ERRORS_WHILE_COMPUTING)
        }

        if (flagsResponse.quotaLimited?.includes('feature_flags')) {
          errors.push(FeatureFlagError.QUOTA_LIMITED)
        }

        const flagDetail = flagsResponse.flags[key]

        if (flagDetail === undefined) {
          errors.push(FeatureFlagError.FLAG_MISSING)
        } else {
          // Extract metadata for event tracking
          flagId = flagDetail.metadata?.id
          flagVersion = flagDetail.metadata?.version
          flagReason = flagDetail.reason?.description ?? flagDetail.reason?.code
          flagHasExperiment = flagDetail.metadata?.has_experiment

          // Parse payload once from the API response
          let parsedPayload: JsonType | undefined = undefined
          if (flagDetail.metadata?.payload !== undefined) {
            try {
              parsedPayload = JSON.parse(flagDetail.metadata.payload)
            } catch {
              // If parsing fails, return the raw string (matches parsePayload behavior)
              parsedPayload = flagDetail.metadata.payload
            }
          }

          result = {
            key,
            enabled: flagDetail.enabled,
            // The flags API serializes missing variants as null
            variant: flagDetail.variant ?? undefined,
            payload: parsedPayload,
            reason: flagReason,
            reasonCode: flagDetail.reason?.code,
          }
        }

        if (errors.length > 0) {
          featureFlagError = errors.join(',')
        }
      }
    }

    // Send feature flag event if configured
    if (sendFeatureFlagEvents) {
      const response = result === undefined ? undefined : result.enabled === false ? false : (result.variant ?? true)
      const properties: Record<string, any> = {
        $feature_flag: key,
        $feature_flag_response: response,
        $feature_flag_id: flagId,
        $feature_flag_version: flagVersion,
        $feature_flag_reason: flagReason,
        locally_evaluated: flagWasLocallyEvaluated,
        [`$feature/${key}`]: response,
        $feature_flag_request_id: requestId,
        $feature_flag_evaluated_at: flagWasLocallyEvaluated ? Date.now() : evaluatedAt,
      }

      if (flagHasExperiment !== undefined) {
        properties.$feature_flag_has_experiment = flagHasExperiment
      }

      if (flagWasLocallyEvaluated && this.featureFlagsPoller) {
        const flagDefinitionsLoadedAt = this.featureFlagsPoller.getFlagDefinitionsLoadedAt()
        if (flagDefinitionsLoadedAt !== undefined) {
          properties.$feature_flag_definitions_loaded_at = flagDefinitionsLoadedAt
        }
      }

      if (featureFlagError) {
        properties.$feature_flag_error = featureFlagError
      }

      this._captureFlagCalledEventIfNeeded({
        distinctId,
        key,
        response,
        groups,
        disableGeoip,
        properties,
      })
    }

    // Apply payload override if present (even when there's no flag override)
    // This ensures consistency with getFeatureFlagPayload behavior
    if (result !== undefined && this._payloadOverrides !== undefined && key in this._payloadOverrides) {
      result = {
        ...result,
        payload: this._payloadOverrides[key],
      }
    }

    return result
  }

  /**
   * Get the value of a feature flag for a specific user.
   *
   * A boolean `false` is a conclusive off evaluation. `undefined` means no result is available,
   * for example because the key was not returned or local-only evaluation was inconclusive.
   * Local evaluation resolves cached inactive definitions to `false`; remote evaluation omits
   * globally inactive flags, so the result depends on which evaluation path is available.
   *
   * @example
   * ```ts
   * // Basic feature flag check
   * const flagValue = await client.getFeatureFlag('new-feature', 'user_123')
   * if (flagValue === 'variant-a') {
   *   // Show variant A
   * } else if (flagValue === 'variant-b') {
   *   // Show variant B
   * } else {
   *   // Flag evaluated off, or no value was returned
   * }
   * ```
   *
   * @example
   * ```ts
   * // With groups and properties
   * const flagValue = await client.getFeatureFlag('org-feature', 'user_123', {
   *   groups: { organization: 'acme-corp' },
   *   personProperties: { plan: 'enterprise' },
   *   groupProperties: { organization: { tier: 'premium' } }
   * })
   * ```
   *
   * @example
   * ```ts
   * // Only evaluate locally
   * const flagValue = await client.getFeatureFlag('local-flag', 'user_123', {
   *   onlyEvaluateLocally: true
   * })
   * ```
   *
   * {@label Feature flags}
   *
   * @deprecated Use {@link evaluateFlags} and call `flags.getFlag(key)` on the returned snapshot.
   *   This consolidates flag evaluation into a single `/flags` request per incoming request and
   *   avoids drift between the values your code branched on and the values attached to events.
   *   Will be removed in the next major version.
   *
   * @param key - The feature flag key
   * @param distinctId - The user's distinct ID
   * @param options - Optional configuration for flag evaluation
   * @returns Promise that resolves to the flag value, or undefined when no evaluation is available
   */
  async getFeatureFlag(
    key: string,
    distinctId: string,
    options?: {
      groups?: Record<string, string>
      personProperties?: Properties
      groupProperties?: Record<string, Properties>
      onlyEvaluateLocally?: boolean
      sendFeatureFlagEvents?: boolean
      disableGeoip?: boolean
    }
  ): Promise<FeatureFlagValue | undefined> {
    emitDeprecationWarningOnce(
      'getFeatureFlag',
      '`getFeatureFlag` is deprecated and will be removed in a future major version. ' +
        'Use `posthog.evaluateFlags(distinctId, ...)` and call `flags.getFlag(key)` instead — ' +
        'this consolidates flag evaluation into a single `/flags` request per incoming request.'
    )
    const result = await this._getFeatureFlagResult(key, distinctId, {
      ...options,
      sendFeatureFlagEvents: options?.sendFeatureFlagEvents ?? this.options.sendFeatureFlagEvent ?? true,
    })
    if (result === undefined) {
      return undefined
    }
    if (result.enabled === false) {
      return false
    }
    return result.variant ?? true
  }

  /**
   * Get the payload for a feature flag.
   *
   * @example
   * ```ts
   * // Get payload for a feature flag
   * const payload = await client.getFeatureFlagPayload('flag-key', 'user_123')
   * if (payload) {
   *   console.log('Flag payload:', payload)
   * }
   * ```
   *
   * @example
   * ```ts
   * // Get payload with specific match value
   * const payload = await client.getFeatureFlagPayload('flag-key', 'user_123', 'variant-a')
   * ```
   *
   * @example
   * ```ts
   * // With groups and properties
   * const payload = await client.getFeatureFlagPayload('org-flag', 'user_123', undefined, {
   *   groups: { organization: 'acme-corp' },
   *   personProperties: { plan: 'enterprise' }
   * })
   * ```
   *
   * {@label Feature flags}
   *
   * @deprecated Use {@link evaluateFlags} and call `flags.getFlagPayload(key)` on the returned
   *   snapshot. This consolidates flag evaluation into a single `/flags` request per incoming
   *   request. Will be removed in the next major version.
   *
   * @param key - The feature flag key
   * @param distinctId - The user's distinct ID
   * @param matchValue - Optional match value to get payload for
   * @param options - Optional configuration for flag evaluation
   * @returns Promise that resolves to the flag payload or undefined
   */
  async getFeatureFlagPayload(
    key: string,
    distinctId: string,
    matchValue?: FeatureFlagValue,
    options?: {
      groups?: Record<string, string>
      personProperties?: Properties
      groupProperties?: Record<string, Properties>
      onlyEvaluateLocally?: boolean
      /** @deprecated THIS OPTION HAS NO EFFECT, kept here for backwards compatibility reasons. */
      sendFeatureFlagEvents?: boolean
      disableGeoip?: boolean
    }
  ): Promise<JsonType | undefined> {
    emitDeprecationWarningOnce(
      'getFeatureFlagPayload',
      '`getFeatureFlagPayload` is deprecated and will be removed in a future major version. ' +
        'Use `posthog.evaluateFlags(distinctId, ...)` and call `flags.getFlagPayload(key)` instead — ' +
        'this consolidates flag evaluation into a single `/flags` request per incoming request.'
    )
    // Check for payload overrides first - they take precedence over all evaluation
    // This is checked independently from flag overrides
    if (this._payloadOverrides !== undefined && key in this._payloadOverrides) {
      return this._payloadOverrides[key]
    }

    // sendFeatureFlagEvents is intentionally ignored for payload-only calls.
    // getFeatureFlagPayload never sends $feature_flag_called events, matching pre-refactoring behavior.
    // The option is kept in the signature for backwards compatibility (marked @deprecated above).
    const result = await this._getFeatureFlagResult(
      key,
      distinctId,
      { ...options, sendFeatureFlagEvents: false },
      matchValue
    )

    // Return undefined when API fails or flag not found
    if (result === undefined) {
      return undefined
    }

    // Return payload if available, null if flag exists but no payload
    return result.payload ?? null
  }

  /**
   * Get the result of evaluating a feature flag, including its value and payload.
   * This is more efficient than calling getFeatureFlag and getFeatureFlagPayload separately when you need both.
   * A result with `enabled: false` is a conclusive off evaluation; `undefined` means no evaluation
   * is available. Local evaluation resolves cached inactive definitions to `enabled: false`, while
   * remote evaluation omits globally inactive flags.
   *
   * @example
   * ```ts
   * // Get flag result
   * const result = await client.getFeatureFlagResult('my-flag', 'user_123')
   * if (result) {
   *   console.log('Flag enabled:', result.enabled)
   *   console.log('Variant:', result.variant)
   *   console.log('Payload:', result.payload)
   * }
   * ```
   *
   * @example
   * ```ts
   * // With groups and properties
   * const result = await client.getFeatureFlagResult('org-feature', 'user_123', {
   *   groups: { organization: 'acme-corp' },
   *   personProperties: { plan: 'enterprise' }
   * })
   * ```
   *
   * {@label Feature flags}
   *
   * @param key - The feature flag key
   * @param distinctId - The user's distinct ID
   * @param options - Optional configuration for flag evaluation
   * @returns Promise that resolves to the flag result or undefined
   */
  async getFeatureFlagResult(key: string, options?: FlagEvaluationOptions): Promise<FeatureFlagResult | undefined>
  async getFeatureFlagResult(
    key: string,
    distinctId: string,
    options?: FlagEvaluationOptions
  ): Promise<FeatureFlagResult | undefined>
  async getFeatureFlagResult(
    key: string,
    distinctIdOrOptions?: string | FlagEvaluationOptions,
    options?: FlagEvaluationOptions
  ): Promise<FeatureFlagResult | undefined> {
    const { distinctId: resolvedDistinctId, options: resolvedOptions } = this._resolveDistinctId(
      distinctIdOrOptions,
      options
    )

    if (!resolvedDistinctId) {
      this._logger.warn('[PostHog] distinctId is required — pass it explicitly or use withContext()')
      return undefined
    }

    return this._getFeatureFlagResult(key, resolvedDistinctId, {
      ...resolvedOptions,
      sendFeatureFlagEvents: resolvedOptions?.sendFeatureFlagEvents ?? this.options.sendFeatureFlagEvent ?? true,
    })
  }

  /**
   * Get the remote config payload for a feature flag.
   *
   * @example
   * ```ts
   * // Get remote config payload
   * const payload = await client.getRemoteConfigPayload('flag-key')
   * if (payload) {
   *   console.log('Remote config payload:', payload)
   * }
   * ```
   *
   * {@label Feature flags}
   *
   * @param flagKey - The feature flag key
   * @returns Promise that resolves to the remote config payload or undefined
   * @throws Error if personal API key is not provided
   */
  async getRemoteConfigPayload(flagKey: string): Promise<JsonType | undefined> {
    if (this.disabled) {
      this._logger.warn('The client is disabled')
      return undefined
    }

    if (!this.options.personalApiKey) {
      throw new Error('Personal API key is required for remote config payload decryption')
    }

    const response = await this._requestRemoteConfigPayload(flagKey)
    if (!response) {
      return undefined
    }

    const parsed = await response.json()
    // The payload from the endpoint is stored as a JSON encoded string. So when we return
    // it, it's effectively double encoded. As far as we know, we should never get single-encoded
    // JSON, but we'll be defensive here just in case.
    if (typeof parsed === 'string') {
      try {
        // If the parsed value is a string, try parsing it again to handle double-encoded JSON
        return JSON.parse(parsed)
      } catch (e) {
        // If second parse fails, return the string as is
        return parsed
      }
    }
    return parsed
  }

  /**
   * Check if a feature flag is enabled for a specific user.
   *
   * @example
   * ```ts
   * // Basic feature flag check
   * const isEnabled = await client.isFeatureEnabled('new-feature', 'user_123')
   * if (isEnabled) {
   *   // Feature is enabled
   *   console.log('New feature is active')
   * } else {
   *   // Flag evaluated off, or no value was returned
   *   console.log('New feature is not active')
   * }
   * ```
   *
   * @example
   * ```ts
   * // With groups and properties
   * const isEnabled = await client.isFeatureEnabled('org-feature', 'user_123', {
   *   groups: { organization: 'acme-corp' },
   *   personProperties: { plan: 'enterprise' }
   * })
   * ```
   *
   * {@label Feature flags}
   *
   * @deprecated Use {@link evaluateFlags} and call `flags.isEnabled(key)` on the returned snapshot.
   *   This consolidates flag evaluation into a single `/flags` request per incoming request.
   *   Will be removed in the next major version.
   *
   * @param key - The feature flag key
   * @param distinctId - The user's distinct ID
   * @param options - Optional configuration for flag evaluation
   * @returns Promise that resolves to true if the flag evaluates on, false if it conclusively evaluates off, or undefined when no evaluation is available
   */
  async isFeatureEnabled(
    key: string,
    distinctId: string,
    options?: {
      groups?: Record<string, string>
      personProperties?: Properties
      groupProperties?: Record<string, Properties>
      onlyEvaluateLocally?: boolean
      sendFeatureFlagEvents?: boolean
      disableGeoip?: boolean
    }
  ): Promise<boolean | undefined> {
    emitDeprecationWarningOnce(
      'isFeatureEnabled',
      '`isFeatureEnabled` is deprecated and will be removed in a future major version. ' +
        'Use `posthog.evaluateFlags(distinctId, ...)` and call `flags.isEnabled(key)` instead — ' +
        'this consolidates flag evaluation into a single `/flags` request per incoming request.'
    )
    // Bypass the public `getFeatureFlag` so the user only sees one deprecation warning per call.
    const result = await this._getFeatureFlagResult(key, distinctId, {
      ...options,
      sendFeatureFlagEvents: options?.sendFeatureFlagEvents ?? this.options.sendFeatureFlagEvent ?? true,
    })
    if (result === undefined) {
      return undefined
    }
    if (result.enabled === false) {
      return false
    }
    const feat: FeatureFlagValue = result.variant ?? true
    return !!feat || false
  }

  /**
   * Get all feature flag values for a specific user.
   *
   * @example
   * ```ts
   * // Get all flags for a user
   * const allFlags = await client.getAllFlags('user_123')
   * console.log('User flags:', allFlags)
   * // Output: { 'flag-1': 'variant-a', 'flag-2': false, 'flag-3': 'variant-b' }
   * ```
   *
   * @example
   * ```ts
   * // With specific flag keys
   * const specificFlags = await client.getAllFlags('user_123', {
   *   flagKeys: ['flag-1', 'flag-2']
   * })
   * ```
   *
   * @example
   * ```ts
   * // With groups and properties
   * const orgFlags = await client.getAllFlags('user_123', {
   *   groups: { organization: 'acme-corp' },
   *   personProperties: { plan: 'enterprise' }
   * })
   * ```
   *
   * {@label Feature flags}
   *
   * @param distinctId - The user's distinct ID
   * @param options - Optional configuration for flag evaluation
   * @returns Promise that resolves to a record of flag keys and their values
   */
  async getAllFlags(options?: AllFlagsOptions): Promise<Record<string, FeatureFlagValue>>
  async getAllFlags(distinctId: string, options?: AllFlagsOptions): Promise<Record<string, FeatureFlagValue>>
  async getAllFlags(
    distinctIdOrOptions?: string | AllFlagsOptions,
    options?: AllFlagsOptions
  ): Promise<Record<string, FeatureFlagValue>> {
    const { distinctId: resolvedDistinctId, options: resolvedOptions } = this._resolveDistinctId(
      distinctIdOrOptions,
      options
    )
    if (!resolvedDistinctId) {
      this._logger.warn(
        '[PostHog] distinctId is required to get feature flags — pass it explicitly or use withContext()'
      )
      return {}
    }

    const response = await this.getAllFlagsAndPayloads(resolvedDistinctId, resolvedOptions)
    return response.featureFlags || {}
  }

  /**
   * Get all feature flag values and payloads for a specific user.
   *
   * @example
   * ```ts
   * // Get all flags and payloads for a user
   * const result = await client.getAllFlagsAndPayloads('user_123')
   * console.log('Flags:', result.featureFlags)
   * console.log('Payloads:', result.featureFlagPayloads)
   * ```
   *
   * @example
   * ```ts
   * // With specific flag keys
   * const result = await client.getAllFlagsAndPayloads('user_123', {
   *   flagKeys: ['flag-1', 'flag-2']
   * })
   * ```
   *
   * @example
   * ```ts
   * // Only evaluate locally
   * const result = await client.getAllFlagsAndPayloads('user_123', {
   *   onlyEvaluateLocally: true
   * })
   * ```
   *
   * {@label Feature flags}
   *
   * @param distinctId - The user's distinct ID
   * @param options - Optional configuration for flag evaluation
   * @returns Promise that resolves to flags and payloads
   */
  async getAllFlagsAndPayloads(options?: AllFlagsOptions): Promise<PostHogFlagsAndPayloadsResponse>
  async getAllFlagsAndPayloads(distinctId: string, options?: AllFlagsOptions): Promise<PostHogFlagsAndPayloadsResponse>
  async getAllFlagsAndPayloads(
    distinctIdOrOptions?: string | AllFlagsOptions,
    options?: AllFlagsOptions
  ): Promise<PostHogFlagsAndPayloadsResponse> {
    const { distinctId: resolvedDistinctId, options: resolvedOptions } = this._resolveDistinctId(
      distinctIdOrOptions,
      options
    )
    if (!resolvedDistinctId) {
      this._logger.warn(
        '[PostHog] distinctId is required to get feature flags and payloads — pass it explicitly or use withContext()'
      )
      return { featureFlags: {}, featureFlagPayloads: {} }
    }

    if (this.disabled) {
      this._logger.warn('The client is disabled')
      return { featureFlags: {}, featureFlagPayloads: {} }
    }

    const { groups, disableGeoip, flagKeys } = resolvedOptions || {}
    let { onlyEvaluateLocally, personProperties, groupProperties } = resolvedOptions || {}

    const adjustedProperties = this.addLocalPersonAndGroupProperties(
      resolvedDistinctId,
      groups,
      personProperties,
      groupProperties
    )

    personProperties = adjustedProperties.allPersonProperties
    groupProperties = adjustedProperties.allGroupProperties
    const evaluationContext = this.createFeatureFlagEvaluationContext(
      resolvedDistinctId,
      groups,
      this.personPropertiesForLocalEvaluation(resolvedDistinctId, personProperties),
      groupProperties
    )

    // set defaults
    if (onlyEvaluateLocally == undefined) {
      onlyEvaluateLocally = this.options.strictLocalEvaluation ?? false
    }

    const localEvaluationResult = await this.featureFlagsPoller?.getAllFlagsAndPayloads(evaluationContext, flagKeys)

    let featureFlags = {}
    let featureFlagPayloads = {}
    let fallbackToFlags = true
    if (localEvaluationResult) {
      featureFlags = localEvaluationResult.response
      featureFlagPayloads = localEvaluationResult.payloads
      fallbackToFlags = localEvaluationResult.fallbackToFlags
    }

    if (fallbackToFlags && !onlyEvaluateLocally) {
      const remoteEvaluationResult = await super.getFeatureFlagsAndPayloadsStateless(
        evaluationContext.distinctId,
        evaluationContext.groups,
        personProperties,
        groupProperties,
        disableGeoip,
        flagKeys
      )
      featureFlags = {
        ...featureFlags,
        ...(remoteEvaluationResult.flags || {}),
      }
      featureFlagPayloads = {
        ...featureFlagPayloads,
        ...(remoteEvaluationResult.payloads || {}),
      }
    }

    // Apply overrides last - they take precedence over all evaluation
    if (this._flagOverrides !== undefined) {
      featureFlags = {
        ...featureFlags,
        ...this._flagOverrides,
      }
    }
    if (this._payloadOverrides !== undefined) {
      featureFlagPayloads = {
        ...featureFlagPayloads,
        ...this._payloadOverrides,
      }
    }

    return { featureFlags, featureFlagPayloads }
  }

  /**
   * Evaluate all feature flags for a user in a single call and return a
   * {@link FeatureFlagEvaluations} snapshot. Branch on `.isEnabled()` / `.getFlag()`,
   * then pass the same snapshot to `capture()` via the `flags` option so the
   * captured event carries the exact flag values the code branched on.
   *
   * Prefer this over repeated `isFeatureEnabled()` / `getFeatureFlag()` calls and
   * over `capture({ sendFeatureFlags: true })` — it consolidates flag evaluation
   * into a single `/flags` request per incoming request.
   *
   * **Local evaluation is transparent.** When the poller can resolve a flag from
   * cached definitions, no network call is made and the snapshot's `$feature_flag_called`
   * events are tagged `locally_evaluated: true`. A requested key missing from local
   * definitions is included in a `/flags` fallback unless `onlyEvaluateLocally` is true.
   * Locally resolved values remain authoritative when remote results are merged. In particular,
   * a cached inactive definition is a conclusive `false` result locally, while remote evaluation
   * omits globally inactive flags and therefore leaves those keys absent.
   *
   * **Trim the request.** Pass `flagKeys` to scope local evaluation, the underlying
   * `/flags` request, and the returned snapshot to a subset of flags. Remote evaluation
   * responses are not cached, so a key missing both locally and remotely costs one
   * `/flags` request per `evaluateFlags()` call.
   *
   * **Trim the event payload.** Use `flags.only([...])` or `flags.onlyAccessed()`
   * to filter which flags get attached to a captured event without re-fetching.
   *
   * @example
   * Basic usage:
   * ```ts
   * const flags = await client.evaluateFlags('user_123', {
   *   personProperties: { plan: 'enterprise' },
   * })
   * if (flags.isEnabled('new-dashboard')) {
   *   renderNewDashboard()
   * }
   * client.capture({ distinctId: 'user_123', event: 'page_viewed', flags })
   * ```
   *
   * @example
   * Scope the `/flags` request to specific keys:
   * ```ts
   * const flags = await client.evaluateFlags('user_123', {
   *   flagKeys: ['new-dashboard', 'checkout-flow'],
   *   personProperties: { plan: 'enterprise' },
   * })
   * ```
   *
   * @example
   * Attach only the flags the developer actually checked:
   * ```ts
   * const flags = await client.evaluateFlags('user_123')
   * if (flags.isEnabled('new-dashboard')) { ... }
   * client.capture({ distinctId: 'user_123', event: 'page_viewed', flags: flags.onlyAccessed() })
   * ```
   *
   * @example
   * Use `withContext()` to avoid repeating the distinctId:
   * ```ts
   * await client.withContext({ distinctId: 'user_123' }, async () => {
   *   const flags = await client.evaluateFlags()
   *   if (flags.isEnabled('new-dashboard')) { ... }
   *   client.capture({ event: 'page_viewed', flags })
   * })
   * ```
   *
   * {@label Feature flags}
   *
   * @param distinctIdOrOptions - The user's distinct ID, or options when the distinctId comes from `withContext()`
   * @param options - Optional configuration for flag evaluation. Supports the same fields as `getAllFlags()`. `flagKeys` scopes local evaluation, the `/flags` request, and the returned snapshot. `onlyEvaluateLocally` prevents fallback and leaves unresolved keys absent; the snapshot's `unresolvedFlags` lists them with a reason.
   * @returns Promise that resolves to a `FeatureFlagEvaluations` snapshot
   */
  async evaluateFlags(options?: AllFlagsOptions): Promise<FeatureFlagEvaluations>
  async evaluateFlags(distinctId: string, options?: AllFlagsOptions): Promise<FeatureFlagEvaluations>
  async evaluateFlags(
    distinctIdOrOptions?: string | AllFlagsOptions,
    options?: AllFlagsOptions
  ): Promise<FeatureFlagEvaluations> {
    const { distinctId: resolvedDistinctId, options: resolvedOptions } = this._resolveDistinctId(
      distinctIdOrOptions,
      options
    )

    if (!resolvedDistinctId) {
      this._logger.warn(
        '[PostHog] distinctId is required to evaluate feature flags — pass it explicitly or use withContext()'
      )
      return new FeatureFlagEvaluations({
        host: this._getFeatureFlagEvaluationsHost(),
        distinctId: '',
        flags: {},
      })
    }

    if (this.disabled) {
      this._logger.warn('The client is disabled')
      return new FeatureFlagEvaluations({
        host: this._getFeatureFlagEvaluationsHost(),
        distinctId: resolvedDistinctId,
        flags: {},
      })
    }

    const { groups, disableGeoip } = resolvedOptions || {}
    const flagKeys = resolvedOptions?.flagKeys ?? undefined

    if (flagKeys?.length === 0) {
      return new FeatureFlagEvaluations({
        host: this._getFeatureFlagEvaluationsHost(),
        distinctId: resolvedDistinctId,
        groups,
        disableGeoip,
        flags: {},
      })
    }

    let { onlyEvaluateLocally, personProperties, groupProperties } = resolvedOptions || {}

    const adjustedProperties = this.addLocalPersonAndGroupProperties(
      resolvedDistinctId,
      groups,
      personProperties,
      groupProperties
    )
    personProperties = adjustedProperties.allPersonProperties
    groupProperties = adjustedProperties.allGroupProperties
    const evaluationContext = this.createFeatureFlagEvaluationContext(
      resolvedDistinctId,
      groups,
      this.personPropertiesForLocalEvaluation(resolvedDistinctId, personProperties),
      groupProperties
    )

    if (onlyEvaluateLocally == undefined) {
      onlyEvaluateLocally = this.options.strictLocalEvaluation ?? false
    }

    const requestedFlagKeys = flagKeys ? new Set(flagKeys) : undefined
    const records: Record<string, EvaluatedFlagRecord> = {}
    let requestId: string | undefined = undefined
    let evaluatedAt: number | undefined = undefined
    let errorsWhileComputing = false
    let quotaLimited = false

    // Try local evaluation first and decorate each flag with metadata from the poller.
    // `flagKeys` scopes the evaluation to a subset of definitions when provided.
    const localResult = await this.featureFlagsPoller?.getAllFlagsAndPayloads(evaluationContext, flagKeys)
    const locallyEvaluatedKeys = new Set<string>()
    if (localResult) {
      for (const [key, value] of Object.entries(localResult.response)) {
        const flagDef = this.featureFlagsPoller?.featureFlagsByKey[key]
        records[key] = {
          key,
          enabled: value !== false,
          variant: typeof value === 'string' ? value : undefined,
          payload: localResult.payloads[key],
          id: flagDef?.id,
          // The local-evaluation flag definition (`PostHogFeatureFlag`) does not carry a
          // version field; only the remote `/flags` response does via `metadata.version`.
          version: undefined,
          reason: 'Evaluated locally',
          locallyEvaluated: true,
          hasExperiment: flagDef?.has_experiment,
        }
        locallyEvaluatedKeys.add(key)
      }
    }

    // Fall back to remote evaluation for any flags the poller couldn't resolve locally.
    // We use the detail-shaped endpoint so the resulting records carry id/version/reason
    // and fired $feature_flag_called events match what isFeatureEnabled()/getFeatureFlag() emit.
    const requestedFlagMissingLocally =
      requestedFlagKeys !== undefined &&
      Array.from(requestedFlagKeys).some((key) => this.featureFlagsPoller?.featureFlagsByKey[key] === undefined)
    const fallbackToFlags = localResult ? localResult.fallbackToFlags || requestedFlagMissingLocally : true
    if (fallbackToFlags && !onlyEvaluateLocally) {
      const details = await super.getFeatureFlagDetailsStateless(
        evaluationContext.distinctId,
        evaluationContext.groups,
        personProperties,
        groupProperties,
        disableGeoip,
        flagKeys
      )
      if (details) {
        this._minimalFlagCalledEvents = details.minimalFlagCalledEvents === true
        requestId = details.requestId
        evaluatedAt = details.evaluatedAt
        errorsWhileComputing = Boolean((details as any).errorsWhileComputingFlags)
        quotaLimited = Array.isArray(details.quotaLimited) && details.quotaLimited.includes('feature_flags')
        for (const [key, detail] of Object.entries(details.flags)) {
          if (locallyEvaluatedKeys.has(key)) {
            continue
          }
          let parsedPayload: JsonType | undefined = undefined
          if (detail.metadata?.payload !== undefined) {
            try {
              parsedPayload = JSON.parse(detail.metadata.payload)
            } catch {
              parsedPayload = detail.metadata.payload
            }
          }
          records[key] = {
            key,
            enabled: detail.enabled,
            variant: detail.variant,
            payload: parsedPayload,
            id: detail.metadata?.id,
            version: detail.metadata?.version,
            reason: detail.reason?.description ?? detail.reason?.code,
            locallyEvaluated: false,
            hasExperiment: detail.metadata?.has_experiment,
          }
        }
      }
    }

    // Apply overrides last so they take precedence over evaluation.
    if (this._flagOverrides !== undefined) {
      for (const [key, value] of Object.entries(this._flagOverrides)) {
        if (value === undefined) {
          delete records[key]
          continue
        }
        const existing = records[key]
        records[key] = {
          key,
          enabled: value !== false,
          variant: typeof value === 'string' ? value : undefined,
          payload: existing?.payload,
          id: existing?.id,
          version: existing?.version,
          reason: existing?.reason,
          locallyEvaluated: existing?.locallyEvaluated ?? false,
          hasExperiment: existing?.hasExperiment,
        }
      }
    }
    if (this._payloadOverrides !== undefined) {
      for (const [key, payload] of Object.entries(this._payloadOverrides)) {
        const existing = records[key]
        if (existing) {
          records[key] = { ...existing, payload }
        }
      }
    }

    if (requestedFlagKeys !== undefined) {
      for (const key of Object.keys(records)) {
        if (!requestedFlagKeys.has(key)) {
          delete records[key]
        }
      }
    }

    // A flag a remote fallback or override resolved has a value, so it is not unresolved.
    const unresolvedFlags: Record<string, UnresolvedFlagReason> = {}
    for (const [key, reason] of Object.entries(localResult?.unresolved ?? {})) {
      if (!Object.prototype.hasOwnProperty.call(records, key)) {
        unresolvedFlags[key] = reason
      }
    }

    return new FeatureFlagEvaluations({
      host: this._getFeatureFlagEvaluationsHost(),
      distinctId: resolvedDistinctId,
      groups,
      disableGeoip,
      flags: records,
      unresolvedFlags,
      requestId,
      evaluatedAt,
      flagDefinitionsLoadedAt: this.featureFlagsPoller?.getFlagDefinitionsLoadedAt(),
      errorsWhileComputing,
      quotaLimited,
    })
  }

  /**
   * Minimal iff this is a `$feature_flag_called` event, the server gate is on, and the flag
   * is known to not be linked to an experiment. Any missing signal — no gate seen yet,
   * `$feature_flag_has_experiment` absent — falls back to the full event.
   *
   * @internal
   */
  private _shouldSendMinimalFlagCalledEvent(event: string, properties: PostHogEventProperties): boolean {
    return (
      event === '$feature_flag_called' &&
      this._minimalFlagCalledEvents &&
      properties.$feature_flag_has_experiment === false
    )
  }

  /**
   * Fires a `$feature_flag_called` event for the given flag if the (distinctId, flag, response)
   * triple hasn't already been reported for this client. Shared by the single-flag evaluation
   * path and `FeatureFlagEvaluations.isEnabled() / getFlag()` so both paths dedupe identically.
   *
   * @internal
   */
  protected _captureFlagCalledEventIfNeeded(params: FlagCalledEventParams): void {
    const { distinctId, key, response, groups, disableGeoip, properties } = params
    const groupSuffix =
      groups && Object.keys(groups).length > 0
        ? `_${JSON.stringify(Object.entries(groups).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))}`
        : ''
    const featureFlagReportedKey = `${key}_${response}${groupSuffix}`

    const reported = this._distinctIdHasSentFlagCalls.get(distinctId) ?? new Set<string>()

    // Re-insert so the distinct id moves to the most-recently-used end of the map.
    this._distinctIdHasSentFlagCalls.delete(distinctId)
    this._distinctIdHasSentFlagCalls.set(distinctId, reported)

    if (reported.has(featureFlagReportedKey)) {
      return
    }

    reported.add(featureFlagReportedKey)

    // Evict only the least recently used distinct ids. Clearing the whole tracker under capacity
    // pressure would re-send `$feature_flag_called` for every active user at once. The current id
    // is always kept, even when maxCacheSize is below 1.
    while (this._distinctIdHasSentFlagCalls.size > Math.max(this.maxCacheSize, 1)) {
      const lruDistinctId = this._distinctIdHasSentFlagCalls.keys().next().value
      if (lruDistinctId === undefined) {
        break
      }
      this._distinctIdHasSentFlagCalls.delete(lruDistinctId)
    }

    this.capture({
      distinctId,
      event: '$feature_flag_called',
      properties,
      groups,
      disableGeoip,
    })
  }

  private _featureFlagEvaluationsHost?: FeatureFlagEvaluationsHost

  private _getFeatureFlagEvaluationsHost(): FeatureFlagEvaluationsHost {
    if (!this._featureFlagEvaluationsHost) {
      this._featureFlagEvaluationsHost = {
        captureFlagCalledEventIfNeeded: (params) => this._captureFlagCalledEventIfNeeded(params),
        logWarning: (message) => {
          if (this.options.featureFlagsLogWarnings !== false) {
            // These warnings guide API usage (misuse of `onlyAccessed()` / `only()`) and
            // should always surface — unlike `this._logger.warn` which is gated on debug mode.
            console.warn(`[PostHog] ${message}`)
          }
        },
      }
    }
    return this._featureFlagEvaluationsHost
  }

  /**
   * Create or update a group and its properties.
   *
   * @example
   * ```ts
   * // Create a company group
   * client.groupIdentify({
   *   groupType: 'company',
   *   groupKey: 'acme-corp',
   *   properties: {
   *     name: 'Acme Corporation',
   *     industry: 'Technology',
   *     employee_count: 500
   *   },
   *   distinctId: 'user_123'
   * })
   * ```
   *
   * @example
   * ```ts
   * // Update organization properties
   * client.groupIdentify({
   *   groupType: 'organization',
   *   groupKey: 'org-456',
   *   properties: {
   *     plan: 'enterprise',
   *     region: 'US-West'
   *   }
   * })
   * ```
   *
   * {@label Identification}
   *
   * @param data - The group identify data
   */
  groupIdentify({ groupType, groupKey, properties, distinctId, disableGeoip, options }: GroupIdentifyMessage): void {
    this._sendPreparedEvent(
      'capture',
      {
        distinctId,
        event: '$groupidentify',
        properties: {
          $group_type: groupType,
          $group_key: groupKey,
          $group_set: properties || {},
        },
        disableGeoip,
        options,
      },
      false,
      { fallbackDistinctId: `$${groupType}_${groupKey}`, contextSession: false }
    )
  }

  /**
   * Create or update a group and its properties immediately (synchronously).
   *
   * @example
   * ```ts
   * // Immediately create or update a company group
   * await client.groupIdentifyImmediate({
   *   groupType: 'company',
   *   groupKey: 'acme-corp',
   *   properties: {
   *     name: 'Acme Corporation',
   *     industry: 'Technology',
   *     employee_count: 500
   *   }
   * })
   * ```
   *
   * {@label Identification}
   *
   * @param data - The group identify data
   * @returns Promise that resolves when the group identify is processed
   */
  async groupIdentifyImmediate({
    groupType,
    groupKey,
    properties,
    distinctId,
    disableGeoip,
    options,
  }: GroupIdentifyMessage): Promise<void> {
    await this._sendPreparedEvent(
      'capture',
      {
        distinctId,
        event: '$groupidentify',
        properties: {
          $group_type: groupType,
          $group_key: groupKey,
          $group_set: properties || {},
        },
        disableGeoip,
        options,
      },
      true,
      { fallbackDistinctId: `$${groupType}_${groupKey}`, contextSession: false }
    )
  }

  /**
   * Reload feature flag definitions from the configured cache provider or PostHog for local evaluation.
   *
   * @example
   * ```ts
   * // Force reload of feature flags
   * await client.reloadFeatureFlags()
   * console.log('Feature flags reloaded')
   * ```
   *
   * @example
   * ```ts
   * // Reload before checking a specific flag
   * await client.reloadFeatureFlags()
   * const flag = await client.getFeatureFlag('flag-key', 'user_123')
   * ```
   *
   * {@label Feature flags}
   *
   * @returns Promise that resolves when flags are reloaded
   */
  async reloadFeatureFlags(): Promise<void> {
    await this.featureFlagsPoller?.loadFeatureFlags(true)
  }

  /**
   * Override feature flags locally. Useful for testing and local development.
   * Overridden flags take precedence over both local evaluation and remote evaluation.
   *
   * @example
   * ```ts
   * // Clear all overrides
   * client.overrideFeatureFlags(false)
   *
   * // Enable a list of flags (sets them to true)
   * client.overrideFeatureFlags(['flag-a', 'flag-b'])
   *
   * // Set specific flag values/variants
   * client.overrideFeatureFlags({ 'my-flag': 'variant-a', 'other-flag': true })
   *
   * // Set both flags and payloads
   * client.overrideFeatureFlags({
   *   flags: { 'my-flag': 'variant-a' },
   *   payloads: { 'my-flag': { discount: 20 } }
   * })
   * ```
   *
   * {@label Feature flags}
   *
   * @param overrides - Flag overrides configuration
   */
  overrideFeatureFlags(overrides: OverrideFeatureFlagsOptions): void {
    const flagArrayToRecord = (flags: string[]) => Object.fromEntries(flags.map((f) => [f, true]))

    if (overrides === false) {
      this._flagOverrides = undefined
      this._payloadOverrides = undefined
      return
    }

    // Array syntax: ['flag-a', 'flag-b'] -> { 'flag-a': true, 'flag-b': true }
    if (Array.isArray(overrides)) {
      this._flagOverrides = flagArrayToRecord(overrides)
      return
    }

    if (this._isFeatureFlagOverrideOptions(overrides)) {
      if ('flags' in overrides) {
        if (overrides.flags === false) {
          this._flagOverrides = undefined
        } else if (Array.isArray(overrides.flags)) {
          this._flagOverrides = flagArrayToRecord(overrides.flags)
        } else if (overrides.flags !== undefined) {
          this._flagOverrides = { ...overrides.flags }
        }
      }

      if ('payloads' in overrides) {
        if (overrides.payloads === false) {
          this._payloadOverrides = undefined
        } else if (overrides.payloads !== undefined) {
          this._payloadOverrides = { ...overrides.payloads }
        }
      }

      return
    }

    // Fallback: treat as Record<string, FeatureFlagValue>
    this._flagOverrides = { ...overrides }
  }

  /**
   * Type guard to check if overrides is a FeatureFlagOverrideOptions object.
   *
   * This distinguishes between:
   * - { flags: { 'flag-a': true } } -> FeatureFlagOverrideOptions (flags is an object/array/false)
   * - { flags: true } -> Record<string, FeatureFlagValue> (a flag named "flags" with value true)
   */
  private _isFeatureFlagOverrideOptions(overrides: unknown): overrides is FeatureFlagOverrideOptions {
    if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
      return false
    }

    const obj = overrides as Record<string, unknown>

    // Check if 'flags' key exists and has a valid structure for FeatureFlagOverrideOptions
    // Valid values: false, string[], or Record<string, FeatureFlagValue> (an object)
    if ('flags' in obj) {
      const flagsValue = obj['flags']
      // If flags is false, an array, or a plain object - it's FeatureFlagOverrideOptions
      // If flags is a boolean true or a string - it's a flag named "flags" with that value
      if (
        flagsValue === false ||
        Array.isArray(flagsValue) ||
        (typeof flagsValue === 'object' && flagsValue !== null)
      ) {
        return true
      }
    }

    // Check if 'payloads' key exists and has a valid structure for FeatureFlagOverrideOptions
    // Valid values: false or Record<string, JsonType> (an object)
    if ('payloads' in obj) {
      const payloadsValue = obj['payloads']
      // If payloads is false or a plain object - it's FeatureFlagOverrideOptions
      // If payloads is a string or boolean true - it's a flag named "payloads" with that value
      if (payloadsValue === false || (typeof payloadsValue === 'object' && payloadsValue !== null)) {
        return true
      }
    }

    return false
  }

  /**
   * Register properties that every event sent by this client carries.
   *
   * @remarks
   * Each event fills the keys it left unset in this order: the event's own values, then context
   * properties, then these, then the values the SDK adds (such as `$is_server` and
   * `$geoip_disable`). `before_send` sees the result and can change it.
   *
   * @example
   * ```ts
   * await client.register({ service: 'billing' })
   * ```
   *
   * {@label Capture}
   *
   * @param properties - The properties to add to every event
   */
  override register(properties: PostHogEventProperties): Promise<void> {
    return super.register(properties)
  }

  /**
   * Remove a property added with `register()`.
   *
   * {@label Capture}
   *
   * @param property - The property name to remove
   */
  override unregister(property: string): Promise<void> {
    return super.unregister(property)
  }

  /**
   * Register options that every event sent by this client carries.
   *
   * @remarks
   * Each event fills the options it left unset (missing or `null`) in this order: the event's own
   * `options`, then context options, then these, then the options the SDK adds (such as
   * `process_person_profile: false` for an event with no distinct id). `before_send` sees the
   * result and can change it. Values are sent to capture unchanged. An option beats its legacy
   * property, such as `$process_person_profile`, wherever either one was set.
   *
   * @example
   * ```ts
   * client.registerOptions({ cookieless_mode: true })
   * ```
   *
   * {@label Capture}
   *
   * @param options - The options to add to every event
   */
  registerOptions(options: Record<string, JsonType>): void {
    if (!isPlainObject(options)) {
      // console.error, not this._logger: the logger only prints in debug mode, and the options are lost.
      console.error('[PostHog] registerOptions takes an object; ignoring the value')
      return
    }
    this._globalOptions = { ...this._globalOptions, ...options }
  }

  /**
   * Remove an option added with `registerOptions()`.
   *
   * {@label Capture}
   *
   * @param key - The option name to remove
   */
  unregisterOptions(key: string): void {
    const remaining = { ...this._globalOptions }
    delete remaining[key]
    this._globalOptions = remaining
  }

  protected abstract initializeContext(): IPostHogContext | undefined

  /**
   * Run a function with specific context that will be applied to all events captured within that context.
   * It propagates the context to all subsequent calls down the call stack.
   * Context properties like tags and sessionId will be automatically attached to all events.
   * By default, nested contexts inherit from parent contexts. Use `{ fresh: true }` to start with a clean context.
   *
   * @remarks
   * Context `properties` and `options` fill only what an event left unset: the event's own values
   * win, and context values beat `register()` and `registerOptions()` values and the values the SDK
   * adds. `before_send` sees the result and can change it.
   *
   * @example
   * ```ts
   * posthog.withContext({ distinctId: 'user_123' }, () => {
   *   posthog.capture({ event: 'button clicked' })
   * })
   * ```
   *
   * {@label Context}
   *
   * @param data - Context data to apply (sessionId, distinctId, properties, options)
   * @param fn - Function to run with the context
   * @param options - Context options (fresh: true to start with clean context instead of inheriting)
   * @returns The return value of the function
   */
  withContext<T>(data: Partial<ContextData>, fn: () => T, options?: ContextOptions): T {
    if (!this.context) {
      // Context not supported in this environment (e.g., edge runtime)
      return fn()
    }

    return this.context.run(data, fn, options)
  }

  /**
   * Get the current context data.
   *
   * @example
   * ```ts
   * // Get current context within a withContext block
   * posthog.withContext({ distinctId: 'user_123' }, () => {
   *   const context = posthog.getContext()
   *   console.log(context?.distinctId) // 'user_123'
   * })
   * ```
   *
   * {@label Context}
   *
   * @returns The current context data, or undefined if no context is set
   */
  getContext(): ContextData | undefined {
    return this.context?.get()
  }

  /**
   * Set context without a callback wrapper.
   *
   * Uses `AsyncLocalStorage.enterWith()` to attach context to the current
   * async execution context. The context lives until that async context ends.
   *
   * Must be called in the same async scope that makes PostHog calls.
   * Calling this outside a request-scoped async context will leak context
   * across unrelated work. Prefer `withContext()` when you can wrap code
   * in a callback — it creates an isolated scope that cleans up automatically.
   *
   * @param data - Context data to apply (distinctId, sessionId, properties, options)
   * @param options - Context options (fresh: true to start with clean context instead of inheriting)
   */
  enterContext(data: Partial<ContextData>, options?: ContextOptions): void {
    this.context?.enter(data as ContextData, options)
  }

  /**
   * Shutdown the PostHog client gracefully.
   *
   * @example
   * ```ts
   * // Shutdown with default timeout
   * await client._shutdown()
   * ```
   *
   * @example
   * ```ts
   * // Shutdown with custom timeout
   * await client._shutdown(5000) // 5 seconds
   * ```
   *
   * {@label Shutdown}
   *
   * @param shutdownTimeoutMs - Timeout in milliseconds for shutdown
   * @returns Promise that resolves when shutdown is complete
   */
  async _shutdown(shutdownTimeoutMs?: number): Promise<void> {
    // One absolute deadline for the whole shutdown: the metrics flush race and
    // super._shutdown spend from the same budget, so shutdown(500) can't take
    // ~1000ms by giving each phase a fresh full timeout.
    const shutdownDeadlineMs = Date.now() + (shutdownTimeoutMs ?? 30000)
    // Cancel any pending debounced flush — shutdown will flush directly.
    const resolve = this._consumeWaitUntilCycle()

    await this.featureFlagsPoller?.stopPoller(shutdownTimeoutMs)
    this.errorTracking.shutdown()
    if (this._metrics) {
      // Send whatever is aggregated in the current window, then clear the flush
      // timer so it can't fire after teardown. Raced against the shutdown budget:
      // this flush runs before super._shutdown starts its own timeout, so an
      // unresponsive transport must not be able to hold shutdown past the
      // caller's deadline (its retry stack alone can take ~49s).
      await raceWithTimeout(
        this._metrics.flush().catch(() => {}),
        Math.max(0, shutdownDeadlineMs - Date.now())
      )
      // reset() also invalidates a flush that lost the race above: when its
      // send finally settles, the stale window is discarded instead of being
      // merged back onto a re-armed timer after teardown.
      this._metrics.reset()
    }
    if (this._traces) {
      // Same treatment as metrics: send what's queued, raced against the shared
      // shutdown budget, then reset so a losing flush can't re-arm a timer.
      await raceWithTimeout(
        this._traces.flush().catch(() => {}),
        Math.max(0, shutdownDeadlineMs - Date.now())
      )
      this._traces.reset()
    }
    try {
      // The core shutdown waits for pending captures to land on their lanes; the lanes drain meanwhile,
      // then once more for whatever those captures added.
      await Promise.all([
        super._shutdown(Math.max(0, shutdownDeadlineMs - Date.now())),
        this._drainCaptureLanes(shutdownDeadlineMs),
      ])
      await this._drainCaptureLanes(shutdownDeadlineMs)
    } finally {
      for (const lane of this._captureLanes.values()) {
        lane.finishShutdown()
      }
      this._distinctIdHasSentFlagCalls.clear()
      resolve?.()
    }
  }

  private _drainCaptureLanes(deadlineMs: number): Promise<void> {
    return Promise.all([...this._captureLanes.values()].map((lane) => lane.drain(deadlineMs))).then(() => {})
  }

  private async _requestRemoteConfigPayload(flagKey: string): Promise<PostHogFetchResponse | undefined> {
    if (this.disabled || !this.apiKey || !this.options.personalApiKey) {
      return undefined
    }

    const url = `${this.host}/api/projects/@current/feature_flags/${flagKey}/remote_config?token=${encodeURIComponent(this.apiKey)}`

    const options: PostHogFetchOptions = {
      method: 'GET',
      headers: {
        ...this.getCustomHeaders(),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.personalApiKey}`,
      },
    }

    let abortTimeout = null
    if (this.options.requestTimeout && typeof this.options.requestTimeout === 'number') {
      const controller = new AbortController()
      abortTimeout = safeSetTimeout(() => {
        controller.abort()
      }, this.options.requestTimeout)
      options.signal = controller.signal
    }

    try {
      return await this.fetch(url, options)
    } catch (error) {
      this._events.emit('error', error)
      return undefined
    } finally {
      if (abortTimeout) {
        clearTimeout(abortTimeout)
      }
    }
  }

  private extractPropertiesFromEvent(
    eventProperties?: Record<string | number, any>,
    groups?: Record<string, string | number>
  ): {
    personProperties: Record<string, string>
    groupProperties: Record<string, Record<string, string>>
  } {
    if (!eventProperties) {
      return { personProperties: {}, groupProperties: {} }
    }

    const personProperties: Record<string, string> = {}
    const groupProperties: Record<string, Record<string, string>> = {}

    for (const [key, value] of Object.entries(eventProperties)) {
      // If the value is a plain object and the key exists in groups, treat it as group properties
      if (isPlainObject(value) && groups && key in groups) {
        const groupProps: Record<string, string> = {}
        for (const [groupKey, groupValue] of Object.entries(value as Record<string, any>)) {
          groupProps[String(groupKey)] = String(groupValue)
        }
        groupProperties[String(key)] = groupProps
      } else {
        // Otherwise treat as person property
        personProperties[String(key)] = String(value)
      }
    }

    return { personProperties, groupProperties }
  }

  private async getFeatureFlagsForEvent(
    distinctId: string,
    groups?: Record<string, string | number>,
    disableGeoip?: boolean,
    sendFeatureFlagsOptions?: SendFeatureFlagsOptions
  ): Promise<PostHogFlagsResponse['featureFlags'] | undefined> {
    if (this.disabled || !this.apiKey) {
      this._logger.warn('The client is disabled')
      return undefined
    }

    // Use properties directly from options if they exist
    const finalPersonProperties = sendFeatureFlagsOptions?.personProperties || {}
    const finalGroupProperties = sendFeatureFlagsOptions?.groupProperties || {}
    const flagKeys = sendFeatureFlagsOptions?.flagKeys

    // Check if we should only evaluate locally
    const onlyEvaluateLocally =
      sendFeatureFlagsOptions?.onlyEvaluateLocally ?? this.options.strictLocalEvaluation ?? false

    // If onlyEvaluateLocally is true, only use local evaluation
    if (onlyEvaluateLocally) {
      if ((this.featureFlagsPoller?.featureFlags?.length || 0) > 0) {
        const groupsWithStringValues: Record<string, string> = {}
        for (const [key, value] of Object.entries(groups || {})) {
          groupsWithStringValues[key] = String(value)
        }

        return await this.getAllFlags(distinctId, {
          groups: groupsWithStringValues,
          personProperties: finalPersonProperties,
          groupProperties: finalGroupProperties,
          disableGeoip,
          onlyEvaluateLocally: true,
          flagKeys,
        })
      } else {
        // If onlyEvaluateLocally is true but we don't have local flags, return empty
        return {}
      }
    }

    // Prefer local evaluation if available (default behavior; I'd rather not penalize users who haven't updated to the new API but still want to use local evaluation)
    if ((this.featureFlagsPoller?.featureFlags?.length || 0) > 0) {
      const groupsWithStringValues: Record<string, string> = {}
      for (const [key, value] of Object.entries(groups || {})) {
        groupsWithStringValues[key] = String(value)
      }

      return await this.getAllFlags(distinctId, {
        groups: groupsWithStringValues,
        personProperties: finalPersonProperties,
        groupProperties: finalGroupProperties,
        disableGeoip,
        onlyEvaluateLocally: true,
        flagKeys,
      })
    }

    // Fall back to remote evaluation if local evaluation is not available
    return (
      await super.getFeatureFlagsStateless(
        distinctId,
        groups,
        finalPersonProperties,
        finalGroupProperties,
        disableGeoip
      )
    ).flags
  }

  private addLocalPersonAndGroupProperties(
    distinctId: string,
    groups?: Record<string, string>,
    personProperties?: Properties,
    groupProperties?: Record<string, Properties>
  ): { allPersonProperties: Properties; allGroupProperties: Record<string, Properties> } {
    const allPersonProperties = { ...(personProperties || {}) }

    const allGroupProperties: Record<string, Properties> = {}
    if (groups) {
      for (const groupName of Object.keys(groups)) {
        allGroupProperties[groupName] = {
          $group_key: groups[groupName],
          ...(groupProperties?.[groupName] || {}),
        }
      }
    }

    return { allPersonProperties, allGroupProperties }
  }

  private personPropertiesForLocalEvaluation(distinctId: string, personProperties?: Properties): Record<string, any> {
    return { distinct_id: distinctId, ...(personProperties || {}) }
  }

  private createFeatureFlagEvaluationContext(
    distinctId: string,
    groups?: Record<string, string>,
    personProperties?: Properties,
    groupProperties?: Record<string, Properties>
  ): FeatureFlagEvaluationContext {
    return {
      distinctId,
      groups: groups || {},
      personProperties: personProperties || {},
      groupProperties: groupProperties || {},
      evaluationCache: {},
    }
  }

  /**
   * Capture an error exception as an event.
   *
   * @example
   * ```ts
   * // Capture an error with user ID
   * try {
   *   // Some risky operation
   *   riskyOperation()
   * } catch (error) {
   *   client.captureException(error, 'user_123')
   * }
   * ```
   *
   * @example
   * ```ts
   * // Capture with additional properties
   * try {
   *   apiCall()
   * } catch (error) {
   *   client.captureException(error, 'user_123', {
   *     endpoint: '/api/users',
   *     method: 'POST',
   *     status_code: 500
   *   })
   * }
   * ```
   *
   * {@label Error tracking}
   *
   * @param error - The error to capture
   * @param distinctId - Optional user distinct ID
   * @param additionalProperties - Optional additional properties to include
   * @param uuid - Optional event UUID
   * @param flags - Optional `FeatureFlagEvaluations` snapshot to attach the same flag context as your other events
   */
  captureException(
    error: unknown,
    distinctId?: string,
    additionalProperties?: Record<string | number, any>,
    uuid?: EventMessage['uuid'],
    flags?: FeatureFlagEvaluations
  ): void {
    if (!ErrorTracking.isPreviouslyCapturedError(error)) {
      const syntheticException = new Error('PostHog syntheticException')
      this.addPendingPromise(
        ErrorTracking.buildEventMessage(
          this.getErrorPropertiesBuilder(),
          error,
          { syntheticException },
          distinctId,
          additionalProperties
        ).then((msg) => this._capturePreparedEvent({ ...msg, uuid, flags }, false))
      )
    }
  }

  /**
   * Capture an error exception as an event immediately (synchronously).
   *
   * @example
   * ```ts
   * // Capture an error immediately with user ID
   * try {
   *   // Some risky operation
   *   riskyOperation()
   * } catch (error) {
   *   await client.captureExceptionImmediate(error, 'user_123')
   * }
   * ```
   *
   * @example
   * ```ts
   * // Capture with additional properties
   * try {
   *   apiCall()
   * } catch (error) {
   *   await client.captureExceptionImmediate(error, 'user_123', {
   *     endpoint: '/api/users',
   *     method: 'POST',
   *     status_code: 500
   *   })
   * }
   * ```
   *
   * {@label Error tracking}
   *
   * @param error - The error to capture
   * @param distinctId - Optional user distinct ID
   * @param additionalProperties - Optional additional properties to include
   * @param flags - Optional `FeatureFlagEvaluations` snapshot to attach the same flag context as your other events
   * @returns Promise that resolves when the error is captured
   */
  async captureExceptionImmediate(
    error: unknown,
    distinctId?: string,
    additionalProperties?: Record<string | number, any>,
    flags?: FeatureFlagEvaluations
  ): Promise<void> {
    if (!ErrorTracking.isPreviouslyCapturedError(error)) {
      const syntheticException = new Error('PostHog syntheticException')
      return this.addPendingPromise(
        ErrorTracking.buildEventMessage(
          this.getErrorPropertiesBuilder(),
          error,
          { syntheticException },
          distinctId,
          additionalProperties
        ).then((msg) => this.captureImmediate({ ...msg, flags }))
      )
    }
  }

  public async prepareEventMessage(props: EventMessage): Promise<{
    distinctId: string
    event: string
    properties: PostHogEventProperties
    options: PostHogCaptureOptions
  }> {
    return this._prepareEventMessage(props)
  }

  /**
   * Build an event in the canonical order: identity, the call's own values, then the values it left
   * unset from context, then `register()` / `registerOptions()`, then the SDK, then the minimal
   * `$feature_flag_called` allowlist, then `before_send`, which has the final say.
   */
  private async _prepareEventMessage(
    props: EventMessage,
    prepareOptions: PrepareEventOptions = {}
  ): Promise<{
    distinctId: string
    event: string
    properties: PostHogEventProperties
    options: PostHogCaptureOptions
    /** The event's `options` map, sent to capture unchanged. */
    eventOptions?: Record<string, JsonType>
  }> {
    const {
      distinctId,
      event,
      properties,
      groups,
      flags,
      sendFeatureFlags,
      timestamp,
      disableGeoip,
      uuid,
    }: EventMessage = props
    const callOptions = readEventOptions(props.options)

    // Read every layer now, before the first await, so later changes never reach this event.
    const contextData = this.context?.get()
    const contextProperties = snapshotLayer(contextData?.properties)
    const contextOptions = snapshotLayer(contextData?.options)
    const globalProperties = snapshotLayer(this.props)
    const globalOptions = this._globalOptions

    const resolvedDistinctId =
      presentDistinctId(distinctId) ?? presentDistinctId(contextData?.distinctId) ?? prepareOptions.fallbackDistinctId
    const eventDistinctId = resolvedDistinctId ?? uuidv7()

    const eventProperties: PostHogEventProperties = { ...(properties || {}) }
    if (prepareOptions.distinctIdProperty) {
      eventProperties.distinct_id = eventDistinctId
    }
    if (
      (prepareOptions.contextSession ?? true) &&
      contextData?.sessionId &&
      isUnsetProperty(eventProperties, '$session_id')
    ) {
      eventProperties.$session_id = contextData.sessionId
    }
    if (isPlainObject(groups) && Object.keys(groups).length > 0) {
      const existingGroups = eventProperties.$groups
      eventProperties.$groups = isPlainObject(existingGroups) ? { ...existingGroups, ...groups } : { ...groups }
    }
    if (disableGeoip !== undefined && disableGeoip !== null) {
      fillProperties(eventProperties, [{ $geoip_disable: disableGeoip }])
    }

    fillProperties(eventProperties, [contextProperties, globalProperties], prepareOptions.callOnlyProperties)
    fillProperties(eventProperties, [
      await this._sdkEventProperties(event, eventProperties, eventDistinctId, {
        groups,
        flags,
        sendFeatureFlags,
        disableGeoip,
      }),
    ])

    const filledOptions: Record<string, JsonType> = { ...callOptions }
    fillOptions(filledOptions, [
      contextOptions,
      globalOptions,
      resolvedDistinctId !== undefined ? undefined : { process_person_profile: false },
    ])
    const eventOptions = callOptions !== undefined || Object.keys(filledOptions).length > 0 ? filledOptions : undefined

    // Runs after every fill and before before_send, so no default can re-add a stripped property
    // but a hook still can.
    const finalProperties = this._shouldSendMinimalFlagCalledEvent(event, eventProperties)
      ? minimizeFlagCalledEventProperties(eventProperties, FLAG_CALLED_OPTION_SOURCE_PROPERTIES)
      : eventProperties

    let finalEvent = event
    if (
      event === '$pageview' &&
      this.options.__preview_capture_bot_pageviews &&
      typeof finalProperties.$raw_user_agent === 'string' &&
      isBlockedUA(finalProperties.$raw_user_agent, this.options.custom_blocked_useragents || [])
    ) {
      finalEvent = '$bot_pageview'
      finalProperties.$browser_type = 'bot'
    }

    const eventMessage = this._runBeforeSend({
      distinctId: eventDistinctId,
      event: finalEvent,
      properties: finalProperties,
      groups,
      flags,
      sendFeatureFlags,
      timestamp,
      disableGeoip,
      uuid,
      options: eventOptions,
    })

    if (!eventMessage) {
      return Promise.reject(null)
    }

    return {
      distinctId: eventMessage.distinctId!,
      event: eventMessage.event,
      properties: eventMessage.properties || {},
      options: {
        timestamp: eventMessage.timestamp,
        disableGeoip: eventMessage.disableGeoip,
        uuid: eventMessage.uuid,
      },
      eventOptions: eventMessage.options,
    }
  }

  private _runBeforeSend(eventMessage: EventMessage): EventMessage | null {
    const beforeSend = this.options.before_send
    if (!beforeSend) {
      return eventMessage
    }

    const fns = Array.isArray(beforeSend) ? beforeSend : [beforeSend]
    let result: EventMessage | null = isolateForBeforeSend(eventMessage)

    for (const fn of fns) {
      try {
        result = fn(result)
        if (!result) {
          this._logger.info(`Event '${eventMessage.event}' was rejected in beforeSend function`)
          return null
        }
        if (!result.properties || Object.keys(result.properties).length === 0) {
          const message = `Event '${result.event}' has no properties after beforeSend function, this is likely an error.`
          this._logger.warn(message)
        }
      } catch (error) {
        this._logger.error(`Error in before_send function for event '${eventMessage.event}':`, error)
        return null
      }
    }

    return result
  }
}
