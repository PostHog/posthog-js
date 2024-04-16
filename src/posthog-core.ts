import Config from './config'
import {
    _copyAndTruncateStrings,
    _each,
    _eachArray,
    _extend,
    _includes,
    _register_event,
    _safewrap_class,
    isCrossDomainCookie,
    isDistinctIdStringLike,
} from './utils'
import { assignableWindow, document, location, userAgent, window } from './utils/globals'
import { PostHogFeatureFlags } from './posthog-featureflags'
import { PostHogPersistence } from './posthog-persistence'
import {
    ALIAS_ID_KEY,
    ENABLE_PERSON_PROCESSING,
    FLAG_CALL_REPORTED,
    PEOPLE_DISTINCT_ID_KEY,
    SESSION_RECORDING_IS_SAMPLED,
} from './constants'
import { SessionRecording } from './extensions/replay/sessionrecording'
import { Decide } from './decide'
import { Toolbar } from './extensions/toolbar'
import { clearOptInOut, hasOptedIn, hasOptedOut, optIn, optOut, userOptedOut } from './gdpr-utils'
import { cookieStore, localStore } from './storage'
import { RequestQueue } from './request-queue'
import { RetryQueue } from './retry-queue'
import { SessionIdManager } from './sessionid'
import { RequestRouter, RequestRouterRegion } from './utils/request-router'
import {
    CaptureOptions,
    CaptureResult,
    Compression,
    DecideResponse,
    EarlyAccessFeatureCallback,
    GDPROptions,
    IsFeatureEnabledOptions,
    JsonType,
    OptInOutCapturingOptions,
    PostHogConfig,
    Properties,
    Property,
    QueuedRequestOptions,
    RequestCallback,
    SessionIdChangedCallback,
    SnippetArrayItem,
    ToolbarParams,
} from './types'
import { SentryIntegration } from './extensions/sentry-integration'
import { setupSegmentIntegration } from './extensions/segment-integration'
import { PageViewManager } from './page-view'
import { PostHogSurveys } from './posthog-surveys'
import { RateLimiter } from './rate-limiter'
import { uuidv7 } from './uuidv7'
import { SurveyCallback } from './posthog-surveys-types'
import {
    _isArray,
    _isEmptyObject,
    _isEmptyString,
    _isFunction,
    _isNumber,
    _isObject,
    _isString,
    _isUndefined,
} from './utils/type-utils'
import { _info } from './utils/event-utils'
import { logger } from './utils/logger'
import { SessionPropsManager } from './session-props'
import { _isBlockedUA } from './utils/blocked-uas'
import { extendURLParams, request, SUPPORTS_REQUEST } from './request'
import { SimpleEventEmitter } from './utils/simple-event-emitter'
import { Autocapture } from './autocapture'

/*
SIMPLE STYLE GUIDE:

this.x === public function
this._x === internal - only use within this file
this.__x === private - only use within the class

Globals should be all caps
*/

/* posthog.init is called with `Partial<PostHogConfig>`
 * and we want to ensure that only valid keys are passed to the config object.
 * TypeScript does not enforce that the object passed does not have extra keys.
 * So someone can call with { bootstrap: { distinctId: '123'} }
 * which is not a valid key. They should have passed distinctID (upper case D).
 * That's a really tricky mistake to spot.
 * The OnlyValidKeys type ensures that only keys that are valid in the PostHogConfig type are allowed.
 */
type OnlyValidKeys<T, Shape> = T extends Shape ? (Exclude<keyof T, keyof Shape> extends never ? T : never) : never

const instances: Record<string, PostHog> = {}

// some globals for comparisons
const __NOOP = () => {}

const PRIMARY_INSTANCE_NAME = 'posthog'

/*
 * Dynamic... constants? Is that an oxymoron?
 */
// http://hacks.mozilla.org/2009/07/cross-site-xmlhttprequest-with-cors/
// https://developer.mozilla.org/en-US/docs/DOM/XMLHttpRequest#withCredentials

// IE<10 does not support cross-origin XHR's but script tags
// with defer won't block window.onload; ENQUEUE_REQUESTS
// should only be true for Opera<12
let ENQUEUE_REQUESTS = !SUPPORTS_REQUEST && userAgent?.indexOf('MSIE') === -1 && userAgent?.indexOf('Mozilla') === -1

export const defaultConfig = (): PostHogConfig => ({
    api_host: 'https://us.i.posthog.com',
    api_transport: 'XHR',
    ui_host: null,
    token: '',
    autocapture: true,
    rageclick: true,
    cross_subdomain_cookie: isCrossDomainCookie(document?.location),
    persistence: 'localStorage+cookie', // up to 1.92.0 this was 'cookie'. It's easy to migrate as 'localStorage+cookie' will migrate data from cookie storage
    persistence_name: '',
    loaded: __NOOP,
    store_google: true,
    custom_campaign_params: [],
    custom_blocked_useragents: [],
    save_referrer: true,
    capture_pageview: true,
    capture_pageleave: true, // We'll only capture pageleave events if capture_pageview is also true
    debug: (location && _isString(location?.search) && location.search.indexOf('__posthog_debug=true') !== -1) || false,
    verbose: false,
    cookie_expiration: 365,
    upgrade: false,
    disable_session_recording: false,
    disable_persistence: false,
    disable_surveys: false,
    enable_recording_console_log: undefined, // When undefined, it falls back to the server-side setting
    secure_cookie: window?.location?.protocol === 'https:',
    ip: true,
    opt_out_capturing_by_default: false,
    opt_out_persistence_by_default: false,
    opt_out_useragent_filter: false,
    opt_out_capturing_persistence_type: 'localStorage',
    opt_out_capturing_cookie_prefix: null,
    opt_in_site_apps: false,
    property_denylist: [],
    respect_dnt: false,
    sanitize_properties: null,
    request_headers: {}, // { header: value, header2: value }
    inapp_protocol: '//',
    inapp_link_new_window: false,
    request_batching: true,
    properties_string_max_length: 65535,
    session_recording: {},
    mask_all_element_attributes: false,
    mask_all_text: false,
    advanced_disable_decide: false,
    advanced_disable_feature_flags: false,
    advanced_disable_feature_flags_on_first_load: false,
    advanced_disable_toolbar_metrics: false,
    feature_flag_request_timeout_ms: 3000,
    on_request_error: (res) => {
        const error = 'Bad HTTP status: ' + res.statusCode + ' ' + res.text
        logger.error(error)
    },
    get_device_id: (uuid) => uuid,
    // Used for internal testing
    _onCapture: __NOOP,
    capture_performance: undefined,
    name: 'posthog',
    bootstrap: {},
    disable_compression: false,
    session_idle_timeout_seconds: 30 * 60, // 30 minutes
    person_profiles: 'always',
})

export const configRenames = (origConfig: Partial<PostHogConfig>): Partial<PostHogConfig> => {
    const renames: Partial<PostHogConfig> = {}
    if (!_isUndefined(origConfig.process_person)) {
        renames.person_profiles = origConfig.process_person
    }
    if (!_isUndefined(origConfig.xhr_headers)) {
        renames.request_headers = origConfig.xhr_headers
    }
    if (!_isUndefined(origConfig.cookie_name)) {
        renames.persistence_name = origConfig.cookie_name
    }
    if (!_isUndefined(origConfig.disable_cookie)) {
        renames.disable_persistence = origConfig.disable_cookie
    }
    // on_xhr_error is not present, as the type is different to on_request_error

    // the original config takes priority over the renames
    const newConfig = _extend({}, renames, origConfig)

    // merge property_blacklist into property_denylist
    if (_isArray(origConfig.property_blacklist)) {
        if (_isUndefined(origConfig.property_denylist)) {
            newConfig.property_denylist = origConfig.property_blacklist
        } else if (_isArray(origConfig.property_denylist)) {
            newConfig.property_denylist = [...origConfig.property_blacklist, ...origConfig.property_denylist]
        } else {
            logger.error('Invalid value for property_denylist config: ' + origConfig.property_denylist)
        }
    }

    return newConfig
}

class DeprecatedWebPerformanceObserver {
    get _forceAllowLocalhost(): boolean {
        return this.__forceAllowLocalhost
    }

    set _forceAllowLocalhost(value: boolean) {
        logger.error(
            'WebPerformanceObserver is deprecated and has no impact on network capture. Use `_forceAllowLocalhostNetworkCapture` on `posthog.sessionRecording`'
        )
        this.__forceAllowLocalhost = value
    }

    private __forceAllowLocalhost: boolean = false
}

/**
 * PostHog Library Object
 * @constructor
 */
export class PostHog {
    __loaded: boolean
    config: PostHogConfig

    rateLimiter: RateLimiter
    pageViewManager: PageViewManager
    featureFlags: PostHogFeatureFlags
    surveys: PostHogSurveys
    toolbar: Toolbar

    // These are instance-specific state created after initialisation
    persistence?: PostHogPersistence
    sessionPersistence?: PostHogPersistence
    sessionManager?: SessionIdManager
    sessionPropsManager?: SessionPropsManager
    requestRouter: RequestRouter
    autocapture?: Autocapture

