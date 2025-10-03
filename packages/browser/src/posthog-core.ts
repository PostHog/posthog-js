import { Autocapture } from './autocapture'
import Config from './config'
import { ConsentManager, ConsentStatus } from './consent'
import {
    ALIAS_ID_KEY,
    COOKIELESS_MODE_FLAG_PROPERTY,
    COOKIELESS_SENTINEL_VALUE,
    ENABLE_PERSON_PROCESSING,
    FLAG_CALL_REPORTED,
    PEOPLE_DISTINCT_ID_KEY,
    SURVEYS_REQUEST_TIMEOUT_MS,
    USER_STATE,
} from './constants'
import { DeadClicksAutocapture, isDeadClicksEnabledForAutocapture } from './extensions/dead-clicks-autocapture'
import { ExceptionObserver } from './extensions/exception-autocapture'
import { HistoryAutocapture } from './extensions/history-autocapture'
import { SessionRecording } from './extensions/replay/sessionrecording'
import { setupSegmentIntegration } from './extensions/segment-integration'
import { SentryIntegration, sentryIntegration, SentryIntegrationOptions } from './extensions/sentry-integration'
import { Toolbar } from './extensions/toolbar'
import { TracingHeaders } from './extensions/tracing-headers'
import { WebVitalsAutocapture } from './extensions/web-vitals'
import { Heatmaps } from './heatmaps'
import { PageViewManager } from './page-view'
import { PostHogExceptions } from './posthog-exceptions'
import { PostHogFeatureFlags } from './posthog-featureflags'
import { PostHogPersistence } from './posthog-persistence'
import { PostHogSurveys } from './posthog-surveys'
import {
    DisplaySurveyOptions,
    SurveyCallback,
    SurveyEventName,
    SurveyEventProperties,
    SurveyRenderReason,
} from './posthog-surveys-types'
import { RateLimiter } from './rate-limiter'
import { RemoteConfigLoader } from './remote-config'
import { extendURLParams, request, SUPPORTS_REQUEST } from './request'
import { DEFAULT_FLUSH_INTERVAL_MS, RequestQueue } from './request-queue'
import { RetryQueue } from './retry-queue'
import { ScrollManager } from './scroll-manager'
import { SessionPropsManager } from './session-props'
import { SessionIdManager } from './sessionid'
import { SiteApps } from './site-apps'
import { localStore } from './storage'
import {
    CaptureOptions,
    CaptureResult,
    Compression,
    ConfigDefaults,
    EarlyAccessFeatureCallback,
    EarlyAccessFeatureStage,
    EventName,
    FeatureFlagsCallback,
    JsonType,
    PostHogConfig,
    Properties,
    Property,
    QueuedRequestWithOptions,
    RemoteConfig,
    RequestCallback,
    SessionIdChangedCallback,
    SnippetArrayItem,
    ToolbarParams,
} from './types'
import {
    _copyAndTruncateStrings,
    addEventListener,
    each,
    eachArray,
    extend,
    isCrossDomainCookie,
    migrateConfigField,
    safewrapClass,
} from './utils'
import { isLikelyBot } from './utils/blocked-uas'
import { getEventProperties } from './utils/event-utils'
import { assignableWindow, document, location, navigator, userAgent, window } from './utils/globals'
import { logger } from './utils/logger'
import { getPersonPropertiesHash } from './utils/property-utils'
import { RequestRouter, RequestRouterRegion } from './utils/request-router'
import { SimpleEventEmitter } from './utils/simple-event-emitter'
import {
    DEFAULT_DISPLAY_SURVEY_OPTIONS,
    getSurveyInteractionProperty,
    setSurveySeenOnLocalStorage,
} from './utils/survey-utils'
import {
    isEmptyString,
    isFunction,
    isKnownUnsafeEditableEvent,
    isNullish,
    isNumber,
    isString,
    isUndefined,
    includes,
    isDistinctIdStringLike,
    isArray,
    isEmptyObject,
    isObject,
} from '@posthog/core'
import { uuidv7 } from './uuidv7'
import { WebExperiments } from './web-experiments'
import { ExternalIntegrations } from './extensions/external-integration'
import { SessionRecordingWrapper } from './extensions/replay/sessionrecording-wrapper'

/*
SIMPLE STYLE GUIDE:

Use TypeScript accessibility modifiers, e.g. private/protected

If something is not part of the public interface:
* prefix it with _ to allow mangling
* prefix it with __ to disable mangling, but signal that it is internal

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

// NOTE: Remember to update `types.ts` when changing a default value
// to guarantee documentation is up to date, make sure to also update our website docs
// NOTE²: This shouldn't ever change because we try very hard to be backwards-compatible
export const defaultConfig = (defaults?: ConfigDefaults): PostHogConfig => ({
    api_host: 'https://us.i.posthog.com',
    ui_host: null,
    token: '',
    autocapture: true,
    rageclick: true,
    cross_subdomain_cookie: isCrossDomainCookie(document?.location),
    persistence: 'localStorage+cookie', // up to 1.92.0 this was 'cookie'. It's easy to migrate as 'localStorage+cookie' will migrate data from cookie storage
    persistence_name: '',
    loaded: __NOOP,
    save_campaign_params: true,
    custom_campaign_params: [],
    custom_blocked_useragents: [],
    save_referrer: true,
    capture_pageview: defaults === '2025-05-24' ? 'history_change' : true,
    capture_pageleave: 'if_capture_pageview', // We'll only capture pageleave events if capture_pageview is also true
    defaults: defaults ?? 'unset',
    debug: (location && isString(location?.search) && location.search.indexOf('__posthog_debug=true') !== -1) || false,
    cookie_expiration: 365,
    upgrade: false,
    disable_session_recording: false,
    disable_persistence: false,
    disable_web_experiments: true, // disabled in beta.
    disable_surveys: false,
    disable_surveys_automatic_display: false,
    disable_external_dependency_loading: false,
    enable_recording_console_log: undefined, // When undefined, it falls back to the server-side setting
    secure_cookie: window?.location?.protocol === 'https:',
    ip: false,
    opt_out_capturing_by_default: false,
    opt_out_persistence_by_default: false,
    opt_out_useragent_filter: false,
    opt_out_capturing_persistence_type: 'localStorage',
    consent_persistence_name: null,
    opt_out_capturing_cookie_prefix: null,
    opt_in_site_apps: false,
    property_denylist: [],
    respect_dnt: false,
    sanitize_properties: null,
    request_headers: {}, // { header: value, header2: value }
    request_batching: true,
    properties_string_max_length: 65535,
    session_recording: {},
    mask_all_element_attributes: false,
    mask_all_text: false,
    mask_personal_data_properties: false,
    custom_personal_data_properties: [],
    advanced_disable_flags: false,
    advanced_disable_decide: false,
    advanced_disable_feature_flags: false,
    advanced_disable_feature_flags_on_first_load: false,
    advanced_only_evaluate_survey_feature_flags: false,
    advanced_enable_surveys: false,
    advanced_disable_toolbar_metrics: false,
    feature_flag_request_timeout_ms: 3000,
    surveys_request_timeout_ms: SURVEYS_REQUEST_TIMEOUT_MS,
    on_request_error: (res) => {
        const error = 'Bad HTTP status: ' + res.statusCode + ' ' + res.text
        logger.error(error)
    },
    get_device_id: (uuid) => uuid,
    capture_performance: undefined,
    name: 'posthog',
    bootstrap: {},
    disable_compression: false,
    session_idle_timeout_seconds: 30 * 60, // 30 minutes
    person_profiles: 'identified_only',
    before_send: undefined,
    request_queue_config: { flush_interval_ms: DEFAULT_FLUSH_INTERVAL_MS },
    error_tracking: {},

    // Used for internal testing
    _onCapture: __NOOP,

    __preview_eager_load_replay: true,
})

export const configRenames = (origConfig: Partial<PostHogConfig>): Partial<PostHogConfig> => {
    const renames: Partial<PostHogConfig> = {}
    if (!isUndefined(origConfig.process_person)) {
        renames.person_profiles = origConfig.process_person
    }
    if (!isUndefined(origConfig.xhr_headers)) {
        renames.request_headers = origConfig.xhr_headers
    }
    if (!isUndefined(origConfig.cookie_name)) {
        renames.persistence_name = origConfig.cookie_name
    }
    if (!isUndefined(origConfig.disable_cookie)) {
        renames.disable_persistence = origConfig.disable_cookie
    }
    if (!isUndefined(origConfig.store_google)) {
        renames.save_campaign_params = origConfig.store_google
    }
    if (!isUndefined(origConfig.verbose)) {
        renames.debug = origConfig.verbose
    }
    // on_xhr_error is not present, as the type is different to on_request_error

    // the original config takes priority over the renames
    const newConfig = extend({}, renames, origConfig)

    // merge property_blacklist into property_denylist
    if (isArray(origConfig.property_blacklist)) {
        if (isUndefined(origConfig.property_denylist)) {
            newConfig.property_denylist = origConfig.property_blacklist
        } else if (isArray(origConfig.property_denylist)) {
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
 *
 * This is the SDK reference for the PostHog JavaScript Web SDK.
 * You can learn more about example usage in the
 * [JavaScript Web SDK documentation](/docs/libraries/js).
 * You can also follow [framework specific guides](/docs/frameworks)
 * to integrate PostHog into your project.
 *
 * This SDK is designed for browser environments.
 * Use the PostHog [Node.js SDK](/docs/libraries/node) for server-side usage.
 *
 * @constructor
 */
export class PostHog {
    __loaded: boolean
    config: PostHogConfig
    _originalUserConfig?: Partial<PostHogConfig>

    rateLimiter: RateLimiter
    scrollManager: ScrollManager
    pageViewManager: PageViewManager
    featureFlags: PostHogFeatureFlags
    surveys: PostHogSurveys
    experiments: WebExperiments
    toolbar: Toolbar
    exceptions: PostHogExceptions
    consent: ConsentManager

    // These are instance-specific state created after initialisation
    persistence?: PostHogPersistence
    sessionPersistence?: PostHogPersistence
    sessionManager?: SessionIdManager
    sessionPropsManager?: SessionPropsManager
    requestRouter: RequestRouter
    siteApps?: SiteApps
    autocapture?: Autocapture
    heatmaps?: Heatmaps
    webVitalsAutocapture?: WebVitalsAutocapture
    exceptionObserver?: ExceptionObserver
    deadClicksAutocapture?: DeadClicksAutocapture
    historyAutocapture?: HistoryAutocapture

    _requestQueue?: RequestQueue
    _retryQueue?: RetryQueue
    sessionRecording?: SessionRecording | SessionRecordingWrapper
    externalIntegrations?: ExternalIntegrations
    webPerformance = new DeprecatedWebPerformanceObserver()

    _initialPageviewCaptured: boolean
    _visibilityStateListener: (() => void) | null
    _personProcessingSetOncePropertiesSent: boolean = false
    _triggered_notifs: any
    compression?: Compression
    __request_queue: QueuedRequestWithOptions[]
    analyticsDefaultEndpoint: string
    version = Config.LIB_VERSION
    _initialPersonProfilesConfig: 'always' | 'never' | 'identified_only' | null
    _cachedPersonProperties: string | null

    SentryIntegration: typeof SentryIntegration
    sentryIntegration: (options?: SentryIntegrationOptions) => ReturnType<typeof sentryIntegration>

