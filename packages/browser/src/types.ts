// Portions of this file are derived from getsentry/sentry-javascript
// Copyright (c) 2012 Functional Software, Inc. dba Sentry
// Licensed under the MIT License: https://github.com/getsentry/sentry-javascript/blob/develop/LICENSE

import { PostHog } from './posthog-core'
// only importing types here, so won't affect the bundle
// eslint-disable-next-line posthog-js/no-external-replay-imports
import type { SAMPLED } from './extensions/replay/external/triggerMatching'
import { Compression, type RemoteConfig, type SessionRecordingRemoteConfig } from '@posthog/browser-common'

// Extension class types for __extensionClasses (type-only, no bundle impact)
import type { ExtensionConstructor } from './extensions/types'
import type { Autocapture } from './autocapture'
import type { DeadClicksAutocapture } from './extensions/dead-clicks-autocapture'
import type { ExceptionObserver } from './extensions/exception-autocapture'
import type { HistoryAutocapture } from './extensions/history-autocapture'
import type { TracingHeaders } from './extensions/tracing-headers'
import type { WebVitalsAutocapture } from './extensions/web-vitals'
import type { SessionRecording } from './extensions/replay/session-recording'
import type { Heatmaps } from './heatmaps'
import type { PostHogProductTours } from './posthog-product-tours'
import type { SiteApps } from './site-apps'
import type { PostHogSurveys } from './posthog-surveys'
import type { Toolbar } from './extensions/toolbar'
import type { PostHogExceptions } from './posthog-exceptions'
import type { WebExperiments } from './web-experiments'
import type { PostHogConversations } from './extensions/conversations/posthog-conversations'
import type { PostHogFeatureFlags } from './posthog-featureflags'
import type { PostHogLogs } from './posthog-logs'
import type { PostHogMetrics } from './posthog-metrics'

// ============================================================================
// Re-export public types from @posthog/types
// ============================================================================

// Common types
export type { Property, Properties, JsonType, JsonRecord } from '@posthog/types'

// Capture types
export type { KnownEventName, EventName, CaptureResult, CaptureOptions, BeforeSendFn } from '@posthog/types'

// Feature flag types
export type {
    FeatureFlagsCallback,
    FeatureFlagDetail,
    FeatureFlagMetadata,
    EvaluationReason,
    FeatureFlagResult,
    FeatureFlagOptions,
    IsFeatureEnabledOptions,
    RemoteConfigFeatureFlagCallback,
    EarlyAccessFeature,
    EarlyAccessFeatureStage,
    EarlyAccessFeatureCallback,
    EarlyAccessFeatureResponse,
    FeatureFlagOverrides,
    FeatureFlagPayloadOverrides,
    FeatureFlagOverrideOptions,
    OverrideFeatureFlagsOptions,
} from '@posthog/types'

// Request types
export type { Headers, RequestResponse, RequestCallback } from '@posthog/types'

// Session recording types
export type {
    SessionRecordingCanvasOptions,
    InitiatorType,
    NetworkRequest,
    CapturedNetworkRequest,
    SessionIdChangedCallback,
    SeverityLevel,
} from '@posthog/types'

// Config types
export type {
    AutocaptureCompatibleElement,
    DomAutocaptureEvents,
    AutocaptureConfig,
    RageclickConfig,
    BootstrapConfig,
    SupportedWebVitalsMetrics,
    PerformanceCaptureConfig,
    DeadClickCandidate,
    ExceptionAutoCaptureConfig,
    ExceptionStepsConfig,
    DeadClicksAutoCaptureConfig,
    HeatmapConfig,
    ConfigDefaults,
    ExternalIntegrationKind,
    ErrorTrackingOptions,
    MaskInputOptions,
    SlimDOMOptions,
    SessionRecordingSamplingConfig,
    SessionRecordingOptions,
    RequestQueueConfig,
} from '@posthog/types'

// Toolbar types
export type { ToolbarUserIntent, ToolbarSource, ToolbarVersion, ToolbarParams } from '@posthog/types'

// Log capture types
export type {
    LogSeverityLevel,
    OtlpSeverityText,
    OtlpSeverityEntry,
    LogAttributeValue,
    LogAttributes,
    CaptureLogOptions,
    Logger,
    OtlpAnyValue,
    OtlpKeyValue,
    OtlpLogRecord,
    OtlpLogsPayload,
} from '@posthog/types'
export type { LogSdkContext } from '@posthog/core'
export { Compression }
export type {
    RemoteConfig,
    FlagVariant,
    SessionRecordingRemoteConfig,
    SessionRecordingUrlTrigger,
    SessionRecordingEventTrigger,
    SessionRecordingTriggerPropertyFilter,
    SessionRecordingTriggerGroup,
    NetworkRecordOptions,
    PropertyMatchType,
    ErrorTrackingSuppressionRule,
    ErrorTrackingSuppressionRuleValue,
} from '@posthog/browser-common'

