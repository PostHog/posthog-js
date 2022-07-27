/* eslint camelcase: "off" */
import { LZString } from './lz-string'
import Config from './config'
import { _, logger, document, userAgent, window } from './utils'
import { autocapture } from './autocapture'
import { PostHogPeople } from './posthog-people'
import { PostHogFeatureFlags } from './posthog-featureflags'
import { ALIAS_ID_KEY, PEOPLE_DISTINCT_ID_KEY, PostHogPersistence } from './posthog-persistence'
import { SessionRecording } from './extensions/sessionrecording'
import { Decide } from './decide'
import { Toolbar } from './extensions/toolbar'
import { addOptOutCheckPostHogLib, clearOptInOut, hasOptedIn, hasOptedOut, optIn, optOut } from './gdpr-utils'
import { cookieStore, localStore } from './storage'
import { RequestQueue } from './request-queue'
import { CaptureMetrics } from './capture-metrics'
import { compressData, decideCompression } from './compression'
import { addParamsToURL, encodePostData, xhr } from './send-request'
import { RetryQueue } from './retry-queue'
import { SessionIdManager } from './sessionid'
import { getPerformanceData } from './apm'

/*
SIMPLE STYLE GUIDE:

this.x === public function
this._x === internal - only use within this file
this.__x === private - only use within the class

Globals should be all caps
*/

let init_type // MODULE or SNIPPET loader
let posthog_master // main posthog instance / object
const INIT_MODULE = 0
const INIT_SNIPPET = 1
// some globals for comparisons
const __NOOP = function () {}
const __NOOPTIONS = {}

const PRIMARY_INSTANCE_NAME = 'posthog'

/*
 * Dynamic... constants? Is that an oxymoron?
 */
// http://hacks.mozilla.org/2009/07/cross-site-xmlhttprequest-with-cors/
// https://developer.mozilla.org/en-US/docs/DOM/XMLHttpRequest#withCredentials
const USE_XHR = window.XMLHttpRequest && 'withCredentials' in new XMLHttpRequest()

// IE<10 does not support cross-origin XHR's but script tags
// with defer won't block window.onload; ENQUEUE_REQUESTS
// should only be true for Opera<12
let ENQUEUE_REQUESTS = !USE_XHR && userAgent.indexOf('MSIE') === -1 && userAgent.indexOf('Mozilla') === -1

const defaultConfig = () => ({
    api_host: 'https://app.posthog.com',
    api_method: 'POST',
    api_transport: 'XHR',
    autocapture: true,
    rageclick: false,
    cross_subdomain_cookie: document.location.hostname.indexOf('herokuapp.com') === -1,
    persistence: 'cookie',
    persistence_name: '',
    cookie_name: '',
    loaded: function () {},
    store_google: true,
    save_referrer: true,
    test: false,
    verbose: false,
    img: false,
    capture_pageview: true,
    debug: false,
    cookie_expiration: 365,
    upgrade: false,
    disable_session_recording: false,
    disable_persistence: false,
    disable_cookie: false,
    enable_recording_console_log: false,
    secure_cookie: window.location.protocol === 'https:',
    ip: true,
    opt_out_capturing_by_default: false,
    opt_out_persistence_by_default: false,
    opt_out_capturing_persistence_type: 'localStorage',
    opt_out_capturing_cookie_prefix: null,
    property_blacklist: [],
    sanitize_properties: null,
    xhr_headers: {}, // { header: value, header2: value }
    inapp_protocol: '//',
    inapp_link_new_window: false,
    request_batching: true,
    properties_string_max_length: 65535,
    session_recording: {
        // select set of rrweb config options we expose to our users
        // see https://github.com/rrweb-io/rrweb/blob/master/guide.md
        blockClass: 'ph-no-capture',
        blockSelector: null,
        ignoreClass: 'ph-ignore-input',
        maskAllInputs: true,
        maskInputOptions: {},
        maskInputFn: null,
        slimDOMOptions: {},
        collectFonts: false,
        inlineStylesheet: true,
    },
    mask_all_element_attributes: false,
    mask_all_text: false,
    advanced_disable_decide: false,
    advanced_disable_toolbar_metrics: false,
    on_xhr_error: (req) => {
        const error = 'Bad HTTP status: ' + req.status + ' ' + req.statusText
        console.error(error)
    },
    get_device_id: (uuid) => uuid,
    // Used for internal testing
    _onCapture: () => {},
    _capture_metrics: false,
    _capture_performance: false,
})

/**
 * PostHog Library Object
 * @constructor
 */
export const PostHogLib = function () {}

/**
 * create_mplib(token:string, config:object, name:string)
 *
 * This function is used by the init method of PostHogLib objects
 * as well as the main initializer at the end of the JSLib (that
 * initializes document.posthog as well as any additional instances
 * declared before this file has loaded).
 */