    _requestQueue?: RequestQueue
    _retryQueue?: RetryQueue
    sessionRecording?: SessionRecording
    webPerformance = new DeprecatedWebPerformanceObserver()

    _triggered_notifs: any
    compression?: Compression
    __request_queue: QueuedRequestOptions[]
    decideEndpointWasHit: boolean
    analyticsDefaultEndpoint: string

    SentryIntegration: typeof SentryIntegration

    private _debugEventEmitter = new SimpleEventEmitter()

    /** DEPRECATED: We keep this to support existing usage but now one should just call .setPersonProperties */
    people: {
        set: (prop: string | Properties, to?: string, callback?: RequestCallback) => void
        set_once: (prop: string | Properties, to?: string, callback?: RequestCallback) => void
    }

    constructor() {
        this.config = defaultConfig()
        this.decideEndpointWasHit = false
        this.SentryIntegration = SentryIntegration
        this.__request_queue = []
        this.__loaded = false
        this.analyticsDefaultEndpoint = '/e/'

        this.featureFlags = new PostHogFeatureFlags(this)
        this.toolbar = new Toolbar(this)
        this.pageViewManager = new PageViewManager(this)
        this.surveys = new PostHogSurveys(this)
        this.rateLimiter = new RateLimiter()
        this.requestRouter = new RequestRouter(this)

        // NOTE: See the property definition for deprecation notice
        this.people = {
            set: (prop: string | Properties, to?: string, callback?: RequestCallback) => {
                const setProps = _isString(prop) ? { [prop]: to } : prop
                this.setPersonProperties(setProps)
                callback?.({} as any)
            },
            set_once: (prop: string | Properties, to?: string, callback?: RequestCallback) => {
                const setProps = _isString(prop) ? { [prop]: to } : prop
                this.setPersonProperties(undefined, setProps)
                callback?.({} as any)
            },
        }

        this.on('eventCaptured', (data) => logger.info('send', data))
    }

    // Initialization methods

    /**
     * This function initializes a new instance of the PostHog capturing object.
     * All new instances are added to the main posthog object as sub properties (such as
     * posthog.library_name) and also returned by this function. To define a
     * second instance on the page, you would call:
     *
     *     posthog.init('new token', { your: 'config' }, 'library_name');
     *
     * and use it like so:
     *
     *     posthog.library_name.capture(...);
     *
     * @param {String} token   Your PostHog API token
     * @param {Object} [config]  A dictionary of config options to override. <a href="https://github.com/posthog/posthog-js/blob/6e0e873/src/posthog-core.js#L57-L91">See a list of default config options</a>.
     * @param {String} [name]    The name for the new posthog instance that you want created
     */
    init(
        token: string,
        config?: OnlyValidKeys<Partial<PostHogConfig>, Partial<PostHogConfig>>,
        name?: string
    ): PostHog | void {
        if (!name || name === PRIMARY_INSTANCE_NAME) {
            // This means we are initializing the primary instance (i.e. this)
            return this._init(token, config, name)
        } else {
            const namedPosthog = instances[name] ?? new PostHog()
            namedPosthog._init(token, config, name)
            instances[name] = namedPosthog
            // Add as a property to the primary instance (this isn't type-safe but its how it was always done)
            ;(instances[PRIMARY_INSTANCE_NAME] as any)[name] = namedPosthog

            return namedPosthog
        }
    }

    // posthog._init(token:string, config:object, name:string)
    //
    // This function sets up the current instance of the posthog
    // library.  The difference between this method and the init(...)
    // method is this one initializes the actual instance, whereas the
    // init(...) method sets up a new library and calls _init on it.
    //
    // Note that there are operations that can be asynchronous, so we
    // accept a callback that is called when all the asynchronous work
    // is done. Note that we do not use promises because we want to be
    // IE11 compatible. We could use polyfills, which would make the
    // code a bit cleaner, but will add some overhead.
    //
    _init(token: string, config: Partial<PostHogConfig> = {}, name?: string): PostHog {
        if (_isUndefined(token) || _isEmptyString(token)) {
            logger.critical(
                'PostHog was initialized without a token. This likely indicates a misconfiguration. Please check the first argument passed to posthog.init()'
            )
            return this
        }

        if (this.__loaded) {
            logger.warn('You have already initialized PostHog! Re-initializing is a no-op')
            return this
        }

        this.__loaded = true
        this.config = {} as PostHogConfig // will be set right below
        this._triggered_notifs = []

        this.set_config(
            _extend({}, defaultConfig(), configRenames(config), {
                name: name,
                token: token,
            })
        )

        this.compression = config.disable_compression ? undefined : Compression.Base64

        this.persistence = new PostHogPersistence(this.config)
        this.sessionPersistence =
            this.config.persistence === 'sessionStorage'
                ? this.persistence
                : new PostHogPersistence({ ...this.config, persistence: 'sessionStorage' })

        this._requestQueue = new RequestQueue((req) => this._send_request(req))
        this._retryQueue = new RetryQueue(this)
        this.__request_queue = []

        this.sessionManager = new SessionIdManager(this.config, this.persistence)
        this.sessionPropsManager = new SessionPropsManager(this.sessionManager, this.persistence)

        this.sessionRecording = new SessionRecording(this)
        this.sessionRecording.startRecordingIfEnabled()

        if (!this.config.disable_scroll_properties) {
            this.pageViewManager.startMeasuringScrollPosition()
        }

        this.autocapture = new Autocapture(this)

        // if any instance on the page has debug = true, we set the
        // global debug to be true
        Config.DEBUG = Config.DEBUG || this.config.debug

        this._gdpr_init()

        // isUndefined doesn't provide typehint here so wouldn't reduce bundle as we'd need to assign
        // eslint-disable-next-line posthog-js/no-direct-undefined-check
        if (config.bootstrap?.distinctID !== undefined) {
            const uuid = this.config.get_device_id(uuidv7())
            const deviceID = config.bootstrap?.isIdentifiedID ? uuid : config.bootstrap.distinctID
            this.persistence.set_user_state(config.bootstrap?.isIdentifiedID ? 'identified' : 'anonymous')
            this.register({
                distinct_id: config.bootstrap.distinctID,
                $device_id: deviceID,
            })
        }

        if (this._hasBootstrappedFeatureFlags()) {
            const activeFlags = Object.keys(config.bootstrap?.featureFlags || {})
                .filter((flag) => !!config.bootstrap?.featureFlags?.[flag])
                .reduce(
                    (res: Record<string, string | boolean>, key) => (
                        (res[key] = config.bootstrap?.featureFlags?.[key] || false), res
                    ),
                    {}
                )
            const featureFlagPayloads = Object.keys(config.bootstrap?.featureFlagPayloads || {})
                .filter((key) => activeFlags[key])
                .reduce((res: Record<string, JsonType>, key) => {
                    if (config.bootstrap?.featureFlagPayloads?.[key]) {
                        res[key] = config.bootstrap?.featureFlagPayloads?.[key]
                    }
                    return res
                }, {})

            this.featureFlags.receivedFeatureFlags({ featureFlags: activeFlags, featureFlagPayloads })
        }

        if (!this.get_distinct_id()) {
            // There is no need to set the distinct id
            // or the device id if something was already stored
            // in the persitence
            const uuid = this.config.get_device_id(uuidv7())

            this.register_once(
                {
                    distinct_id: uuid,
                    $device_id: uuid,
                },
                ''
            )
            // distinct id == $device_id is a proxy for anonymous user
            this.persistence.set_user_state('anonymous')
        }
        // Set up event handler for pageleave
        // Use `onpagehide` if available, see https://calendar.perfplanet.com/2020/beaconing-in-practice/#beaconing-reliability-avoiding-abandons
        window?.addEventListener?.('onpagehide' in self ? 'pagehide' : 'unload', this._handle_unload.bind(this))

        this.toolbar.maybeLoadToolbar()

        // We wan't to avoid promises for IE11 compatibility, so we use callbacks here
        if (config.segment) {
            setupSegmentIntegration(this, () => this._loaded())
        } else {
            this._loaded()
        }

        if (_isFunction(this.config._onCapture)) {
            this.on('eventCaptured', (data) => this.config._onCapture(data.event, data))
        }

        return this
    }

    // Private methods
    _afterDecideResponse(response: DecideResponse) {
        this.compression = undefined
        if (response.supportedCompression && !this.config.disable_compression) {
            this.compression = _includes(response['supportedCompression'], Compression.GZipJS)
                ? Compression.GZipJS
                : _includes(response['supportedCompression'], Compression.Base64)
                ? Compression.Base64
                : undefined
        }

        if (response.analytics?.endpoint) {
            this.analyticsDefaultEndpoint = response.analytics.endpoint
        }
    }