// Metric capture types
export type {
    MetricAttributeValue,
    MetricAttributes,
    MetricType,
    CaptureMetricOptions,
    MetricSample,
    BeforeSendMetricFn,
    OtlpMetricsPayload,
    MetricsConfig,
} from '@posthog/types'

// Re-export KnownUnsafeEditableEvent from @posthog/core for backwards compatibility
export type { KnownUnsafeEditableEvent } from '@posthog/core'

// ============================================================================
// Browser-specific types that depend on local imports
// These cannot be moved to @posthog/types as they reference browser-specific code
// ============================================================================

// Import types for internal use in this file
import type {
    JsonType,
    Properties,
    EventName,
    FeatureFlagDetail,
    PostHogConfig as BasePostHogConfig,
    PostHog as BasePostHogInterface,
    RequestResponse,
} from '@posthog/types'

/* Small override from the base class to make it more specific to the browser/src/posthog-core.ts file
 * This guarantees we'll be able to use `PostHogConfig` as implemented in the browser/src/posthog-core.ts file
 * using the proper `loaded` function signature.
 */
export type PostHogInterface = Omit<BasePostHogInterface, 'config' | 'init' | 'set_config'> & {
    // re-declared (rather than kept from the base interface) so they use the
    // browser-specific `PostHogConfig` below, matching the class implementation
    config: PostHogConfig
    set_config(config: Partial<PostHogConfig>): void
}

/*
 * Specify that `loaded` should be using the PostHog instance type
 * as implemented by the browser/src/posthog-core.ts file rather than the @posthog/types type
 */
export type PostHogConfig = Omit<BasePostHogConfig, 'loaded'> & {
    loaded: (posthog: PostHogInterface) => void

    /**
     * Disables capturing the `$device_model` super-property.
     *
     * When capturing is enabled (the default), PostHog resolves the hardware model once during init
     * via `navigator.userAgentData.getHighEntropyValues(['model'])` and registers it as the raw OEM
     * code (e.g. `Pixel 7`). This is Chromium-only and only meaningful on Android — it resolves to
     * `undefined` on Safari/Firefox and to an empty string on desktop, in which cases nothing is
     * registered.
     *
     * This opt-out is offered because `getHighEntropyValues` is still experimental and Chromium-only
     * (not yet a cross-browser standard); set it to `true` to skip the call entirely.
     *
     * @default false
     */
    disableDeviceModel?: boolean

    /**
     * Internal: Extension class overrides for tree-shaking support.
     * When provided, these classes are used instead of the default imports.
     * This enables entrypoints to control which extensions are bundled.
     * @internal
     */
    __extensionClasses?: {
        exceptions?: ExtensionConstructor<PostHogExceptions>
        historyAutocapture?: ExtensionConstructor<HistoryAutocapture>
        tracingHeaders?: ExtensionConstructor<TracingHeaders>
        siteApps?: ExtensionConstructor<SiteApps>
        sessionRecording?: ExtensionConstructor<SessionRecording>
        autocapture?: ExtensionConstructor<Autocapture>
        productTours?: ExtensionConstructor<PostHogProductTours>
        heatmaps?: ExtensionConstructor<Heatmaps>
        webVitalsAutocapture?: ExtensionConstructor<WebVitalsAutocapture>
        exceptionObserver?: ExtensionConstructor<ExceptionObserver>
        deadClicksAutocapture?: ExtensionConstructor<DeadClicksAutocapture>
        surveys?: ExtensionConstructor<PostHogSurveys>
        toolbar?: ExtensionConstructor<Toolbar>
        experiments?: ExtensionConstructor<WebExperiments>
        conversations?: ExtensionConstructor<PostHogConversations>
        featureFlags?: ExtensionConstructor<PostHogFeatureFlags>
        logs?: ExtensionConstructor<PostHogLogs>
        metrics?: ExtensionConstructor<PostHogMetrics>
    }
}

// See https://nextjs.org/docs/app/api-reference/functions/fetch#fetchurl-options
type NextOptions = { revalidate: false | 0 | number; tags: string[] }

export interface RequestWithOptions {
    url: string
    // Data can be a single object or an array of objects when batched
    data?: Record<string, any> | Record<string, any>[]
    headers?: Record<string, any>
    transport?: 'XHR' | 'fetch' | 'sendBeacon'
    method?: 'POST' | 'GET'
    urlQueryArgs?: { compression: Compression }
    callback?: (response: RequestResponse) => void
    timeout?: number
    noRetries?: boolean
    disableTransport?: ('XHR' | 'fetch' | 'sendBeacon')[]
    compression?: Compression | 'best-available'
    /**
     * Controls where the request dispatch time is sent.
     * - `body` adds ISO `sent_at` to the existing request object (for example, flags).
     * - `capture-body` wraps events in `{ api_key, batch, sent_at }` with an ISO timestamp.
     * - `query` adds numeric `sent_at` to POST requests or cache-busting `_` to GET requests.
     */
    timestampMode?: 'body' | 'capture-body' | 'query'
    fetchOptions?: {
        cache?: RequestInit['cache']
        next?: NextOptions
    }
    /**
     * When set, `_send_request` invokes `callback` with a synthetic response
     * on the paths that otherwise drop a request without notifying the caller
     * (client not loaded, server rate limit). Opt-in so existing callers keep
     * their current behavior; the logs pipeline uses it to keep records for a
     * later retry instead of losing them silently.
     */
    fireCallbackOnDrop?: boolean
}

