import { PostHog } from './posthog-core'
import type { SegmentAnalytics } from './extensions/segment-integration'
import { recordOptions } from './extensions/replay/sessionrecording-utils'

export type Property = any
export type Properties = Record<string, Property>

export const COPY_AUTOCAPTURE_EVENT = '$copy_autocapture'

export const knownUnsafeEditableEvent = [
    '$snapshot',
    '$pageview',
    '$pageleave',
    '$set',
    'survey dismissed',
    'survey sent',
    'survey shown',
    '$identify',
    '$groupidentify',
    '$create_alias',
    '$$client_ingestion_warning',
    '$web_experiment_applied',
    '$feature_enrollment_update',
    '$feature_flag_called',
] as const

/**
 * These events can be processed by the `beforeCapture` function
 * but can cause unexpected confusion in data.
 *
 * Some features of PostHog rely on receiving 100% of these events
 */
export type KnownUnsafeEditableEvent = (typeof knownUnsafeEditableEvent)[number]

/**
 * These are known events PostHog events that can be processed by the `beforeCapture` function
 * That means PostHog functionality does not rely on receiving 100% of these for calculations
 * So, it is safe to sample them to reduce the volume of events sent to PostHog
 */
export type KnownEventName =
    | '$heatmaps_data'
    | '$opt_in'
    | '$exception'
    | '$$heatmap'
    | '$web_vitals'
    | '$dead_click'
    | '$autocapture'
    | typeof COPY_AUTOCAPTURE_EVENT
    | '$rageclick'

export type EventName =
    | KnownUnsafeEditableEvent
    | KnownEventName
    // magic value so that the type of EventName is a set of known strings or any other string
    // which means you get autocomplete for known strings
    // but no type complaints when you add an arbitrary string
    | (string & {})

export interface CaptureResult {
    uuid: string
    event: EventName
    properties: Properties
    $set?: Properties
    $set_once?: Properties
    timestamp?: Date
}

export type AutocaptureCompatibleElement = 'a' | 'button' | 'form' | 'input' | 'select' | 'textarea' | 'label'
export type DomAutocaptureEvents = 'click' | 'change' | 'submit'

/**
 * If an array is passed for an allowlist, autocapture events will only be sent for elements matching
 * at least one of the elements in the array. Multiple allowlists can be used
 */
export interface AutocaptureConfig {
    /**
     * List of URLs to allow autocapture on, can be strings to match
     * or regexes e.g. ['https://example.com', 'test.com/.*']
     * this is useful when you want to autocapture on specific pages only
     *
     * if you set both url_allowlist and url_ignorelist,
     * we check the allowlist first and then the ignorelist.
     * the ignorelist can override the allowlist
     */
    url_allowlist?: (string | RegExp)[]

    /**
     * List of URLs to not allow autocapture on, can be strings to match
     * or regexes e.g. ['https://example.com', 'test.com/.*']
     * this is useful when you want to autocapture on most pages but not some specific ones
     *
     * if you set both url_allowlist and url_ignorelist,
     * we check the allowlist first and then the ignorelist.
     * the ignorelist can override the allowlist
     */
    url_ignorelist?: (string | RegExp)[]

    /**
     * List of DOM events to allow autocapture on  e.g. ['click', 'change', 'submit']
     */
    dom_event_allowlist?: DomAutocaptureEvents[]

    /**
     * List of DOM elements to allow autocapture on
     * e.g. ['a', 'button', 'form', 'input', 'select', 'textarea', 'label']
     * we consider the tree of elements from the root to the target element of the click event
     * so for the tree div > div > button > svg
     * if the allowlist has button then we allow the capture when the button or the svg is the click target
     * but not if either of the divs are detected as the click target
     */
    element_allowlist?: AutocaptureCompatibleElement[]

    /**
     * List of CSS selectors to allow autocapture on
     * e.g. ['[ph-capture]']
     * we consider the tree of elements from the root to the target element of the click event
     * so for the tree div > div > button > svg
     * and allow list config `['[id]']`
     * we will capture the click if the click-target or its parents has any id
     */
    css_selector_allowlist?: string[]