    _loaded(): void {
        // Pause `reloadFeatureFlags` calls in config.loaded callback.
        // These feature flags are loaded in the decide call made right
        // afterwards
        const disableDecide = this.config.advanced_disable_decide
        if (!disableDecide) {
            this.featureFlags.setReloadingPaused(true)
        }

        try {
            this.config.loaded(this)
        } catch (err) {
            logger.critical('`loaded` function failed', err)
        }

        this._start_queue_if_opted_in()

        // this happens after "loaded" so a user can call identify or any other things before the pageview fires
        if (this.config.capture_pageview) {
            // NOTE: We want to fire this on the next tick as the previous implementation had this side effect
            // and some clients may rely on it
            setTimeout(() => {
                if (document) {
                    this.capture('$pageview', { title: document.title }, { send_instantly: true })
                }
            }, 1)
        }

        // Call decide to get what features are enabled and other settings.
        // As a reminder, if the /decide endpoint is disabled, feature flags, toolbar, session recording, autocapture,
        // and compression will not be available.
        if (!disableDecide) {
            new Decide(this).call()

            // TRICKY: Reset any decide reloads queued during config.loaded because they'll be
            // covered by the decide call right above.
            this.featureFlags.resetRequestQueue()
        }
    }

    _start_queue_if_opted_in(): void {
        if (!this.has_opted_out_capturing()) {
            if (this.config.request_batching) {
                this._requestQueue?.enable()
            }
        }
    }

    _dom_loaded(): void {
        if (!this.has_opted_out_capturing()) {
            _eachArray(this.__request_queue, (item) => this._send_retriable_request(item))
        }

        this.__request_queue = []
        this._start_queue_if_opted_in()
    }

    _handle_unload(): void {
        if (!this.config.request_batching) {
            if (this.config.capture_pageview && this.config.capture_pageleave) {
                this.capture('$pageleave', null, { transport: 'sendBeacon' })
            }
            return
        }

        if (this.config.capture_pageview && this.config.capture_pageleave) {
            this.capture('$pageleave')
        }

        this._requestQueue?.unload()
        this._retryQueue?.unload()
    }

    _send_request(options: QueuedRequestOptions): void {
        if (!this.__loaded) {
            return
        }

        if (ENQUEUE_REQUESTS) {
            this.__request_queue.push(options)
            return
        }

        if (this.rateLimiter.isRateLimited(options.batchKey)) {
            return
        }

        options.transport = options.transport || this.config.api_transport
        options.url = extendURLParams(options.url, {
            // Whether to detect ip info or not
            ip: this.config.ip ? 1 : 0,
        })
        options.headers = this.config.request_headers
        options.compression = options.compression === 'best-available' ? this.compression : options.compression

        request({
            ...options,
            callback: (response) => {
                this.rateLimiter.checkForLimiting(response)

                if (response.statusCode >= 400) {
                    this.config.on_request_error?.(response)
                }

                options.callback?.(response)
            },
        })
    }

    _send_retriable_request(options: QueuedRequestOptions): void {
        if (this._retryQueue) {
            this._retryQueue.retriableRequest(options)
        } else {
            this._send_request(options)
        }
    }

    /**
     * _execute_array() deals with processing any posthog function
     * calls that were called before the PostHog library were loaded
     * (and are thus stored in an array so they can be called later)
     *
     * Note: we fire off all the posthog function calls && user defined
     * functions BEFORE we fire off posthog capturing calls. This is so
     * identify/register/set_config calls can properly modify early
     * capturing calls.
     *
     * @param {Array} array
     */
    _execute_array(array: SnippetArrayItem[]): void {
        let fn_name
        const alias_calls: SnippetArrayItem[] = []
        const other_calls: SnippetArrayItem[] = []
        const capturing_calls: SnippetArrayItem[] = []
        _eachArray(array, (item) => {
            if (item) {
                fn_name = item[0]
                if (_isArray(fn_name)) {
                    capturing_calls.push(item) // chained call e.g. posthog.get_group().set()
                } else if (_isFunction(item)) {
                    ;(item as any).call(this)
                } else if (_isArray(item) && fn_name === 'alias') {
                    alias_calls.push(item)
                } else if (_isArray(item) && fn_name.indexOf('capture') !== -1 && _isFunction((this as any)[fn_name])) {
                    capturing_calls.push(item)
                } else {
                    other_calls.push(item)
                }
            }
        })

        const execute = function (calls: SnippetArrayItem[], thisArg: any) {
            _eachArray(
                calls,
                function (item) {
                    if (_isArray(item[0])) {
                        // chained call
                        let caller = thisArg
                        _each(item, function (call) {
                            caller = caller[call[0]].apply(caller, call.slice(1))
                        })
                    } else {
                        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                        // @ts-ignore
                        this[item[0]].apply(this, item.slice(1))
                    }
                },
                thisArg
            )
        }

        execute(alias_calls, this)
        execute(other_calls, this)
        execute(capturing_calls, this)
    }

    _hasBootstrappedFeatureFlags(): boolean {
        return (
            (this.config.bootstrap?.featureFlags && Object.keys(this.config.bootstrap?.featureFlags).length > 0) ||
            false
        )
    }

    /**
     * push() keeps the standard async-array-push
     * behavior around after the lib is loaded.
     * This is only useful for external integrations that
     * do not wish to rely on our convenience methods
     * (created in the snippet).
     *
     * ### Usage:
     *     posthog.push(['register', { a: 'b' }]);
     *
     * @param {Array} item A [function_name, args...] array to be executed
     */
    push(item: SnippetArrayItem): void {
        this._execute_array([item])
    }

    /**
     * Capture an event. This is the most important and
     * frequently used PostHog function.
     *
     * ### Usage:
     *
     *     // capture an event named 'Registered'
     *     posthog.capture('Registered', {'Gender': 'Male', 'Age': 21});
     *
     *     // capture an event using navigator.sendBeacon
     *     posthog.capture('Left page', {'duration_seconds': 35}, {transport: 'sendBeacon'});
     *
     * @param {String} event_name The name of the event. This can be anything the user does - 'Button Click', 'Sign Up', 'Item Purchased', etc.
     * @param {Object} [properties] A set of properties to include with the event you're sending. These describe the user who did the event or details about the event itself.
     * @param {Object} [options] Optional configuration for this capture request.
     * @param {String} [options.transport] Transport method for network request ('XHR' or 'sendBeacon').
     * @param {Date} [options.timestamp] Timestamp is a Date object. If not set, it'll automatically be set to the current time.
     */
    capture(event_name: string, properties?: Properties | null, options?: CaptureOptions): CaptureResult | void {
        // While developing, a developer might purposefully _not_ call init(),
        // in this case, we would like capture to be a noop.
        if (!this.__loaded || !this.persistence || !this.sessionPersistence || !this._requestQueue) {
            return logger.uninitializedWarning('posthog.capture')
        }

        if (userOptedOut(this)) {
            return
        }

        // typing doesn't prevent interesting data
        if (_isUndefined(event_name) || !_isString(event_name)) {
            logger.error('No event name provided to posthog.capture')
            return
        }

        if (
            userAgent &&
            !this.config.opt_out_useragent_filter &&
            _isBlockedUA(userAgent, this.config.custom_blocked_useragents)
        ) {
            return
        }

        // update persistence
        this.sessionPersistence.update_search_keyword()

        // The initial campaign/referrer props need to be stored in the regular persistence, as they are there to mimic
        // the person-initial props. The non-initial versions are stored in the sessionPersistence, as they are sent
        // with every event and used by the session table to create session-initial props.
        if (this.config.store_google) {
            this.sessionPersistence.update_campaign_params()
            this.persistence.set_initial_campaign_params()
        }
        if (this.config.save_referrer) {
            this.sessionPersistence.update_referrer_info()
            this.persistence.set_initial_referrer_info()
        }

        let data: CaptureResult = {
            uuid: uuidv7(),
            event: event_name,
            properties: this._calculate_event_properties(event_name, properties || {}),
        }

        const setProperties = options?.$set
        if (setProperties) {
            data.$set = options?.$set
        }
        const setOnceProperties = this._calculate_set_once_properties(options?.$set_once)
        if (setOnceProperties) {
            data.$set_once = setOnceProperties
        }

        data = _copyAndTruncateStrings(data, options?._noTruncate ? null : this.config.properties_string_max_length)
        data.timestamp = options?.timestamp || new Date()
        if (!_isUndefined(options?.timestamp)) {
            data.properties['$event_time_override_provided'] = true
            data.properties['$event_time_override_system_time'] = new Date()
        }

        // Top-level $set overriding values from the one from properties is taken from the plugin-server normalizeEvent
        // This doesn't handle $set_once, because posthog-people doesn't either
        const finalSet = { ...data.properties['$set'], ...data['$set'] }
        if (!_isEmptyObject(finalSet)) {
            this.setPersonPropertiesForFlags(finalSet)
        }

        this._debugEventEmitter.emit('eventCaptured', data)

        const requestOptions: QueuedRequestOptions = {
            method: 'POST',
            url: options?._url ?? this.requestRouter.endpointFor('api', this.analyticsDefaultEndpoint),
            data,
            compression: 'best-available',
            batchKey: options?._batchKey,
        }

        if (this.config.request_batching && (!options || options?._batchKey) && !options?.send_instantly) {
            this._requestQueue.enqueue(requestOptions)
        } else {
            this._send_retriable_request(requestOptions)
        }

        return data
    }

