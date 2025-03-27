import type { recordOptions } from './extensions/replay/types/rrweb'
import type { SegmentAnalytics } from './extensions/segment-integration'
import { PostHog } from './posthog-core'
import { Survey } from './posthog-surveys-types'

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
     *
     * We consider the tree of elements from the root to the target element of the click event
     * so for the tree `div > div > button > svg`
     * if the allowlist has `button` then we allow the capture when the `button` or the `svg` is the click target
     * but not if either of the `div`s are detected as the click target
     */
    element_allowlist?: AutocaptureCompatibleElement[]

    /**
     * List of CSS selectors to allow autocapture on
     * e.g. ['[ph-capture]']
     * we consider the tree of elements from the root to the target element of the click event
     * so for the tree div > div > button > svg
     * and allow list config `['[id]']`
     * we will capture the click if the click-target or its parents has any id
     *
     * Everything is allowed when there's no allowlist
     */
    css_selector_allowlist?: string[]

    /**
     * Exclude certain element attributes from autocapture
     * E.g. ['aria-label'] or [data-attr-pii]
     */
    element_attribute_ignorelist?: string[]

    /**
     * When set to true, autocapture will capture the text of any element that is cut or copied.
     */
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
    /**
     *  Works with session replay to use the browser's native performance observer to capture performance metrics
     */
    network_timing?: boolean

    /**
     * Use chrome's web vitals library to wrap fetch and capture web vitals
     */
    web_vitals?: boolean

    /**
     * We observe very large values reported by the Chrome web vitals library
     * These outliers are likely not real, useful values, and we exclude them
     * You can set this to 0 in order to include all values, NB this is not recommended
     *
     * @default 15 * 60 * 1000 (15 minutes)
     */
    __web_vitals_max_value?: number

    /**
     * By default all 4 metrics are captured
     * You can set this config to restrict which metrics are captured
     * e.g. ['CLS', 'FCP'] to only capture those two metrics
     * NB setting this does not override whether the capture is enabled
     *
     * @default ['LCP', 'CLS', 'FCP', 'INP']
     */
    web_vitals_allowed_metrics?: SupportedWebVitalsMetrics[]

    /**
     * We delay flushing web vitals metrics to reduce the number of events we send
     * This is the maximum time we will wait before sending the metrics
     *
     * @default 5000
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

export type ExceptionAutoCaptureConfig = {
    /**
     * Determines whether PostHog should capture unhandled errors.
     *
     * @default true
     */
    capture_unhandled_errors: boolean

    /**
     * Determines whether PostHog should capture unhandled promise rejections.
     *
     * @default true
     */
    capture_unhandled_rejections: boolean

    /**
     * Determines whether PostHog should capture console errors.
     *
     * @default false
     */
    capture_console_errors: boolean
}

export type DeadClicksAutoCaptureConfig = {
    /**
     * We'll not consider a click to be a dead click, if it's followed by a scroll within `scroll_threshold_ms` milliseconds
     *
     * @default 100
     */
    scroll_threshold_ms?: number

    /**
     * We'll not consider a click to be a dead click, if it's followed by a selection change within `selection_change_threshold_ms` milliseconds
     *
     * @default 100
     */
    selection_change_threshold_ms?: number

    /**
     * We'll not consider a click to be a dead click, if it's followed by a mutation within `mutation_threshold_ms` milliseconds
     *
     * @default 2500
     */
    mutation_threshold_ms?: number

    /**
     * Allows setting behavior for when a dead click is captured.
     * For e.g. to support capture to heatmaps
     *
     * If not provided the default behavior is to auto-capture dead click events
     *
     * Only intended to be provided by our own SDK
     */
    __onCapture?: ((click: DeadClickCandidate, properties: Properties) => void) | undefined
} & Pick<AutocaptureConfig, 'element_attribute_ignorelist'>

export interface HeatmapConfig {
    /**
     * How often to send batched data in `$heatmap_data` events
     * If set to 0 or not set, sends using the default interval of 1 second
     *
     * @default 1000
     */
    flush_interval_milliseconds: number
}

export type BeforeSendFn = (cr: CaptureResult | null) => CaptureResult | null

/**
 * Configuration options for the PostHog JavaScript SDK.
 * @see https://posthog.com/docs/libraries/js#config
 */
export interface PostHogConfig {
    /** URL of your PostHog instance.
     *
     * @default 'https://us.i.posthog.com'
     */
    api_host: string