    /**
     * Exclude certain element attributes from autocapture
     * E.g. ['aria-label'] or [data-attr-pii]
     */
    element_attribute_ignorelist?: string[]

    capture_copied_text?: boolean
}

export interface BootstrapConfig {
    distinctID?: string
    isIdentifiedID?: boolean
    featureFlags?: Record<string, boolean | string>
    featureFlagPayloads?: Record<string, JsonType>
    /**
     * Optionally provide a sessionID, this is so that you can provide an existing sessionID here to continue a user's session across a domain or device. It MUST be:
     * - unique to this user
     * - a valid UUID v7
     * - the timestamp part must be <= the timestamp of the first event in the session
     * - the timestamp of the last event in the session must be < the timestamp part + 24 hours
     * **/
    sessionID?: string
}

export type SupportedWebVitalsMetrics = 'LCP' | 'CLS' | 'FCP' | 'INP'

export interface PerformanceCaptureConfig {
    /** works with session replay to use the browser's native performance observer to capture performance metrics */
    network_timing?: boolean
    /** use chrome's web vitals library to wrap fetch and capture web vitals */
    web_vitals?: boolean
    /**
     * We observe very large values reported by the Chrome web vitals library
     * These outliers are likely not real, useful values, and we exclude them
     * You can set this to 0 in order to include all values, NB this is not recommended
     * if not set this defaults to 15 minutes
     */
    __web_vitals_max_value?: number
    /**
     * By default all 4 metrics are captured
     * You can set this config to restrict which metrics are captured
     * e.g. ['CLS', 'FCP'] to only capture those two metrics
     * NB setting this does not override whether the capture is enabled
     */
    web_vitals_allowed_metrics?: SupportedWebVitalsMetrics[]
    /**
     * we delay flushing web vitals metrics to reduce the number of events we send
     * this is the maximum time we will wait before sending the metrics
     * if not set it defaults to 5 seconds
     */
    web_vitals_delayed_flush_ms?: number
}

export interface DeadClickCandidate {
    node: Element
    originalEvent: MouseEvent
    timestamp: number
    // time between click and the most recent scroll
    scrollDelayMs?: number
    // time between click and the most recent mutation
    mutationDelayMs?: number
    // time between click and the most recent selection changed event
    selectionChangedDelayMs?: number
    // if neither scroll nor mutation seen before threshold passed
    absoluteDelayMs?: number
}

export type DeadClicksAutoCaptureConfig = {
    // by default if a click is followed by a sroll within 100ms it is not a dead click
    scroll_threshold_ms?: number
    // by default if a click is followed by a selection change within 100ms it is not a dead click
    selection_change_threshold_ms?: number
    // by default if a click is followed by a mutation within 2500ms it is not a dead click
    mutation_threshold_ms?: number
    /**
     * Allows setting behavior for when a dead click is captured.
     * For e.g. to support capture to heatmaps
     *
     * If not provided the default behavior is to auto-capture dead click events
     *
     * Only intended to be provided by the SDK
     */
    __onCapture?: ((click: DeadClickCandidate, properties: Properties) => void) | undefined
} & Pick<AutocaptureConfig, 'element_attribute_ignorelist'>

export interface HeatmapConfig {
    /*
     * how often to send batched data in $$heatmap_data events
     * if set to 0 or not set, sends using the default interval of 1 second
     * */
    flush_interval_milliseconds: number
}

export type BeforeSendFn = (cr: CaptureResult | null) => CaptureResult | null