    _addCaptureHook(callback: (eventName: string) => void): void {
        this.on('eventCaptured', (data) => callback(data.event))
    }

    _calculate_event_properties(event_name: string, event_properties: Properties): Properties {
        if (!this.persistence || !this.sessionPersistence) {
            return event_properties
        }

        // set defaults
        const start_timestamp = this.persistence.remove_event_timer(event_name)
        let properties = { ...event_properties }
        properties['token'] = this.config.token

        if (event_name === '$snapshot') {
            const persistenceProps = { ...this.persistence.properties(), ...this.sessionPersistence.properties() }
            properties['distinct_id'] = persistenceProps.distinct_id
            return properties
        }

        const infoProperties = _info.properties()

        if (this.sessionManager) {
            const { sessionId, windowId } = this.sessionManager.checkAndGetSessionAndWindowId()
            properties['$session_id'] = sessionId
            properties['$window_id'] = windowId
        }

        if (this.requestRouter.region === RequestRouterRegion.CUSTOM) {
            properties['$lib_custom_api_host'] = this.config.api_host
        }

        if (
            this.sessionPropsManager &&
            this.config.__preview_send_client_session_params &&
            (event_name === '$pageview' || event_name === '$pageleave' || event_name === '$autocapture')
        ) {
            const sessionProps = this.sessionPropsManager.getSessionProps()
            properties = _extend(properties, sessionProps)
        }

        if (!this.config.disable_scroll_properties) {
            let performanceProperties: Record<string, any> = {}
            if (event_name === '$pageview') {
                performanceProperties = this.pageViewManager.doPageView()
            } else if (event_name === '$pageleave') {
                performanceProperties = this.pageViewManager.doPageLeave()
            }
            properties = _extend(properties, performanceProperties)
        }

        if (event_name === '$pageview' && document) {
            properties['title'] = document.title
        }

        if (event_name === '$performance_event') {
            const persistenceProps = this.persistence.properties()
            // Early exit for $performance_event as we only need session and $current_url
            properties['distinct_id'] = persistenceProps.distinct_id
            properties['$current_url'] = infoProperties.$current_url
            return properties
        }

        // set $duration if time_event was previously called for this event
        if (!_isUndefined(start_timestamp)) {
            const duration_in_ms = new Date().getTime() - start_timestamp
            properties['$duration'] = parseFloat((duration_in_ms / 1000).toFixed(3))
        }

        // this is only added when this.config.opt_out_useragent_filter is true,
        // or it would always add "browser"
        if (userAgent && this.config.opt_out_useragent_filter) {
            properties['$browser_type'] = _isBlockedUA(userAgent, this.config.custom_blocked_useragents)
                ? 'bot'
                : 'browser'
        }

        // note: extend writes to the first object, so lets make sure we
        // don't write to the persistence properties object and info
        // properties object by passing in a new object

        // update properties with pageview info and super-properties
        properties = _extend(
            {},
            _info.properties(),
            this.persistence.properties(),
            this.sessionPersistence.properties(),
            properties
        )

        properties['$is_identified'] = this._isIdentified()

        if (_isArray(this.config.property_denylist)) {
            _each(this.config.property_denylist, function (denylisted_prop) {
                delete properties[denylisted_prop]
            })
        } else {
            logger.error(
                'Invalid value for property_denylist config: ' +
                    this.config.property_denylist +
                    ' or property_blacklist config: ' +
                    this.config.property_blacklist
            )
        }

        const sanitize_properties = this.config.sanitize_properties
        if (sanitize_properties) {
            properties = sanitize_properties(properties, event_name)
        }

        // add person processing flag as very last step, so it cannot be overridden. process_person=true is default
        properties['$process_person_profile'] = this._hasPersonProcessing()

        return properties
    }

    _calculate_set_once_properties(dataSetOnce?: Properties): Properties | undefined {
        if (!this.persistence || !this._hasPersonProcessing()) {
            return dataSetOnce
        }
        // if we're an identified person, send initial params with every event
        const setOnceProperties = _extend({}, this.persistence.get_initial_props(), dataSetOnce || {})
        if (_isEmptyObject(setOnceProperties)) {
            return undefined
        }
        return setOnceProperties
    }

    /**
     * Register a set of super properties, which are included with all
     * events. This will overwrite previous super property values, except
     * for session properties (see `register_for_session(properties)`).
     *
     * ### Usage:
     *
     *     // register 'Gender' as a super property
     *     posthog.register({'Gender': 'Female'});
     *
     *     // register several super properties when a user signs up
     *     posthog.register({
     *         'Email': 'jdoe@example.com',
     *         'Account Type': 'Free'
     *     });
     *
     *     // Display the properties
     *     console.log(posthog.persistence.properties())
     *
     * @param {Object} properties An associative array of properties to store about the user
     * @param {Number} [days] How many days since the user's last visit to store the super properties
     */
    register(properties: Properties, days?: number): void {
        this.persistence?.register(properties, days)
    }

    /**
     * Register a set of super properties only once. These will not
     * overwrite previous super property values, unlike register().
     *
     * ### Usage:
     *
     *     // register a super property for the first time only
     *     posthog.register_once({
     *         'First Login Date': new Date().toISOString()
     *     });
     *
     *     // Display the properties
     *     console.log(posthog.persistence.properties())
     *
     * ### Notes:
     *
     * If default_value is specified, current super properties
     * with that value will be overwritten.
     *
     * @param {Object} properties An associative array of properties to store about the user
     * @param {*} [default_value] Value to override if already set in super properties (ex: 'False') Default: 'None'
     * @param {Number} [days] How many days since the users last visit to store the super properties
     */
    register_once(properties: Properties, default_value?: Property, days?: number): void {
        this.persistence?.register_once(properties, default_value, days)
    }

    /**
     * Register a set of super properties, which are included with all events, but only
     * for THIS SESSION. These will overwrite all other super property values.
     *
     * Unlike regular super properties, which last in LocalStorage for a long time,
     * session super properties get cleared after a session ends.
     *
     * ### Usage:
     *
     *     // register on all events this session
     *     posthog.register_for_session({'referer': customGetReferer()});
     *
     *     // register several session super properties when a user signs up
     *     posthog.register_for_session({
     *         'selectedPlan': 'pro',
     *         'completedSteps': 4,
     *     });
     *
     *     // Display the properties
     *     console.log(posthog.sessionPersistence.properties())
     *
     * @param {Object} properties An associative array of properties to store about the user
     */
    register_for_session(properties: Properties): void {
        this.sessionPersistence?.register(properties)
    }

    /**
     * Delete a super property stored with the current user.
     *
     * @param {String} property The name of the super property to remove
     */
    unregister(property: string): void {
        this.persistence?.unregister(property)
    }

    /**
     * Delete a session super property stored with the current user.
     *
     * @param {String} property The name of the session super property to remove
     */
    unregister_for_session(property: string): void {
        this.sessionPersistence?.unregister(property)
    }

    _register_single(prop: string, value: Property) {
        this.register({ [prop]: value })
    }

    /*
     * Get feature flag value for user (supports multivariate flags).
     *
     * ### Usage:
     *
     *     if(posthog.getFeatureFlag('beta-feature') === 'some-value') { // do something }
     *
     * @param {Object|String} prop Key of the feature flag.
     * @param {Object|String} options (optional) If {send_event: false}, we won't send an $feature_flag_call event to PostHog.
     */
    getFeatureFlag(key: string, options?: { send_event?: boolean }): boolean | string | undefined {
        return this.featureFlags.getFeatureFlag(key, options)
    }

    /*
     * Get feature flag payload value matching key for user (supports multivariate flags).
     *
     * ### Usage:
     *
     *     if(posthog.getFeatureFlag('beta-feature') === 'some-value') {
     *          const someValue = posthog.getFeatureFlagPayload('beta-feature')
     *          // do something
     *     }
     *
     * @param {Object|String} prop Key of the feature flag.
     */
    getFeatureFlagPayload(key: string): JsonType {
        const payload = this.featureFlags.getFeatureFlagPayload(key)
        try {
            return JSON.parse(payload as any)
        } catch {
            return payload
        }
    }

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
    isFeatureEnabled(key: string, options?: IsFeatureEnabledOptions): boolean | undefined {
        return this.featureFlags.isFeatureEnabled(key, options)
    }

    reloadFeatureFlags(): void {
        this.featureFlags.reloadFeatureFlags()
    }

    /** Opt the user in or out of an early access feature. */
    updateEarlyAccessFeatureEnrollment(key: string, isEnrolled: boolean): void {
        this.featureFlags.updateEarlyAccessFeatureEnrollment(key, isEnrolled)
    }

    /** Get the list of early access features. To check enrollment status, use `isFeatureEnabled`. */
    getEarlyAccessFeatures(callback: EarlyAccessFeatureCallback, force_reload = false): void {
        return this.featureFlags.getEarlyAccessFeatures(callback, force_reload)
    }

