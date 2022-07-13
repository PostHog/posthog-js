import { MaskInputOptions, SlimDOMOptions } from 'rrweb-snapshot'
import { EventProcessor, Hub, Integration } from '@sentry/types'

// namespacing everything with *Class to keep the definitions separate from the implementation

export declare class PostHogClass {
    /**
     * Integrate Sentry with PostHog. This will add a direct link to the person in Sentry, and an $exception event in PostHog
     *
     * ### Usage
     *
     *     Sentry.init({
     *          dsn: 'https://example',
     *          integrations: [
     *              new posthog.SentryIntegration(posthog)
     *          ]
     *     })
     *
     * @param {Object} [posthog] The posthog object
     * @param {string} [organization] Optional: The Sentry organization, used to send a direct link from PostHog to Sentry
     * @param {Number} [projectId] Optional: The Sentry project id, used to send a direct link from PostHog to Sentry
     * @param {string} [prefix] Optional: Url of a self-hosted sentry instance (default: https://sentry.io/organizations/)
     */
    static SentryIntegration: typeof SentryIntegration

    static toString(): string

    /* Will log all capture requests to the Javascript console, including event properties for easy debugging */
    static debug(): void

    /*
     * Starts session recording and updates disable_session_recording to false.
     * Used for manual session recording management. By default, session recording is enabled and
     * starts automatically.
     *
     * ### Usage:
     *
     *     posthog.startSessionRecording()
     */
    static startSessionRecording(): void

    /*
     * Stops session recording and updates disable_session_recording to true.
     *
     * ### Usage:
     *
     *     posthog.stopSessionRecording()
     */
    static stopSessionRecording(): void

    /*
     * Check if session recording is currently running.
     *
     * ### Usage:
     *
     *     const isSessionRecordingOn = posthog.sessionRecordingStarted()
     */
    static sessionRecordingStarted(): boolean
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Property = any
export type Properties = Record<string, Property>
export type CaptureResult = { event: string; properties: Properties }
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
    loaded: (posthog_instance: typeof PostHogClass) => void
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

export declare class PersistenceClass {
    static properties(): Properties

    static load(): void

    static save(): void

    static remove(): void

    static clear(): void

    /**
     * @param {Object} props
     * @param {*=} default_value
     * @param {number=} days
     */
    static register_once(props: Properties, default_value?: Property, days?: number): boolean

    /**
     * @param {Object} props
     * @param {number=} days
     */
    static register(props: Properties, days?: number): boolean

    static unregister(prop: string): void

    static update_campaign_params(): void

    static update_search_keyword(referrer: string): void

    static update_referrer_info(referrer: string): void

    static get_referrer_info(): Properties

    static safe_merge(props: Properties): Properties

    static update_config(config: PostHogConfig): void

    static set_disabled(disabled: boolean): void

    static set_cross_subdomain(cross_subdomain: boolean): void

    static get_cross_subdomain(): boolean

    static set_secure(secure: boolean): void

    static set_event_timer(event_name: string, timestamp: Date): void

    static remove_event_timer(event_name: string): Date | undefined
}

export declare class PeopleClass {
    /*
     * Set properties on a user record.
     *
     * ### Usage:
     *
     *     posthog.people.set('gender', 'm');
     *
     *     // or set multiple properties at once
     *     posthog.people.set({
     *         'Company': 'Acme',
     *         'Plan': 'Premium',
     *         'Upgrade date': new Date()
     *     });
     *     // properties can be strings, integers, dates, or lists
     *
     * @param {Object|String} prop If a string, this is the name of the property. If an object, this is an associative array of names and values.
     * @param {*} [to] A value to set on the given property name
     * @param {Function} [callback] If provided, the callback will be called after capturing the event.
     */
    static set(prop: Properties | string, to?: Property, callback?: CaptureCallback): Properties

    /*
     * Set properties on a user record, only if they do not yet exist.
     * This will not overwrite previous people property values, unlike
     * people.set().
     *
     * ### Usage:
     *
     *     posthog.people.set_once('First Login Date', new Date());
     *
     *     // or set multiple properties at once
     *     posthog.people.set_once({
     *         'First Login Date': new Date(),
     *         'Starting Plan': 'Premium'
     *     });
     *
     *     // properties can be strings, integers or dates
     *
     * @param {Object|String} prop If a string, this is the name of the property. If an object, this is an associative array of names and values.
     * @param {*} [to] A value to set on the given property name
     * @param {Function} [callback] If provided, the callback will be called after capturing the event.
     */
    static set_once(prop: Properties | string, to?: Property, callback?: CaptureCallback): Properties

    static toString(): string
}

export declare class SessionManagerClass {
    /*
     * Allows you to manually reset the current session id. By default, the session id is reset after 30 minutes
     * of inactivity, but with this function, you can reset it earlier. This will also result in a new session recording.
     *
     *
     * ### Usage:
     *
     *     posthog.sessionManager.resetSessionId()
     *
     */
    static resetSessionId(): void
}

export declare class FeatureFlagsClass {
    static getFlags(): string[]
    static getFlagVariants(): Record<string, boolean | string>

    static reloadFeatureFlags(): void

    /*
     * Get feature flag variant for user
     *
     * ### Usage:
     *
     *     if(posthog.getFeatureFlag('beta-feature')) { // do something }
     *     if(posthog.getFeatureFlag('feature-with-variant') === 'some-value') { // do something }
     *
     * @param {Object|String} prop Key of the feature flag.
     * @param {Object|String} options (optional) If {send_event: false}, we won't send an $feature_flag_call event to PostHog.
     */
    static getFeatureFlag(key: string, options?: { send_event?: boolean }): boolean | string | undefined

    /*
     * See if feature flag is enabled for user.
     *
     * ### Usage:
     *
     *     if(posthog.isFeatureEnabled('beta-feature')) { // do something }
     *
     * @param {Object|String} prop Key of the feature flag.
     * @param {Object|String} options (optional) If {send_event: false}, we won't send an $feature_flag_call event to PostHog.
     */
    static isFeatureEnabled(key: string, options?: { send_event?: boolean }): boolean

    /*
     * See if feature flags are available.
     *
     * ### Usage:
     *
     *     posthog.onFeatureFlags(function(featureFlags) { // do something })
     *
     * @param {Function} [callback] The callback function will be called once the feature flags are ready. It'll return a list of feature flags enabled for the user.
     */
    static onFeatureFlags(
        callback: (flags: string[], variants: Record<string, boolean | string>) => void
    ): false | undefined

    /*
     * Override flags locally.
     *
     * ### Usage:
     *
     *     - posthog.feature_flags.override(false)
     *     - posthog.feature_flags.override(['beta-feature'])
     *     - posthog.feature_flags.override({'beta-feature': 'variant', 'other-feature': True})
     *
     * @param {Function} [callback] The callback function will be called once the feature flags are ready. It'll return a list of feature flags enabled for the user.
     */
    static override(flags: false | string[] | Record<string, boolean | string>): void
}

export declare class SentryIntegration implements Integration {
    constructor(posthog: PostHogClass, organization?: string, projectId?: number, prefix?: string)
    name: string
    setupOnce(addGlobalEventProcessor: (callback: EventProcessor) => void, getCurrentHub: () => Hub): void
}