export interface PostHogConfig {
    api_host: string
    /** @deprecated - This property is no longer supported */
    api_method?: string
    api_transport?: 'XHR' | 'fetch'
    ui_host: string | null
    token: string
    autocapture: boolean | AutocaptureConfig
    rageclick: boolean
    cross_subdomain_cookie: boolean
    persistence: 'localStorage' | 'cookie' | 'memory' | 'localStorage+cookie' | 'sessionStorage'
    persistence_name: string
    /** @deprecated - Use 'persistence_name' instead */
    cookie_name?: string
    loaded: (posthog_instance: PostHog) => void
    store_google: boolean
    custom_campaign_params: string[]
    // a list of strings to be tested against navigator.userAgent to determine if the source is a bot
    // this is **added to** the default list of bots that we check
    // defaults to the empty array
    custom_blocked_useragents: string[]
    save_referrer: boolean
    verbose: boolean
    capture_pageview: boolean
    capture_pageleave: boolean | 'if_capture_pageview'
    debug: boolean
    cookie_expiration: number
    upgrade: boolean
    disable_session_recording: boolean
    disable_persistence: boolean
    /** @deprecated - use `disable_persistence` instead  */
    disable_cookie?: boolean
    disable_surveys: boolean
    disable_web_experiments: boolean
    /** If set, posthog-js will never load external scripts such as those needed for Session Replay or Surveys. */
    disable_external_dependency_loading?: boolean
    prepare_external_dependency_script?: (script: HTMLScriptElement) => HTMLScriptElement | null
    enable_recording_console_log?: boolean
    secure_cookie: boolean
    ip: boolean
    /** Starts the SDK in an opted out state requiring opt_in_capturing() to be called before events will b captured  */
    opt_out_capturing_by_default: boolean
    opt_out_capturing_persistence_type: 'localStorage' | 'cookie'
    /** If set to true this will disable persistence if the user is opted out of capturing. @default false */
    opt_out_persistence_by_default?: boolean
    /** Opt out of user agent filtering such as googlebot or other bots. Defaults to `false` */
    opt_out_useragent_filter: boolean

    opt_out_capturing_cookie_prefix: string | null
    opt_in_site_apps: boolean
    respect_dnt: boolean
    /** @deprecated - use `property_denylist` instead  */
    property_blacklist?: string[]
    property_denylist: string[]
    request_headers: { [header_name: string]: string }
    on_request_error?: (error: RequestResponse) => void
    /** @deprecated - use `request_headers` instead  */
    xhr_headers?: { [header_name: string]: string }
    /** @deprecated - use `on_request_error` instead  */
    on_xhr_error?: (failedRequest: XMLHttpRequest) => void
    inapp_protocol: string
    inapp_link_new_window: boolean
    request_batching: boolean
    properties_string_max_length: number
    session_recording: SessionRecordingOptions
    session_idle_timeout_seconds: number
    mask_all_element_attributes: boolean
    mask_all_text: boolean
    mask_personal_data_properties: boolean
    custom_personal_data_properties: string[]
    advanced_disable_decide: boolean
    advanced_disable_feature_flags: boolean
    advanced_disable_feature_flags_on_first_load: boolean
    advanced_disable_toolbar_metrics: boolean
    feature_flag_request_timeout_ms: number
    get_device_id: (uuid: string) => string
    name: string

    /**
     * This function is called when collecting properties for an event.
     * It allows you to edit data before it is sent
     * @deprecated - use `before_send` instead
     */
    sanitize_properties: ((properties: Properties, event_name: string) => Properties) | null
    /**
     * this is a read-only function that can be used to react to event capture
     * @deprecated - use `before_send` instead - NB before_send is not read only
     */
    _onCapture: (eventName: string, eventData: CaptureResult) => void
    /**
     * This function or array of functions - if provided - are called immediately before sending data to the server.
     * It allows you to edit data before it is sent, or choose not to send it all.
     * if provided as an array the functions are called in the order they are provided
     * any one function returning null means the event will not be sent
     */
    before_send?: BeforeSendFn | BeforeSendFn[]
    capture_performance?: boolean | PerformanceCaptureConfig
    // Should only be used for testing. Could negatively impact performance.
    disable_compression: boolean
    bootstrap: BootstrapConfig
    segment?: SegmentAnalytics
    __preview_send_client_session_params?: boolean
    /* @deprecated - use `capture_heatmaps` instead */
    enable_heatmaps?: boolean
    capture_heatmaps?: boolean | HeatmapConfig
    capture_dead_clicks?: boolean | DeadClicksAutoCaptureConfig
    disable_scroll_properties?: boolean
    // Let the pageview scroll stats use a custom css selector for the root element, e.g. `main`
    scroll_root_selector?: string | string[]