    /**
     * Exposes a set of events that PostHog will emit.
     * e.g. `eventCaptured` is emitted immediately before trying to send an event
     *
     * Unlike  `onFeatureFlags` and `onSessionId` these are not called when the
     * listener is registered, the first callback will be the next event
     * _after_ registering a listener
     */
    on(event: 'eventCaptured', cb: (...args: any[]) => void): () => void {
        return this._debugEventEmitter.on(event, cb)
    }

    /*
     * Register an event listener that runs when feature flags become available or when they change.
     * If there are flags, the listener is called immediately in addition to being called on future changes.
     *
     * ### Usage:
     *
     *     posthog.onFeatureFlags(function(featureFlags) { // do something })
     *
     * @param {Function} [callback] The callback function will be called once the feature flags are ready or when they are updated.
     *                              It'll return a list of feature flags enabled for the user.
     * @returns {Function} A function that can be called to unsubscribe the listener. Used by useEffect when the component unmounts.
     */
    onFeatureFlags(callback: (flags: string[], variants: Record<string, string | boolean>) => void): () => void {
        return this.featureFlags.onFeatureFlags(callback)
    }

    /*
     * Register an event listener that runs whenever the session id or window id change.
     * If there is already a session id, the listener is called immediately in addition to being called on future changes.
     *
     * Can be used, for example, to sync the PostHog session id with a backend session.
     *
     * ### Usage:
     *
     *     posthog.onSessionId(function(sessionId, windowId) { // do something })
     *
     * @param {Function} [callback] The callback function will be called once a session id is present or when it or the window id are updated.
     * @returns {Function} A function that can be called to unsubscribe the listener. E.g. Used by useEffect when the component unmounts.
     */
    onSessionId(callback: SessionIdChangedCallback): () => void {
        return this.sessionManager?.onSessionId(callback) ?? (() => {})
    }

    /** Get list of all surveys. */
    getSurveys(callback: SurveyCallback, forceReload = false): void {
        this.surveys.getSurveys(callback, forceReload)
    }

    /** Get surveys that should be enabled for the current user. */
    getActiveMatchingSurveys(callback: SurveyCallback, forceReload = false): void {
        this.surveys.getActiveMatchingSurveys(callback, forceReload)
    }

    /**
     * Identify a user with a unique ID instead of a PostHog
     * randomly generated distinct_id. If the method is never called,
     * then unique visitors will be identified by a UUID that is generated
     * the first time they visit the site.
     *
     * If user properties are passed, they are also sent to posthog.
     *
     * ### Usage:
     *
     *      posthog.identify('[user unique id]')
     *      posthog.identify('[user unique id]', { email: 'john@example.com' })
     *      posthog.identify('[user unique id]', {}, { referral_code: '12345' })
     *
     * ### Notes:
     *
     * You can call this function to overwrite a previously set
     * unique ID for the current user.
     *
     * If the user has been identified ($user_state in persistence is set to 'identified'),
     * then capture of $identify is skipped to avoid merging users. For example,
     * if your system allows an admin user to impersonate another user.
     *
     * Then a single browser instance can have:
     *
     *  `identify('a') -> capture(1) -> identify('b') -> capture(2)`
     *
     * and capture 1 and capture 2 will have the correct distinct_id.
     * but users a and b will NOT be merged in posthog.
     *
     * However, if reset is called then:
     *
     *  `identify('a') -> capture(1) -> reset() -> capture(2) -> identify('b') -> capture(3)`
     *
     * users a and b are not merged.
     * Capture 1 is associated with user a.
     * A new distinct id is generated for capture 2.
     * which is merged with user b.
     * So, capture 2 and 3 are associated with user b.
     *
     * If you want to merge two identified users, you can call posthog.alias
     *
     * @param {String} [new_distinct_id] A string that uniquely identifies a user. If not provided, the distinct_id currently in the persistent store (cookie or localStorage) will be used.
     * @param {Object} [userPropertiesToSet] Optional: An associative array of properties to store about the user
     * @param {Object} [userPropertiesToSetOnce] Optional: An associative array of properties to store about the user. If property is previously set, this does not override that value.
     */
    identify(new_distinct_id?: string, userPropertiesToSet?: Properties, userPropertiesToSetOnce?: Properties): void {
        if (!this.__loaded || !this.persistence) {
            return logger.uninitializedWarning('posthog.identify')
        }
        if (_isNumber(new_distinct_id)) {
            new_distinct_id = (new_distinct_id as number).toString()
            logger.warn(
                'The first argument to posthog.identify was a number, but it should be a string. It has been converted to a string.'
            )
        }

        //if the new_distinct_id has not been set ignore the identify event
        if (!new_distinct_id) {
            logger.error('Unique user id has not been set in posthog.identify')
            return
        }

        if (isDistinctIdStringLike(new_distinct_id)) {
            logger.critical(
                `The string "${new_distinct_id}" was set in posthog.identify which indicates an error. This ID should be unique to the user and not a hardcoded string.`
            )
            return
        }

        if (!this._requirePersonProcessing('posthog.identify')) {
            return
        }

        const previous_distinct_id = this.get_distinct_id()
        this.register({ $user_id: new_distinct_id })

        if (!this.get_property('$device_id')) {
            // The persisted distinct id might not actually be a device id at all
            // it might be a distinct id of the user from before
            const device_id = previous_distinct_id
            this.register_once(
                {
                    $had_persisted_distinct_id: true,
                    $device_id: device_id,
                },
                ''
            )
        }

        // if the previous distinct id had an alias stored, then we clear it
        if (new_distinct_id !== previous_distinct_id && new_distinct_id !== this.get_property(ALIAS_ID_KEY)) {
            this.unregister(ALIAS_ID_KEY)
            this.register({ distinct_id: new_distinct_id })
        }

        const isKnownAnonymous = this.persistence.get_user_state() === 'anonymous'

        // send an $identify event any time the distinct_id is changing and the old ID is an anonymous ID
        // - logic on the server will determine whether or not to do anything with it.
        if (new_distinct_id !== previous_distinct_id && isKnownAnonymous) {
            this.persistence.set_user_state('identified')

            // Update current user properties
            this.setPersonPropertiesForFlags(userPropertiesToSet || {}, false)

            this.capture(
                '$identify',
                {
                    distinct_id: new_distinct_id,
                    $anon_distinct_id: previous_distinct_id,
                },
                { $set: userPropertiesToSet || {}, $set_once: userPropertiesToSetOnce || {} }
            )
            // let the reload feature flag request know to send this previous distinct id
            // for flag consistency
            this.featureFlags.setAnonymousDistinctId(previous_distinct_id)
        } else if (userPropertiesToSet || userPropertiesToSetOnce) {
            // If the distinct_id is not changing, but we have user properties to set, we can go for a $set event
            this.setPersonProperties(userPropertiesToSet, userPropertiesToSetOnce)
        }

        // Reload active feature flags if the user identity changes.
        // Note we don't reload this on property changes as these get processed async
        if (new_distinct_id !== previous_distinct_id) {
            this.reloadFeatureFlags()
            // also clear any stored flag calls
            this.unregister(FLAG_CALL_REPORTED)
        }
    }

    /**
     * Sets properties for the Person associated with the current distinct_id. If person processing is not active for
     * this user (either due to have process_persons set to never, or set to identified_only and the user is anonymous),
     * then the properties will be set locally for flags but will not trigger a $set event
     *
     *
     * @param {Object} [userPropertiesToSet] Optional: An associative array of properties to store about the user
     * @param {Object} [userPropertiesToSetOnce] Optional: An associative array of properties to store about the user. If property is previously set, this does not override that value.
     */
    setPersonProperties(userPropertiesToSet?: Properties, userPropertiesToSetOnce?: Properties): void {
        if (!userPropertiesToSet && !userPropertiesToSetOnce) {
            return
        }

        if (!this._requirePersonProcessing('posthog.setPersonProperties')) {
            return
        }

        // Update current user properties
        this.setPersonPropertiesForFlags(userPropertiesToSet || {})

        this.capture('$set', { $set: userPropertiesToSet || {}, $set_once: userPropertiesToSetOnce || {} })
    }

    /**
     * Sets group analytics information for subsequent events and reloads feature flags.
     *
     * @param {String} groupType Group type (example: 'organization')
     * @param {String} groupKey Group key (example: 'org::5')
     * @param {Object} groupPropertiesToSet Optional properties to set for group
     */
    group(groupType: string, groupKey: string, groupPropertiesToSet?: Properties): void {
        if (!groupType || !groupKey) {
            logger.error('posthog.group requires a group type and group key')
            return
        }

        if (!this._requirePersonProcessing('posthog.group')) {
            return
        }

        const existingGroups = this.getGroups()

        // if group key changes, remove stored group properties
        if (existingGroups[groupType] !== groupKey) {
            this.resetGroupPropertiesForFlags(groupType)
        }

        this.register({ $groups: { ...existingGroups, [groupType]: groupKey } })

        if (groupPropertiesToSet) {
            this.capture('$groupidentify', {
                $group_type: groupType,
                $group_key: groupKey,
                $group_set: groupPropertiesToSet,
            })
            this.setGroupPropertiesForFlags({ [groupType]: groupPropertiesToSet })
        }

        // If groups change and no properties change, reload feature flags.
        // The property change reload case is handled in setGroupPropertiesForFlags.
        if (existingGroups[groupType] !== groupKey && !groupPropertiesToSet) {
            this.reloadFeatureFlags()
        }
    }