    private _internalEventEmitter = new SimpleEventEmitter()

    // Legacy property to support existing usage - this isn't technically correct but it's what it has always been - a proxy for flags being loaded
    /** @deprecated Use `flagsEndpointWasHit` instead.  We migrated to using a new feature flag endpoint and the new method is more semantically accurate */
    public get decideEndpointWasHit(): boolean {
        return this.featureFlags?.hasLoadedFlags ?? false
    }

    public get flagsEndpointWasHit(): boolean {
        return this.featureFlags?.hasLoadedFlags ?? false
    }

    /** DEPRECATED: We keep this to support existing usage but now one should just call .setPersonProperties */
    people: {
        set: (prop: string | Properties, to?: string, callback?: RequestCallback) => void
        set_once: (prop: string | Properties, to?: string, callback?: RequestCallback) => void
    }

    constructor() {
        this.config = defaultConfig()

        this.SentryIntegration = SentryIntegration
        this.sentryIntegration = (options?: SentryIntegrationOptions) => sentryIntegration(this, options)
        this.__request_queue = []
        this.__loaded = false
        this.analyticsDefaultEndpoint = '/e/'
        this._initialPageviewCaptured = false
        this._visibilityStateListener = null
        this._initialPersonProfilesConfig = null
        this._cachedPersonProperties = null
        this.featureFlags = new PostHogFeatureFlags(this)
        this.toolbar = new Toolbar(this)
        this.scrollManager = new ScrollManager(this)
        this.pageViewManager = new PageViewManager(this)
        this.surveys = new PostHogSurveys(this)
        this.experiments = new WebExperiments(this)
        this.exceptions = new PostHogExceptions(this)
        this.rateLimiter = new RateLimiter(this)
        this.requestRouter = new RequestRouter(this)
        this.consent = new ConsentManager(this)
        this.externalIntegrations = new ExternalIntegrations(this)
        // NOTE: See the property definition for deprecation notice
        this.people = {
            set: (prop: string | Properties, to?: string, callback?: RequestCallback) => {
                const setProps = isString(prop) ? { [prop]: to } : prop
                this.setPersonProperties(setProps)
                callback?.({} as any)
            },
            set_once: (prop: string | Properties, to?: string, callback?: RequestCallback) => {
                const setProps = isString(prop) ? { [prop]: to } : prop
                this.setPersonProperties(undefined, setProps)
                callback?.({} as any)
            },
        }

        this.on('eventCaptured', (data) => logger.info(`send "${data?.event}"`, data))
    }

    // Initialization methods

    /**
     * Initializes a new instance of the PostHog capturing object.
     *
     * @remarks
     * All new instances are added to the main posthog object as sub properties (such as
     * `posthog.library_name`) and also returned by this function. [Learn more about configuration options](https://github.com/posthog/posthog-js/blob/6e0e873/src/posthog-core.js#L57-L91)
     *
     * @example
     * ```js
     * // basic initialization
     * posthog.init('<ph_project_api_key>', {
     *     api_host: '<ph_client_api_host>'
     * })
     * ```
     *
     * @example
     * ```js
     * // multiple instances
     * posthog.init('<ph_project_api_key>', {}, 'project1')
     * posthog.init('<ph_project_api_key>', {}, 'project2')
     * ```
     *
     * @public
     *
     * @param token - Your PostHog API token
     * @param config - A dictionary of config options to override
     * @param name - The name for the new posthog instance that you want created
     *
     * {@label Initialization}
     *
     * @returns The newly initialized PostHog instance
     */
    init(
        token: string,
        config?: OnlyValidKeys<Partial<PostHogConfig>, Partial<PostHogConfig>>,
        name?: string
    ): PostHog {
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
        if (isUndefined(token) || isEmptyString(token)) {
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
        this._originalUserConfig = config // Store original user config for migration
        this._triggered_notifs = []

        if (config.person_profiles) {
            this._initialPersonProfilesConfig = config.person_profiles
        }

        this.set_config(
            extend({}, defaultConfig(config.defaults), configRenames(config), {
                name: name,
                token: token,
            })
        )

        if (this.config.on_xhr_error) {
            logger.error('on_xhr_error is deprecated. Use on_request_error instead')
        }

        this.compression = config.disable_compression ? undefined : Compression.GZipJS

        const persistenceDisabled = this._is_persistence_disabled()

        this.persistence = new PostHogPersistence(this.config, persistenceDisabled)
        this.sessionPersistence =
            this.config.persistence === 'sessionStorage' || this.config.persistence === 'memory'
                ? this.persistence
                : new PostHogPersistence({ ...this.config, persistence: 'sessionStorage' }, persistenceDisabled)

        // should I store the initial person profiles config in persistence?
        const initialPersistenceProps = { ...this.persistence.props }
        const initialSessionProps = { ...this.sessionPersistence.props }

        this.register({ $initialization_time: new Date().toISOString() })

        this._requestQueue = new RequestQueue(
            (req) => this._send_retriable_request(req),
            this.config.request_queue_config
        )
        this._retryQueue = new RetryQueue(this)
        this.__request_queue = []

        const startInCookielessMode =
            this.config.cookieless_mode === 'always' ||
            (this.config.cookieless_mode === 'on_reject' && this.consent.isExplicitlyOptedOut())

        if (!startInCookielessMode) {
            this.sessionManager = new SessionIdManager(this)
            this.sessionPropsManager = new SessionPropsManager(this, this.sessionManager, this.persistence)
        }

        new TracingHeaders(this).startIfEnabledOrStop()

        this.siteApps = new SiteApps(this)
        this.siteApps?.init()

        if (!startInCookielessMode) {
            if (this.config.__preview_eager_load_replay) {
                this.sessionRecording = new SessionRecording(this)
            } else {
                this.sessionRecording = new SessionRecordingWrapper(this)
            }
            this.sessionRecording.startIfEnabledOrStop()
        }

        if (!this.config.disable_scroll_properties) {
            this.scrollManager.startMeasuringScrollPosition()
        }

        this.autocapture = new Autocapture(this)
        this.autocapture.startIfEnabled()
        this.surveys.loadIfEnabled()

        this.heatmaps = new Heatmaps(this)
        this.heatmaps.startIfEnabled()

        this.webVitalsAutocapture = new WebVitalsAutocapture(this)

        this.exceptionObserver = new ExceptionObserver(this)
        this.exceptionObserver.startIfEnabled()

        this.deadClicksAutocapture = new DeadClicksAutocapture(this, isDeadClicksEnabledForAutocapture)
        this.deadClicksAutocapture.startIfEnabled()

        this.historyAutocapture = new HistoryAutocapture(this)
        this.historyAutocapture.startIfEnabled()

        // if any instance on the page has debug = true, we set the
        // global debug to be true
        Config.DEBUG = Config.DEBUG || this.config.debug
        if (Config.DEBUG) {
            logger.info('Starting in debug mode', {
                this: this,
                config,
                thisC: { ...this.config },
                p: initialPersistenceProps,
                s: initialSessionProps,
            })
        }

        // isUndefined doesn't provide typehint here so wouldn't reduce bundle as we'd need to assign
        // eslint-disable-next-line posthog-js/no-direct-undefined-check
        if (config.bootstrap?.distinctID !== undefined) {
            const uuid = this.config.get_device_id(uuidv7())
            const deviceID = config.bootstrap?.isIdentifiedID ? uuid : config.bootstrap.distinctID
            this.persistence.set_property(USER_STATE, config.bootstrap?.isIdentifiedID ? 'identified' : 'anonymous')
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

        if (startInCookielessMode) {
            this.register_once(
                {
                    distinct_id: COOKIELESS_SENTINEL_VALUE,
                    $device_id: null,
                },
                ''
            )
        } else if (!this.get_distinct_id()) {
            // There is no need to set the distinct id
            // or the device id if something was already stored
            // in the persistence
            const uuid = this.config.get_device_id(uuidv7())

            this.register_once(
                {
                    distinct_id: uuid,
                    $device_id: uuid,
                },
                ''
            )
            // distinct id == $device_id is a proxy for anonymous user
            this.persistence.set_property(USER_STATE, 'anonymous')
        }
        // Set up event handler for pageleave
        // Use `onpagehide` if available, see https://calendar.perfplanet.com/2020/beaconing-in-practice/#beaconing-reliability-avoiding-abandons
        //
        // Not making it passive to try and force the browser to handle this before the page is unloaded
        addEventListener(window, 'onpagehide' in self ? 'pagehide' : 'unload', this._handle_unload.bind(this), {
            passive: false,
        })

        this.toolbar.maybeLoadToolbar()

        // We want to avoid promises for IE11 compatibility, so we use callbacks here
        if (config.segment) {
            setupSegmentIntegration(this, () => this._loaded())
        } else {
            this._loaded()
        }

        if (isFunction(this.config._onCapture) && this.config._onCapture !== __NOOP) {
            logger.warn('onCapture is deprecated. Please use `before_send` instead')
            this.on('eventCaptured', (data) => this.config._onCapture(data.event, data))
        }

        if (this.config.ip) {
            logger.warn(
                'The `ip` config option has NO EFFECT AT ALL and has been deprecated. Use a custom transformation or "Discard IP data" project setting instead. See https://posthog.com/tutorials/web-redact-properties#hiding-customer-ip-address for more information.'
            )
        }

        return this
    }

    _onRemoteConfig(config: RemoteConfig) {
        if (!(document && document.body)) {
            logger.info('document not ready yet, trying again in 500 milliseconds...')
            setTimeout(() => {
                this._onRemoteConfig(config)
            }, 500)
            return
        }

        this.compression = undefined
        if (config.supportedCompression && !this.config.disable_compression) {
            this.compression = includes(config['supportedCompression'], Compression.GZipJS)
                ? Compression.GZipJS
                : includes(config['supportedCompression'], Compression.Base64)
                  ? Compression.Base64
                  : undefined
        }

        if (config.analytics?.endpoint) {
            this.analyticsDefaultEndpoint = config.analytics.endpoint
        }

        this.set_config({
            person_profiles: this._initialPersonProfilesConfig ? this._initialPersonProfilesConfig : 'identified_only',
        })

        this.siteApps?.onRemoteConfig(config)
        this.sessionRecording?.onRemoteConfig(config)
        this.autocapture?.onRemoteConfig(config)
        this.heatmaps?.onRemoteConfig(config)
        this.surveys.onRemoteConfig(config)
        this.webVitalsAutocapture?.onRemoteConfig(config)
        this.exceptionObserver?.onRemoteConfig(config)
        this.exceptions.onRemoteConfig(config)
        this.deadClicksAutocapture?.onRemoteConfig(config)
    }

    _loaded(): void {
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
                if (this.consent.isOptedIn() || this.config.cookieless_mode === 'always') {
                    this._captureInitialPageview()
                }
            }, 1)
        }