    /**
     * If using a reverse proxy for `api_host` then this should be the actual PostHog app URL (e.g. https://us.posthog.com).
     * This ensures that links to PostHog point to the correct host.
     *
     * @default null
     */
    ui_host: string | null

    /**
     * The transport method to use for API requests.
     *
     * @default 'fetch'
     */
    api_transport?: 'XHR' | 'fetch'

    /**
     * The token for your PostHog project.
     * It should NOT be provided manually in the config, but rather passed as the first parameter to `posthog.init()`.
     */
    token: string

    /**
     * The name this instance will be identified by.
     * You don't need to set this most of the time,
     * but can be useful if you have several Posthog instances running at the same time.
     *
     * @default 'posthog'
     */
    name: string

    /**
     * Determines whether PostHog should autocapture events.
     * This setting does not affect capturing pageview events (see `capture_pageview`).
     *
     * @default true
     */
    autocapture: boolean | AutocaptureConfig

    /**
     * Determines whether PostHog should capture rage clicks.
     *
     * @default true
     */
    rageclick: boolean

    /**
     * Determines if cookie should be set on the top level domain (example.com).
     * If PostHog-js is loaded on a subdomain (test.example.com), and `cross_subdomain_cookie` is set to false,
     * it'll set the cookie on the subdomain only (test.example.com).
     *
     * NOTE: It will be set to `false` if we detect that the domain is a subdomain of a platform that is excluded from cross-subdomain cookie setting.
     * The current list of excluded platforms is `herokuapp.com`, `vercel.app`, and `netlify.app`.
     *
     * @see `isCrossDomainCookie`
     * @default true
     */
    cross_subdomain_cookie: boolean

    /**
     * Determines how PostHog stores information about the user. See [persistence](https://posthog.com/docs/libraries/js#persistence) for details.
     *
     * @default 'localStorage+cookie'
     */
    persistence: 'localStorage' | 'cookie' | 'memory' | 'localStorage+cookie' | 'sessionStorage'

    /**
     * The name for the super properties persistent store
     *
     * @default ''
     */
    persistence_name: string

    /** @deprecated - Use 'persistence_name' instead */
    cookie_name?: string

    /**
     * A function to be called once the PostHog scripts have loaded successfully.
     *
     * @param posthog_instance - The PostHog instance that has been loaded.
     */
    loaded: (posthog_instance: PostHog) => void

    /**
     * Determines whether PostHog should save referrer information.
     *
     * @default true
     */
    save_referrer: boolean

    /**
     * Determines whether PostHog should save marketing parameters.
     * These are `utm_*` paramaters and friends.
     *
     * @see {CAMPAIGN_PARAMS} from './utils/event-utils' - Default campaign parameters like utm_source, utm_medium, etc.
     * @default true
     */
    save_campaign_params: boolean

    /** @deprecated - Use `save_campaign_params` instead */
    store_google?: boolean

    /**
     * Used to extend the list of campaign parameters that are saved by default.
     *
     * @see {CAMPAIGN_PARAMS} from './utils/event-utils' - Default campaign parameters like utm_source, utm_medium, etc.
     * @default []
     */
    custom_campaign_params: string[]

    /**
     * Used to extend the list of user agents that are blocked by default.
     *
     * @see {DEFAULT_BLOCKED_UA_STRS} from './utils/blocked-uas' - Default list of blocked user agents.
     * @default []
     */
    custom_blocked_useragents: string[]

    /**
     * Determines whether PostHog should be in debug mode.
     * You can enable this to get more detailed logging.
     *
     * You can also enable this on your website by appending `?__posthog_debug=true` at the end of your URL
     * You can also call `posthog.debug()` in your code to enable debug mode
     *
     * @default false
     */
    debug: boolean

    /** @deprecated Use `debug` instead */
    verbose?: boolean

    /**
     * Determines whether PostHog should capture pageview events automatically.
     *
     * @default true
     */
    capture_pageview: boolean

    /**
     * Determines whether PostHog should capture pageleave events.
     * If set to `true`, it will capture pageleave events for all pages.
     * If set to `'if_capture_pageview'`, it will only capture pageleave events if `capture_pageview` is also set to `true`.
     *
     * @default 'if_capture_pageview'
     */
    capture_pageleave: boolean | 'if_capture_pageview'

    /**
     * Determines the number of days to store cookies for.
     *
     * @default 365
     */
    cookie_expiration: number

