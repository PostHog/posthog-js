import { MaskInputOptions, SlimDOMOptions } from 'rrweb-snapshot'
import { EventProcessor, Hub, Integration } from '@sentry/types'
import { PostHogLib } from './posthog-core'
import { logger } from './utils'

// namespacing everything with *Class to keep the definitions separate from the implementation
//
// export declare class PostHogClass {
//     /**
//      * Integrate Sentry with PostHog. This will add a direct link to the person in Sentry, and an $exception event in PostHog
//      *
//      * ### Usage
//      *
//      *     Sentry.init({
//      *          dsn: 'https://example',
//      *          integrations: [
//      *              new posthog.SentryIntegration(posthog)
//      *          ]
//      *     })
//      *
//      * @param {Object} [posthog] The posthog object
//      * @param {string} [organization] Optional: The Sentry organization, used to send a direct link from PostHog to Sentry
//      * @param {Number} [projectId] Optional: The Sentry project id, used to send a direct link from PostHog to Sentry
//      * @param {string} [prefix] Optional: Url of a self-hosted sentry instance (default: https://sentry.io/organizations/)
//      */
//     static SentryIntegration: typeof SentryIntegration
//
//     static toString(): string
//
//     /* Will log all capture requests to the Javascript console, including event properties for easy debugging */
//     static debug(): void
//
//     /*
//      * Starts session recording and updates disable_session_recording to false.
//      * Used for manual session recording management. By default, session recording is enabled and
//      * starts automatically.
//      *
//      * ### Usage:
//      *
//      *     posthog.startSessionRecording()
//      */
//     static startSessionRecording(): void
//
//     /*
//      * Stops session recording and updates disable_session_recording to true.
//      *
//      * ### Usage:
//      *
//      *     posthog.stopSessionRecording()
//      */
//     static stopSessionRecording(): void
//
//     /*
//      * Check if session recording is currently running.
//      *
//      * ### Usage:
//      *
//      *     const isSessionRecordingOn = posthog.sessionRecordingStarted()
//      */
//     static sessionRecordingStarted(): boolean
// }

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Property = any
export type Properties = Record<string, Property>
export interface CaptureResult {
    event: string
    properties: Properties
    $set: Properties | undefined
    timestamp: Date | undefined
}
export type CaptureCallback = (response: any, data: any) => void
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface PostHogConfig {
    api_host: string
    api_method: string
    api_transport: string
    token: string
    autocapture: boolean
    rageclick: boolean
    cross_subdomain_cookie: boolean
    persistence: 'localStorage' | 'cookie' | 'memory' | 'localStorage+cookie'
    persistence_name: string
    cookie_name: string
    loaded: (posthog_instance: PostHogLib) => void
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
    enable_recording_console_log: boolean
    secure_cookie: boolean
    ip: boolean
    opt_out_capturing_by_default: boolean
    opt_out_persistence_by_default: boolean
    opt_out_capturing_persistence_type: 'localStorage' | 'cookie'
    opt_out_capturing_cookie_prefix: string | null
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
    _onCapture: (eventName: string, eventData: CaptureResult) => void
    _capture_metrics: boolean
    _capture_performance: boolean
}

export interface OptInOutCapturingOptions {
    clear_persistence: boolean
    persistence_type: string
    cookie_prefix: string
    cookie_expiration: number
    cross_subdomain_cookie: boolean
    secure_cookie: boolean
}

export interface HasOptedInOutCapturingOptions {
    persistence_type: string
    cookie_prefix: string
}

export interface ClearOptInOutCapturingOptions {
    enable_persistence: boolean
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

export declare class SentryIntegration implements Integration {
    constructor(posthog: PostHogLib, organization?: string, projectId?: number, prefix?: string)
    name: string
    setupOnce(addGlobalEventProcessor: (callback: EventProcessor) => void, getCurrentHub: () => Hub): void
}

export enum Compression {
    GZipJS = 'gzip-js',
    LZ64 = 'lz64',
    Base64 = 'base64',
}

export interface NetworkRequestOptions {
    sendBeacon: boolean
    blob: boolean
    method: 'POST' | 'GET'
}

export interface XHROptions {
    transport: 'XHR' | 'sendBeacon'
    method: 'POST' | 'GET'
    urlQueryArgs?: { compression: Compression }
}

export interface RetryQueueElement {
    retryAt: Date
    requestData: QueuedRequestData
}
export interface QueuedRequestData {
    url: string
    data: Properties
    options: XHROptions
    headers: Properties
    callback: RequestCallback
    retriesPerformedSoFar: number
}
export interface DecideResponse {
    status: number
    supportedCompression: Compression[]
    config: {
        enable_collect_everything: boolean
    }
    custom_properties: AutoCaptureCustomProperty[] // TODO: delete, not sent
    featureFlags: Record<string, string | boolean>
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
export interface CompressionOptions {}

export interface GDPROptions {
    capture: (
        event: string,
        properties: Properties
    ) => void /** function used for capturing a PostHog event to record the opt-in action */
    captureEventName: string /** event name to be used for capturing the opt-in action */
    captureProperties: Properties /** set of properties to be captured along with the opt-in action */
    persistenceType: string /** persistence mechanism used - cookie or localStorage */
    persistencePrefix: string /** [__ph_opt_in_out] - custom prefix to be used in the cookie/localstorage name */
    cookieExpiration: number /** number of days until the opt-in cookie expires */
    cookieDomain: string /** custom cookie domain */
    crossSiteCookie: boolean /** whether the opt-in cookie is set as cross-site-enabled */
    crossSubdomainCookie: boolean /** whether the opt-in cookie is set as cross-subdomain or not */
    secureCookie: boolean /** whether the opt-in cookie is set as secure or not */
}

export type RequestCallback = (response: Record<string, any>, data?: Properties) => void

export interface PersistentStore {
    is_supported: () => boolean
    error: (error: any) => void
    parse: (name: string) => any
    get: (name: string) => any
    set: (name: string, value: any, expire_days?: number, cross_subdomain?: boolean, secure?: boolean) => void
    remove: (name: string, cross_subdomain?: boolean) => void
}