    /** You can control whether events from PostHog-js have person processing enabled with the `person_profiles` config setting. There are three options:
     * - `person_profiles: 'always'` _(default)_ - we will process persons data for all events
     * - `person_profiles: 'never'` - we won't process persons for any event. This means that anonymous users will not be merged once they sign up or login, so you lose the ability to create funnels that track users from anonymous to identified. All events (including `$identify`) will be sent with `$process_person_profile: False`.
     * - `person_profiles: 'identified_only'` - we will only process persons when you call `posthog.identify`, `posthog.alias`, `posthog.setPersonProperties`, `posthog.group`, `posthog.setPersonPropertiesForFlags` or `posthog.setGroupPropertiesForFlags` Anonymous users won't get person profiles.
     */
    person_profiles?: 'always' | 'never' | 'identified_only'
    /** @deprecated - use `person_profiles` instead  */
    process_person?: 'always' | 'never' | 'identified_only'

    /** Client side rate limiting */
    rate_limiting?: {
        /** The average number of events per second that should be permitted (defaults to 10) */
        events_per_second?: number
        /** How many events can be captured in a burst. This defaults to 10 times the events_per_second count  */
        events_burst_limit?: number
    }

    /** Used when sending data via `fetch`, use with care, this is intentionally meant to be used with NextJS `fetch`
     *  Incorrect usage may cause out-of-date data for feature flags, actions tracking, etc.
     *  See https://nextjs.org/docs/app/api-reference/functions/fetch#fetchurl-options
     */
    fetch_options?: {
        cache?: RequestInit['cache']
        next_options?: NextOptions
    }

    /**
     * PREVIEW - MAY CHANGE WITHOUT WARNING - DO NOT USE IN PRODUCTION
     * whether to wrap fetch and add tracing headers to the request
     * */
    __add_tracing_headers?: boolean

    /**
     * PREVIEW - MAY CHANGE WITHOUT WARNING - DO NOT USE IN PRODUCTION
     * enables the new RemoteConfig approach to loading config instead of decide
     * */
    __preview_remote_config?: boolean

    /**
     * PREVIEW - MAY CHANGE WITHOUT WARNING - DO NOT USE IN PRODUCTION
     * whether to send a sentinel value for distinct id, device id, and session id, which will be replaced server-side by a cookieless hash
     * */
    __preview_experimental_cookieless_mode?: boolean
}

export interface OptInOutCapturingOptions {
    capture: (event: string, properties: Properties, options: CaptureOptions) => void
    capture_event_name: string
    capture_properties: Properties
    enable_persistence: boolean
    clear_persistence: boolean
    persistence_type: 'cookie' | 'localStorage' | 'localStorage+cookie'
    cookie_prefix: string
    cookie_expiration: number
    cross_subdomain_cookie: boolean
    secure_cookie: boolean
}

export interface IsFeatureEnabledOptions {
    send_event: boolean
}

export interface SessionRecordingOptions {
    blockClass?: string | RegExp
    blockSelector?: string | null
    ignoreClass?: string
    maskTextClass?: string | RegExp
    maskTextSelector?: string | null
    maskTextFn?: ((text: string, element: HTMLElement | null) => string) | null
    maskAllInputs?: boolean
    maskInputOptions?: recordOptions['maskInputOptions']
    maskInputFn?: ((text: string, element?: HTMLElement) => string) | null
    slimDOMOptions?: recordOptions['slimDOMOptions']
    collectFonts?: boolean
    inlineStylesheet?: boolean
    recordCrossOriginIframes?: boolean
    /**
     * Allows local config to override remote canvas recording settings from the decide response
     */
    captureCanvas?: SessionRecordingCanvasOptions
    /** @deprecated - use maskCapturedNetworkRequestFn instead  */
    maskNetworkRequestFn?: ((data: NetworkRequest) => NetworkRequest | null | undefined) | null
    /** Modify the network request before it is captured. Returning null or undefined stops it being captured */
    maskCapturedNetworkRequestFn?: ((data: CapturedNetworkRequest) => CapturedNetworkRequest | null | undefined) | null
    // our settings here only support a subset of those proposed for rrweb's network capture plugin
    recordHeaders?: boolean
    recordBody?: boolean
    // ADVANCED: while a user is active we take a full snapshot of the browser every interval. For very few sites playback performance might be better with different interval. Set to 0 to disable
    full_snapshot_interval_millis?: number
    /*
     ADVANCED: whether to partially compress rrweb events before sending them to the server,
     defaults to true, can be set to false to disable partial compression
     NB requests are still compressed when sent to the server regardless of this setting
    */
    compress_events?: boolean
    /*
     ADVANCED: alters the threshold before a recording considers a user has become idle.
     Normally only altered alongside changes to session_idle_timeout_ms.
     Default is 5 minutes.
    */
    session_idle_threshold_ms?: number
    /*
     ADVANCED: alters the refill rate for the token bucket mutation throttling
     Normally only altered alongside posthog support guidance.
     Accepts values between 0 and 100
     Default is 10.
    */
    __mutationRateLimiterRefillRate?: number
    /*
     ADVANCED: alters the bucket size for the token bucket mutation throttling
     Normally only altered alongside posthog support guidance.
     Accepts values between 0 and 100
     Default is 100.
    */
    __mutationRateLimiterBucketSize?: number
}