    /**
     * Determines whether PostHog should upgrade old cookies.
     * If set to `true`, the library will check for a cookie from our old js library and import super properties from it, then the old cookie is deleted.
     * This option only works in the initialization, so make sure you set it when you create the library.
     *
     * @default false
     */
    upgrade: boolean

    /**
     * Determines whether PostHog should disable session recording.
     *
     * @default false
     */
    disable_session_recording: boolean

    /**
     * Determines whether PostHog should disable persistence.
     * If set to `true`, the library will not save any data to the browser. It will also delete any data previously saved to the browser.
     *
     * @default false
     */
    disable_persistence: boolean

    /** @deprecated - use `disable_persistence` instead */
    disable_cookie?: boolean

    /**
     * Determines whether PostHog should disable surveys.
     *
     * @default false
     */
    disable_surveys: boolean

    /**
     * Determines whether PostHog should disable web experiments.
     *
     * Currently disabled while we're in BETA. It will be toggled to `true` in a future release.
     *
     * @default true
     */
    disable_web_experiments: boolean

    /**
     * Determines whether PostHog should disable any external dependency loading.
     * This will prevent PostHog from requesting any external scripts such as those needed for Session Replay, Surveys or Site Apps.
     *
     * @default false
     */
    disable_external_dependency_loading: boolean

    /**
     * A function to be called when a script is being loaded.
     * This can be used to modify the script before it is loaded.
     * This is useful for adding a nonce to the script, for example.
     *
     * @param script - The script element that is being loaded.
     * @returns The modified script element, or null if the script should not be loaded.
     */
    prepare_external_dependency_script?: (script: HTMLScriptElement) => HTMLScriptElement | null

    /**
     * A function to be called when a stylesheet is being loaded.
     * This can be used to modify the stylesheet before it is loaded.
     * This is useful for adding a nonce to the stylesheet, for example.
     *
     * @param stylesheet - The stylesheet element that is being loaded.
     * @returns The modified stylesheet element, or null if the stylesheet should not be loaded.
     */
    prepare_external_dependency_stylesheet?: (stylesheet: HTMLStyleElement) => HTMLStyleElement | null

    /**
     * Determines whether PostHog should enable recording console logs.
     * When undefined, it falls back to the remote config setting.
     *
     * @default undefined
     */
    enable_recording_console_log?: boolean

    /**
     * Determines whether PostHog should use secure cookies.
     * If this is `true`, PostHog cookies will be marked as secure,
     * meaning they will only be transmitted over HTTPS.
     *
     * @default window.location.protocol === 'https:'
     */
    secure_cookie: boolean

    /**
     * Determines whether PostHog should capture IP addresses.
     *
     * @default true
     */
    ip: boolean

    /**
     * Determines if users should be opted out of PostHog tracking by default,
     * requiring additional logic to opt them into capturing by calling `posthog.opt_in_capturing()`.
     *
     * @default false
     */
    opt_out_capturing_by_default: boolean

    /**
     * Determines where we'll save the information about whether users are opted out of capturing.
     *
     * @default 'localStorage'
     */
    opt_out_capturing_persistence_type: 'localStorage' | 'cookie'

    /**
     * Determines if users should be opted out of browser data storage by this PostHog instance by default,
     * requiring additional logic to opt them into capturing by calling `posthog.opt_in_capturing()`.
     *
     * @default false
     */
    opt_out_persistence_by_default?: boolean

    /**
     * Determines if users should be opted out of user agent filtering such as googlebot or other bots.
     * If this is set to `true`, PostHog will set `$browser_type` to either `bot` or `browser` for all events,
     * but will process all events as if they were from a browser.
     *
     * @default false
     */
    opt_out_useragent_filter: boolean

    /**
     * Determines the prefix for the cookie used to store the information about whether users are opted out of capturing.
     * When `null`, it falls back to the default prefix found in `consent.ts`.
     *
     * @default null
     */
    opt_out_capturing_cookie_prefix: string | null

    /**
     * Determines if users should be opted in to site apps.
     *
     * @default false
     */
    opt_in_site_apps: boolean

    /**
     * Determines whether PostHog should respect the Do Not Track header when computing
     * consent in `ConsentManager`.
     *
     * @see `ConsentManager`
     * @default false
     */
    respect_dnt: boolean

    /**
     * A list of properties that should never be sent with capture calls.
     *
     * @default []
     */
    property_denylist: string[]

