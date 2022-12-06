import { MaskInputOptions, SlimDOMOptions } from 'rrweb-snapshot'
import { PostHog } from './posthog-core'
import { CaptureMetrics } from './capture-metrics'
import { RetryQueue } from './retry-queue'

export type Property = any
export type Properties = Record<string, Property>
export interface CaptureResult {
    event: string
    properties: Properties
    $set?: Properties
    timestamp?: Date
}
export type CaptureCallback = (response: any, data: any) => void

export type UsefulElements = 'a' | 'button' | 'form' | 'input' | 'select' | 'textarea' | 'label'
export type AutocaptureEvents = 'click' | 'change' | 'submit'

export interface AutocaptureConfig {
    url_allowlist?: string[] | RegExp[]
    event_allowlist?: AutocaptureEvents[]
    element_allowlist?: UsefulElements[]
    css_selector_allowlist?: string[]
}

export interface PostHogConfig {
    api_host: string
    api_method: string
    api_transport: string
    ui_host: string | null
    token: string
    autocapture: boolean | AutocaptureConfig
    rageclick: boolean
    cross_subdomain_cookie: boolean
    persistence: 'localStorage' | 'cookie' | 'memory' | 'localStorage+cookie'
    persistence_name: string
    cookie_name: string
    loaded: (posthog_instance: PostHog) => void
    store_google: boolean
    save_referrer: boolean
    test: boolean
    verbose: boolean
    img: boolean
    capture_pageview: boolean
    debug: boolean
    cookie_expiration: number
    upgrade: boolean
    disable_session_recording: boolean
    disable_persistence: boolean
    disable_cookie: boolean
    enable_recording_console_log?: boolean
    secure_cookie: boolean
    ip: boolean
    opt_out_capturing_by_default: boolean
    opt_out_persistence_by_default: boolean
    opt_out_capturing_persistence_type: 'localStorage' | 'cookie'
    opt_out_capturing_cookie_prefix: string | null
    opt_in_site_apps: boolean
    respect_dnt: boolean
    property_blacklist: string[]
    xhr_headers: { [header_name: string]: string }
    on_xhr_error: (failedRequest: XMLHttpRequest) => void
    inapp_protocol: string
    inapp_link_new_window: boolean
    request_batching: boolean
    sanitize_properties: ((properties: Properties, event_name: string) => Properties) | null
    properties_string_max_length: number
    session_recording: SessionRecordingOptions
    mask_all_element_attributes: boolean
    mask_all_text: boolean
    advanced_disable_decide: boolean
    advanced_disable_toolbar_metrics: boolean
    get_device_id: (uuid: string) => string
    name: string
    callback_fn: string
    _onCapture: (eventName: string, eventData: CaptureResult) => void
    _capture_metrics: boolean
    _capture_performance: boolean
    // Should only be used for testing. Could negatively impact performance.
    disable_compression: boolean
    bootstrap: {
        distinctID?: string
        isIdentifiedID?: boolean
        featureFlags?: Record<string, boolean | string>
    }
    segment?: any
}

export interface OptInOutCapturingOptions {
    capture: (event: string, properties: Properties, options: CaptureOptions) => void
    capture_event_name: string
    capture_properties: Properties
    enable_persistence: boolean
    clear_persistence: boolean
    persistence_type: string
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
    maskAllInputs?: boolean
    maskInputOptions?: MaskInputOptions
    maskInputFn?: ((text: string) => string) | null
    slimDOMOptions?: SlimDOMOptions | 'all' | true
    collectFonts?: boolean
    inlineStylesheet?: boolean
}

export enum Compression {
    GZipJS = 'gzip-js',
    LZ64 = 'lz64',
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
}

export interface DecideResponse {
    status: number
    supportedCompression: Compression[]
    config: {
        enable_collect_everything: boolean
    }
    custom_properties: AutoCaptureCustomProperty[] // TODO: delete, not sent
    featureFlags: Record<string, string | boolean>
    sessionRecording?: {
        endpoint?: string
        consoleLogRecordingEnabled?: boolean
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
    persistenceType?: string /** persistence mechanism used - cookie or localStorage */
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
    apiURL?: string
    jsURL?: string
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