var create_mplib = function (token, config, name) {
    var instance,
        target = name === PRIMARY_INSTANCE_NAME || !posthog_master ? posthog_master : posthog_master[name]

    if (target && init_type === INIT_MODULE) {
        instance = target
    } else {
        if (target && !_.isArray(target)) {
            console.error('You have already initialized ' + name)
            return
        }
        instance = new PostHogLib()
    }

    instance._init(token, config, name)

    instance['people'] = new PostHogPeople()
    instance['people']._init(instance)

    instance.featureFlags = new PostHogFeatureFlags(instance)
    instance.feature_flags = instance.featureFlags

    instance.toolbar = new Toolbar(instance)
    instance.toolbar.maybeLoadEditor()

    instance.sessionRecording = new SessionRecording(instance)
    instance.sessionRecording.startRecordingIfEnabled()

    instance['__autocapture_enabled'] = instance.get_config('autocapture')
    if (instance.get_config('autocapture')) {
        var num_buckets = 100
        var num_enabled_buckets = 100
        if (!autocapture.enabledForProject(instance.get_config('token'), num_buckets, num_enabled_buckets)) {
            instance['__autocapture_enabled'] = false
            logger.log('Not in active bucket: disabling Automatic Event Collection.')
        } else if (!autocapture.isBrowserSupported()) {
            instance['__autocapture_enabled'] = false
            logger.log('Disabling Automatic Event Collection because this browser is not supported')
        } else {
            autocapture.init(instance)
        }
    }

    // if any instance on the page has debug = true, we set the
    // global debug to be true
    Config.DEBUG = Config.DEBUG || instance.get_config('debug')

    // if target is not defined, we called init after the lib already
    // loaded, so there won't be an array of things to execute
    if (!_.isUndefined(target) && _.isArray(target)) {
        // Crunch through the people queue first - we queue this data up &
        // flush on identify, so it's better to do all these operations first
        instance._execute_array.call(instance['people'], target['people'])
        instance._execute_array(target)
    }

    return instance
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
PostHogLib.prototype.init = function (token, config, name) {
    if (_.isUndefined(name)) {
        console.error('You must name your new library: init(token, config, name)')
        return
    }
    if (name === PRIMARY_INSTANCE_NAME) {
        console.error('You must initialize the main posthog object right after you include the PostHog js snippet')
        return
    }

    const instance = create_mplib(token, config, name)
    posthog_master[name] = instance
    instance._loaded()

    return instance
}

// posthog._init(token:string, config:object, name:string)
//
// This function sets up the current instance of the posthog
// library.  The difference between this method and the init(...)
// method is this one initializes the actual instance, whereas the
// init(...) method sets up a new library and calls _init on it.
//
PostHogLib.prototype._init = function (token, config, name) {
    this['__loaded'] = true
    this['config'] = {}
    this['_triggered_notifs'] = []
    this['compression'] = {}

    this.set_config(
        _.extend({}, defaultConfig(), config, {
            name: name,
            token: token,
            callback_fn: (name === PRIMARY_INSTANCE_NAME ? name : PRIMARY_INSTANCE_NAME + '.' + name) + '._jsc',
        })
    )

    this['_jsc'] = function () {}

    this._captureMetrics = new CaptureMetrics(this.get_config('_capture_metrics'))

    this._requestQueue = new RequestQueue(this._captureMetrics, _.bind(this._handle_queued_event, this))

    this._retryQueue = new RetryQueue(this._captureMetrics, this.get_config('on_xhr_error'))
    this.__captureHooks = []
    this.__request_queue = []

    this['persistence'] = new PostHogPersistence(this['config'])
    this['sessionManager'] = new SessionIdManager(this['config'], this['persistence'])

    this._gdpr_init()

    if (!this.get_distinct_id()) {
        // There is no need to set the distinct id
        // or the device id if something was already stored
        // in the persitence
        const uuid = this.get_config('get_device_id')(_.UUID())
        this.register_once(
            {
                distinct_id: uuid,
                $device_id: uuid,
            },
            ''
        )
    }
    // Set up the window close event handler "unload"
    window.addEventListener && window.addEventListener('unload', this._handle_unload.bind(this))
}

// Private methods

PostHogLib.prototype._loaded = function () {
    // Pause `reloadFeatureFlags` calls in config.loaded callback.
    // These feature flags are loaded in the decide call made right afterwards
    this.featureFlags.setReloadingPaused(true)

    try {
        this.get_config('loaded')(this)
    } catch (err) {
        console.error('`loaded` function failed', err)
    }

    this._start_queue_if_opted_in()

    // this happens after so a user can call identify in
    // the loaded callback
    if (this.get_config('capture_pageview')) {
        this.capture('$pageview', {}, { send_instantly: true })
    }

    // Call decide to get what features are enabled and other settings.
    // As a reminder, if the /decide endpoint is disabled, feature flags, toolbar, session recording, autocapture,
    // and compression will not be available.
    if (!this.get_config('advanced_disable_decide')) {
        new Decide(this).call()
    }

    this.featureFlags.resetRequestQueue()
    this.featureFlags.setReloadingPaused(false)
}

PostHogLib.prototype._start_queue_if_opted_in = function () {
    if (!this.has_opted_out_capturing()) {
        if (this.get_config('request_batching')) {
            this._requestQueue.poll()
        }
    }
}

PostHogLib.prototype._dom_loaded = function () {
    if (!this.has_opted_out_capturing()) {
        _.each(
            this.__request_queue,
            function (item) {
                this._send_request.apply(this, item)
            },
            this
        )
    }

    delete this.__request_queue

    this._start_queue_if_opted_in()
}

/**
 * _prepare_callback() should be called by callers of _send_request for use
 * as the callback argument.
 *
 * If there is no callback, this returns null.
 * If we are going to make XHR/XDR requests, this returns a function.
 * If we are going to use script tags, this returns a string to use as the
 * callback GET param.
 */
PostHogLib.prototype._prepare_callback = function (callback, data) {
    if (_.isUndefined(callback)) {
        return null
    }

    if (USE_XHR) {
        var callback_function = function (response) {
            callback(response, data)
        }
        return callback_function
    } else {
        // if the user gives us a callback, we store as a random
        // property on this instances jsc function and update our
        // callback string to reflect that.
        var jsc = this['_jsc']
        var randomized_cb = '' + Math.floor(Math.random() * 100000000)
        var callback_string = this.get_config('callback_fn') + '[' + randomized_cb + ']'
        jsc[randomized_cb] = function (response) {
            delete jsc[randomized_cb]
            callback(response, data)
        }
        return callback_string
    }
}

PostHogLib.prototype._handle_unload = function () {
    if (!this.get_config('request_batching')) {
        if (this.get_config('capture_pageview')) {
            this.capture('$pageleave', null, { transport: 'sendbeacon' })
        }
        return
    }

    if (this.get_config('capture_pageview')) {
        this.capture('$pageleave')
    }
    if (this.get_config('_capture_metrics')) {
        this._requestQueue.updateUnloadMetrics()
        this.capture('$capture_metrics', this._captureMetrics.metrics)
    }
    this._requestQueue.unload()
    this._retryQueue.unload()
}

PostHogLib.prototype._handle_queued_event = function (url, data, options) {
    const jsonData = JSON.stringify(data)
    this.__compress_and_send_json_request(url, jsonData, options || __NOOPTIONS, __NOOP)
}

PostHogLib.prototype.__compress_and_send_json_request = function (url, jsonData, options, callback) {
    const [data, _options] = compressData(decideCompression(this.compression), jsonData, options)
    this._send_request(url, data, _options, callback)
}

PostHogLib.prototype._send_request = function (url, data, options, callback) {
    if (ENQUEUE_REQUESTS) {
        this.__request_queue.push(arguments)
        return
    }

    var DEFAULT_OPTIONS = {
        method: this.get_config('api_method'),
        transport: this.get_config('api_transport'),
        verbose: this.get_config('verbose'),
    }

    options = _.extend(DEFAULT_OPTIONS, options || {})
    if (!USE_XHR) {
        options.method = 'GET'
    }

    const useSendBeacon = window.navigator.sendBeacon && options.transport.toLowerCase() === 'sendbeacon'
    url = addParamsToURL(url, options.urlQueryArgs, {
        ip: this.get_config('ip'),
    })

    if (_.isObject(data) && this.get_config('img')) {
        var img = document.createElement('img')
        img.src = url
        document.body.appendChild(img)
    } else if (useSendBeacon) {
        // beacon documentation https://w3c.github.io/beacon/
        // beacons format the message and use the type property
        // also no need to try catch as sendBeacon does not report errors
        //   and is defined as best effort attempt
        try {
            window.navigator.sendBeacon(url, encodePostData(data, { ...options, sendBeacon: true }))
        } catch (e) {
            if (this.get_config('debug')) {
                console.error(e)
            }
        }
    } else if (USE_XHR) {
        try {
            xhr({
                url: url,
                data: data,
                headers: this.get_config('xhr_headers'),
                options: options,
                captureMetrics: this._captureMetrics,
                callback,
                retriesPerformedSoFar: 0,
                retryQueue: this._retryQueue,
                onXHRError: this.get_config('on_xhr_error'),
            })
        } catch (e) {
            console.error(e)
        }
    } else {
        var script = document.createElement('script')
        script.type = 'text/javascript'
        script.async = true
        script.defer = true
        script.src = url
        var s = document.getElementsByTagName('script')[0]
        s.parentNode.insertBefore(script, s)
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
PostHogLib.prototype._execute_array = function (array) {
    var fn_name,
        alias_calls = [],
        other_calls = [],
        capturing_calls = []
    _.each(
        array,
        function (item) {
            if (item) {
                fn_name = item[0]
                if (_.isArray(fn_name)) {
                    capturing_calls.push(item) // chained call e.g. posthog.get_group().set()
                } else if (typeof item === 'function') {
                    item.call(this)
                } else if (_.isArray(item) && fn_name === 'alias') {
                    alias_calls.push(item)
                } else if (
                    _.isArray(item) &&
                    fn_name.indexOf('capture') !== -1 &&
                    typeof this[fn_name] === 'function'
                ) {
                    capturing_calls.push(item)
                } else {
                    other_calls.push(item)
                }
            }
        },
        this
    )

    var execute = function (calls, context) {
        _.each(
            calls,
            function (item) {
                if (_.isArray(item[0])) {
                    // chained call
                    var caller = context
                    _.each(item, function (call) {
                        caller = caller[call[0]].apply(caller, call.slice(1))
                    })
                } else {
                    this[item[0]].apply(this, item.slice(1))
                }
            },
            context
        )
    }

    execute(alias_calls, this)
    execute(other_calls, this)
    execute(capturing_calls, this)
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
PostHogLib.prototype.push = function (item) {
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
 */
PostHogLib.prototype.capture = addOptOutCheckPostHogLib(function (event_name, properties, options) {
    // While developing, a developer might purposefully _not_ call init(),
    // in this case, we would like capture to be a noop.
    if (!this['__loaded']) {
        return
    }

    this._captureMetrics.incr('capture')
    if (event_name === '$snapshot') {
        this._captureMetrics.incr('snapshot')
    }

    options = options || __NOOPTIONS
    var transport = options['transport'] // external API, don't minify 'transport' prop
    if (transport) {
        options.transport = transport // 'transport' prop name can be minified internally
    }

    if (_.isUndefined(event_name) || typeof event_name !== 'string') {
        console.error('No event name provided to posthog.capture')
        return
    }

    if (_.isBlockedUA(userAgent)) {
        return
    }

    const start_timestamp = this['persistence'].remove_event_timer(event_name)

    // update persistence
    this['persistence'].update_search_keyword(document.referrer)

    if (this.get_config('store_google')) {
        this['persistence'].update_campaign_params()
    }
    if (this.get_config('save_referrer')) {
        this['persistence'].update_referrer_info(document.referrer)
    }

    var data = {
        event: event_name,
        properties: this._calculate_event_properties(event_name, properties, start_timestamp),
    }

    if (event_name === '$identify' && options.$set) {
        data['$set'] = options['$set']
    }

    data = _.copyAndTruncateStrings(data, options._noTruncate ? null : this.get_config('properties_string_max_length'))
    if (this.get_config('debug')) {
        logger.log('PostHog.js send', data)
    }
    const jsonData = JSON.stringify(data)

    const url = this.get_config('api_host') + (options.endpoint || '/e/')

    const has_unique_traits = options !== __NOOPTIONS

    if (this.get_config('request_batching') && (!has_unique_traits || options._batchKey) && !options.send_instantly) {
        data['timestamp'] = new Date()
        this._requestQueue.enqueue(url, data, options)
    } else {
        this.__compress_and_send_json_request(url, jsonData, options)
    }

    this._invokeCaptureHooks(event_name, data)

    return data
})

PostHogLib.prototype._addCaptureHook = function (callback) {
    this.__captureHooks.push(callback)
}

PostHogLib.prototype._invokeCaptureHooks = function (eventName, eventData) {
    this.config._onCapture(eventName, eventData)
    _.each(this.__captureHooks, (callback) => callback(eventName))
}

PostHogLib.prototype._calculate_event_properties = function (event_name, event_properties, start_timestamp) {
    // set defaults
    let properties = { ...event_properties }
    properties['token'] = this.get_config('token')

    if (event_name === '$snapshot') {
        const persistenceProps = this.persistence.properties()
        properties['distinct_id'] = persistenceProps.distinct_id
        return properties
    }

    // set $duration if time_event was previously called for this event
    if (!_.isUndefined(start_timestamp)) {
        var duration_in_ms = new Date().getTime() - start_timestamp
        properties['$duration'] = parseFloat((duration_in_ms / 1000).toFixed(3))
    }

    if (this.sessionManager) {
        const { sessionId, windowId } = this.sessionManager.checkAndGetSessionAndWindowId()
        properties['$session_id'] = sessionId
        properties['$window_id'] = windowId
    }
    // note: extend writes to the first object, so lets make sure we
    // don't write to the persistence properties object and info
    // properties object by passing in a new object

    // update properties with pageview info and super-properties
    properties = _.extend({}, _.info.properties(), this['persistence'].properties(), properties)

    if (event_name === '$pageview' && this.get_config('_capture_performance')) {
        properties = _.extend(properties, getPerformanceData())
    }

    var property_blacklist = this.get_config('property_blacklist')
    if (_.isArray(property_blacklist)) {
        _.each(property_blacklist, function (blacklisted_prop) {
            delete properties[blacklisted_prop]
        })
    } else {
        console.error('Invalid value for property_blacklist config: ' + property_blacklist)
    }

    var sanitize_properties = this.get_config('sanitize_properties')
    if (sanitize_properties) {
        properties = sanitize_properties(properties, event_name)
    }

    return properties
}

/**
 * Register a set of super properties, which are included with all
 * events. This will overwrite previous super property values.
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
 * @param {Object} properties An associative array of properties to store about the user
 * @param {Number} [days] How many days since the user's last visit to store the super properties
 */
PostHogLib.prototype.register = function (props, days) {
    this['persistence'].register(props, days)
}

/**
 * Register a set of super properties only once. This will not
 * overwrite previous super property values, unlike register().
 *
 * ### Usage:
 *
 *     // register a super property for the first time only
 *     posthog.register_once({
 *         'First Login Date': new Date().toISOString()
 *     });
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
PostHogLib.prototype.register_once = function (props, default_value, days) {
    this['persistence'].register_once(props, default_value, days)
}

/**
 * Delete a super property stored with the current user.
 *
 * @param {String} property The name of the super property to remove
 */
PostHogLib.prototype.unregister = function (property) {
    this['persistence'].unregister(property)
}

PostHogLib.prototype._register_single = function (prop, value) {
    var props = {}
    props[prop] = value
    this.register(props)
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
PostHogLib.prototype.getFeatureFlag = function (key, options = {}) {
    return this.featureFlags.getFeatureFlag(key, options)
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
PostHogLib.prototype.isFeatureEnabled = function (key, options = {}) {
    return this.featureFlags.isFeatureEnabled(key, options)
}

PostHogLib.prototype.reloadFeatureFlags = function () {
    return this.featureFlags.reloadFeatureFlags()
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
 */
PostHogLib.prototype.onFeatureFlags = function (callback) {
    this.featureFlags.onFeatureFlags(callback)
}

/**
 * Identify a user with a unique ID instead of a PostHog
 * randomly generated distinct_id. If the method is never called,
 * then unique visitors will be identified by a UUID generated
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
 * unique ID for the current user. PostHog cannot translate
 * between IDs at this time, so when you change a user's ID
 * they will appear to be a new user.
 *
 * When used alone, posthog.identify will change the user's
 * distinct_id to the unique ID provided. When used in tandem
 * with posthog.alias, it will allow you to identify based on
 * unique ID and map that back to the original, anonymous
 * distinct_id given to the user upon her first arrival to your
 * site (thus connecting anonymous pre-signup activity to
 * post-signup activity). Though the two work together, do not
 * call identify() at the same time as alias(). Calling the two
 * at the same time can cause a race condition, so it is best
 * practice to call identify on the original, anonymous ID
 * right after you've aliased it.
 *
 * @param {String} [unique_id] A string that uniquely identifies a user. If not provided, the distinct_id currently in the persistent store (cookie or localStorage) will be used.
 * @param {Object} [userProperties] Optional: An associative array of properties to store about the user
 * @param {Object} [userPropertiesToSetOnce] Optional: An associative array of properties to store about the user. If property is previously set, this does not override that value.
 */
PostHogLib.prototype.identify = function (new_distinct_id, userPropertiesToSet, userPropertiesToSetOnce) {
    //if the new_distinct_id has not been set ignore the identify event
    if (!new_distinct_id) {
        console.error('Unique user id has not been set in posthog.identify')
        return
    }

    this._captureMetrics.incr('identify')

    var previous_distinct_id = this.get_distinct_id()
    this.register({ $user_id: new_distinct_id })

    if (!this.get_property('$device_id')) {
        // The persisted distinct id might not actually be a device id at all
        // it might be a distinct id of the user from before
        var device_id = previous_distinct_id
        this.register_once(
            {
                $had_persisted_distinct_id: true,
                $device_id: device_id,
            },
            ''
        )
    }

    // identify only changes the distinct id if it doesn't match either the existing or the alias;
    // if it's new, blow away the alias as well.
    if (new_distinct_id !== previous_distinct_id && new_distinct_id !== this.get_property(ALIAS_ID_KEY)) {
        this.unregister(ALIAS_ID_KEY)
        this.register({ distinct_id: new_distinct_id })
    }

    // send an $identify event any time the distinct_id is changing and the old ID is an anoymous ID
    // - logic on the server will determine whether or not to do anything with it.
    if (
        new_distinct_id !== previous_distinct_id &&
        (!this.get_property('$device_id') || previous_distinct_id === this.get_property('$device_id'))
    ) {
        this.capture(
            '$identify',
            {
                distinct_id: new_distinct_id,
                $anon_distinct_id: previous_distinct_id,
            },
            { $set: userPropertiesToSet || {} },
            { $set_once: userPropertiesToSetOnce || {} }
        )
        // let the reload feature flag request know to send this previous distinct id
        // for flag consistency
        this.featureFlags.setAnonymousDistinctId(previous_distinct_id)
    } else {
        if (userPropertiesToSet) {
            this['people'].set(userPropertiesToSet)
        }
        if (userPropertiesToSetOnce) {
            this['people'].set_once(userPropertiesToSetOnce)
        }
    }

    // Reload active feature flags if the user identity changes.
    // Note we don't reload this on property changes as these get processed async
    if (new_distinct_id !== previous_distinct_id) {
        this.reloadFeatureFlags()
    }
}

/**
 * Alpha feature: don't use unless you know what you're doing!
 *
 * Sets group analytics information for subsequent events and reloads feature flags.
 *
 * @param {String} groupType Group type (example: 'organization')
 * @param {String} groupKey Group key (example: 'org::5')
 * @param {Object} groupPropertiesToSet Optional properties to set for group
 */
PostHogLib.prototype.group = function (groupType, groupKey, groupPropertiesToSet) {
    if (!groupType || !groupKey) {
        console.error('posthog.group requires a group type and group key')
        return
    }

    this._captureMetrics.incr('group')

    var existingGroups = this.getGroups()

    this.register({ $groups: { ...existingGroups, [groupType]: groupKey } })

    if (groupPropertiesToSet) {
        this.capture('$groupidentify', {
            $group_type: groupType,
            $group_key: groupKey,
            $group_set: groupPropertiesToSet,
        })
    }

    // If groups change, reload feature flags.
    if (existingGroups[groupType] !== groupKey) {
        this.reloadFeatureFlags()
    }
}

/**
 * Clears super properties and generates a new random distinct_id for this instance.
 * Useful for clearing data when a user logs out.
 */
PostHogLib.prototype.reset = function (reset_device_id) {
    let device_id = this.get_property('$device_id')
    this['persistence'].clear()
    this.sessionManager.resetSessionId()
    const uuid = this.get_config('get_device_id')(_.UUID())
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
PostHogLib.prototype.get_distinct_id = function () {
    return this.get_property('distinct_id')
}

PostHogLib.prototype.getGroups = function () {
    return this.get_property('$groups') || {}
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
PostHogLib.prototype.alias = function (alias, original) {
    // If the $people_distinct_id key exists in persistence, there has been a previous
    // posthog.people.identify() call made for this user. It is VERY BAD to make an alias with
    // this ID, as it will duplicate users.
    if (alias === this.get_property(PEOPLE_DISTINCT_ID_KEY)) {
        console.critical('Attempting to create alias for existing People user - aborting.')
        return -2
    }

    var _this = this
    if (_.isUndefined(original)) {
        original = this.get_distinct_id()
    }
    if (alias !== original) {
        this._register_single(ALIAS_ID_KEY, alias)
        return this.capture('$create_alias', { alias: alias, distinct_id: original }, function () {
            // Flush the people queue
            _this.identify(alias)
        })
    } else {
        console.error('alias matches current distinct_id - skipping api call.')
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
 *       // Posthog host
 *       api_host: 'https://app.posthog.com',
 *
 *       // HTTP method for capturing requests
 *       api_method: 'POST'
 *
 *       // Automatically capture clicks, form submissions and change events
 *       autocapture: true
 *
 *       // Capture rage clicks (beta) - useful for session recording
 *       rageclick: false
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

PostHogLib.prototype.set_config = function (config) {
    const oldConfig = { ...this.config }
    if (_.isObject(config)) {
        _.extend(this['config'], config)

        if (!this.get_config('persistence_name')) {
            this['config']['persistence_name'] = this['config']['cookie_name']
        }
        if (!this.get_config('disable_persistence')) {
            this['config']['disable_persistence'] = this['config']['disable_cookie']
        }

        if (this['persistence']) {
            this['persistence'].update_config(this['config'])
        }

        if (localStore.is_supported() && localStore.get('ph_debug') === 'true') {
            this['config']['debug'] = true
        }
        Config.DEBUG = Config.DEBUG || this.get_config('debug')

        if (this.sessionRecording && typeof config.disable_session_recording !== 'undefined') {
            if (oldConfig.disable_session_recording !== config.disable_session_recording) {
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
 */
PostHogLib.prototype.startSessionRecording = function () {
    this.set_config({ disable_session_recording: false })
}

/**
 * turns session recording off, and updates the config option
 * disable_session_recording to true
 */
PostHogLib.prototype.stopSessionRecording = function () {
    this.set_config({ disable_session_recording: true })
}

/**
 * returns a boolean indicating whether session recording
 * is currently running
 */
PostHogLib.prototype.sessionRecordingStarted = function () {
    return this.sessionRecording.started()
}

/**
 * returns the current config object for the library.
 */
PostHogLib.prototype.get_config = function (prop_name) {
    return this.config?.[prop_name]
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
 *     // grab value for 'user_id' after the posthog library has loaded
 *     posthog.init('YOUR PROJECT TOKEN', {
 *         loaded: function(posthog) {
 *             user_id = posthog.get_property('user_id');
 *         }
 *     });
 *
 * @param {String} property_name The name of the super property you want to retrieve
 */
PostHogLib.prototype.get_property = function (property_name) {
    return this['persistence']['props'][property_name]
}

PostHogLib.prototype.toString = function () {
    var name = this.get_config('name')
    if (name !== PRIMARY_INSTANCE_NAME) {
        name = PRIMARY_INSTANCE_NAME + '.' + name
    }
    return name
}

// perform some housekeeping around GDPR opt-in/out state
PostHogLib.prototype._gdpr_init = function () {
    var is_localStorage_requested = this.get_config('opt_out_capturing_persistence_type') === 'localStorage'

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
        (this.get_config('opt_out_capturing_by_default') || cookieStore.get('ph_optout'))
    ) {
        cookieStore.remove('ph_optout')
        this.opt_out_capturing({
            clear_persistence: this.get_config('opt_out_persistence_by_default'),
        })
    }
}

/**
 * Enable or disable persistence based on options
 * only enable/disable if persistence is not already in this state
 * @param {boolean} [options.clear_persistence] If true, will delete all data stored by the sdk in persistence and disable it
 * @param {boolean} [options.enable_persistence] If true, will re-enable sdk persistence
 */
PostHogLib.prototype._gdpr_update_persistence = function (options) {
    var disabled
    if (options && options['clear_persistence']) {
        disabled = true
    } else if (options && options['enable_persistence']) {
        disabled = false
    } else {
        return
    }

    if (!this.get_config('disable_persistence') && this['persistence'].disabled !== disabled) {
        this['persistence'].set_disabled(disabled)
    }
}

// call a base gdpr function after constructing the appropriate token and options args
PostHogLib.prototype._gdpr_call_func = function (func, options) {
    options = _.extend(
        {
            capture: _.bind(this.capture, this),
            persistence_type: this.get_config('opt_out_capturing_persistence_type'),
            cookie_prefix: this.get_config('opt_out_capturing_cookie_prefix'),
            cookie_expiration: this.get_config('cookie_expiration'),
            cross_subdomain_cookie: this.get_config('cross_subdomain_cookie'),
            secure_cookie: this.get_config('secure_cookie'),
        },
        options
    )

    // check if localStorage can be used for recording opt out status, fall back to cookie if not
    if (!localStore.is_supported() && options['persistence_type'] === 'localStorage') {
        options['persistence_type'] = 'cookie'
    }

    return func(this.get_config('token'), {
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
PostHogLib.prototype.opt_in_capturing = function (options) {
    options = _.extend(
        {
            enable_persistence: true,
        },
        options
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
PostHogLib.prototype.opt_out_capturing = function (options) {
    options = _.extend(
        {
            clear_persistence: true,
        },
        options
    )

    this._gdpr_call_func(optOut, options)
    this._gdpr_update_persistence(options)
}

/**
 * Check whether the user has opted in to data capturing and cookies/localstorage for this PostHog instance
 *
 * ### Usage
 *
 *     var has_opted_in = posthog.has_opted_in_capturing();
 *     // use has_opted_in value
 *
 * @param {Object} [options] A dictionary of config options to override
 * @param {string} [options.persistence_type=localStorage] Persistence mechanism used - cookie or localStorage - falls back to cookie if localStorage is unavailable
 * @param {string} [options.cookie_prefix=__ph_opt_in_out] Custom prefix to be used in the cookie/localstorage name
 * @returns {boolean} current opt-in status
 */
PostHogLib.prototype.has_opted_in_capturing = function (options) {
    return this._gdpr_call_func(hasOptedIn, options)
}

/**
 * Check whether the user has opted out of data capturing and cookies/localstorage for this PostHog instance
 *
 * ### Usage
 *
 *     var has_opted_out = posthog.has_opted_out_capturing();
 *     // use has_opted_out value
 *
 * @param {Object} [options] A dictionary of config options to override
 * @param {string} [options.persistence_type=localStorage] Persistence mechanism used - cookie or localStorage - falls back to cookie if localStorage is unavailable
 * @param {string} [options.cookie_prefix=__ph_opt_in_out] Custom prefix to be used in the cookie/localstorage name
 * @returns {boolean} current opt-out status
 */
PostHogLib.prototype.has_opted_out_capturing = function (options) {
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
PostHogLib.prototype.clear_opt_in_out_capturing = function (options) {
    options = _.extend(
        {
            enable_persistence: true,
        },
        options
    )

    this._gdpr_call_func(clearOptInOut, options)
    this._gdpr_update_persistence(options)
}

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
PostHogLib.prototype.sentry_integration = function (_posthog, organization, projectId, prefix) {
    // setupOnce gets called by Sentry when it intializes the plugin
    this.name = 'posthog-js'
    this.setupOnce = function (addGlobalEventProcessor) {
        addGlobalEventProcessor((event) => {
            if (event.level !== 'error' || !_posthog.__loaded) return event
            if (!event.tags) event.tags = {}
            event.tags['PostHog Person URL'] = _posthog.config.api_host + '/person/' + _posthog.get_distinct_id()
            if (_posthog.sessionRecordingStarted()) {
                event.tags['PostHog Recording URL'] =
                    _posthog.config.api_host +
                    '/recordings/#sessionRecordingId=' +
                    _posthog.sessionManager.checkAndGetSessionAndWindowId(true).sessionId
            }
            let data = {
                $sentry_event_id: event.event_id,
                $sentry_exception: event.exception,
            }
            if (organization && projectId)
                data['$sentry_url'] =
                    (prefix || 'https://sentry.io/organizations/') +
                    organization +
                    '/issues/?project=' +
                    projectId +
                    '&query=' +
                    event.event_id
            _posthog.capture('$exception', data)
            return event
        })
    }
}

PostHogLib.prototype.debug = function (debug) {
    if (debug === false) {
        window.console.log("You've disabled debug mode.")
        localStorage && localStorage.setItem('ph_debug', undefined)
        this.set_config({ debug: false })
    } else {
        window.console.log(
            "You're now in debug mode. All calls to PostHog will be logged in your console.\nYou can disable this with `posthog.debug(false)`."
        )
        localStorage && localStorage.setItem('ph_debug', 'true')
        this.set_config({ debug: true })
    }
}

PostHogLib.prototype.decodeLZ64 = LZString.decompressFromBase64

// EXPORTS (for closure compiler)

// PostHogLib Exports
PostHogLib.prototype['init'] = PostHogLib.prototype.init
PostHogLib.prototype['reset'] = PostHogLib.prototype.reset
PostHogLib.prototype['capture'] = PostHogLib.prototype.capture
PostHogLib.prototype['register'] = PostHogLib.prototype.register
PostHogLib.prototype['register_once'] = PostHogLib.prototype.register_once
PostHogLib.prototype['unregister'] = PostHogLib.prototype.unregister
PostHogLib.prototype['identify'] = PostHogLib.prototype.identify
PostHogLib.prototype['getGroups'] = PostHogLib.prototype.getGroups
PostHogLib.prototype['group'] = PostHogLib.prototype.group
PostHogLib.prototype['alias'] = PostHogLib.prototype.alias
PostHogLib.prototype['set_config'] = PostHogLib.prototype.set_config
PostHogLib.prototype['get_config'] = PostHogLib.prototype.get_config
PostHogLib.prototype['get_property'] = PostHogLib.prototype.get_property
PostHogLib.prototype['get_distinct_id'] = PostHogLib.prototype.get_distinct_id
PostHogLib.prototype['toString'] = PostHogLib.prototype.toString
PostHogLib.prototype['opt_out_captureing'] = PostHogLib.prototype.opt_out_captureing
PostHogLib.prototype['opt_in_captureing'] = PostHogLib.prototype.opt_in_captureing
PostHogLib.prototype['has_opted_out_captureing'] = PostHogLib.prototype.has_opted_out_captureing
PostHogLib.prototype['has_opted_in_captureing'] = PostHogLib.prototype.has_opted_in_captureing
PostHogLib.prototype['clear_opt_in_out_captureing'] = PostHogLib.prototype.clear_opt_in_out_captureing
PostHogLib.prototype['opt_out_capturing'] = PostHogLib.prototype.opt_out_capturing
PostHogLib.prototype['opt_in_capturing'] = PostHogLib.prototype.opt_in_capturing
PostHogLib.prototype['has_opted_out_capturing'] = PostHogLib.prototype.has_opted_out_capturing
PostHogLib.prototype['has_opted_in_capturing'] = PostHogLib.prototype.has_opted_in_capturing
PostHogLib.prototype['clear_opt_in_out_capturing'] = PostHogLib.prototype.clear_opt_in_out_capturing
PostHogLib.prototype['getFeatureFlag'] = PostHogLib.prototype.getFeatureFlag
PostHogLib.prototype['isFeatureEnabled'] = PostHogLib.prototype.isFeatureEnabled
PostHogLib.prototype['reloadFeatureFlags'] = PostHogLib.prototype.reloadFeatureFlags
PostHogLib.prototype['onFeatureFlags'] = PostHogLib.prototype.onFeatureFlags
PostHogLib.prototype['decodeLZ64'] = PostHogLib.prototype.decodeLZ64
PostHogLib.prototype['SentryIntegration'] = PostHogLib.prototype.sentry_integration
PostHogLib.prototype['debug'] = PostHogLib.prototype.debug
PostHogLib.prototype['LIB_VERSION'] = Config.LIB_VERSION
PostHogLib.prototype['startSessionRecording'] = PostHogLib.prototype.startSessionRecording
PostHogLib.prototype['stopSessionRecording'] = PostHogLib.prototype.stopSessionRecording
PostHogLib.prototype['sessionRecordingStarted'] = PostHogLib.prototype.sessionRecordingStarted

// PostHogPersistence Exports
PostHogPersistence.prototype['properties'] = PostHogPersistence.prototype.properties
PostHogPersistence.prototype['update_search_keyword'] = PostHogPersistence.prototype.update_search_keyword
PostHogPersistence.prototype['update_referrer_info'] = PostHogPersistence.prototype.update_referrer_info
PostHogPersistence.prototype['get_cross_subdomain'] = PostHogPersistence.prototype.get_cross_subdomain
PostHogPersistence.prototype['clear'] = PostHogPersistence.prototype.clear

_.safewrap_class(PostHogLib, ['identify'])

var instances = {}
var extend_mp = function () {
    // add all the sub posthog instances
    _.each(instances, function (instance, name) {
        if (name !== PRIMARY_INSTANCE_NAME) {
            posthog_master[name] = instance
        }
    })

    // add private functions as _
    posthog_master['_'] = _
}

var override_ph_init_func = function () {
    // we override the snippets init function to handle the case where a
    // user initializes the posthog library after the script loads & runs
    posthog_master['init'] = function (token, config, name) {
        if (name) {
            // initialize a sub library
            if (!posthog_master[name]) {
                posthog_master[name] = instances[name] = create_mplib(token, config, name)
                posthog_master[name]._loaded()
            }
            return posthog_master[name]
        } else {
            var instance = posthog_master

            if (instances[PRIMARY_INSTANCE_NAME]) {
                // main posthog lib already initialized
                instance = instances[PRIMARY_INSTANCE_NAME]
            } else if (token) {
                // intialize the main posthog lib
                instance = create_mplib(token, config, PRIMARY_INSTANCE_NAME)
                instance._loaded()
                instances[PRIMARY_INSTANCE_NAME] = instance
            }

            posthog_master = instance
            if (init_type === INIT_SNIPPET) {
                window[PRIMARY_INSTANCE_NAME] = posthog_master
            }
            extend_mp()
        }
    }
}

var add_dom_loaded_handler = function () {
    // Cross browser DOM Loaded support
    function dom_loaded_handler() {
        // function flag since we only want to execute this once
        if (dom_loaded_handler.done) {
            return
        }
        dom_loaded_handler.done = true

        ENQUEUE_REQUESTS = false

        _.each(instances, function (inst) {
            inst._dom_loaded()
        })
    }

    function do_scroll_check() {
        try {
            document.documentElement.doScroll('left')
        } catch (e) {
            setTimeout(do_scroll_check, 1)
            return
        }

        dom_loaded_handler()
    }

    if (document.addEventListener) {
        if (document.readyState === 'complete') {
            // safari 4 can fire the DOMContentLoaded event before loading all
            // external JS (including this file). you will see some copypasta
            // on the internet that checks for 'complete' and 'loaded', but
            // 'loaded' is an IE thing
            dom_loaded_handler()
        } else {
            document.addEventListener('DOMContentLoaded', dom_loaded_handler, false)
        }
    } else if (document.attachEvent) {
        // IE
        document.attachEvent('onreadystatechange', dom_loaded_handler)

        // check to make sure we arn't in a frame
        var toplevel = false
        try {
            toplevel = window.frameElement === null
        } catch (e) {
            // noop
        }

        if (document.documentElement.doScroll && toplevel) {
            do_scroll_check()
        }
    }

    // fallback handler, always will work
    _.register_event(window, 'load', dom_loaded_handler, true)
}

export function init_from_snippet() {
    init_type = INIT_SNIPPET
    if (_.isUndefined(window.posthog)) window.posthog = []
    posthog_master = window.posthog

    if (posthog_master['__loaded'] || (posthog_master['config'] && posthog_master['persistence'])) {
        // lib has already been loaded at least once; we don't want to override the global object this time so bomb early
        console.error('PostHog library has already been downloaded at least once.')
        return
    }
    // Load instances of the PostHog Library
    _.each(posthog_master['_i'], function (item) {
        if (item && _.isArray(item)) {
            instances[item[item.length - 1]] = create_mplib.apply(this, item)
        }
    })

    override_ph_init_func()
    posthog_master['init']()

    // Fire loaded events after updating the window's posthog object
    _.each(instances, function (instance) {
        instance._loaded()
    })

    add_dom_loaded_handler()
}

export function init_as_module() {
    init_type = INIT_MODULE
    posthog_master = new PostHogLib()

    override_ph_init_func()
    posthog_master['init']()
    add_dom_loaded_handler()

    return posthog_master
}