export type SessionIdChangedCallback = (
    sessionId: string,
    windowId: string | null | undefined,
    changeReason?: { noSessionId: boolean; activityTimeout: boolean; sessionPastMaximumLength: boolean }
) => void

export enum Compression {
    GZipJS = 'gzip-js',
    Base64 = 'base64',
}

// Request types - these should be kept minimal to what request.ts needs

// Minimal class to allow interop between different request methods (xhr / fetch)
export interface RequestResponse {
    statusCode: number
    text?: string
    json?: any
}

export type RequestCallback = (response: RequestResponse) => void

// See https://nextjs.org/docs/app/api-reference/functions/fetch#fetchurl-options
type NextOptions = { revalidate: false | 0 | number; tags: string[] }

export interface RequestOptions {
    url: string
    // Data can be a single object or an array of objects when batched
    data?: Record<string, any> | Record<string, any>[]
    headers?: Record<string, any>
    transport?: 'XHR' | 'fetch' | 'sendBeacon'
    method?: 'POST' | 'GET'
    urlQueryArgs?: { compression: Compression }
    callback?: RequestCallback
    timeout?: number
    noRetries?: boolean
    compression?: Compression | 'best-available'
    fetchOptions?: {
        cache?: RequestInit['cache']
        next?: NextOptions
    }
}

// Queued request types - the same as a request but with additional queueing information

export interface QueuedRequestOptions extends RequestOptions {
    batchKey?: string /** key of queue, e.g. 'sessionRecording' vs 'event' */
}

// Used explicitly for retriable requests
export interface RetriableRequestOptions extends QueuedRequestOptions {
    retriesPerformedSoFar?: number
}

export interface CaptureOptions {
    $set?: Properties /** used with $identify */
    $set_once?: Properties /** used with $identify */
    _url?: string /** Used to override the desired endpoint for the captured event */
    _batchKey?: string /** key of queue, e.g. 'sessionRecording' vs 'event' */
    _noTruncate?: boolean /** if set, overrides and disables config.properties_string_max_length */
    send_instantly?: boolean /** if set skips the batched queue */
    skip_client_rate_limiting?: boolean /** if set skips the client side rate limiting */
    transport?: RequestOptions['transport'] /** if set, overrides the desired transport method */
    timestamp?: Date
}

export type FlagVariant = { flag: string; variant: string }

export type SessionRecordingCanvasOptions = {
    recordCanvas?: boolean | null
    canvasFps?: number | null
    // the API returns a decimal between 0 and 1 as a string
    canvasQuality?: string | null
}