    /**
     * Resets only the group properties of the user currently logged in.
     */
    resetGroups(): void {
        this.register({ $groups: {} })
        this.resetGroupPropertiesForFlags()

        // If groups changed, reload feature flags.
        this.reloadFeatureFlags()
    }

    /**
     * Set override person properties for feature flags.
     * This is used when dealing with new persons / where you don't want to wait for ingestion
     * to update user properties.
     */
    setPersonPropertiesForFlags(properties: Properties, reloadFeatureFlags = true): void {
        if (!this._requirePersonProcessing('posthog.setPersonPropertiesForFlags')) {
            return
        }
        this.featureFlags.setPersonPropertiesForFlags(properties, reloadFeatureFlags)
    }

    resetPersonPropertiesForFlags(): void {
        this.featureFlags.resetPersonPropertiesForFlags()
    }

    /**
     * Set override group properties for feature flags.
     * This is used when dealing with new groups / where you don't want to wait for ingestion
     * to update properties.
     * Takes in an object, the key of which is the group type.
     * For example:
     *     setGroupPropertiesForFlags({'organization': { name: 'CYZ', employees: '11' } })
     */
    setGroupPropertiesForFlags(properties: { [type: string]: Properties }, reloadFeatureFlags = true): void {
        if (!this._requirePersonProcessing('posthog.setGroupPropertiesForFlags')) {
            return
        }
        this.featureFlags.setGroupPropertiesForFlags(properties, reloadFeatureFlags)
    }

    resetGroupPropertiesForFlags(group_type?: string): void {
        this.featureFlags.resetGroupPropertiesForFlags(group_type)
    }

    /**
     * Clears super properties and generates a new random distinct_id for this instance.
     * Useful for clearing data when a user logs out.
     */
    reset(reset_device_id?: boolean): void {
        if (!this.__loaded) {
            return logger.uninitializedWarning('posthog.reset')
        }
        const device_id = this.get_property('$device_id')
        this.persistence?.clear()
        this.sessionPersistence?.clear()
        this.persistence?.set_user_state('anonymous')
        this.sessionManager?.resetSessionId()
        const uuid = this.config.get_device_id(uuidv7())
        this.register_once(
            {
                distinct_id: uuid,
                $device_id: reset_device_id ? uuid : device_id,
            },
            ''
        )
    }

    /**
     * Returns the current distinct id of the user. This is either the id automatically
     * generated by the library or the id that has been passed by a call to identify().
     *
     * ### Notes:
     *
     * get_distinct_id() can only be called after the PostHog library has finished loading.
     * init() has a loaded function available to handle this automatically. For example:
     *
     *     // set distinct_id after the posthog library has loaded
     *     posthog.init('YOUR PROJECT TOKEN', {
     *         loaded: function(posthog) {
     *             distinct_id = posthog.get_distinct_id();
     *         }
     *     });
     */
    get_distinct_id(): string {
        return this.get_property('distinct_id')
    }

    getGroups(): Record<string, any> {
        return this.get_property('$groups') || {}
    }

    /**
     * Returns the current session_id.
     *
     * NOTE: This should only be used for informative purposes.
     * Any actual internal use case for the session_id should be handled by the sessionManager.
     */

    get_session_id(): string {
        return this.sessionManager?.checkAndGetSessionAndWindowId(true).sessionId ?? ''
    }

    /**
     * Returns the Replay url for the current session.
     *
     * @param options Options for the url
     * @param options.withTimestamp Whether to include the timestamp in the url (defaults to false)
     * @param options.timestampLookBack How many seconds to look back for the timestamp (defaults to 10)
     */
    get_session_replay_url(options?: { withTimestamp?: boolean; timestampLookBack?: number }): string {
        if (!this.sessionManager) {
            return ''
        }
        const { sessionId, sessionStartTimestamp } = this.sessionManager.checkAndGetSessionAndWindowId(true)
        let url = this.requestRouter.endpointFor('ui', `/project/${this.config.token}/replay/${sessionId}`)
        if (options?.withTimestamp && sessionStartTimestamp) {
            const LOOK_BACK = options.timestampLookBack ?? 10
            if (!sessionStartTimestamp) {
                return url
            }
            const recordingStartTime = Math.max(
                Math.floor((new Date().getTime() - sessionStartTimestamp) / 1000) - LOOK_BACK,
                0
            )
            url += `?t=${recordingStartTime}`
        }

        return url
    }

    /**
     * Create an alias, which PostHog will use to link two distinct_ids going forward (not retroactively).
     * Multiple aliases can map to the same original ID, but not vice-versa. Aliases can also be chained - the
     * following is a valid scenario:
     *
     *     posthog.alias('new_id', 'existing_id');
     *     ...
     *     posthog.alias('newer_id', 'new_id');
     *
     * If the original ID is not passed in, we will use the current distinct_id - probably the auto-generated GUID.
     *
     * ### Notes:
     *
     * The best practice is to call alias() when a unique ID is first created for a user
     * (e.g., when a user first registers for an account and provides an email address).
     * alias() should never be called more than once for a given user, except to
     * chain a newer ID to a previously new ID, as described above.
     *
     * @param {String} alias A unique identifier that you want to use for this user in the future.
     * @param {String} [original] The current identifier being used for this user.
     */
    alias(alias: string, original?: string): CaptureResult | void | number {
        // If the $people_distinct_id key exists in persistence, there has been a previous
        // posthog.people.identify() call made for this user. It is VERY BAD to make an alias with
        // this ID, as it will duplicate users.
        if (alias === this.get_property(PEOPLE_DISTINCT_ID_KEY)) {
            logger.critical('Attempting to create alias for existing People user - aborting.')
            return -2
        }
        if (!this._requirePersonProcessing('posthog.alias')) {
            return
        }

        if (_isUndefined(original)) {
            original = this.get_distinct_id()
        }
        if (alias !== original) {
            this._register_single(ALIAS_ID_KEY, alias)
            return this.capture('$create_alias', { alias: alias, distinct_id: original })
        } else {
            logger.warn('alias matches current distinct_id - skipping api call.')
            this.identify(alias)
            return -1
        }
    }

    /**
     * Update the configuration of a posthog library instance.
     *
     * The default config is:
     *
     *     {
     *       // PostHog API host
     *       api_host: 'https://us.i.posthog.com',
     *     *
     *       // PostHog web app host, currently only used by the Sentry integration.
     *       // This will only be different from api_host when using a reverse-proxied API host – in that case
     *       // the original web app host needs to be passed here so that links to the web app are still convenient.
     *       ui_host: 'https://us.posthog.com',
     *
     *       // Automatically capture clicks, form submissions and change events
     *       autocapture: true
     *
     *       // Capture rage clicks
     *       rageclick: true
     *
     *       // transport for sending requests ('XHR' or 'sendBeacon')
     *       // NB: sendBeacon should only be used for scenarios such as
     *       // page unload where a "best-effort" attempt to send is
     *       // acceptable; the sendBeacon API does not support callbacks
     *       // or any way to know the result of the request. PostHog
     *       // capturing via sendBeacon will not support any event-
     *       // batching or retry mechanisms.
     *       api_transport: 'XHR'
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
     *       // opt out of user agent filtering such as googlebot or other bots
     *       opt_out_useragent_filter: false
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
     *       // deprecated, use property_denylist instead.
     *       // names of properties/superproperties which should never
     *       // be sent with capture() calls.
     *       property_blacklist: []
     *
     *       // names of properties/superproperties which should never
     *       // be sent with capture() calls.
     *       property_denylist: []
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
     *       response_headers: {}
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

    set_config(config: Partial<PostHogConfig>): void {
        const oldConfig = { ...this.config }
        if (_isObject(config)) {
            _extend(this.config, configRenames(config))

            this.persistence?.update_config(this.config, oldConfig)
            this.sessionPersistence =
                this.config.persistence === 'sessionStorage'
                    ? this.persistence
                    : new PostHogPersistence({ ...this.config, persistence: 'sessionStorage' })

            if (localStore.is_supported() && localStore.get('ph_debug') === 'true') {
                this.config.debug = true
            }
            if (this.config.debug) {
                Config.DEBUG = true
            }

            if (this.sessionRecording && !_isUndefined(config.disable_session_recording)) {
                const disable_session_recording_has_changed =
                    oldConfig.disable_session_recording !== config.disable_session_recording
                // if opting back in, this config might not have changed
                const try_enable_after_opt_in =
                    !userOptedOut(this) && !config.disable_session_recording && !this.sessionRecording.started

                if (disable_session_recording_has_changed || try_enable_after_opt_in) {
                    if (config.disable_session_recording) {
                        this.sessionRecording.stopRecording()
                    } else {
                        this.sessionRecording.startRecordingIfEnabled()
                    }
                }
            }
        }
    }

    /**
     * turns session recording on, and updates the config option
     * disable_session_recording to false
     * @param override.sampling - optional boolean to override the default sampling behavior - ensures the next session recording to start will not be skipped by sampling config.
     */
    startSessionRecording(override?: { sampling?: boolean }): void {
        if (override?.sampling) {
            // allow the session id check to rotate session id if necessary
            const ids = this.sessionManager?.checkAndGetSessionAndWindowId()
            this.persistence?.register({
                // short-circuits the `makeSamplingDecision` function in the session recording module
                [SESSION_RECORDING_IS_SAMPLED]: true,
            })
            logger.info('Session recording started with sampling override for session: ', ids?.sessionId)
        }
        this.set_config({ disable_session_recording: false })
    }

