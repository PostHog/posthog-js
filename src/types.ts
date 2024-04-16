import type { MaskInputOptions, SlimDOMOptions } from 'rrweb-snapshot'
import { PostHog } from './posthog-core'
import type { SegmentAnalytics } from './extensions/segment-integration'

export type Property = any
export type Properties = Record<string, Property>

export interface CaptureResult {
    uuid: string
    event: string
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
     */
    url_allowlist?: (string | RegExp)[]

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
}

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
    capture_pageleave: boolean
    debug: boolean
    cookie_expiration: number
    upgrade: boolean
    disable_session_recording: boolean
    disable_persistence: boolean
    /** @deprecated - use `disable_persistence` instead  */
    disable_cookie?: boolean
    disable_surveys: boolean
    enable_recording_console_log?: boolean
    secure_cookie: boolean
    ip: boolean
    opt_out_capturing_by_default: boolean
    opt_out_persistence_by_default: boolean
    /** Opt out of user agent filtering such as googlebot or other bots. Defaults to `false` */
    opt_out_useragent_filter: boolean
    opt_out_capturing_persistence_type: 'localStorage' | 'cookie'
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
    sanitize_properties: ((properties: Properties, event_name: string) => Properties) | null
    properties_string_max_length: number
    session_recording: SessionRecordingOptions
    session_idle_timeout_seconds: number
    mask_all_element_attributes: boolean
    mask_all_text: boolean
    advanced_disable_decide: boolean
    advanced_disable_feature_flags: boolean
    advanced_disable_feature_flags_on_first_load: boolean
    advanced_disable_toolbar_metrics: boolean
    feature_flag_request_timeout_ms: number
    get_device_id: (uuid: string) => string
    name: string
    _onCapture: (eventName: string, eventData: CaptureResult) => void
    capture_performance?: boolean
    // Should only be used for testing. Could negatively impact performance.
    disable_compression: boolean
    bootstrap: BootstrapConfig
    segment?: SegmentAnalytics
    __preview_send_client_session_params?: boolean
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
    maskInputOptions?: MaskInputOptions
    maskInputFn?: ((text: string, element?: HTMLElement) => string) | null
    slimDOMOptions?: SlimDOMOptions | 'all' | true
    collectFonts?: boolean
    inlineStylesheet?: boolean
    recordCrossOriginIframes?: boolean
    /** @deprecated - use maskCapturedNetworkRequestFn instead  */
    maskNetworkRequestFn?: ((data: NetworkRequest) => NetworkRequest | null | undefined) | null
    /** Modify the network request before it is captured. Returning null or undefined stops it being captured */
    maskCapturedNetworkRequestFn?: ((data: CapturedNetworkRequest) => CapturedNetworkRequest | null | undefined) | null
    // our settings here only support a subset of those proposed for rrweb's network capture plugin
    recordHeaders?: boolean
    recordBody?: boolean
}

export type SessionIdChangedCallback = (sessionId: string, windowId: string | null | undefined) => void

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
    transport?: RequestOptions['transport'] /** if set, overrides the desired transport method */
    timestamp?: Date
}

export type FlagVariant = { flag: string; variant: string }

export interface DecideResponse {
    supportedCompression: Compression[]
    featureFlags: Record<string, string | boolean>
    featureFlagPayloads: Record<string, JsonType>
    errorsWhileComputingFlags: boolean
    autocapture_opt_out?: boolean
    capturePerformance?: boolean
    analytics?: {
        endpoint?: string
    }
    elementsChainAsString?: boolean
    // this is currently in development and may have breaking changes without a major version bump
    autocaptureExceptions?:
        | boolean
        | {
              endpoint?: string
              errors_to_ignore: string[]
          }
    sessionRecording?: {
        endpoint?: string
        consoleLogRecordingEnabled?: boolean
        // the API returns a decimal between 0 and 1 as a string
        sampleRate?: string | null
        minimumDurationMilliseconds?: number
        recordCanvas?: boolean | null
        canvasFps?: number | null
        // the API returns a decimal between 0 and 1 as a string
        canvasQuality?: string | null
        linkedFlag?: string | FlagVariant | null
        networkPayloadCapture?: Pick<NetworkRecordOptions, 'recordBody' | 'recordHeaders'>
    }
    surveys?: boolean
    toolbarParams: ToolbarParams
    editorParams?: ToolbarParams /** @deprecated, renamed to toolbarParams, still present on older API responses */
    toolbarVersion: 'toolbar' /** @deprecated, moved to toolbarParams */
    isAuthenticated: boolean
    siteApps: { id: number; url: string }[]
}

export type FeatureFlagsCallback = (
    flags: string[],
    variants: Record<string, string | boolean>,
    context?: {
        errorsLoading?: boolean
    }
) => void

export interface GDPROptions {
    capture?: (
        event: string,
        properties: Properties,
        options: CaptureOptions
    ) => void /** function used for capturing a PostHog event to record the opt-in action */
    captureEventName?: string /** event name to be used for capturing the opt-in action */
    captureProperties?: Properties /** set of properties to be captured along with the opt-in action */
    /** persistence mechanism used */
    persistenceType?: 'cookie' | 'localStorage' | 'localStorage+cookie'
    persistencePrefix?: string /** [__ph_opt_in_out] - custom prefix to be used in the cookie/localstorage name */
    cookieExpiration?: number /** number of days until the opt-in cookie expires */
    crossSubdomainCookie?: boolean /** whether the opt-in cookie is set as cross-subdomain or not */
    secureCookie?: boolean /** whether the opt-in cookie is set as secure or not */
    respectDnt?: boolean
    window?: Window
}

export interface PersistentStore {
    is_supported: () => boolean
    error: (error: any) => void
    parse: (name: string) => any
    get: (name: string) => any
    set: (name: string, value: any, expire_days?: number | null, cross_subdomain?: boolean, secure?: boolean) => void
    remove: (name: string, cross_subdomain?: boolean) => void
}

// eslint-disable-next-line @typescript-eslint/ban-types
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

export type JsonType = string | number | boolean | null | { [key: string]: JsonType } | Array<JsonType>

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
export type CapturedNetworkRequest = Omit<PerformanceEntry, 'toJSON'> & {
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
