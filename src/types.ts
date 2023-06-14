import type { MaskInputOptions, SlimDOMOptions } from 'rrweb-snapshot'
import { PostHog } from './posthog-core'
import { CaptureMetrics } from './capture-metrics'
import { RetryQueue } from './retry-queue'

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
export type CaptureCallback = (response: any, data: any) => void

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
     */
    element_allowlist?: AutocaptureCompatibleElement[]

    /**
     * List of CSS selectors to allow autocapture on
     * e.g. ['[ph-capture]']
     */
    css_selector_allowlist?: string[]
}

/**
 * Update the configuration of a posthog library instance.
 *
 * The default config is:
 *
 *     {
 *
 *
 *       // super properties cookie expiration (in days)
 *       cookie_expiration: 365
 *
 *       // super properties span subdomains
 *       cross_subdomain_cookie: true
 *
 *       // debug mode
 *       debug: false
 *
 *       // if this is true, the posthog cookie or localStorage entry
 *       // will be deleted, and no user persistence will take place
 *       disable_persistence: false
 *
 *       // if this is true, PostHog will automatically determine
 *       // City, Region and Country data using the IP address of
 *       //the client
 *       ip: true
 *
 *       // opt users out of capturing by this PostHog instance by default
 *       opt_out_capturing_by_default: false
 *
 *       // opt users out of browser data storage by this PostHog instance by default
 *       opt_out_persistence_by_default: false
 *
 *       // persistence mechanism used by opt-in/opt-out methods - cookie
 *       // or localStorage - falls back to cookie if localStorage is unavailable
 *       opt_out_capturing_persistence_type: 'localStorage'
 *
 *       // customize the name of cookie/localStorage set by opt-in/opt-out methods
 *       opt_out_capturing_cookie_prefix: null
 *
 *       // type of persistent store for super properties (cookie/
 *       // localStorage) if set to 'localStorage', any existing
 *       // posthog cookie value with the same persistence_name
 *       // will be transferred to localStorage and deleted
 *       persistence: 'cookie'
 *
 *       // name for super properties persistent store
 *       persistence_name: ''
 *
 *       // names of properties/superproperties which should never
 *       // be sent with capture() calls
 *       property_blacklist: []
 *
 *       // if this is true, posthog cookies will be marked as
 *       // secure, meaning they will only be transmitted over https
 *       secure_cookie: false
 *
 *       // should we capture a page view on page load
 *       capture_pageview: true
 *
 *       // if you set upgrade to be true, the library will check for
 *       // a cookie from our old js library and import super
 *       // properties from it, then the old cookie is deleted
 *       // The upgrade config option only works in the initialization,
 *       // so make sure you set it when you create the library.
 *       upgrade: false
 *
 *       // if this is true, session recording is always disabled.
 *       disable_session_recording: false,
 *
 *       // extra HTTP request headers to set for each API request, in
 *       // the format {'Header-Name': value}
 *       xhr_headers: {}
 *
 *       // protocol for fetching in-app message resources, e.g.
 *       // 'https://' or 'http://'; defaults to '//' (which defers to the
 *       // current page's protocol)
 *       inapp_protocol: '//'
 *
 *       // whether to open in-app message link in new tab/window
 *       inapp_link_new_window: false
 *
 *      // a set of rrweb config options that PostHog users can configure
 *      // see https://github.com/rrweb-io/rrweb/blob/master/guide.md
 *      session_recording: {
 *         blockClass: 'ph-no-capture',
 *         blockSelector: null,
 *         ignoreClass: 'ph-ignore-input',
 *         maskAllInputs: true,
 *         maskInputOptions: {},
 *         maskInputFn: null,
 *         slimDOMOptions: {},
 *         collectFonts: false
 *      }
 *
 *      // prevent autocapture from capturing any attribute names on elements
 *      mask_all_element_attributes: false
 *
 *      // prevent autocapture from capturing textContent on all elements
 *      mask_all_text: false
 *
 *      // Anonymous users get a random UUID as their device by default.
 *      // This option allows overriding that option.
 *      get_device_id: (uuid) => uuid
 *     }
 *
 *
 * @param {Object} config A dictionary of new configuration values to update
 */