    /**
     * turns session recording off, and updates the config option
     * disable_session_recording to true
     */
    stopSessionRecording(): void {
        this.set_config({ disable_session_recording: true })
    }

    /**
     * returns a boolean indicating whether session recording
     * is currently running
     */
    sessionRecordingStarted(): boolean {
        return !!this.sessionRecording?.started
    }

    /**
     * returns a boolean indicating whether the toolbar loaded
     * @param toolbarParams
     */

    loadToolbar(params: ToolbarParams): boolean {
        return this.toolbar.loadToolbar(params)
    }

    /**
     * Returns the value of the super property named property_name. If no such
     * property is set, get_property() will return the undefined value.
     *
     * ### Notes:
     *
     * get_property() can only be called after the PostHog library has finished loading.
     * init() has a loaded function available to handle this automatically. For example:
     *
     *     // grab value for '$user_id' after the posthog library has loaded
     *     posthog.init('YOUR PROJECT TOKEN', {
     *         loaded: function(posthog) {
     *             user_id = posthog.get_property('$user_id');
     *         }
     *     });
     *
     * @param {String} property_name The name of the super property you want to retrieve
     */
    get_property(property_name: string): Property | undefined {
        return this.persistence?.props[property_name]
    }

    /**
     * Returns the value of the session super property named property_name. If no such
     * property is set, getSessionProperty() will return the undefined value.
     *
     * ### Notes:
     *
     * This is based on browser-level `sessionStorage`, NOT the PostHog session.
     * getSessionProperty() can only be called after the PostHog library has finished loading.
     * init() has a loaded function available to handle this automatically. For example:
     *
     *     // grab value for 'user_id' after the posthog library has loaded
     *     posthog.init('YOUR PROJECT TOKEN', {
     *         loaded: function(posthog) {
     *             user_id = posthog.getSessionProperty('user_id');
     *         }
     *     });
     *
     * @param {String} property_name The name of the session super property you want to retrieve
     */
    getSessionProperty(property_name: string): Property | undefined {
        return this.sessionPersistence?.props[property_name]
    }

    toString(): string {
        let name = this.config.name ?? PRIMARY_INSTANCE_NAME
        if (name !== PRIMARY_INSTANCE_NAME) {
            name = PRIMARY_INSTANCE_NAME + '.' + name
        }
        return name
    }

    _isIdentified(): boolean {
        return (
            this.persistence?.get_user_state() === 'identified' ||
            this.sessionPersistence?.get_user_state() === 'identified'
        )
    }

    _hasPersonProcessing(): boolean {
        return !(
            this.config.person_profiles === 'never' ||
            (this.config.person_profiles === 'identified_only' &&
                !this._isIdentified() &&
                _isEmptyObject(this.getGroups()) &&
                !this.persistence?.props?.[ALIAS_ID_KEY] &&
                !this.persistence?.props?.[ENABLE_PERSON_PROCESSING])
        )
    }

    /**
     * Enables person processing if possible, returns true if it does so or already enabled, false otherwise
     *
     * @param function_name
     */
    _requirePersonProcessing(function_name: string): boolean {
        if (this.config.person_profiles === 'never') {
            logger.error(
                function_name + ' was called, but process_person is set to "never". This call will be ignored.'
            )
            return false
        }
        this._register_single(ENABLE_PERSON_PROCESSING, true)
        return true
    }

    // perform some housekeeping around GDPR opt-in/out state
    _gdpr_init(): void {
        const is_localStorage_requested = this.config.opt_out_capturing_persistence_type === 'localStorage'

        // try to convert opt-in/out cookies to localStorage if possible
        if (is_localStorage_requested && localStore.is_supported()) {
            if (!this.has_opted_in_capturing() && this.has_opted_in_capturing({ persistence_type: 'cookie' })) {
                this.opt_in_capturing({ enable_persistence: false })
            }
            if (!this.has_opted_out_capturing() && this.has_opted_out_capturing({ persistence_type: 'cookie' })) {
                this.opt_out_capturing({ clear_persistence: false })
            }
            this.clear_opt_in_out_capturing({
                persistence_type: 'cookie',
                enable_persistence: false,
            })
        }

        // check whether the user has already opted out - if so, clear & disable persistence
        if (this.has_opted_out_capturing()) {
            this._gdpr_update_persistence({ clear_persistence: true })

            // check whether we should opt out by default
            // note: we don't clear persistence here by default since opt-out default state is often
            //       used as an initial state while GDPR information is being collected
        } else if (
            !this.has_opted_in_capturing() &&
            (this.config.opt_out_capturing_by_default || cookieStore.get('ph_optout'))
        ) {
            cookieStore.remove('ph_optout')
            this.opt_out_capturing({
                clear_persistence: this.config.opt_out_persistence_by_default,
            })
        }
    }

    /**
     * Enable or disable persistence based on options
     * only enable/disable if persistence is not already in this state
     * @param {boolean} [options.clear_persistence] If true, will delete all data stored by the sdk in persistence and disable it
     * @param {boolean} [options.enable_persistence] If true, will re-enable sdk persistence
     */
    _gdpr_update_persistence(options: Partial<OptInOutCapturingOptions>): void {
        let disabled
        if (options && options['clear_persistence']) {
            disabled = true
        } else if (options && options['enable_persistence']) {
            disabled = false
        } else {
            return
        }

        if (!this.config.disable_persistence && this.persistence?.disabled !== disabled) {
            this.persistence?.set_disabled(disabled)
        }
        if (!this.config.disable_persistence && this.sessionPersistence?.disabled !== disabled) {
            this.sessionPersistence?.set_disabled(disabled)
        }
    }

    // call a base gdpr function after constructing the appropriate token and options args
    _gdpr_call_func<R = any>(
        func: (token: string, options: GDPROptions) => R,
        options?: Partial<OptInOutCapturingOptions>
    ): R {
        options = _extend(
            {
                capture: this.capture.bind(this),
                persistence_type: this.config.opt_out_capturing_persistence_type,
                cookie_prefix: this.config.opt_out_capturing_cookie_prefix,
                cookie_expiration: this.config.cookie_expiration,
                cross_subdomain_cookie: this.config.cross_subdomain_cookie,
                secure_cookie: this.config.secure_cookie,
            },
            options || {}
        )

        // check if localStorage can be used for recording opt out status, fall back to cookie if not
        if (!localStore.is_supported() && options['persistence_type'] === 'localStorage') {
            options['persistence_type'] = 'cookie'
        }

        return func(this.config.token, {
            capture: options['capture'],
            captureEventName: options['capture_event_name'],
            captureProperties: options['capture_properties'],
            persistenceType: options['persistence_type'],
            persistencePrefix: options['cookie_prefix'],
            cookieExpiration: options['cookie_expiration'],
            crossSubdomainCookie: options['cross_subdomain_cookie'],
            secureCookie: options['secure_cookie'],
        })
    }

    /**
     * Opt the user in to data capturing and cookies/localstorage for this PostHog instance
     *
     * ### Usage
     *
     *     // opt user in
     *     posthog.opt_in_capturing();
     *
     *     // opt user in with specific event name, properties, cookie configuration
     *     posthog.opt_in_capturing({
     *         capture_event_name: 'User opted in',
     *         capture_event_properties: {
     *             'Email': 'jdoe@example.com'
     *         },
     *         cookie_expiration: 30,
     *         secure_cookie: true
     *     });
     *
     * @param {Object} [options] A dictionary of config options to override
     * @param {function} [options.capture] Function used for capturing a PostHog event to record the opt-in action (default is this PostHog instance's capture method)
     * @param {string} [options.capture_event_name=$opt_in] Event name to be used for capturing the opt-in action
     * @param {Object} [options.capture_properties] Set of properties to be captured along with the opt-in action
     * @param {boolean} [options.enable_persistence=true] If true, will re-enable sdk persistence
     * @param {string} [options.persistence_type=localStorage] Persistence mechanism used - cookie or localStorage - falls back to cookie if localStorage is unavailable
     * @param {string} [options.cookie_prefix=__ph_opt_in_out] Custom prefix to be used in the cookie/localstorage name
     * @param {Number} [options.cookie_expiration] Number of days until the opt-in cookie expires (overrides value specified in this PostHog instance's config)
     * @param {boolean} [options.cross_subdomain_cookie] Whether the opt-in cookie is set as cross-subdomain or not (overrides value specified in this PostHog instance's config)
     * @param {boolean} [options.secure_cookie] Whether the opt-in cookie is set as secure or not (overrides value specified in this PostHog instance's config)
     */
    opt_in_capturing(options?: Partial<OptInOutCapturingOptions>): void {
        options = _extend(
            {
                enable_persistence: true,
            },
            options || {}
        )

        this._gdpr_call_func(optIn, options)
        this._gdpr_update_persistence(options)
    }