    /** @deprecated - use `property_denylist` instead  */
    property_blacklist?: string[]

    /**
     * A list of headers that should be sent with requests to the PostHog API.
     *
     * @default {}
     */
    request_headers: { [header_name: string]: string }

    /** @deprecated - use `request_headers` instead  */
    xhr_headers?: { [header_name: string]: string }

    /**
     * A function that is called when a request to the PostHog API fails.
     *
     * @param error - The `RequestResponse` object that occurred.
     */
    on_request_error?: (error: RequestResponse) => void

    /** @deprecated - use `on_request_error` instead  */
    on_xhr_error?: (failedRequest: XMLHttpRequest) => void

    /**
     * Determines whether PostHog should batch requests to the PostHog API.
     *
     * @default true
     */
    request_batching: boolean

    /**
     * Determines the maximum length of the properties string that can be sent with capture calls.
     *
     * @default 65535
     */
    properties_string_max_length: number

    /**
     * Determines the session recording options.
     *
     * @see `SessionRecordingOptions`
     * @default {}
     */
    session_recording: SessionRecordingOptions

    /**
     * Determines the session idle timeout in seconds.
     * Any new event that's happened after this timeout will create a new session.
     *
     * @default 30 * 60 -- 30 minutes
     */
    session_idle_timeout_seconds: number

    /**
     * Prevent autocapture from capturing any attribute names on elements.
     *
     * @default false
     */
    mask_all_element_attributes: boolean

    /**
     * Prevent autocapture from capturing `textContent` on elements.
     *
     * @default false
     */
    mask_all_text: boolean

    /**
     * Prevent autocapture from capturing personal data properties.
     * These include campaign parameters, UTM parameters, and other parameters that could be considered personal data under e.g. GDPR.
     *
     * @default false
     */
    mask_personal_data_properties: boolean

    /**
     * Custom list of personal data properties to mask.
     *
     * @default []
     */
    custom_personal_data_properties: string[]

    /**
     * One of the very first things the PostHog library does when init() is called
     * is make a request to the /decide endpoint on PostHog's backend.
     * This endpoint contains information on how to run the PostHog library
     * so events are properly received in the backend.
     *
     * This endpoint is required to run most features of the library.
     * However, if you're not using any of the described features,
     * you may wish to turn off the call completely to avoid an extra request
     * and reduce resource usage on both the client and the server.
     *
     * @default false
     */
    advanced_disable_decide: boolean

    /**
     * Will keep /decide running, but without any feature flag requests
     *
     * @default false
     */
    advanced_disable_feature_flags: boolean

    /**
     * Stops from firing feature flag requests on first page load.
     * Only requests feature flags when user identity or properties are updated,
     * or you manually request for flags to be loaded.
     *
     * @default false
     */
    advanced_disable_feature_flags_on_first_load: boolean

    /**
     * Determines whether PostHog should disable toolbar metrics.
     * This is our internal instrumentation for our toolbar in your website.
     *
     * @default false
     */
    advanced_disable_toolbar_metrics: boolean

    /**
     * Sets timeout for fetching feature flags
     *
     * @default 3000
     */
    feature_flag_request_timeout_ms: number

    /**
     * Sets timeout for fetching surveys
     *
     * @default 10000
     */
    surveys_request_timeout_ms: number

    /**
     * Function to get the device ID.
     * This doesn't usually need to be set, but can be useful if you want to use a custom device ID.
     *
     * @param uuid - The UUID we would use for the device ID.
     * @returns The device ID.
     *
     * @default (uuid) => uuid
     */
    get_device_id: (uuid: string) => string

    /**
     * This function or array of functions - if provided - are called immediately before sending data to the server.
     * It allows you to edit data before it is sent, or choose not to send it all.
     * if provided as an array the functions are called in the order they are provided
     * any one function returning null means the event will not be sent
     */
    before_send?: BeforeSendFn | BeforeSendFn[]

    /** @deprecated - use `before_send` instead */
    sanitize_properties: ((properties: Properties, event_name: string) => Properties) | null

    /** @deprecated - use `before_send` instead */
    _onCapture: (eventName: string, eventData: CaptureResult) => void

    /**
     * Determines whether to capture performance metrics.
     * These include Network Timing and Web Vitals.
     *
     * When `undefined`, fallback to the remote configuration.
     * If `false`, neither network timing nor web vitals will work.
     * If an object, that will override the remote configuration.
     *
     * @see {PerformanceCaptureConfig}
     * @default undefined
     */
    capture_performance?: boolean | PerformanceCaptureConfig