export interface RemoteConfig {
    supportedCompression: Compression[]
    autocapture_opt_out?: boolean
    /**
     *     originally capturePerformance was replay only and so boolean true
     *     is equivalent to { network_timing: true }
     *     now capture performance can be separately enabled within replay
     *     and as a standalone web vitals tracker
     *     people can have them enabled separately
     *     they work standalone but enhance each other
     *     TODO: deprecate this so we make a new config that doesn't need this explanation
     */
    capturePerformance?: boolean | PerformanceCaptureConfig
    analytics?: {
        endpoint?: string
    }
    elementsChainAsString?: boolean
    // this is currently in development and may have breaking changes without a major version bump
    autocaptureExceptions?: boolean | { endpoint?: string }
    sessionRecording?: SessionRecordingCanvasOptions & {
        endpoint?: string
        consoleLogRecordingEnabled?: boolean
        // the API returns a decimal between 0 and 1 as a string
        sampleRate?: string | null
        minimumDurationMilliseconds?: number
        linkedFlag?: string | FlagVariant | null
        networkPayloadCapture?: Pick<NetworkRecordOptions, 'recordBody' | 'recordHeaders'>
        urlTriggers?: SessionRecordingUrlTrigger[]
        scriptConfig?: { script?: string | undefined }
        urlBlocklist?: SessionRecordingUrlTrigger[]
        eventTriggers?: string[]
    }
    surveys?: boolean
    toolbarParams: ToolbarParams
    editorParams?: ToolbarParams /** @deprecated, renamed to toolbarParams, still present on older API responses */
    toolbarVersion: 'toolbar' /** @deprecated, moved to toolbarParams */
    isAuthenticated: boolean
    siteApps: { id: string; url: string }[]
    heatmaps?: boolean
    defaultIdentifiedOnly?: boolean
    captureDeadClicks?: boolean
    hasFeatureFlags?: boolean // Indicates if the team has any flags enabled (if not we don't need to load them)
}

export interface DecideResponse extends RemoteConfig {
    featureFlags: Record<string, string | boolean>
    featureFlagPayloads: Record<string, JsonType>
    errorsWhileComputingFlags: boolean
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
    processEvent?: (globals: SiteAppGlobals) => void
}

export type FeatureFlagsCallback = (
    flags: string[],
    variants: Record<string, string | boolean>,
    context?: {
        errorsLoading?: boolean
    }
) => void