export interface PostHogConfig {
    /** Automatically capture capture clicks, form submissions and change events (default: true) */
    autocapture: boolean | AutocaptureConfig
    /** PostHog API host (default: 'https://app.posthog.com) */
    api_host: string
    /** HTTP method for capturing requests (default: 'POST) */
    api_method: string
    /** transport for sending requests ('XHR' or 'sendBeacon')
     * NB: sendBeacon should only be used for scenarios such as page unload where a "best-effort" attempt to send is
     * acceptable; the sendBeacon API does not support callbacks or any way to know the result of the request. PostHog
     * capturing via sendBeacon will not support any event batching or retry mechanisms.
     */
    api_transport: string
    advanced_disable_decide: boolean
    advanced_disable_toolbar_metrics: boolean
    bootstrap: {
        distinctID?: string
        isIdentifiedID?: boolean
        featureFlags?: Record<string, boolean | string>
        featureFlagPayloads?: Record<string, JsonType>
    }
    callback_fn: string
    /** Capture pageleave event when the page unloads (default: true) */
    capture_pageleave: boolean
    /** Capture pageview event when the page loads (default: true) */
    capture_pageview: boolean
    /** Capture performance (network) information. Typically controlled remotely in the PostHog App */
    capture_performance?: boolean

    /** super properties cookie expiration in days (default: 365) */
    cookie_expiration: number
    cookie_name: string
    /** super properties span subdomains */
    cross_subdomain_cookie: boolean
    /** List of additional query params to be automatically captured */
    custom_campaign_params: string[]
    /** Start with debug mode enabled */
    debug: boolean
    disable_compression: boolean
    disable_cookie: boolean

    /** Disable persisting user data across pages. This will disable cookies, session storage and local storage. */
    disable_persistence: boolean
    /** Start with session recording disabled. If set this takes priority over the remote setting in the PostHog app */
    disable_session_recording: boolean
    /** Enable console log recording. If set this takes priority over the remote setting in the PostHog app */
    enable_recording_console_log?: boolean
    get_device_id: (uuid: string) => string
    ip: boolean
    inapp_link_new_window: boolean
    inapp_protocol: string
    loaded: (posthog_instance: PostHog) => void
    mask_all_element_attributes: boolean
    mask_all_text: boolean
    name: string
    opt_in_site_apps: boolean
    opt_out_capturing_by_default: boolean
    opt_out_capturing_cookie_prefix: string | null
    opt_out_capturing_persistence_type: 'localStorage' | 'cookie'
    opt_out_persistence_by_default: boolean
    on_xhr_error: (failedRequest: XMLHttpRequest) => void
    persistence: 'localStorage' | 'cookie' | 'memory' | 'localStorage+cookie' | 'sessionStorage'
    persistence_name: string
    property_blacklist: string[]
    properties_string_max_length: number
    rageclick: boolean
    request_batching: boolean
    respect_dnt: boolean
    save_referrer: boolean
    sanitize_properties: ((properties: Properties, event_name: string) => Properties) | null
    secure_cookie: boolean
    segment?: any
    session_idle_timeout_seconds: number
    session_recording: SessionRecordingOptions
    store_google: boolean
    test: boolean
    token: string
    /**  PostHog web app host, used when links to the PostHog app are generated.
     * This will only be different from api_host when using a reverse-proxied API host – in that case
     * the original web app host needs to be passed here so that links to the web app are still convenient.
     */
    ui_host: string | null
    upgrade: boolean
    verbose: boolean
    xhr_headers: { [header_name: string]: string }
    _capture_metrics: boolean
    _onCapture: (eventName: string, eventData: CaptureResult) => void
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

export interface isFeatureEnabledOptions {
    send_event: boolean
}

export interface SessionRecordingOptions {
    blockClass?: string | RegExp
    blockSelector?: string | null
    ignoreClass?: string
    maskTextClass?: string | RegExp
    maskTextSelector?: string | null
    maskTextFn?: ((text: string) => string) | null
    maskAllInputs?: boolean
    maskInputOptions?: MaskInputOptions
    maskInputFn?: ((text: string, element?: HTMLElement) => string) | null
    /** Modify the network request before it is captured. Returning null stops it being captured */
    maskNetworkRequestFn?: ((url: NetworkRequest) => NetworkRequest | null | undefined) | null
    slimDOMOptions?: SlimDOMOptions | 'all' | true
    collectFonts?: boolean
    inlineStylesheet?: boolean
    recorderVersion?: 'v1' | 'v2'
    recordCrossOriginIframes?: boolean
}

export enum Compression {
    GZipJS = 'gzip-js',
    Base64 = 'base64',
}

export interface XHROptions {
    transport?: 'XHR' | 'sendBeacon'
    method?: 'POST' | 'GET'
    urlQueryArgs?: { compression: Compression }
    verbose?: boolean
    blob?: boolean
    sendBeacon?: boolean
}

export interface CaptureOptions extends XHROptions {
    $set?: Properties /** used with $identify */
    $set_once?: Properties /** used with $identify */
    _batchKey?: string /** key of queue, e.g. 'sessionRecording' vs 'event' */
    _metrics?: Properties
    _noTruncate?: boolean /** if set, overrides and disables config.properties_string_max_length */
    endpoint?: string /** defaults to '/e/' */
    send_instantly?: boolean /** if set skips the batched queue */
    timestamp?: Date
}

export interface RetryQueueElement {
    retryAt: Date
    requestData: QueuedRequestData
}
export interface QueuedRequestData {
    url: string
    data: Properties
    options: CaptureOptions
    headers?: Properties
    callback?: RequestCallback
    retriesPerformedSoFar?: number
}

export interface XHRParams extends QueuedRequestData {
    captureMetrics: CaptureMetrics
    retryQueue: RetryQueue
    onXHRError: (req: XMLHttpRequest) => void
    timeout?: number
}

export interface DecideResponse {
    status: number
    supportedCompression: Compression[]
    config: {
        enable_collect_everything: boolean
    }
    custom_properties: AutoCaptureCustomProperty[] // TODO: delete, not sent
    featureFlags: Record<string, string | boolean>
    featureFlagPayloads: Record<string, JsonType>
    errorsWhileComputingFlags: boolean
    autocapture_opt_out?: boolean
    capturePerformance?: boolean
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
        recorderVersion?: 'v1' | 'v2'
    }
    toolbarParams: ToolbarParams
    editorParams?: ToolbarParams /** @deprecated, renamed to toolbarParams, still present on older API responses */
    toolbarVersion: 'toolbar' /** @deprecated, moved to toolbarParams */
    isAuthenticated: boolean
    siteApps: { id: number; url: string }[]
}