    /**
     * Determines whether to disable compression when sending events to the server.
     * WARNING: Should only be used for testing. Could negatively impact performance.
     *
     * @default false
     */
    disable_compression: boolean

    /**
     * An object containing the `distinctID`, `isIdentifiedID`, and `featureFlags` keys,
     * where `distinctID` is a string, and `featureFlags` is an object of key-value pairs.
     *
     * Since there is a delay between initializing PostHog and fetching feature flags,
     * feature flags are not always available immediately.
     * This makes them unusable if you want to do something like redirecting a user
     * to a different page based on a feature flag.
     *
     * You can, therefore, fetch the feature flags in your server and pre-fill them here,
     * allowing PostHog to know the feature flag values immediately.
     *
     * After the SDK fetches feature flags from PostHog, it will use those flag values instead of bootstrapped ones.
     *
     * @default {}
     */
    bootstrap: BootstrapConfig

    /**
     * The segment analytics object.
     *
     * @see https://posthog.com/docs/libraries/segment
     */
    segment?: SegmentAnalytics

    /**
     * Determines whether to capture heatmaps.
     *
     * @see {HeatmapConfig}
     * @default undefined
     */
    capture_heatmaps?: boolean | HeatmapConfig

    /* @deprecated - use `capture_heatmaps` instead */
    enable_heatmaps?: boolean

    /**
     * Determines whether to capture dead clicks.
     *
     * @see {DeadClicksAutoCaptureConfig}
     * @default undefined
     */
    capture_dead_clicks?: boolean | DeadClicksAutoCaptureConfig

    /**
     * Determines whether to capture exceptions.
     *
     * @see {ExceptionAutoCaptureConfig}
     * @default undefined
     */
    capture_exceptions?: boolean | ExceptionAutoCaptureConfig

    /**
     * Determines whether to disable scroll properties.
     * These allow you to keep track of how far down someone scrolled in your website.
     *
     * @default false
     */
    disable_scroll_properties?: boolean

    /**
     * Let the pageview scroll stats use a custom css selector for the root element, e.g. `main`
     * It will use `window.document.documentElement` if not specified.
     */
    scroll_root_selector?: string | string[]

    /**
     * You can control whether events from PostHog-js have person processing enabled with the `person_profiles` config setting.
     * There are three options:
     * - `person_profiles: 'always'` - we will process persons data for all events
     * - `person_profiles: 'never'` - we won't process persons for any event. This means that anonymous users will not be merged once they sign up or login, so you lose the ability to create funnels that track users from anonymous to identified. All events (including `$identify`) will be sent with `$process_person_profile: False`.
     * - `person_profiles: 'identified_only'` _(default)_ - we will only process persons when you call `posthog.identify`, `posthog.alias`, `posthog.setPersonProperties`, `posthog.group`, `posthog.setPersonPropertiesForFlags` or `posthog.setGroupPropertiesForFlags` Anonymous users won't get person profiles.
     *
     * @default 'identified_only'
     */
    person_profiles?: 'always' | 'never' | 'identified_only'

    /** @deprecated - use `person_profiles` instead  */
    process_person?: 'always' | 'never' | 'identified_only'

    /**
     * Client side rate limiting
     */
    rate_limiting?: {
        /**
         * The average number of events per second that should be permitted
         *
         * @default 10
         */
        events_per_second?: number

        /**
         * How many events can be captured in a burst. This defaults to 10 times the events_per_second count
         *
         * @default 10 * `events_per_second`
         */
        events_burst_limit?: number
    }

    /**
     * Used when sending data via `fetch`, use with care.
     * This is intentionally meant to be used with NextJS `fetch`
     *
     * Incorrect `cache` usage may cause out-of-date data for feature flags, actions tracking, etc.
     * See https://nextjs.org/docs/app/api-reference/functions/fetch#fetchurl-options
     */
    fetch_options?: {
        cache?: RequestInit['cache']
        next_options?: NextOptions
    }

    /**
     * Used to change the behavior of the request queue.
     * This is an advanced feature and should be used with caution.
     */
    request_queue_config?: RequestQueueConfig

    // ------- PREVIEW CONFIGS -------