export interface PersistentStore {
    is_supported: () => boolean
    error: (error: any) => void
    parse: (name: string) => any
    get: (name: string) => any
    set: (
        name: string,
        value: any,
        expire_days?: number | null,
        cross_subdomain?: boolean,
        secure?: boolean,
        debug?: boolean
    ) => void
    remove: (name: string, cross_subdomain?: boolean) => void
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Breaker = {}
export type EventHandler = (event: Event) => boolean | void

export type ToolbarUserIntent = 'add-action' | 'edit-action'
export type ToolbarSource = 'url' | 'localstorage'
export type ToolbarVersion = 'toolbar'

/* sync with posthog */
export interface ToolbarParams {
    token?: string /** public posthog-js token */
    temporaryToken?: string /** private temporary user token */
    actionId?: number
    userIntent?: ToolbarUserIntent
    source?: ToolbarSource
    toolbarVersion?: ToolbarVersion
    instrument?: boolean
    distinctId?: string
    userEmail?: string
    dataAttributes?: string[]
    featureFlags?: Record<string, string | boolean>
}

export type SnippetArrayItem = [method: string, ...args: any[]]

export type JsonRecord = { [key: string]: JsonType }
export type JsonType = string | number | boolean | null | JsonRecord | Array<JsonType>

/** A feature that isn't publicly available yet.*/
export interface EarlyAccessFeature {
    // Sync this with the backend's EarlyAccessFeatureSerializer!
    name: string
    description: string
    stage: 'concept' | 'alpha' | 'beta'
    documentationUrl: string | null
    flagKey: string | null
}

export type EarlyAccessFeatureCallback = (earlyAccessFeatures: EarlyAccessFeature[]) => void

export interface EarlyAccessFeatureResponse {
    earlyAccessFeatures: EarlyAccessFeature[]
}

export type Headers = Record<string, string>

/* for rrweb/network@1
 ** when that is released as part of rrweb this can be removed
 ** don't rely on this type, it may change without notice
 */
export type InitiatorType =
    | 'audio'
    | 'beacon'
    | 'body'
    | 'css'
    | 'early-hint'
    | 'embed'
    | 'fetch'
    | 'frame'
    | 'iframe'
    | 'icon'
    | 'image'
    | 'img'
    | 'input'
    | 'link'
    | 'navigation'
    | 'object'
    | 'ping'
    | 'script'
    | 'track'
    | 'video'
    | 'xmlhttprequest'

export type NetworkRecordOptions = {
    initiatorTypes?: InitiatorType[]
    maskRequestFn?: (data: CapturedNetworkRequest) => CapturedNetworkRequest | undefined
    recordHeaders?: boolean | { request: boolean; response: boolean }
    recordBody?: boolean | string[] | { request: boolean | string[]; response: boolean | string[] }
    recordInitialRequests?: boolean
    /**
     * whether to record PerformanceEntry events for network requests
     */
    recordPerformance?: boolean
    /**
     * the PerformanceObserver will only observe these entry types
     */
    performanceEntryTypeToObserve: string[]
    /**
     * the maximum size of the request/response body to record
     * NB this will be at most 1MB even if set larger
     */
    payloadSizeLimitBytes: number
    /**
     * some domains we should never record the payload
     * for example other companies session replay ingestion payloads aren't super useful but are gigantic
     * if this isn't provided we use a default list
     * if this is provided - we add the provided list to the default list
     * i.e. we never record the payloads on the default deny list
     */
    payloadHostDenyList?: string[]
}

/** @deprecated - use CapturedNetworkRequest instead  */
export type NetworkRequest = {
    url: string
}

// In rrweb this is called NetworkRequest, but we already exposed that as having only URL
// we also want to vary from the rrweb NetworkRequest because we want to include
// all PerformanceEntry properties too.
// that has 4 required properties
//     readonly duration: DOMHighResTimeStamp;
//     readonly entryType: string;
//     readonly name: string;
//     readonly startTime: DOMHighResTimeStamp;
// NB: properties below here are ALPHA, don't rely on them, they may change without notice

// we mirror PerformanceEntry since we read into this type from a PerformanceObserver,
// but we don't want to inherit its readonly-iness
type Writable<T> = { -readonly [P in keyof T]: T[P] }

export type CapturedNetworkRequest = Writable<Omit<PerformanceEntry, 'toJSON'>> & {
    // properties below here are ALPHA, don't rely on them, they may change without notice
    method?: string
    initiatorType?: InitiatorType
    status?: number
    timeOrigin?: number
    timestamp?: number
    startTime?: number
    endTime?: number
    requestHeaders?: Headers
    requestBody?: string | null
    responseHeaders?: Headers
    responseBody?: string | null
    // was this captured before fetch/xhr could have been wrapped
    isInitial?: boolean
}

export type ErrorEventArgs = [
    event: string | Event,
    source?: string | undefined,
    lineno?: number | undefined,
    colno?: number | undefined,
    error?: Error | undefined,
]

export type ErrorMetadata = {
    handled?: boolean
    synthetic?: boolean
    syntheticException?: Error
    overrideExceptionType?: string
    overrideExceptionMessage?: string
    defaultExceptionType?: string
    defaultExceptionMessage?: string
}

// levels originally copied from Sentry to work with the sentry integration
// and to avoid relying on a frequently changing @sentry/types dependency
// but provided as an array of literal types, so we can constrain the level below
export const severityLevels = ['fatal', 'error', 'warning', 'log', 'info', 'debug'] as const
export declare type SeverityLevel = (typeof severityLevels)[number]

export interface ErrorProperties {
    $exception_type: string
    $exception_message: string
    $exception_level: SeverityLevel
    $exception_source?: string
    $exception_lineno?: number
    $exception_colno?: number
    $exception_DOMException_code?: string
    $exception_is_synthetic?: boolean
    $exception_stack_trace_raw?: string
    $exception_handled?: boolean
    $exception_personURL?: string
}

export interface ErrorConversions {
    errorToProperties: (args: ErrorEventArgs) => ErrorProperties
    unhandledRejectionToProperties: (args: [ev: PromiseRejectionEvent]) => ErrorProperties
}

export interface SessionRecordingUrlTrigger {
    url: string
    matching: 'regex'
}