        new RemoteConfigLoader(this).load()
        this.featureFlags.flags()
    }

    _start_queue_if_opted_in(): void {
        if (this.is_capturing()) {
            if (this.config.request_batching) {
                this._requestQueue?.enable()
            }
        }
    }

    _dom_loaded(): void {
        if (this.is_capturing()) {
            eachArray(this.__request_queue, (item) => this._send_retriable_request(item))
        }

        this.__request_queue = []
        this._start_queue_if_opted_in()
    }

    _handle_unload(): void {
        if (!this.config.request_batching) {
            if (this._shouldCapturePageleave()) {
                this.capture('$pageleave', null, { transport: 'sendBeacon' })
            }
            return
        }

        if (this._shouldCapturePageleave()) {
            this.capture('$pageleave')
        }

        this._requestQueue?.unload()
        this._retryQueue?.unload()
    }

    _send_request(options: QueuedRequestWithOptions): void {
        if (!this.__loaded) {
            return
        }

        if (ENQUEUE_REQUESTS) {
            this.__request_queue.push(options)
            return
        }

        if (this.rateLimiter.isServerRateLimited(options.batchKey)) {
            return
        }

        options.transport = options.transport || this.config.api_transport
        options.url = extendURLParams(options.url, {
            // Whether to detect ip info or not
            ip: this.config.ip ? 1 : 0,
        })
        options.headers = {
            ...this.config.request_headers,
        }
        options.compression = options.compression === 'best-available' ? this.compression : options.compression
        options.disableXHRCredentials = this.config.__preview_disable_xhr_credentials
        if (this.config.__preview_disable_beacon) {
            options.disableTransport = ['sendBeacon']
        }

        // Specially useful if you're doing SSR with NextJS
        // Users must be careful when tweaking `cache` because they might get out-of-date feature flags
        options.fetchOptions = options.fetchOptions || this.config.fetch_options

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

    _send_retriable_request(options: QueuedRequestWithOptions): void {
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
        eachArray(array, (item) => {
            if (item) {
                fn_name = item[0]
                if (isArray(fn_name)) {
                    capturing_calls.push(item) // chained call e.g. posthog.get_group().set()
                } else if (isFunction(item)) {
                    ;(item as any).call(this)
                } else if (isArray(item) && fn_name === 'alias') {
                    alias_calls.push(item)
                } else if (isArray(item) && fn_name.indexOf('capture') !== -1 && isFunction((this as any)[fn_name])) {
                    capturing_calls.push(item)
                } else {
                    other_calls.push(item)
                }
            }
        })

        const execute = function (calls: SnippetArrayItem[], thisArg: any) {
            eachArray(
                calls,
                function (item) {
                    if (isArray(item[0])) {
                        // chained call
                        let caller = thisArg
                        each(item, function (call) {
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
     * @example
     * ```js
     * posthog.push(['register', { a: 'b' }]);
     * ```
     *
     * @param {Array} item A [function_name, args...] array to be executed
     */
    push(item: SnippetArrayItem): void {
        this._execute_array([item])
    }

    /**
     * Captures an event with optional properties and configuration.
     *
     * @remarks
     * You can capture arbitrary object-like values as events. [Learn about capture best practices](/docs/product-analytics/capture-events)
     *
     * @example
     * ```js
     * // basic event capture
     * posthog.capture('cta-button-clicked', {
     *     button_name: 'Get Started',
     *     page: 'homepage'
     * })
     * ```
     *
     * {@label Capture}
     *
     * @public
     *
     * @param event_name - The name of the event (e.g., 'Sign Up', 'Button Click', 'Purchase')
     * @param properties - Properties to include with the event describing the user or event details
     * @param options - Optional configuration for the capture request
     *
     * @returns The capture result containing event data, or undefined if capture failed
     */
    capture(
        event_name: EventName,
        properties?: Properties | null,
        options?: CaptureOptions
    ): CaptureResult | undefined {
        // While developing, a developer might purposefully _not_ call init(),
        // in this case, we would like capture to be a noop.
        if (!this.__loaded || !this.persistence || !this.sessionPersistence || !this._requestQueue) {
            logger.uninitializedWarning('posthog.capture')
            return
        }

        if (!this.is_capturing()) {
            return
        }

        // typing doesn't prevent interesting data
        if (isUndefined(event_name) || !isString(event_name)) {
            logger.error('No event name provided to posthog.capture')
            return
        }

        if (!this.config.opt_out_useragent_filter && this._is_bot()) {
            return
        }

        const clientRateLimitContext = !options?.skip_client_rate_limiting
            ? this.rateLimiter.clientRateLimitContext()
            : undefined

        if (clientRateLimitContext?.isRateLimited) {
            logger.critical('This capture call is ignored due to client rate limiting.')
            return
        }

        if (properties?.$current_url && !isString(properties?.$current_url)) {
            logger.error(
                'Invalid `$current_url` property provided to `posthog.capture`. Input must be a string. Ignoring provided value.'
            )
            delete properties?.$current_url
        }

        // update persistence
        this.sessionPersistence.update_search_keyword()

        // The initial campaign/referrer props need to be stored in the regular persistence, as they are there to mimic
        // the person-initial props. The non-initial versions are stored in the sessionPersistence, as they are sent
        // with every event and used by the session table to create session-initial props.
        if (this.config.save_campaign_params) {
            this.sessionPersistence.update_campaign_params()
        }
        if (this.config.save_referrer) {
            this.sessionPersistence.update_referrer_info()
        }

        if (this.config.save_campaign_params || this.config.save_referrer) {
            this.persistence.set_initial_person_info()
        }

        const systemTime = new Date()
        const timestamp = options?.timestamp || systemTime

        const uuid = uuidv7()
        let data: CaptureResult = {
            uuid,
            event: event_name,
            properties: this.calculateEventProperties(event_name, properties || {}, timestamp, uuid),
        }

        if (clientRateLimitContext) {
            data.properties['$lib_rate_limit_remaining_tokens'] = clientRateLimitContext.remainingTokens
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
        data.timestamp = timestamp
        if (!isUndefined(options?.timestamp)) {
            data.properties['$event_time_override_provided'] = true
            data.properties['$event_time_override_system_time'] = systemTime
        }

        if (event_name === SurveyEventName.DISMISSED || event_name === SurveyEventName.SENT) {
            const surveyId = properties?.[SurveyEventProperties.SURVEY_ID]
            const surveyIteration = properties?.[SurveyEventProperties.SURVEY_ITERATION]
            setSurveySeenOnLocalStorage({ id: surveyId, current_iteration: surveyIteration })
            data.$set = {
                ...data.$set,
                [getSurveyInteractionProperty(
                    { id: surveyId, current_iteration: surveyIteration },
                    event_name === SurveyEventName.SENT ? 'responded' : 'dismissed'
                )]: true,
            }
        }

        // Top-level $set overriding values from the one from properties is taken from the plugin-server normalizeEvent
        // This doesn't handle $set_once, because posthog-people doesn't either
        const finalSet = { ...data.properties['$set'], ...data['$set'] }
        if (!isEmptyObject(finalSet)) {
            this.setPersonPropertiesForFlags(finalSet)
        }

        if (!isNullish(this.config.before_send)) {
            const beforeSendResult = this._runBeforeSend(data)
            if (!beforeSendResult) {
                return
            } else {
                data = beforeSendResult
            }
        }

        this._internalEventEmitter.emit('eventCaptured', data)

        const requestOptions: QueuedRequestWithOptions = {
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

    _addCaptureHook(callback: (eventName: string, eventPayload?: CaptureResult) => void): () => void {
        return this.on('eventCaptured', (data) => callback(data.event, data))
    }

    /**
     * This method is used internally to calculate the event properties before sending it to PostHog. It can also be
     * used by integrations (e.g. Segment) to enrich events with PostHog properties before sending them to Segment,
     * which is required for some PostHog products to work correctly. (e.g. to have a correct $session_id property).
     *
     * @param {String} eventName The name of the event. This can be anything the user does - 'Button Click', 'Sign Up', '$pageview', etc.
     * @param {Object} eventProperties The properties to include with the event.
     * @param {Date} [timestamp] The timestamp of the event, e.g. for calculating time on page. If not set, it'll automatically be set to the current time.
     * @param {String} [uuid] The uuid of the event, e.g. for storing the $pageview ID.
     * @param {Boolean} [readOnly] Set this if you do not intend to actually send the event, and therefore do not want to update internal state e.g. session timeout
     *
     * @internal
     */
    public calculateEventProperties(
        eventName: string,
        eventProperties: Properties,
        timestamp?: Date,
        uuid?: string,
        readOnly?: boolean
    ): Properties {
        timestamp = timestamp || new Date()
        if (!this.persistence || !this.sessionPersistence) {
            return eventProperties
        }

        // set defaults
        const startTimestamp = readOnly ? undefined : this.persistence.remove_event_timer(eventName)
        let properties = { ...eventProperties }
        properties['token'] = this.config.token
        properties['$config_defaults'] = this.config.defaults

        if (
            this.config.cookieless_mode == 'always' ||
            (this.config.cookieless_mode == 'on_reject' && this.consent.isExplicitlyOptedOut())
        ) {
            // Set a flag to tell the plugin server to use cookieless server hash mode
            properties[COOKIELESS_MODE_FLAG_PROPERTY] = true
        }

        if (eventName === '$snapshot') {
            const persistenceProps = { ...this.persistence.properties(), ...this.sessionPersistence.properties() }
            properties['distinct_id'] = persistenceProps.distinct_id
            if (
                // we spotted one customer that was managing to send `false` for ~9k events a day
                !(isString(properties['distinct_id']) || isNumber(properties['distinct_id'])) ||
                isEmptyString(properties['distinct_id'])
            ) {
                logger.error('Invalid distinct_id for replay event. This indicates a bug in your implementation')
            }
            return properties
        }

        const infoProperties = getEventProperties(
            this.config.mask_personal_data_properties,
            this.config.custom_personal_data_properties
        )

        if (this.sessionManager) {
            const { sessionId, windowId } = this.sessionManager.checkAndGetSessionAndWindowId(
                readOnly,
                timestamp.getTime()
            )
            properties['$session_id'] = sessionId
            properties['$window_id'] = windowId
        }
        if (this.sessionPropsManager) {
            extend(properties, this.sessionPropsManager.getSessionProps())
        }

        try {
            if (this.sessionRecording) {
                extend(properties, this.sessionRecording.sdkDebugProperties)
            }
            properties['$sdk_debug_retry_queue_size'] = this._retryQueue?.length
        } catch (e: any) {
            properties['$sdk_debug_error_capturing_properties'] = String(e)
        }

        if (this.requestRouter.region === RequestRouterRegion.CUSTOM) {
            properties['$lib_custom_api_host'] = this.config.api_host
        }

        let pageviewProperties: Record<string, any>
        if (eventName === '$pageview' && !readOnly) {
            pageviewProperties = this.pageViewManager.doPageView(timestamp, uuid)
        } else if (eventName === '$pageleave' && !readOnly) {
            pageviewProperties = this.pageViewManager.doPageLeave(timestamp)
        } else {
            pageviewProperties = this.pageViewManager.doEvent()
        }
        properties = extend(properties, pageviewProperties)

        if (eventName === '$pageview' && document) {
            properties['title'] = document.title
        }

        // set $duration if time_event was previously called for this event
        if (!isUndefined(startTimestamp)) {
            const duration_in_ms = timestamp.getTime() - startTimestamp
            properties['$duration'] = parseFloat((duration_in_ms / 1000).toFixed(3))
        }

        // this is only added when this.config.opt_out_useragent_filter is true,
        // or it would always add "browser"
        if (userAgent && this.config.opt_out_useragent_filter) {
            properties['$browser_type'] = this._is_bot() ? 'bot' : 'browser'
        }

        // note: extend writes to the first object, so lets make sure we
        // don't write to the persistence properties object and info
        // properties object by passing in a new object

        // update properties with pageview info and super-properties
        properties = extend(
            {},
            infoProperties,
            this.persistence.properties(),
            this.sessionPersistence.properties(),
            properties
        )

        properties['$is_identified'] = this._isIdentified()

        if (isArray(this.config.property_denylist)) {
            each(this.config.property_denylist, function (denylisted_prop) {
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
            logger.error('sanitize_properties is deprecated. Use before_send instead')
            properties = sanitize_properties(properties, eventName)
        }

        // add person processing flag as very last step, so it cannot be overridden
        const hasPersonProcessing = this._hasPersonProcessing()
        properties['$process_person_profile'] = hasPersonProcessing
        // if the event has person processing, ensure that all future events will too, even if the setting changes
        if (hasPersonProcessing && !readOnly) {
            this._requirePersonProcessing('_calculate_event_properties')
        }

        return properties
    }

    /** @deprecated - deprecated in 1.241.0, use `calculateEventProperties` instead  */
    _calculate_event_properties = this.calculateEventProperties.bind(this)

    /**
     * Add additional set_once properties to the event when creating a person profile. This allows us to create the
     * profile with mostly-accurate properties, despite earlier events not setting them. We do this by storing them in
     * persistence.
     * @param dataSetOnce
     */
    _calculate_set_once_properties(dataSetOnce?: Properties): Properties | undefined {
        if (!this.persistence || !this._hasPersonProcessing()) {
            return dataSetOnce
        }

        if (this._personProcessingSetOncePropertiesSent) {
            // We only need to send these properties once. Sending them with later events would be redundant and would
            // just require extra work on the server to process them.
            return dataSetOnce
        }
        // if we're an identified person, send initial params with every event
        const initialProps = this.persistence.get_initial_props()
        const sessionProps = this.sessionPropsManager?.getSetOnceProps()
        let setOnceProperties = extend({}, initialProps, sessionProps || {}, dataSetOnce || {})
        const sanitize_properties = this.config.sanitize_properties
        if (sanitize_properties) {
            logger.error('sanitize_properties is deprecated. Use before_send instead')
            setOnceProperties = sanitize_properties(setOnceProperties, '$set_once')
        }
        this._personProcessingSetOncePropertiesSent = true
        if (isEmptyObject(setOnceProperties)) {
            return undefined
        }
        return setOnceProperties
    }

    /**
     * Registers super properties that are included with all events.
     *
     * @remarks
     * Super properties are stored in persistence and automatically added to every event you capture.
     * These values will overwrite any existing super properties with the same keys.
     *
     * @example
     * ```js
     * // register a single property
     * posthog.register({ plan: 'premium' })
     * ```
     *
     * {@label Capture}
     *
     * @example
     * ```js
     * // register multiple properties
     * posthog.register({
     *     email: 'user@example.com',
     *     account_type: 'business',
     *     signup_date: '2023-01-15'
     * })
     * ```
     *
     * @example
     * ```js
     * // register with custom expiration
     * posthog.register({ campaign: 'summer_sale' }, 7) // expires in 7 days
     * ```
     *
     * @public
     *
     * @param {Object} properties properties to store about the user
     * @param {Number} [days] How many days since the user's last visit to store the super properties
     */
    register(properties: Properties, days?: number): void {
        this.persistence?.register(properties, days)
    }

    /**
     * Registers super properties only if they haven't been set before.
     *
     * @remarks
     * Unlike `register()`, this method will not overwrite existing super properties.
     * Use this for properties that should only be set once, like signup date or initial referrer.
     *
     * {@label Capture}
     *
     * @example
     * ```js
     * // register once-only properties
     * posthog.register_once({
     *     first_login_date: new Date().toISOString(),
     *     initial_referrer: document.referrer
     * })
     * ```
     *
     * @example
     * ```js
     * // override existing value if it matches default
     * posthog.register_once(
     *     { user_type: 'premium' },
     *     'unknown'  // overwrite if current value is 'unknown'
     * )
     * ```
     *
     * @public
     *
     * @param {Object} properties An associative array of properties to store about the user
     * @param {*} [default_value] Value to override if already set in super properties (ex: 'False') Default: 'None'
     * @param {Number} [days] How many days since the users last visit to store the super properties
     */
    register_once(properties: Properties, default_value?: Property, days?: number): void {
        this.persistence?.register_once(properties, default_value, days)
    }

    /**
     * Registers super properties for the current session only.
     *
     * @remarks
     * Session super properties are automatically added to all events during the current browser session.
     * Unlike regular super properties, these are cleared when the session ends and are stored in sessionStorage.
     *
     * {@label Capture}
     *
     * @example
     * ```js
     * // register session-specific properties
     * posthog.register_for_session({
     *     current_page_type: 'checkout',
     *     ab_test_variant: 'control'
     * })
     * ```
     *
     * @example
     * ```js
     * // register properties for user flow tracking
     * posthog.register_for_session({
     *     selected_plan: 'pro',
     *     completed_steps: 3,
     *     flow_id: 'signup_flow_v2'
     * })
     * ```
     *
     * @public
     *
     * @param {Object} properties An associative array of properties to store about the user
     */
    register_for_session(properties: Properties): void {
        this.sessionPersistence?.register(properties)
    }

    /**
     * Removes a super property from persistent storage.
     *
     * @remarks
     * This will stop the property from being automatically included in future events.
     * The property will be permanently removed from the user's profile.
     *
     * {@label Capture}
     *
     * @example
     * ```js
     * // remove a super property
     * posthog.unregister('plan_type')
     * ```
     *
     * @public
     *
     * @param {String} property The name of the super property to remove
     */
    unregister(property: string): void {
        this.persistence?.unregister(property)
    }

    /**
     * Removes a session super property from the current session.
     *
     * @remarks
     * This will stop the property from being automatically included in future events for this session.
     * The property is removed from sessionStorage.
     *
     * {@label Capture}
     *
     * @example
     * ```js
     * // remove a session property
     * posthog.unregister_for_session('current_flow')
     * ```
     *
     * @public
     *
     * @param {String} property The name of the session super property to remove
     */
    unregister_for_session(property: string): void {
        this.sessionPersistence?.unregister(property)
    }

    _register_single(prop: string, value: Property) {
        this.register({ [prop]: value })
    }

    /**
     * Gets the value of a feature flag for the current user.
     *
     * @remarks
     * Returns the feature flag value which can be a boolean, string, or undefined.
     * Supports multivariate flags that can return custom string values.
     *
     * {@label Feature flags}
     *
     * @example
     * ```js
     * // check boolean flag
     * if (posthog.getFeatureFlag('new-feature')) {
     *     // show new feature
     * }
     * ```
     *
     * @example
     * ```js
     * // check multivariate flag
     * const variant = posthog.getFeatureFlag('button-color')
     * if (variant === 'red') {
     *     // show red button
     * }
     * ```
     *
     * @public
     *
     * @param {Object|String} prop Key of the feature flag.
     * @param {Object|String} options (optional) If {send_event: false}, we won't send an $feature_flag_call event to PostHog.
     */
    getFeatureFlag(key: string, options?: { send_event?: boolean }): boolean | string | undefined {
        return this.featureFlags.getFeatureFlag(key, options)
    }

    /**
     * Get feature flag payload value matching key for user (supports multivariate flags).
     *
     * {@label Feature flags}
     *
     * @example
     * ```js
     * if(posthog.getFeatureFlag('beta-feature') === 'some-value') {
     *      const someValue = posthog.getFeatureFlagPayload('beta-feature')
     *      // do something
     * }
     * ```
     *
     * @public
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

    /**
     * Checks if a feature flag is enabled for the current user.
     *
     * @remarks
     * Returns true if the flag is enabled, false if disabled, or undefined if not found.
     * This is a convenience method that treats any truthy value as enabled.
     *
     * {@label Feature flags}
     *
     * @example
     * ```js
     * // simple feature flag check
     * if (posthog.isFeatureEnabled('new-checkout')) {
     *     showNewCheckout()
     * }
     * ```
     *
     * @example
     * ```js
     * // disable event tracking
     * if (posthog.isFeatureEnabled('feature', { send_event: false })) {
     *     // flag checked without sending $feature_flag_call event
     * }
     * ```
     *
     * @public
     *
     * @param {Object|String} prop Key of the feature flag.
     * @param {Object|String} options (optional) If {send_event: false}, we won't send an $feature_flag_call event to PostHog.
     */
    isFeatureEnabled(key: string, options?: { send_event: boolean }): boolean | undefined {
        return this.featureFlags.isFeatureEnabled(key, options)
    }

    /**
     * Feature flag values are cached. If something has changed with your user and you'd like to refetch their flag values, call this method.
     *
     * {@label Feature flags}
     *
     * @example
     * ```js
     * posthog.reloadFeatureFlags()
     * ```
     *
     * @public
     */
    reloadFeatureFlags(): void {
        this.featureFlags.reloadFeatureFlags()
    }

    /**
     * Opt the user in or out of an early access feature. [Learn more in the docs](/docs/feature-flags/early-access-feature-management#option-2-custom-implementation)
     *
     * {@label Feature flags}
     *
     * @example
     * ```js
     * const toggleBeta = (betaKey) => {
     *   if (activeBetas.some(
     *     beta => beta.flagKey === betaKey
     *   )) {
     *     posthog.updateEarlyAccessFeatureEnrollment(
     *       betaKey,
     *       false
     *     )
     *     setActiveBetas(
     *       prevActiveBetas => prevActiveBetas.filter(
     *         item => item.flagKey !== betaKey
     *       )
     *     );
     *     return
     *   }
     *
     *   posthog.updateEarlyAccessFeatureEnrollment(
     *     betaKey,
     *     true
     *   )
     *   setInactiveBetas(
     *     prevInactiveBetas => prevInactiveBetas.filter(
     *       item => item.flagKey !== betaKey
     *     )
     *   );
     * }
     *
     * const registerInterest = (featureKey) => {
     *   posthog.updateEarlyAccessFeatureEnrollment(
     *     featureKey,
     *     true
     *   )
     *   // Update UI to show user has registered
     * }
     * ```
     *
     * @public
     *
     * @param {String} key The key of the feature flag to update.
     * @param {Boolean} isEnrolled Whether the user is enrolled in the feature.
     * @param {String} [stage] The stage of the feature flag to update.
     */
    updateEarlyAccessFeatureEnrollment(key: string, isEnrolled: boolean, stage?: string): void {
        this.featureFlags.updateEarlyAccessFeatureEnrollment(key, isEnrolled, stage)
    }

    /**
     * Get the list of early access features. To check enrollment status, use `isFeatureEnabled`. [Learn more in the docs](/docs/feature-flags/early-access-feature-management#option-2-custom-implementation)
     *
     * {@label Feature flags}
     *
     * @example
     * ```js
     * const posthog = usePostHog()
     * const activeFlags = useActiveFeatureFlags()
     *
     * const [activeBetas, setActiveBetas] = useState([])
     * const [inactiveBetas, setInactiveBetas] = useState([])
     * const [comingSoonFeatures, setComingSoonFeatures] = useState([])
     *
     * useEffect(() => {
     *   posthog.getEarlyAccessFeatures((features) => {
     *     // Filter features by stage
     *     const betaFeatures = features.filter(feature => feature.stage === 'beta')
     *     const conceptFeatures = features.filter(feature => feature.stage === 'concept')
     *
     *     setComingSoonFeatures(conceptFeatures)
     *
     *     if (!activeFlags || activeFlags.length === 0) {
     *       setInactiveBetas(betaFeatures)
     *       return
     *     }
     *
     *     const activeBetas = betaFeatures.filter(
     *             beta => activeFlags.includes(beta.flagKey)
     *         );
     *     const inactiveBetas = betaFeatures.filter(
     *             beta => !activeFlags.includes(beta.flagKey)
     *         );
     *     setActiveBetas(activeBetas)
     *     setInactiveBetas(inactiveBetas)
     *   }, true, ['concept', 'beta'])
     * }, [activeFlags])
     * ```
     *
     * @public
     *
     * @param {Function} callback The callback function will be called when the early access features are loaded.
     * @param {Boolean} [force_reload] Whether to force a reload of the early access features.
     * @param {String[]} [stages] The stages of the early access features to load.
     */
    getEarlyAccessFeatures(
        callback: EarlyAccessFeatureCallback,
        force_reload = false,
        stages?: EarlyAccessFeatureStage[]
    ): void {
        return this.featureFlags.getEarlyAccessFeatures(callback, force_reload, stages)
    }

    /**
     * Exposes a set of events that PostHog will emit.
     * e.g. `eventCaptured` is emitted immediately before trying to send an event
     *
     * Unlike  `onFeatureFlags` and `onSessionId` these are not called when the
     * listener is registered, the first callback will be the next event
     * _after_ registering a listener
     *
     * {@label Capture}
     *
     * @example
     * ```js
     * posthog.on('eventCaptured', (event) => {
     *   console.log(event)
     * })
     * ```
     *
     * @public
     *
     * @param {String} event The event to listen for.
     * @param {Function} cb The callback function to call when the event is emitted.
     * @returns {Function} A function that can be called to unsubscribe the listener.
     */
    on(event: 'eventCaptured', cb: (...args: any[]) => void): () => void {
        return this._internalEventEmitter.on(event, cb)
    }

    /**
     * Register an event listener that runs when feature flags become available or when they change.
     * If there are flags, the listener is called immediately in addition to being called on future changes.
     * Note that this is not called only when we fetch feature flags from the server, but also when they change in the browser.
     *
     * {@label Feature flags}
     *
     * @example
     * ```js
     * posthog.onFeatureFlags(function(featureFlags, featureFlagsVariants, { errorsLoading }) {
     *     // do something
     * })
     * ```
     *
     * @param callback - The callback function will be called once the feature flags are ready or when they are updated.
     *                   It'll return a list of feature flags enabled for the user, the variants,
     *                   and also a context object indicating whether we succeeded to fetch the flags or not.
     * @returns A function that can be called to unsubscribe the listener. Used by `useEffect` when the component unmounts.
     */
    onFeatureFlags(callback: FeatureFlagsCallback): () => void {
        return this.featureFlags.onFeatureFlags(callback)
    }

    /**
     * Register an event listener that runs when surveys are loaded.
     *
     * Callback parameters:
     * - surveys: Survey[]: An array containing all survey objects fetched from PostHog using the getSurveys method
     * - context: { isLoaded: boolean, error?: string }: An object indicating if the surveys were loaded successfully
     *
     * {@label Surveys}
     *
     * @example
     * ```js
     * posthog.onSurveysLoaded((surveys, context) => { // do something })
     * ```
     *
     *
     * @param {Function} callback The callback function will be called when surveys are loaded or updated.
     * @returns {Function} A function that can be called to unsubscribe the listener.
     */
    onSurveysLoaded(callback: SurveyCallback): () => void {
        return this.surveys.onSurveysLoaded(callback)
    }

    /**
     * Register an event listener that runs whenever the session id or window id change.
     * If there is already a session id, the listener is called immediately in addition to being called on future changes.
     *
     * Can be used, for example, to sync the PostHog session id with a backend session.
     *
     * {@label Identification}
     *
     * @example
     * ```js
     * posthog.onSessionId(function(sessionId, windowId) { // do something })
     * ```
     *
     * @param {Function} [callback] The callback function will be called once a session id is present or when it or the window id are updated.
     * @returns {Function} A function that can be called to unsubscribe the listener. E.g. Used by `useEffect` when the component unmounts.
     */
    onSessionId(callback: SessionIdChangedCallback): () => void {
        return this.sessionManager?.onSessionId(callback) ?? (() => {})
    }

    /**
     * Get list of all surveys.
     *
     * {@label Surveys}
     *
     * @example
     * ```js
     * function callback(surveys, context) {
     *   // do something
     * }
     *
     * posthog.getSurveys(callback, false)
     * ```
     *
     * @public
     *
     * @param {Function} [callback] Function that receives the array of surveys
     * @param {Boolean} [forceReload] Optional boolean to force an API call for updated surveys
     */
    getSurveys(callback: SurveyCallback, forceReload = false): void {
        this.surveys.getSurveys(callback, forceReload)
    }

    /**
     * Get surveys that should be enabled for the current user. See [fetching surveys documentation](/docs/surveys/implementing-custom-surveys#fetching-surveys-manually) for more details.
     *
     * {@label Surveys}
     *
     * @example
     * ```js
     * posthog.getActiveMatchingSurveys((surveys) => {
     *      // do something
     * })
     * ```
     *
     * @public
     *
     * @param {Function} [callback] The callback function will be called when the surveys are loaded or updated.
     * @param {Boolean} [forceReload] Whether to force a reload of the surveys.
     */
    getActiveMatchingSurveys(callback: SurveyCallback, forceReload = false): void {
        this.surveys.getActiveMatchingSurveys(callback, forceReload)
    }

    /**
     * Although we recommend using popover surveys and display conditions,
     * if you want to show surveys programmatically without setting up all
     * the extra logic needed for API surveys, you can render surveys
     * programmatically with the renderSurvey method.
     *
     * This takes a survey ID and an HTML selector to render an unstyled survey.
     *
     * {@label Surveys}
     *
     * @example
     * ```js
     * posthog.renderSurvey(coolSurveyID, '#survey-container')
     * ```
     *
     * @deprecated Use displaySurvey instead - it's more complete and also supports popover surveys.
     *
     * @public
     *
     * @param {String} surveyId The ID of the survey to render.
     * @param {String} selector The selector of the HTML element to render the survey on.
     */
    renderSurvey(surveyId: string, selector: string): void {
        this.surveys.renderSurvey(surveyId, selector)
    }

    /**
     * Display a survey programmatically as either a popover or inline element.
     *
     * @param {string} surveyId - The survey ID to display
     * @param {DisplaySurveyOptions} options - Display configuration
     *
     * @example
     * ```js
     * // Display as popover (respects all conditions defined in the dashboard)
     * posthog.displaySurvey('survey-id-123')
     * ```
     *
     * @example
     * ```js
     * // Display inline in a specific element
     * posthog.displaySurvey('survey-id-123', {
     *   displayType: DisplaySurveyType.Inline,
     *   selector: '#survey-container'
     * })
     * ```
     *
     * @example
     * ```js
     * // Force display ignoring conditions and delays
     * posthog.displaySurvey('survey-id-123', {
     *   displayType: DisplaySurveyType.Popover,
     *   ignoreConditions: true,
     *   ignoreDelay: true
     * })
     * ```
     *
     * {@label Surveys}
     */
    displaySurvey(surveyId: string, options: DisplaySurveyOptions = DEFAULT_DISPLAY_SURVEY_OPTIONS): void {
        this.surveys.displaySurvey(surveyId, options)
    }

    /**
     * Checks the feature flags associated with this Survey to see if the survey can be rendered.
     * This method is deprecated because it's synchronous and won't return the correct result if surveys are not loaded.
     * Use `canRenderSurveyAsync` instead.
     *
     * {@label Surveys}
     *
     *
     * @deprecated
     *
     * @param surveyId The ID of the survey to check.
     * @returns A SurveyRenderReason object indicating if the survey can be rendered.
     */
    canRenderSurvey(surveyId: string): SurveyRenderReason | null {
        return this.surveys.canRenderSurvey(surveyId)
    }

    /**
     * Checks the feature flags associated with this Survey to see if the survey can be rendered.
     *
     * {@label Surveys}
     *
     * @example
     * ```js
     * posthog.canRenderSurveyAsync(surveyId).then((result) => {
     *     if (result.visible) {
     *         // Survey can be rendered
     *         console.log('Survey can be rendered')
     *     } else {
     *         // Survey cannot be rendered
     *         console.log('Survey cannot be rendered:', result.disabledReason)
     *     }
     * })
     * ```
     *
     * @public
     *
     * @param surveyId The ID of the survey to check.
     * @param forceReload If true, the survey will be reloaded from the server, Default: false
     * @returns A SurveyRenderReason object indicating if the survey can be rendered.
     */
    canRenderSurveyAsync(surveyId: string, forceReload = false): Promise<SurveyRenderReason> {
        return this.surveys.canRenderSurveyAsync(surveyId, forceReload)
    }

    /**
     * Associates a user with a unique identifier instead of an auto-generated ID.
     * Learn more about [identifying users](/docs/product-analytics/identify)
     *
     * {@label Identification}
     *
     * @remarks
     * By default, PostHog assigns each user a randomly generated `distinct_id`. Use this method to
     * replace that ID with your own unique identifier (like a user ID from your database).
     *
     * @example
     * ```js
     * // basic identification
     * posthog.identify('user_12345')
     * ```
     *
     * @example
     * ```js
     * // identify with user properties
     * posthog.identify('user_12345', {
     *     email: 'user@example.com',
     *     plan: 'premium'
     * })
     * ```
     *
     * @example
     * ```js
     * // identify with set and set_once properties
     * posthog.identify('user_12345',
     *     { last_login: new Date() },  // updates every time
     *     { signup_date: new Date() }  // sets only once
     * )
     * ```
     *
     * @public
     *
     * @param {String} [new_distinct_id] A string that uniquely identifies a user. If not provided, the distinct_id currently in the persistent store (cookie or localStorage) will be used.
     * @param {Object} [userPropertiesToSet] Optional: An associative array of properties to store about the user. Note: For feature flag evaluations, if the same key is present in the userPropertiesToSetOnce,
     *  it will be overwritten by the value in userPropertiesToSet.
     * @param {Object} [userPropertiesToSetOnce] Optional: An associative array of properties to store about the user. If property is previously set, this does not override that value.
     */
    identify(new_distinct_id?: string, userPropertiesToSet?: Properties, userPropertiesToSetOnce?: Properties): void {
        if (!this.__loaded || !this.persistence) {
            return logger.uninitializedWarning('posthog.identify')
        }
        if (isNumber(new_distinct_id)) {
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
        if (new_distinct_id === COOKIELESS_SENTINEL_VALUE) {
            logger.critical(
                `The string "${COOKIELESS_SENTINEL_VALUE}" was set in posthog.identify which indicates an error. This ID is only used as a sentinel value.`
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

        const isKnownAnonymous = (this.persistence.get_property(USER_STATE) || 'anonymous') === 'anonymous'

        // send an $identify event any time the distinct_id is changing and the old ID is an anonymous ID
        // - logic on the server will determine whether or not to do anything with it.
        if (new_distinct_id !== previous_distinct_id && isKnownAnonymous) {
            this.persistence.set_property(USER_STATE, 'identified')

            // Update current user properties
            this.setPersonPropertiesForFlags(
                { ...(userPropertiesToSetOnce || {}), ...(userPropertiesToSet || {}) },
                false
            )

            this.capture(
                '$identify',
                {
                    distinct_id: new_distinct_id,
                    $anon_distinct_id: previous_distinct_id,
                },
                { $set: userPropertiesToSet || {}, $set_once: userPropertiesToSetOnce || {} }
            )

            this._cachedPersonProperties = getPersonPropertiesHash(
                new_distinct_id,
                userPropertiesToSet,
                userPropertiesToSetOnce
            )

            // let the reload feature flag request know to send this previous distinct id
            // for flag consistency
            this.featureFlags.setAnonymousDistinctId(previous_distinct_id)
        } else if (userPropertiesToSet || userPropertiesToSetOnce) {
            // If the distinct_id is not changing, but we have user properties to set, we can check if they have changed
            // and if so, send a $set event

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
     * Sets properties on the person profile associated with the current `distinct_id`.
     * Learn more about [identifying users](/docs/product-analytics/identify)
     *
     * {@label Identification}
     *
     * @remarks
     * Updates user properties that are stored with the person profile in PostHog.
     * If `person_profiles` is set to `identified_only` and no profile exists, this will create one.
     *
     * @example
     * ```js
     * // set user properties
     * posthog.setPersonProperties({
     *     email: 'user@example.com',
     *     plan: 'premium'
     * })
     * ```
     *
     * @example
     * ```js
     * // set properties
     * posthog.setPersonProperties(
     *     { name: 'Max Hedgehog' },  // $set properties
     *     { initial_url: '/blog' }   // $set_once properties
     * )
     * ```
     *
     * @public
     *
     * @param {Object} [userPropertiesToSet] Optional: An associative array of properties to store about the user. Note: For feature flag evaluations, if the same key is present in the userPropertiesToSetOnce,
     *  it will be overwritten by the value in userPropertiesToSet.
     * @param {Object} [userPropertiesToSetOnce] Optional: An associative array of properties to store about the user. If property is previously set, this does not override that value.
     */
    setPersonProperties(userPropertiesToSet?: Properties, userPropertiesToSetOnce?: Properties): void {
        if (!userPropertiesToSet && !userPropertiesToSetOnce) {
            return
        }

        if (!this._requirePersonProcessing('posthog.setPersonProperties')) {
            return
        }

        const hash = getPersonPropertiesHash(this.get_distinct_id(), userPropertiesToSet, userPropertiesToSetOnce)

        // if exactly this $set call has been sent before, don't send it again - determine based on hash of properties
        if (this._cachedPersonProperties === hash) {
            logger.info('A duplicate setPersonProperties call was made with the same properties. It has been ignored.')
            return
        }

        // Update current user properties
        this.setPersonPropertiesForFlags({ ...(userPropertiesToSetOnce || {}), ...(userPropertiesToSet || {}) })

        this.capture('$set', { $set: userPropertiesToSet || {}, $set_once: userPropertiesToSetOnce || {} })

        this._cachedPersonProperties = hash
    }

    /**
     * Associates the user with a group for group-based analytics.
     * Learn more about [groups](/docs/product-analytics/group-analytics)
     *
     * {@label Identification}
     *
     * @remarks
     * Groups allow you to analyze users collectively (e.g., by organization, team, or account).
     * This sets the group association for all subsequent events and reloads feature flags.
     *
     * @example
     * ```js
     * // associate user with an organization
     * posthog.group('organization', 'org_12345', {
     *     name: 'Acme Corp',
     *     plan: 'enterprise'
     * })
     * ```
     *
     * @example
     * ```js
     * // associate with multiple group types
     * posthog.group('organization', 'org_12345')
     * posthog.group('team', 'team_67890')
     * ```
     *
     * @public
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
     * Learn more about [groups](/docs/product-analytics/group-analytics)
     *
     * {@label Identification}
     *
     * @example
     * ```js
     * posthog.resetGroups()
     * ```
     *
     * @public
     */
    resetGroups(): void {
        this.register({ $groups: {} })
        this.resetGroupPropertiesForFlags()

        // If groups changed, reload feature flags.
        this.reloadFeatureFlags()
    }

    /**
     * Sometimes, you might want to evaluate feature flags using properties that haven't been ingested yet,
     * or were set incorrectly earlier. You can do so by setting properties the flag depends on with these calls:
     *
     * {@label Feature flags}
     *
     * @example
     * ```js
     * // Set properties
     * posthog.setPersonPropertiesForFlags({'property1': 'value', property2: 'value2'})
     * ```
     *
     * @example
     * ```js
     * // Set properties without reloading
     * posthog.setPersonPropertiesForFlags({'property1': 'value', property2: 'value2'}, false)
     * ```
     *
     * @public
     *
     * @param {Object} properties The properties to override.
     * @param {Boolean} [reloadFeatureFlags] Whether to reload feature flags.
     */
    setPersonPropertiesForFlags(properties: Properties, reloadFeatureFlags = true): void {
        this.featureFlags.setPersonPropertiesForFlags(properties, reloadFeatureFlags)
    }

    /**
     * Resets the person properties for feature flags.
     *
     * {@label Feature flags}
     *
     * @public
     *
     * @example
     * ```js
     * posthog.resetPersonPropertiesForFlags()
     * ```
     */
    resetPersonPropertiesForFlags(): void {
        this.featureFlags.resetPersonPropertiesForFlags()
    }

    /**
     * Set override group properties for feature flags.
     * This is used when dealing with new groups / where you don't want to wait for ingestion
     * to update properties.
     * Takes in an object, the key of which is the group type.
     *
     * {@label Feature flags}
     *
     * @public
     *
     * @example
     * ```js
     * // Set properties with reload
     * posthog.setGroupPropertiesForFlags({'organization': { name: 'CYZ', employees: '11' } })
     * ```
     *
     * @example
     * ```js
     * // Set properties without reload
     * posthog.setGroupPropertiesForFlags({'organization': { name: 'CYZ', employees: '11' } }, false)
     * ```
     *
     * @param {Object} properties The properties to override, the key of which is the group type.
     * @param {Boolean} [reloadFeatureFlags] Whether to reload feature flags.
     */
    setGroupPropertiesForFlags(properties: { [type: string]: Properties }, reloadFeatureFlags = true): void {
        if (!this._requirePersonProcessing('posthog.setGroupPropertiesForFlags')) {
            return
        }
        this.featureFlags.setGroupPropertiesForFlags(properties, reloadFeatureFlags)
    }

    /**
     * Resets the group properties for feature flags.
     *
     * {@label Feature flags}
     *
     * @public
     *
     * @example
     * ```js
     * posthog.resetGroupPropertiesForFlags()
     * ```
     */
    resetGroupPropertiesForFlags(group_type?: string): void {
        this.featureFlags.resetGroupPropertiesForFlags(group_type)
    }

    /**
     * Resets all user data and starts a fresh session.
     *
     * ⚠️ **Warning**: Only call this when a user logs out. Calling at the wrong time can cause split sessions.
     *
     * This clears:
     * - Session ID and super properties
     * - User identification (sets new random distinct_id)
     * - Cached data and consent settings
     *
     * {@label Identification}
     * @example
     * ```js
     * // reset on user logout
     * function logout() {
     *     posthog.reset()
     *     // redirect to login page
     * }
     * ```
     *
     * @example
     * ```js
     * // reset and generate new device ID
     * posthog.reset(true)  // also resets device_id
     * ```
     *
     * @public
     */
    reset(reset_device_id?: boolean): void {
        logger.info('reset')
        if (!this.__loaded) {
            return logger.uninitializedWarning('posthog.reset')
        }
        const device_id = this.get_property('$device_id')
        this.consent.reset()
        this.persistence?.clear()
        this.sessionPersistence?.clear()
        this.surveys.reset()
        this.featureFlags.reset()
        this.persistence?.set_property(USER_STATE, 'anonymous')
        this.sessionManager?.resetSessionId()
        this._cachedPersonProperties = null
        if (this.config.cookieless_mode === 'always') {
            this.register_once(
                {
                    distinct_id: COOKIELESS_SENTINEL_VALUE,
                    $device_id: null,
                },
                ''
            )
        } else {
            const uuid = this.config.get_device_id(uuidv7())
            this.register_once(
                {
                    distinct_id: uuid,
                    $device_id: reset_device_id ? uuid : device_id,
                },
                ''
            )
        }

        this.register(
            {
                $last_posthog_reset: new Date().toISOString(),
            },
            1
        )
    }

    /**
     * Returns the current distinct ID for the user.
     *
     * @remarks
     * This is either the auto-generated ID or the ID set via `identify()`.
     * The distinct ID is used to associate events with users in PostHog.
     *
     * {@label Identification}
     *
     * @example
     * ```js
     * // get the current user ID
     * const userId = posthog.get_distinct_id()
     * console.log('Current user:', userId)
     * ```
     *
     * @example
     * ```js
     * // use in loaded callback
     * posthog.init('token', {
     *     loaded: (posthog) => {
     *         const id = posthog.get_distinct_id()
     *         // use the ID
     *     }
     * })
     * ```
     *
     * @public
     *
     * @returns The current distinct ID
     */
    get_distinct_id(): string {
        return this.get_property('distinct_id')
    }

    /**
     * Returns the current groups.
     *
     * {@label Identification}
     *
     * @public
     *
     * @returns The current groups
     */
    getGroups(): Record<string, any> {
        return this.get_property('$groups') || {}
    }

    /**
     * Returns the current session_id.
     *
     * @remarks
     * This should only be used for informative purposes.
     * Any actual internal use case for the session_id should be handled by the sessionManager.
     *
     * @public
     *
     * @returns The stored session ID for the current session. This may be an empty string if the client is not yet fully initialized.
     */
    get_session_id(): string {
        return this.sessionManager?.checkAndGetSessionAndWindowId(true).sessionId ?? ''
    }

    /**
     * Returns the Replay url for the current session.
     *
     * {@label Session replay}
     *
     * @public
     *
     * @example
     * ```js
     * // basic usage
     * posthog.get_session_replay_url()
     *
     * @example
     * ```js
     * // timestamp
     * posthog.get_session_replay_url({ withTimestamp: true })
     * ```
     *
     * @example
     * ```js
     * // timestamp and lookback
     * posthog.get_session_replay_url({
     *   withTimestamp: true,
     *   timestampLookBack: 30 // look back 30 seconds
     * })
     * ```
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
     * Creates an alias linking two distinct user identifiers. Learn more about [identifying users](/docs/product-analytics/identify)
     *
     * {@label Identification}
     *
     * @remarks
     * PostHog will use this to link two distinct_ids going forward (not retroactively).
     * Call this when a user signs up to connect their anonymous session with their account.
     *
     *
     * @example
     * ```js
     * // link anonymous user to account on signup
     * posthog.alias('user_12345')
     * ```
     *
     * @example
     * ```js
     * // explicit alias with original ID
     * posthog.alias('user_12345', 'anonymous_abc123')
     * ```
     *
     * @public
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

        if (isUndefined(original)) {
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
     * Updates the configuration of the PostHog instance.
     *
     * {@label Initialization}
     *
     * @public
     *
     * @param {Partial<PostHogConfig>} config A dictionary of new configuration values to update
     */
    set_config(config: Partial<PostHogConfig>): void {
        const oldConfig = { ...this.config }
        if (isObject(config)) {
            extend(this.config, configRenames(config))

            const isPersistenceDisabled = this._is_persistence_disabled()
            this.persistence?.update_config(this.config, oldConfig, isPersistenceDisabled)
            this.sessionPersistence =
                this.config.persistence === 'sessionStorage' || this.config.persistence === 'memory'
                    ? this.persistence
                    : new PostHogPersistence({ ...this.config, persistence: 'sessionStorage' }, isPersistenceDisabled)

            if (localStore._is_supported() && localStore._get('ph_debug') === 'true') {
                this.config.debug = true
            }
            if (this.config.debug) {
                Config.DEBUG = true
                logger.info('set_config', {
                    config,
                    oldConfig,
                    newConfig: { ...this.config },
                })
            }

            this.sessionRecording?.startIfEnabledOrStop()
            this.autocapture?.startIfEnabled()
            this.heatmaps?.startIfEnabled()
            this.surveys.loadIfEnabled()
            this._sync_opt_out_with_persistence()
            this.externalIntegrations?.startIfEnabledOrStop()
        }
    }

    /**
     * turns session recording on, and updates the config option `disable_session_recording` to false
     *
     * {@label Session replay}
     *
     * @public
     *
     * @example
     * ```js
     * // Start and ignore controls
     * posthog.startSessionRecording(true)
     * ```
     *
     * @example
     * ```js
     * // Start and override controls
     * posthog.startSessionRecording({
     *   // you don't have to send all of these
     *   sampling: true || false,
     *   linked_flag: true || false,
     *   url_trigger: true || false,
     *   event_trigger: true || false
     * })
     * ```
     *
     * @param override.sampling - optional boolean to override the default sampling behavior - ensures the next session recording to start will not be skipped by sampling config.
     * @param override.linked_flag - optional boolean to override the default linked_flag behavior - ensures the next session recording to start will not be skipped by linked_flag config.
     * @param override.url_trigger - optional boolean to override the default url_trigger behavior - ensures the next session recording to start will not be skipped by url_trigger config.
     * @param override.event_trigger - optional boolean to override the default event_trigger behavior - ensures the next session recording to start will not be skipped by event_trigger config.
     * @param override - optional boolean to override the default sampling behavior - ensures the next session recording to start will not be skipped by sampling or linked_flag config. `true` is shorthand for { sampling: true, linked_flag: true }
     */
    startSessionRecording(
        override?: { sampling?: boolean; linked_flag?: boolean; url_trigger?: true; event_trigger?: true } | true
    ): void {
        const overrideAll = override === true
        const overrideConfig = {
            sampling: overrideAll || !!override?.sampling,
            linked_flag: overrideAll || !!override?.linked_flag,
            url_trigger: overrideAll || !!override?.url_trigger,
            event_trigger: overrideAll || !!override?.event_trigger,
        }

        if (Object.values(overrideConfig).some(Boolean)) {
            // allow the session id check to rotate session id if necessary
            this.sessionManager?.checkAndGetSessionAndWindowId()

            if (overrideConfig.sampling) {
                this.sessionRecording?.overrideSampling()
            }

            if (overrideConfig.linked_flag) {
                this.sessionRecording?.overrideLinkedFlag()
            }

            if (overrideConfig.url_trigger) {
                this.sessionRecording?.overrideTrigger('url')
            }

            if (overrideConfig.event_trigger) {
                this.sessionRecording?.overrideTrigger('event')
            }
        }

        this.set_config({ disable_session_recording: false })
    }

    /**
     * turns session recording off, and updates the config option
     * disable_session_recording to true
     *
     * {@label Session replay}
     *
     * @public
     *
     * @example
     * ```js
     * // Stop session recording
     * posthog.stopSessionRecording()
     * ```
     */
    stopSessionRecording(): void {
        this.set_config({ disable_session_recording: true })
    }

    /**
     * returns a boolean indicating whether session recording
     * is currently running
     *
     * {@label Session replay}
     *
     * @public
     *
     * @example
     * ```js
     * // Stop session recording if it's running
     * if (posthog.sessionRecordingStarted()) {
     *   posthog.stopSessionRecording()
     * }
     * ```
     */
    sessionRecordingStarted(): boolean {
        return !!this.sessionRecording?.started
    }

    /**
     * Capture a caught exception manually
     *
     * {@label Error tracking}
     *
     * @public
     *
     * @example
     * ```js
     * // Capture a caught exception
     * try {
     *   // something that might throw
     * } catch (error) {
     *   posthog.captureException(error)
     * }
     * ```
     *
     * @example
     * ```js
     * // With additional properties
     * posthog.captureException(error, {
     *   customProperty: 'value',
     *   anotherProperty: ['I', 'can be a list'],
     *   ...
     * })
     * ```
     *
     * @param {Error} error The error to capture
     * @param {Object} [additionalProperties] Any additional properties to add to the error event
     * @returns {CaptureResult} The result of the capture
     */
    captureException(error: unknown, additionalProperties?: Properties): CaptureResult | undefined {
        const syntheticException = new Error('PostHog syntheticException')
        const errorToProperties = this.exceptions.buildProperties(error, {
            handled: true,
            syntheticException,
        })
        return this.exceptions.sendExceptionEvent({
            ...errorToProperties,
            ...additionalProperties,
        })
    }

    /**
     * returns a boolean indicating whether the [toolbar](/docs/toolbar) loaded
     *
     * {@label Toolbar}
     *
     * @public
     *
     * @param toolbarParams
     * @returns {boolean} Whether the toolbar loaded
     */

    loadToolbar(params: ToolbarParams): boolean {
        return this.toolbar.loadToolbar(params)
    }

    /**
     * Returns the value of a super property. Returns undefined if the property doesn't exist.
     *
     * {@label Identification}
     *
     * @remarks
     * get_property() can only be called after the PostHog library has finished loading.
     * init() has a loaded function available to handle this automatically.
     *
     * @example
     * ```js
     * // grab value for '$user_id' after the posthog library has loaded
     * posthog.init('<YOUR PROJECT TOKEN>', {
     *     loaded: function(posthog) {
     *         user_id = posthog.get_property('$user_id');
     *     }
     * });
     * ```
     * @public
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
     * {@label Identification}
     *
     * @remarks
     * This is based on browser-level `sessionStorage`, NOT the PostHog session.
     * getSessionProperty() can only be called after the PostHog library has finished loading.
     * init() has a loaded function available to handle this automatically.
     *
     * @example
     * ```js
     * // grab value for 'user_id' after the posthog library has loaded
     * posthog.init('YOUR PROJECT TOKEN', {
     *     loaded: function(posthog) {
     *         user_id = posthog.getSessionProperty('user_id');
     *     }
     * });
     * ```
     *
     * @param {String} property_name The name of the session super property you want to retrieve
     */
    getSessionProperty(property_name: string): Property | undefined {
        return this.sessionPersistence?.props[property_name]
    }

    /**
     * Returns a string representation of the PostHog instance.
     *
     * {@label Initialization}
     *
     * @internal
     */
    toString(): string {
        let name = this.config.name ?? PRIMARY_INSTANCE_NAME
        if (name !== PRIMARY_INSTANCE_NAME) {
            name = PRIMARY_INSTANCE_NAME + '.' + name
        }
        return name
    }

    _isIdentified(): boolean {
        return (
            this.persistence?.get_property(USER_STATE) === 'identified' ||
            this.sessionPersistence?.get_property(USER_STATE) === 'identified'
        )
    }

    _hasPersonProcessing(): boolean {
        return !(
            this.config.person_profiles === 'never' ||
            (this.config.person_profiles === 'identified_only' &&
                !this._isIdentified() &&
                isEmptyObject(this.getGroups()) &&
                !this.persistence?.props?.[ALIAS_ID_KEY] &&
                !this.persistence?.props?.[ENABLE_PERSON_PROCESSING])
        )
    }

    _shouldCapturePageleave(): boolean {
        return (
            this.config.capture_pageleave === true ||
            (this.config.capture_pageleave === 'if_capture_pageview' &&
                (this.config.capture_pageview === true || this.config.capture_pageview === 'history_change'))
        )
    }

    /**
     *  Creates a person profile for the current user, if they don't already have one and config.person_profiles is set
     *  to 'identified_only'. Produces a warning and does not create a profile if config.person_profiles is set to
     *  'never'. Learn more about [person profiles](/docs/product-analytics/identify)
     *
     * {@label Identification}
     *
     * @public
     *
     * @example
     * ```js
     * posthog.createPersonProfile()
     * ```
     */
    createPersonProfile(): void {
        if (this._hasPersonProcessing()) {
            // if a person profile already exists, don't send an event when we don't need to
            return
        }
        if (!this._requirePersonProcessing('posthog.createPersonProfile')) {
            return
        }
        // sent a $set event. We don't set any properties here, but attribution props will be added later
        this.setPersonProperties({}, {})
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

    private _is_persistence_disabled(): boolean {
        if (this.config.cookieless_mode === 'always') {
            return true
        }
        const isOptedOut = this.consent.isOptedOut()
        const defaultPersistenceDisabled =
            this.config.opt_out_persistence_by_default || this.config.cookieless_mode === 'on_reject'

        // TRICKY: We want a deterministic state for persistence so that a new pageload has the same persistence
        return this.config.disable_persistence || (isOptedOut && !!defaultPersistenceDisabled)
    }

    private _sync_opt_out_with_persistence(): boolean {
        const persistenceDisabled = this._is_persistence_disabled()

        if (this.persistence?._disabled !== persistenceDisabled) {
            this.persistence?.set_disabled(persistenceDisabled)
        }
        if (this.sessionPersistence?._disabled !== persistenceDisabled) {
            this.sessionPersistence?.set_disabled(persistenceDisabled)
        }
        return persistenceDisabled
    }

    /**
     * Opts the user into data capturing and persistence.
     *
     * {@label Privacy}
     *
     * @remarks
     * Enables event tracking and data persistence (cookies/localStorage) for this PostHog instance.
     * By default, captures an `$opt_in` event unless disabled.
     *
     * @example
     * ```js
     * // simple opt-in
     * posthog.opt_in_capturing()
     * ```
     *
     * @example
     * ```js
     * // opt-in with custom event and properties
     * posthog.opt_in_capturing({
     *     captureEventName: 'Privacy Accepted',
     *     captureProperties: { source: 'banner' }
     * })
     * ```
     *
     * @example
     * ```js
     * // opt-in without capturing event
     * posthog.opt_in_capturing({
     *     captureEventName: false
     * })
     * ```
     *
     * @public
     *
     * @param {Object} [config] A dictionary of config options to override
     * @param {string} [config.capture_event_name=$opt_in] Event name to be used for capturing the opt-in action. Set to `null` or `false` to skip capturing the optin event
     * @param {Object} [config.capture_properties] Set of properties to be captured along with the opt-in action
     */
    opt_in_capturing(options?: {
        captureEventName?: EventName | null | false /** event name to be used for capturing the opt-in action */
        captureProperties?: Properties /** set of properties to be captured along with the opt-in action */
    }): void {
        if (this.config.cookieless_mode === 'always') {
            logger.warn('Consent opt in/out is not valid with cookieless_mode="always" and will be ignored')
            return
        }
        if (this.config.cookieless_mode === 'on_reject' && this.consent.isExplicitlyOptedOut()) {
            // If the user has explicitly opted out on_reject mode, then before we can start sending regular non-cookieless events
            // we need to reset the instance to ensure that there is no leaking of state or data between the cookieless and regular events
            this.reset(true)
            this.sessionManager = new SessionIdManager(this)
            if (this.persistence) {
                this.sessionPropsManager = new SessionPropsManager(this, this.sessionManager, this.persistence)
            }
            this.sessionRecording = new SessionRecording(this)
            this.sessionRecording.startIfEnabledOrStop()
        }

        this.consent.optInOut(true)
        this._sync_opt_out_with_persistence()

        // Reinitialize surveys if we're in cookieless mode and just opted in
        if (this.config.cookieless_mode == 'on_reject') {
            this.surveys.loadIfEnabled()
        }

        // Don't capture if captureEventName is null or false
        if (isUndefined(options?.captureEventName) || options?.captureEventName) {
            this.capture(options?.captureEventName ?? '$opt_in', options?.captureProperties, { send_instantly: true })
        }

        if (this.config.capture_pageview) {
            this._captureInitialPageview()
        }
    }

    /**
     * Opts the user out of data capturing and persistence.
     *
     * {@label Privacy}
     *
     * @remarks
     * Disables event tracking and data persistence (cookies/localStorage) for this PostHog instance.
     * If `opt_out_persistence_by_default` is true, SDK persistence will also be disabled.
     *
     * @example
     * ```js
     * // opt user out (e.g., on privacy settings page)
     * posthog.opt_out_capturing()
     * ```
     *
     * @public
     */
    opt_out_capturing(): void {
        if (this.config.cookieless_mode === 'always') {
            logger.warn('Consent opt in/out is not valid with cookieless_mode="always" and will be ignored')
            return
        }

        if (this.config.cookieless_mode === 'on_reject' && this.consent.isOptedIn()) {
            // If the user has opted in, we need to reset the instance to ensure that there is no leaking of state or data between the cookieless and regular events
            this.reset(true)
        }

        this.consent.optInOut(false)
        this._sync_opt_out_with_persistence()

        if (this.config.cookieless_mode === 'on_reject') {
            // If cookieless_mode is 'on_reject', we start capturing events in cookieless mode
            this.register({
                distinct_id: COOKIELESS_SENTINEL_VALUE,
                $device_id: null,
            })
            this.sessionManager = undefined
            this.sessionPropsManager = undefined
            this.sessionRecording?.stopRecording()
            this.sessionRecording = undefined
            this._captureInitialPageview()
        }
    }

    /**
     * Checks if the user has opted into data capturing.
     *
     * {@label Privacy}
     *
     * @remarks
     * Returns the current consent status for event tracking and data persistence.
     *
     * @example
     * ```js
     * if (posthog.has_opted_in_capturing()) {
     *     // show analytics features
     * }
     * ```
     *
     * @public
     *
     * @returns {boolean} current opt-in status
     */
    has_opted_in_capturing(): boolean {
        return this.consent.isOptedIn()
    }

    /**
     * Checks if the user has opted out of data capturing.
     *
     * {@label Privacy}
     *
     * @remarks
     * Returns the current consent status for event tracking and data persistence.
     *
     * @example
     * ```js
     * if (posthog.has_opted_out_capturing()) {
     *     // disable analytics features
     * }
     * ```
     *
     * @public
     *
     * @returns {boolean} current opt-out status
     */
    has_opted_out_capturing(): boolean {
        return this.consent.isOptedOut()
    }

    /**
     * Returns the explicit consent status of the user.
     *
     * @remarks
     * This can be used to check if the user has explicitly opted in or out of data capturing, or neither. This does not
     * take the default config options into account, only whether the user has made an explicit choice, so this can be
     * used to determine whether to show an initial cookie banner or not.
     *
     * @example
     * ```js
     * const consentStatus = posthog.get_explicit_consent_status()
     * if (consentStatus === "granted") {
     *     // user has explicitly opted in
     * } else if (consentStatus === "denied") {
     *     // user has explicitly opted out
     * } else if (consentStatus === "pending"){
     *     // user has not made a choice, show consent banner
     * }
     * ```
     *
     * @public
     *
     * @returns {boolean | null} current explicit consent status
     */
    get_explicit_consent_status(): 'granted' | 'denied' | 'pending' {
        const consent = this.consent.consent
        return consent === ConsentStatus.GRANTED ? 'granted' : consent === ConsentStatus.DENIED ? 'denied' : 'pending'
    }

    /**
     * Checks whether the PostHog library is currently capturing events.
     *
     * Usually this means that the user has not opted out of capturing, but the exact behaviour can be controlled by
     * some config options.
     *
     * Additionally, if the cookieless_mode is set to 'on_reject', we will capture events in cookieless mode if the
     * user has explicitly opted out.
     *
     * {@label Privacy}
     *
     * @see {PostHogConfig.cookieless_mode}
     * @see {PostHogConfig.opt_out_persistence_by_default}
     * @see {PostHogConfig.respect_dnt}
     *
     * @returns {boolean} whether the posthog library is capturing events
     */
    is_capturing(): boolean {
        if (this.config.cookieless_mode === 'always') {
            return true
        }
        if (this.config.cookieless_mode === 'on_reject') {
            return this.consent.isExplicitlyOptedOut() || this.consent.isOptedIn()
        } else {
            return !this.has_opted_out_capturing()
        }
    }

    /**
     * Clear the user's opt in/out status of data capturing and cookies/localstorage for this PostHog instance
     *
     * {@label Privacy}
     *
     * @public
     *
     */
    clear_opt_in_out_capturing(): void {
        this.consent.reset()
        this._sync_opt_out_with_persistence()
    }

    _is_bot(): boolean | undefined {
        if (navigator) {
            return isLikelyBot(navigator, this.config.custom_blocked_useragents)
        } else {
            return undefined
        }
    }

    _captureInitialPageview(): void {
        if (!document) {
            return
        }

        // If page is not visible, add a listener to detect when the page becomes visible
        // and trigger the pageview only then
        // This is useful to avoid `prerender` calls from Chrome/Wordpress/SPAs
        // that are not visible to the user

        if (document.visibilityState !== 'visible') {
            if (!this._visibilityStateListener) {
                this._visibilityStateListener = this._captureInitialPageview.bind(this)
                addEventListener(document, 'visibilitychange', this._visibilityStateListener)
            }

            return
        }

        // Extra check here to guarantee we only ever trigger a single `$pageview` event
        if (!this._initialPageviewCaptured) {
            this._initialPageviewCaptured = true
            this.capture('$pageview', { title: document.title }, { send_instantly: true })

            // After we've captured the initial pageview, we can remove the listener
            if (this._visibilityStateListener) {
                document.removeEventListener('visibilitychange', this._visibilityStateListener)
                this._visibilityStateListener = null
            }
        }
    }

    /**
     * Enables or disables debug mode for detailed logging.
     *
     * @remarks
     * Debug mode logs all PostHog calls to the browser console for troubleshooting.
     * Can also be enabled by adding `?__posthog_debug=true` to the URL.
     *
     * {@label Initialization}
     *
     * @example
     * ```js
     * // enable debug mode
     * posthog.debug(true)
     * ```
     *
     * @example
     * ```js
     * // disable debug mode
     * posthog.debug(false)
     * ```
     *
     * @public
     *
     * @param {boolean} [debug] If true, will enable debug mode.
     */
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

    /**
     * Helper method to check if external API calls (flags/decide) should be disabled
     * Handles migration from old `advanced_disable_decide` to new `advanced_disable_flags`
     */
    _shouldDisableFlags(): boolean {
        // Check if advanced_disable_flags was explicitly set in original config
        const originalConfig = this._originalUserConfig || {}
        if ('advanced_disable_flags' in originalConfig) {
            return !!originalConfig.advanced_disable_flags
        }

        // Check if advanced_disable_flags was set post-init (different from default false)
        if (this.config.advanced_disable_flags !== false) {
            return !!this.config.advanced_disable_flags
        }

        // Check for post-init changes to advanced_disable_decide
        if (this.config.advanced_disable_decide === true) {
            logger.warn(
                "Config field 'advanced_disable_decide' is deprecated. Please use 'advanced_disable_flags' instead. " +
                    'The old field will be removed in a future major version.'
            )
            return true
        }

        // Fall back to migration logic for original user config
        return migrateConfigField(originalConfig, 'advanced_disable_flags', 'advanced_disable_decide', false, logger)
    }

    private _runBeforeSend(data: CaptureResult): CaptureResult | null {
        if (isNullish(this.config.before_send)) {
            return data
        }

        const fns = isArray(this.config.before_send) ? this.config.before_send : [this.config.before_send]
        let beforeSendResult: CaptureResult | null = data
        for (const fn of fns) {
            beforeSendResult = fn(beforeSendResult)
            if (isNullish(beforeSendResult)) {
                const logMessage = `Event '${data.event}' was rejected in beforeSend function`
                if (isKnownUnsafeEditableEvent(data.event)) {
                    logger.warn(`${logMessage}. This can cause unexpected behavior.`)
                } else {
                    logger.info(logMessage)
                }
                return null
            }
            if (!beforeSendResult.properties || isEmptyObject(beforeSendResult.properties)) {
                logger.warn(
                    `Event '${data.event}' has no properties after beforeSend function, this is likely an error.`
                )
            }
        }
        return beforeSendResult
    }

    /**
     * Returns the current page view ID.
     *
     * {@label Initialization}
     *
     * @public
     *
     * @returns {string} The current page view ID
     */
    public getPageViewId(): string | undefined {
        return this.pageViewManager._currentPageview?.pageViewId
    }

    /**
     * Capture written user feedback for a LLM trace. Numeric values are converted to strings.
     *
     * {@label LLM analytics}
     *
     * @public
     *
     * @param traceId The trace ID to capture feedback for.
     * @param userFeedback The feedback to capture.
     */
    captureTraceFeedback(traceId: string | number, userFeedback: string) {
        this.capture('$ai_feedback', {
            $ai_trace_id: String(traceId),
            $ai_feedback_text: userFeedback,
        })
    }

    /**
     * Capture a metric for a LLM trace. Numeric values are converted to strings.
     *
     * {@label LLM analytics}
     *
     * @public
     *
     * @param traceId The trace ID to capture the metric for.
     * @param metricName The name of the metric to capture.
     * @param metricValue The value of the metric to capture.
     */
    captureTraceMetric(traceId: string | number, metricName: string, metricValue: string | number | boolean) {
        this.capture('$ai_metric', {
            $ai_trace_id: String(traceId),
            $ai_metric_name: metricName,
            $ai_metric_value: String(metricValue),
        })
    }
}

safewrapClass(PostHog, ['identify'])

const add_dom_loaded_handler = function () {
    // Cross browser DOM Loaded support
    function dom_loaded_handler() {
        // function flag since we only want to execute this once
        if ((dom_loaded_handler as any).done) {
            return
        }
        ;(dom_loaded_handler as any).done = true

        ENQUEUE_REQUESTS = false

        each(instances, function (inst: PostHog) {
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
            addEventListener(document, 'DOMContentLoaded', dom_loaded_handler, { capture: false })
        }

        return
    }

    // Only IE6-8 don't support `document.addEventListener` and we don't support them
    // so let's simply log an error stating PostHog couldn't be initialized
    // We're checking for `window` to avoid erroring out on a SSR context
    if (window) {
        logger.error("Browser doesn't support `document.addEventListener` so PostHog couldn't be initialized")
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

        each(snippetPostHog['_i'], function (item: [token: string, config: Partial<PostHogConfig>, name: string]) {
            if (item && isArray(item)) {
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