// Queued request types - the same as a request but with additional queueing information
export interface QueuedRequestWithOptions extends RequestWithOptions {
    /** key of queue, e.g. 'sessionRecording' vs 'event' */
    batchKey?: string
}

// Used explicitly for retriable requests
export interface RetriableRequestWithOptions extends QueuedRequestWithOptions {
    retriesPerformedSoFar?: number
}

/** the config stored in persistence when session recording remote config is received */
export type SessionRecordingPersistedConfig = Omit<
    SessionRecordingRemoteConfig,
    | 'recordCanvas'
    | 'canvasFps'
    | 'canvasQuality'
    | 'networkPayloadCapture'
    | 'sampleRate'
    | 'minimumDurationMilliseconds'
> & {
    /**
     * Used to determine if the persisted config is still valid or we need to wait for a new one
     * only accepts undefined since older versions of the library didn't set this.
     */
    cache_timestamp?: number
    enabled: boolean
    networkPayloadCapture: SessionRecordingRemoteConfig['networkPayloadCapture'] & {
        capturePerformance: RemoteConfig['capturePerformance']
    }
    canvasRecording: {
        enabled: SessionRecordingRemoteConfig['recordCanvas']
        fps: SessionRecordingRemoteConfig['canvasFps']
        quality: SessionRecordingRemoteConfig['canvasQuality']
    }
    // we don't allow string config here
    sampleRate: number | null
    minimumDurationMilliseconds: number | null | undefined
}

/**
 * Outcome of a remote config fetch: the config, or an explicit failure.
 * @internal
 */
export type RemoteConfigResult = { ok: true; config: RemoteConfig } | { ok: false }

/**
 * Flags returns feature flags and their payloads
 */
export interface FlagsResponse extends RemoteConfig {
    featureFlags: Record<string, string | boolean>
    featureFlagPayloads: Record<string, JsonType>
    errorsWhileComputingFlags: boolean
    requestId?: string
    flags: Record<string, FeatureFlagDetail>
    evaluatedAt?: number
    /**
     * Server-controlled gate for minimal `$feature_flag_called` events. `true` only when the
     * project opted in; omitted otherwise. Absence always means full events.
     */
    minimalFlagCalledEvents?: boolean
}

export type SiteAppGlobals = {
    event: {
        uuid: string
        event: EventName
        properties: Properties
        timestamp?: Date
        elements_chain?: string
        distinct_id?: string
    }
    person: {
        properties: Properties
    }
    groups: Record<string, { id: string; type: string; properties: Properties }>
}

export type SiteAppLoader = {
    id: string
    init: (config: { posthog: PostHog; callback: (success: boolean) => void }) => {
        processEvent?: (globals: SiteAppGlobals) => void
    }
}

export type SiteApp = {
    id: string
    loaded: boolean
    errored: boolean
    processedBuffer: boolean
    processEvent?: (globals: SiteAppGlobals) => void
}

export interface PersistentStore {
    _is_supported: () => boolean
    _error: (error: any) => void
    _parse: (name: string) => any
    _get: (name: string) => any
    // Returns whether the write was accepted without throwing. Backends that
    // swallow quota/serialization errors return false so callers can avoid
    // caching a write that never landed. This is best-effort, not a durable
    // -persistence guarantee — e.g. Safari private mode has historically
    // reported success on a write that did not persist.
    _set: (
        name: string,
        value: any,
        expire_days?: number | null,
        cross_subdomain?: boolean,
        secure?: boolean,
        debug?: boolean
    ) => boolean
    _remove: (name: string, cross_subdomain?: boolean) => void
}

export type EventHandler = (event: Event) => boolean | void

export type SnippetArrayItem = [method: string, ...args: any[]]

export type ErrorEventArgs = [
    event: string | Event,
    source?: string | undefined,
    lineno?: number | undefined,
    colno?: number | undefined,
    error?: Error | undefined,
]

// levels originally copied from Sentry to work with the sentry integration
// and to avoid relying on a frequently changing @sentry/types dependency
// but provided as an array of literal types, so we can constrain the level below
export const severityLevels = ['fatal', 'error', 'warning', 'log', 'info', 'debug'] as const

export type SessionStartReason =
    | 'sampling_overridden'
    | 'recording_initialized'
    | 'linked_flag_matched'
    | 'linked_flag_overridden'
    | typeof SAMPLED
    | 'session_id_changed'
    | 'url_trigger_matched'
    | 'event_trigger_matched'

export type OverrideConfig = {
    sampling: boolean
    linked_flag: boolean
    url_trigger: boolean
    event_trigger: boolean
}