    /**
     * PREVIEW - MAY CHANGE WITHOUT WARNING - DO NOT USE IN PRODUCTION
     * Whether to wrap fetch and add tracing headers to the request
     * */
    __add_tracing_headers?: boolean

    /**
     * PREVIEW - MAY CHANGE WITHOUT WARNING - DO NOT USE IN PRODUCTION
     * Enables the new RemoteConfig approach to loading config instead of decide
     * */
    __preview_remote_config?: boolean

    /**
     * PREVIEW - MAY CHANGE WITHOUT WARNING - DO NOT USE IN PRODUCTION
     * Whether to send a sentinel value for distinct id, device id, and session id, which will be replaced server-side by a cookieless hash
     * */
    __preview_experimental_cookieless_mode?: boolean

    /**
     * PREVIEW - MAY CHANGE WITHOUT WARNING - DO NOT USE IN PRODUCTION
     * Whether to use the new /flags/ endpoint
     * */
    __preview_flags_v2?: boolean

    // ------- RETIRED CONFIGS - NO REPLACEMENT OR USAGE -------

    /** @deprecated - NOT USED ANYMORE, kept here for backwards compatibility reasons */
    api_method?: string

    /** @deprecated - NOT USED ANYMORE, kept here for backwards compatibility reasons */
    inapp_protocol?: string

    /** @deprecated - NOT USED ANYMORE, kept here for backwards compatibility reasons */
    inapp_link_new_window?: boolean
}

export interface SessionRecordingOptions {
    /**
     * Derived from `rrweb.record` options
     * @see https://github.com/rrweb-io/rrweb/blob/master/guide.md
     * @default 'ph-no-capture'
     */
    blockClass?: string | RegExp

    /**
     * Derived from `rrweb.record` options
     * @see https://github.com/rrweb-io/rrweb/blob/master/guide.md
     * @default null
     */
    blockSelector?: string | null

    /**
     * Derived from `rrweb.record` options
     * @see https://github.com/rrweb-io/rrweb/blob/master/guide.md
     * @default 'ph-ignore-input'
     */
    ignoreClass?: string | RegExp

    /**
     * Derived from `rrweb.record` options
     * @see https://github.com/rrweb-io/rrweb/blob/master/guide.md
     * @default 'ph-mask'
     */
    maskTextClass?: string | RegExp

    /**
     * Derived from `rrweb.record` options
     * @see https://github.com/rrweb-io/rrweb/blob/master/guide.md
     */
    maskTextSelector?: string | null

    /**
     * Derived from `rrweb.record` options
     * @see https://github.com/rrweb-io/rrweb/blob/master/guide.md
     */
    maskTextFn?: ((text: string, element?: HTMLElement) => string) | null

    /**
     * Derived from `rrweb.record` options
     * @see https://github.com/rrweb-io/rrweb/blob/master/guide.md
     */
    maskAllInputs?: boolean

    /**
     * Derived from `rrweb.record` options
     * @see https://github.com/rrweb-io/rrweb/blob/master/guide.md
     */
    maskInputOptions?: recordOptions['maskInputOptions']

    /**
     * Derived from `rrweb.record` options
     * @see https://github.com/rrweb-io/rrweb/blob/master/guide.md
     */
    maskInputFn?: ((text: string, element?: HTMLElement) => string) | null

    /**
     * Derived from `rrweb.record` options
     * @see https://github.com/rrweb-io/rrweb/blob/master/guide.md
     * @default {}
     */
    slimDOMOptions?: recordOptions['slimDOMOptions']

    /**
     * Derived from `rrweb.record` options
     * @see https://github.com/rrweb-io/rrweb/blob/master/guide.md
     * @default false
     */
    collectFonts?: boolean

    /**
     * Derived from `rrweb.record` options
     * @see https://github.com/rrweb-io/rrweb/blob/master/guide.md
     * @default true
     */
    inlineStylesheet?: boolean

    /**
     * Derived from `rrweb.record` options
     * @see https://github.com/rrweb-io/rrweb/blob/master/guide.md
     * @default false
     */
    recordCrossOriginIframes?: boolean

    /**
     * Derived from `rrweb.record` options
     * @see https://github.com/rrweb-io/rrweb/blob/master/guide.md
     * @default false
     */
    recordHeaders?: boolean

    /**
     * Derived from `rrweb.record` options
     * @see https://github.com/rrweb-io/rrweb/blob/master/guide.md
     * @default false
     */
    recordBody?: boolean