    /**
     * Opt the user out of data capturing and cookies/localstorage for this PostHog instance
     *
     * ### Usage
     *
     *     // opt user out
     *     posthog.opt_out_capturing();
     *
     *     // opt user out with different cookie configuration from PostHog instance
     *     posthog.opt_out_capturing({
     *         cookie_expiration: 30,
     *         secure_cookie: true
     *     });
     *
     * @param {Object} [options] A dictionary of config options to override
     * @param {boolean} [options.clear_persistence=true] If true, will delete all data stored by the sdk in persistence
     * @param {string} [options.persistence_type=localStorage] Persistence mechanism used - cookie or localStorage - falls back to cookie if localStorage is unavailable
     * @param {string} [options.cookie_prefix=__ph_opt_in_out] Custom prefix to be used in the cookie/localstorage name
     * @param {Number} [options.cookie_expiration] Number of days until the opt-in cookie expires (overrides value specified in this PostHog instance's config)
     * @param {boolean} [options.cross_subdomain_cookie] Whether the opt-in cookie is set as cross-subdomain or not (overrides value specified in this PostHog instance's config)
     * @param {boolean} [options.secure_cookie] Whether the opt-in cookie is set as secure or not (overrides value specified in this PostHog instance's config)
     */
    opt_out_capturing(options?: Partial<OptInOutCapturingOptions>): void {
        const _options = _extend(
            {
                clear_persistence: true,
            },
            options || {}
        )

        this._gdpr_call_func(optOut, _options)
        this._gdpr_update_persistence(_options)
    }

    /**
     * Check whether the user has opted in to data capturing and cookies/localstorage for this PostHog instance
     *
     * ### Usage
     *
     *     const has_opted_in = posthog.has_opted_in_capturing();
     *     // use has_opted_in value
     *
     * @param {Object} [options] A dictionary of config options to override
     * @param {string} [options.persistence_type=localStorage] Persistence mechanism used - cookie or localStorage - falls back to cookie if localStorage is unavailable
     * @param {string} [options.cookie_prefix=__ph_opt_in_out] Custom prefix to be used in the cookie/localstorage name
     * @returns {boolean} current opt-in status
     */
    has_opted_in_capturing(options?: Partial<OptInOutCapturingOptions>): boolean {
        return this._gdpr_call_func(hasOptedIn, options)
    }

    /**
     * Check whether the user has opted out of data capturing and cookies/localstorage for this PostHog instance
     *
     * ### Usage
     *
     *     const has_opted_out = posthog.has_opted_out_capturing();
     *     // use has_opted_out value
     *
     * @param {Object} [options] A dictionary of config options to override
     * @param {string} [options.persistence_type=localStorage] Persistence mechanism used - cookie or localStorage - falls back to cookie if localStorage is unavailable
     * @param {string} [options.cookie_prefix=__ph_opt_in_out] Custom prefix to be used in the cookie/localstorage name
     * @returns {boolean} current opt-out status
     */
    has_opted_out_capturing(options?: Partial<OptInOutCapturingOptions>): boolean {
        return this._gdpr_call_func(hasOptedOut, options)
    }

    /**
     * Clear the user's opt in/out status of data capturing and cookies/localstorage for this PostHog instance
     *
     * ### Usage
     *
     *     // clear user's opt-in/out status
     *     posthog.clear_opt_in_out_capturing();
     *
     *     // clear user's opt-in/out status with specific cookie configuration - should match
     *     // configuration used when opt_in_capturing/opt_out_capturing methods were called.
     *     posthog.clear_opt_in_out_capturing({
     *         cookie_expiration: 30,
     *         secure_cookie: true
     *     });
     *
     * @param {Object} [options] A dictionary of config options to override
     * @param {boolean} [options.enable_persistence=true] If true, will re-enable sdk persistence
     * @param {string} [options.persistence_type=localStorage] Persistence mechanism used - cookie or localStorage - falls back to cookie if localStorage is unavailable
     * @param {string} [options.cookie_prefix=__ph_opt_in_out] Custom prefix to be used in the cookie/localstorage name
     * @param {Number} [options.cookie_expiration] Number of days until the opt-in cookie expires (overrides value specified in this PostHog instance's config)
     * @param {boolean} [options.cross_subdomain_cookie] Whether the opt-in cookie is set as cross-subdomain or not (overrides value specified in this PostHog instance's config)
     * @param {boolean} [options.secure_cookie] Whether the opt-in cookie is set as secure or not (overrides value specified in this PostHog instance's config)
     */
    clear_opt_in_out_capturing(options?: Partial<OptInOutCapturingOptions>): void {
        const _options: Partial<OptInOutCapturingOptions> = _extend(
            {
                enable_persistence: true,
            },
            options ?? {}
        )
        this._gdpr_call_func(clearOptInOut, _options)
        this._gdpr_update_persistence(_options)
    }

    debug(debug?: boolean): void {
        if (debug === false) {
            window?.console.log("You've disabled debug mode.")
            localStorage && localStorage.removeItem('ph_debug')
            this.set_config({ debug: false })
        } else {
            window?.console.log(
                "You're now in debug mode. All calls to PostHog will be logged in your console.\nYou can disable this with `posthog.debug(false)`."
            )
            localStorage && localStorage.setItem('ph_debug', 'true')
            this.set_config({ debug: true })
        }
    }
}

_safewrap_class(PostHog, ['identify'])

const add_dom_loaded_handler = function () {
    // Cross browser DOM Loaded support
    function dom_loaded_handler() {
        // function flag since we only want to execute this once
        if ((dom_loaded_handler as any).done) {
            return
        }
        ;(dom_loaded_handler as any).done = true

        ENQUEUE_REQUESTS = false

        _each(instances, function (inst: PostHog) {
            inst._dom_loaded()
        })
    }

    if (document?.addEventListener) {
        if (document.readyState === 'complete') {
            // safari 4 can fire the DOMContentLoaded event before loading all
            // external JS (including this file). you will see some copypasta
            // on the internet that checks for 'complete' and 'loaded', but
            // 'loaded' is an IE thing
            dom_loaded_handler()
        } else {
            document.addEventListener('DOMContentLoaded', dom_loaded_handler, false)
        }
    }

    // fallback handler, always will work
    if (window) {
        _register_event(window, 'load', dom_loaded_handler, true)
    }
}

export function init_from_snippet(): void {
    const posthogMain = (instances[PRIMARY_INSTANCE_NAME] = new PostHog())

    const snippetPostHog = assignableWindow['posthog']

    if (snippetPostHog) {
        /**
         * The snippet uses some clever tricks to allow deferred loading of array.js (this code)
         *
         * window.posthog is an array which the queue of calls made before the lib is loaded
         * It has methods attached to it to simulate the posthog object so for instance
         *
         * window.posthog.init("TOKEN", {api_host: "foo" })
         * window.posthog.capture("my-event", {foo: "bar" })
         *
         * ... will mean that window.posthog will look like this:
         * window.posthog == [
         *  ["my-event", {foo: "bar"}]
         * ]
         *
         * window.posthog[_i] == [
         *   ["TOKEN", {api_host: "foo" }, "posthog"]
         * ]
         *
         * If a name is given to the init function then the same as above is true but as a sub-property on the object:
         *
         * window.posthog.init("TOKEN", {}, "ph2")
         * window.posthog.ph2.people.set({foo: "bar"})
         *
         * window.posthog.ph2 == []
         * window.posthog.people == [
         *  ["set", {foo: "bar"}]
         * ]
         *
         */

        // Call all pre-loaded init calls properly

        _each(snippetPostHog['_i'], function (item: [token: string, config: Partial<PostHogConfig>, name: string]) {
            if (item && _isArray(item)) {
                const instance = posthogMain.init(item[0], item[1], item[2])

                const instanceSnippet = snippetPostHog[item[2]] || snippetPostHog

                if (instance) {
                    // Crunch through the people queue first - we queue this data up &
                    // flush on identify, so it's better to do all these operations first
                    instance._execute_array.call(instance.people, instanceSnippet.people)
                    instance._execute_array(instanceSnippet)
                }
            }
        })
    }

    assignableWindow['posthog'] = posthogMain

    add_dom_loaded_handler()
}

export function init_as_module(): PostHog {
    const posthogMain = (instances[PRIMARY_INSTANCE_NAME] = new PostHog())

    add_dom_loaded_handler()

    return posthogMain
}