export type FeatureFlagsCallback = (flags: string[], variants: Record<string, string | boolean>) => void

// TODO: delete custom_properties after changeless typescript refactor
export interface AutoCaptureCustomProperty {
    name: string
    css_selector: string
    event_selectors: string[]
}

export interface CompressionData {
    data: string
    compression?: Compression
}

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

export type RequestCallback = (response: Record<string, any>, data?: Properties) => void

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

export interface PostData {
    buffer?: BlobPart
    compression?: Compression
    data?: string
}

export interface JSC {
    (): void
    [key: string]: (response: any) => void
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

export type NetworkRequest = {
    url: string
}

export interface Survey {
    // Sync this with the backend's SurveySerializer!
    name: string
    description: string
    type: SurveyType
    linked_flag_key?: string | null
    targeting_flag_key?: string | null
    questions: SurveyQuestion[]
    appearance?: SurveyAppearance | null
    conditions?: { url?: string; selector?: string } | null
    start_date?: string | null
    end_date?: string | null
}

export interface SurveyAppearance {
    background_color?: string
    button_color?: string
    text_color?: string
}

export enum SurveyType {
    Popover = 'Popover',
    Button = 'Button',
    Email = 'Email',
    FullScreen = 'Fullscreen',
}

export interface SurveyQuestion {
    type: SurveyQuestionType
    question: string
    required?: boolean
    link?: boolean
    choices?: string[]
}

export enum SurveyQuestionType {
    Open = 'open',
    MultipleChoiceSingle = 'multiple_single',
    MultipleChoiceMulti = 'multiple_multi',
    NPS = 'nps',
    Rating = 'rating',
    Link = 'link',
}

export type SurveyCallback = (surveys: Survey[]) => void

export interface SurveyResponse {
    surveys: Survey[]
}