    /**
     * Allows local config to override remote canvas recording settings from the decide response
     */
    captureCanvas?: SessionRecordingCanvasOptions

    /**
     * Modify the network request before it is captured. Returning null or undefined stops it being captured
     */
    maskCapturedNetworkRequestFn?: ((data: CapturedNetworkRequest) => CapturedNetworkRequest | null | undefined) | null

    /** @deprecated - use maskCapturedNetworkRequestFn instead  */
    maskNetworkRequestFn?: ((data: NetworkRequest) => NetworkRequest | null | undefined) | null

    /**
     * ADVANCED: while a user is active we take a full snapshot of the browser every interval.
     * For very few sites playback performance might be better with different interval.
     * Set to 0 to disable
     *
     * @default 1000 * 60 * 5 (5 minutes)
     */
    full_snapshot_interval_millis?: number

    /**
     * ADVANCED: whether to partially compress rrweb events before sending them to the server,
     * defaults to true, can be set to false to disable partial compression
     * NB requests are still compressed when sent to the server regardless of this setting
     *
     * @default true
     */
    compress_events?: boolean

    /**
     * ADVANCED: alters the threshold before a recording considers a user has become idle.
     * Normally only altered alongside changes to session_idle_timeout_ms.
     *
     * @default 1000 * 60 * 5 (5 minutes)
     */
    session_idle_threshold_ms?: number

    /**
     * ADVANCED: alters the refill rate for the token bucket mutation throttling
     * Normally only altered alongside posthog support guidance.
     * Accepts values between 0 and 100
     *
     * @default 10
     */
    __mutationRateLimiterRefillRate?: number

    /**
     * ADVANCED: alters the bucket size for the token bucket mutation throttling
     * Normally only altered alongside posthog support guidance.
     * Accepts values between 0 and 100
     *
     * @default 100
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

export interface RequestWithOptions {
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

export interface QueuedRequestWithOptions extends RequestWithOptions {
    /** key of queue, e.g. 'sessionRecording' vs 'event' */
    batchKey?: string
}

// Used explicitly for retriable requests
export interface RetriableRequestWithOptions extends QueuedRequestWithOptions {
    retriesPerformedSoFar?: number
}

// we used to call a request that was sent to the queue with options attached `RequestQueueOptions`
// so we can't call the options used to configure the behavior of the RequestQueue that as well,
// so instead we call them config
export interface RequestQueueConfig {
    /**
     *  ADVANCED - alters the frequency which PostHog sends events to the server.
     *  generally speaking this is only set when apps have automatic page refreshes, or very short visits.
     *  Defaults to 3 seconds when not set
     *  Allowed values between 250 and 5000
     * */
    flush_interval_ms?: number
}

export interface CaptureOptions {
    /**
     * Used when `$identify` is called
     * Will set person properties overriding previous values
     */
    $set?: Properties

    /**
     * Used when `$identify` is called
     * Will set person properties but only once, it will NOT override previous values
     */
    $set_once?: Properties

    /**
     * Used to override the desired endpoint for the captured event
     */
    _url?: string

    /**
     * key of queue, e.g. 'sessionRecording' vs 'event'
     */
    _batchKey?: string

    /**
     * If set, overrides and disables config.properties_string_max_length
     */
    _noTruncate?: boolean

    /**
     * If set, skips the batched queue
     */
    send_instantly?: boolean

    /**
     * If set, skips the client side rate limiting
     */
    skip_client_rate_limiting?: boolean

    /**
     * If set, overrides the desired transport method
     */
    transport?: RequestWithOptions['transport']

    /**
     * If set, overrides the current timestamp
     */
    timestamp?: Date
}

export type FlagVariant = { flag: string; variant: string }

export type SessionRecordingCanvasOptions = {
    /**
     * If set, records the canvas
     *
     * @default false
     */
    recordCanvas?: boolean | null

    /**
     * If set, records the canvas at the given FPS
     * Can be set in the remote configuration
     * Limited between 0 and 12
     * When canvas recording is enabled, if this is not set locally, then remote config sets this as 4
     *
     * @default null-ish
     */
    canvasFps?: number | null

    /**
     * If set, records the canvas at the given quality
     * Can be set in the remote configuration
     * Must be a string that is a valid decimal between 0 and 1
     * When canvas recording is enabled, if this is not set locally, then remote config sets this as "0.4"
     *
     * @default null-ish
     */
    canvasQuality?: string | null
}

/**
 * Remote configuration for the PostHog instance
 *
 * All of these settings can be configured directly in your PostHog instance
 * Any configuration set in the client overrides the information from the server
 */
export interface RemoteConfig {
    /**
     * Supported compression algorithms
     */
    supportedCompression: Compression[]

    /**
     * If set, disables autocapture
     */
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

    /**
     * Whether we should use a custom endpoint for analytics
     *
     * @default { endpoint: "/e" }
     */
    analytics?: {
        endpoint?: string
    }

    /**
     * Whether the `$elements_chain` property should be sent as a string or as an array
     *
     * @default false
     */
    elementsChainAsString?: boolean

    /**
     * This is currently in development and may have breaking changes without a major version bump
     */
    autocaptureExceptions?: boolean | { endpoint?: string }

    /**
     * Session recording configuration options
     */
    sessionRecording?: SessionRecordingCanvasOptions & {
        endpoint?: string
        consoleLogRecordingEnabled?: boolean
        // the API returns a decimal between 0 and 1 as a string
        sampleRate?: string | null
        minimumDurationMilliseconds?: number
        linkedFlag?: string | FlagVariant | null
        networkPayloadCapture?: Pick<NetworkRecordOptions, 'recordBody' | 'recordHeaders'>
        masking?: Pick<SessionRecordingOptions, 'maskAllInputs' | 'maskTextSelector'>
        urlTriggers?: SessionRecordingUrlTrigger[]
        scriptConfig?: { script?: string | undefined }
        urlBlocklist?: SessionRecordingUrlTrigger[]
        eventTriggers?: string[]
    }

    /**
     * Whether surveys are enabled
     */
    surveys?: boolean | Survey[]

    /**
     * Parameters for the toolbar
     */
    toolbarParams: ToolbarParams

    /**
     * @deprecated renamed to toolbarParams, still present on older API responses
     */
    editorParams?: ToolbarParams

    /**
     * @deprecated, moved to toolbarParams
     */
    toolbarVersion: 'toolbar'

    /**
     * Whether the user is authenticated
     */
    isAuthenticated: boolean

    /**
     * List of site apps with their IDs and URLs
     */
    siteApps: { id: string; url: string }[]

    /**
     * Whether heatmaps are enabled
     */
    heatmaps?: boolean

    /**
     * Whether to only capture identified users by default
     */
    defaultIdentifiedOnly?: boolean

    /**
     * Whether to capture dead clicks
     */
    captureDeadClicks?: boolean

    /**
     * Indicates if the team has any flags enabled (if not we don't need to load them)
     */
    hasFeatureFlags?: boolean
}

/**
 * Decide returns everything we have on the remote config plus feature flags and their payloads
 */
export interface DecideResponse extends RemoteConfig {
    featureFlags: Record<string, string | boolean>
    featureFlagPayloads: Record<string, JsonType>
    errorsWhileComputingFlags: boolean
    requestId?: string
    flags: Record<string, FeatureFlagDetail>
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

export type FeatureFlagsCallback = (
    flags: string[],
    variants: Record<string, string | boolean>,
    context?: {
        errorsLoading?: boolean
    }
) => void

export type FeatureFlagDetail = {
    key: string
    enabled: boolean
    // Only used when overriding a flag payload.
    original_enabled?: boolean | undefined
    variant: string | undefined
    // Only used when overriding a flag payload.
    original_variant?: string | undefined
    reason: EvaluationReason | undefined
    metadata: FeatureFlagMetadata | undefined
}

export type FeatureFlagMetadata = {
    id: number
    version: number | undefined
    description: string | undefined
    payload: JsonType | undefined
    // Only used when overriding a flag payload.
    original_payload?: JsonType | undefined
}

export type EvaluationReason = {
    code: string
    condition_index: number | undefined
    description: string | undefined
}

export type RemoteConfigFeatureFlagCallback = (payload: JsonType) => void

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
export type JsonType = string | number | boolean | null | undefined | JsonRecord | Array<JsonType>

/** A feature that isn't publicly available yet.*/
export interface EarlyAccessFeature {
    // Sync this with the backend's EarlyAccessFeatureSerializer!
    name: string
    description: string
    stage: 'concept' | 'alpha' | 'beta'
    documentationUrl: string | null
    flagKey: string | null
}

export type EarlyAccessFeatureStage = 'concept' | 'alpha' | 'beta' | 'general-availability'
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
