/**
 * GDPR utils
 *
 * The General Data Protection Regulation (GDPR) is a regulation in EU law on data protection
 * and privacy for all individuals within the European Union. It addresses the export of personal
 * data outside the EU. The GDPR aims primarily to give control back to citizens and residents
 * over their personal data and to simplify the regulatory environment for international business
 * by unifying the regulation within the EU.
 *
 * This set of utilities is intended to enable opt in/out functionality in the PostHog JS SDK.
 * These functions are used internally by the SDK and are not intended to be publicly exposed.
 */

import { _each, _includes, _isNumber, _isString, window } from './utils'
import { cookieStore, localStore, localPlusCookieStore } from './storage'
import { GDPROptions, PersistentStore } from './types'
import { PostHog } from './posthog-core'

/**
 * A function used to capture a PostHog event (e.g. PostHogLib.capture)
 * @callback captureFunction
 * @param {String} event_name The name of the event. This can be anything the user does - 'Button Click', 'Sign Up', 'Item Purchased', etc.
 * @param {Object} [properties] A set of properties to include with the event you're sending. These describe the user who did the event or details about the event itself.
 * @param {Function} [callback] If provided, the callback function will be called after capturing the event.
 */

/** Public **/

const GDPR_DEFAULT_PERSISTENCE_PREFIX = '__ph_opt_in_out_'

/**
 * Opt the user in to data capturing and cookies/localstorage for the given token
 * @param {string} token - PostHog project capturing token
 * @param {Object} [options]
 * @param {captureFunction} [options.capture] - function used for capturing a PostHog event to record the opt-in action
 * @param {string} [options.captureEventName] - event name to be used for capturing the opt-in action
 * @param {Object} [options.captureProperties] - set of properties to be captured along with the opt-in action
 * @param {string} [options.persistenceType] Persistence mechanism used - cookie or localStorage
 * @param {string} [options.persistencePrefix=__ph_opt_in_out] - custom prefix to be used in the cookie/localstorage name
 * @param {Number} [options.cookieExpiration] - number of days until the opt-in cookie expires
 * @param {boolean} [options.crossSubdomainCookie] - whether the opt-in cookie is set as cross-subdomain or not
 * @param {boolean} [options.secureCookie] - whether the opt-in cookie is set as secure or not
 */
export function optIn(token: string, options: GDPROptions): void {
    _optInOut(true, token, options)
}

/**
 * Opt the user out of data capturing and cookies/localstorage for the given token
 * @param {string} token - PostHog project capturing token
 * @param {Object} [options]
 * @param {string} [options.persistenceType] Persistence mechanism used - cookie or localStorage
 * @param {string} [options.persistencePrefix=__ph_opt_in_out] - custom prefix to be used in the cookie/localstorage name
 * @param {Number} [options.cookieExpiration] - number of days until the opt-out cookie expires
 * @param {boolean} [options.crossSubdomainCookie] - whether the opt-out cookie is set as cross-subdomain or not
 * @param {boolean} [options.secureCookie] - whether the opt-out cookie is set as secure or not
 */
export function optOut(token: string, options: GDPROptions): void {
    _optInOut(false, token, options)
}

/**
 * Check whether the user has opted in to data capturing and cookies/localstorage for the given token
 * @param {string} token - PostHog project capturing token
 * @param {Object} [options]
 * @param {string} [options.persistenceType] Persistence mechanism used - cookie or localStorage
 * @param {string} [options.persistencePrefix=__ph_opt_in_out] - custom prefix to be used in the cookie/localstorage name
 * @returns {boolean} whether the user has opted in to the given opt type
 */
export function hasOptedIn(token: string, options: GDPROptions): boolean {
    return _getStorageValue(token, options) === '1'
}

/**
 * Check whether the user has opted out of data capturing and cookies/localstorage for the given token
 * @param {string} token - PostHog project capturing token
 * @param {Object} [options]
 * @param {string} [options.persistenceType] Persistence mechanism used - cookie or localStorage
 * @param {string} [options.persistencePrefix=__ph_opt_in_out] - custom prefix to be used in the cookie/localstorage name
 * @param {boolean} [options.respectDnt] - flag to take browser DNT setting into account
 * @returns {boolean} whether the user has opted out of the given opt type
 */
export function hasOptedOut(token: string, options: Partial<GDPROptions>): boolean {
    if (_hasDoNotTrackFlagOn(options)) {
        return true
    }
    return _getStorageValue(token, options) === '0'
}

/**
 * Clear the user's opt in/out status of data capturing and cookies/localstorage for the given token
 * @param {string} token - PostHog project capturing token
 * @param {Object} [options]
 * @param {string} [options.persistenceType] Persistence mechanism used - cookie or localStorage
 * @param {string} [options.persistencePrefix=__ph_opt_in_out] - custom prefix to be used in the cookie/localstorage name
 * @param {Number} [options.cookieExpiration] - number of days until the opt-in cookie expires
 * @param {boolean} [options.crossSubdomainCookie] - whether the opt-in cookie is set as cross-subdomain or not
 * @param {boolean} [options.secureCookie] - whether the opt-in cookie is set as secure or not
 */
export function clearOptInOut(token: string, options: GDPROptions) {
    options = options || {}
    _getStorage(options).remove(_getStorageKey(token, options), !!options.crossSubdomainCookie)
}

/** Private **/

/**
 * Get storage util
 * @param {Object} [options]
 * @param {string} [options.persistenceType]
 * @returns {object} either cookieStore or localStore
 */
function _getStorage(options: GDPROptions): PersistentStore {
    options = options || {}
    if (options.persistenceType === 'localStorage') {
        return localStore
    }
    if (options.persistenceType === 'localStorage+cookie') {
        return localPlusCookieStore
    }
    return cookieStore
}

/**
 * Get the name of the cookie that is used for the given opt type (capturing, cookie, etc.)
 * @param {string} token - PostHog project capturing token
 * @param {Object} [options]
 * @param {string} [options.persistencePrefix=__ph_opt_in_out] - custom prefix to be used in the cookie/localstorage name
 * @returns {string} the name of the cookie for the given opt type
 */
function _getStorageKey(token: string, options: GDPROptions) {
    options = options || {}
    return (options.persistencePrefix || GDPR_DEFAULT_PERSISTENCE_PREFIX) + token
}

/**
 * Get the value of the cookie that is used for the given opt type (capturing, cookie, etc.)
 * @param {string} token - PostHog project capturing token
 * @param {Object} [options]
 * @param {string} [options.persistencePrefix=__ph_opt_in_out] - custom prefix to be used in the cookie/localstorage name
 * @returns {string} the value of the cookie for the given opt type
 */
function _getStorageValue(token: string, options: GDPROptions) {
    return _getStorage(options).get(_getStorageKey(token, options))
}

/**
 * Check whether the user has set the DNT/doNotTrack setting to true in their browser
 * @param {Object} [options]
 * @param {string} [options.window] - alternate window object to check; used to force various DNT settings in browser tests
 * @param {boolean} [options.respectDnt] - flag to take browser DNT setting into account
 * @returns {boolean} whether the DNT setting is true
 */
function _hasDoNotTrackFlagOn(options: GDPROptions) {
    if (options && options.respectDnt) {
        const win = (options && options.window) || window
        const nav = win['navigator'] || {}
        let hasDntOn = false
        _each(
            [
                nav['doNotTrack'], // standard
                (nav as any)['msDoNotTrack'],
                (win as any)['doNotTrack'],
            ],
            function (dntValue) {
                if (_includes([true, 1, '1', 'yes'], dntValue)) {
                    hasDntOn = true
                }
            }
        )
        return hasDntOn
    }
    return false
}

/**
 * Set cookie/localstorage for the user indicating that they are opted in or out for the given opt type
 * @param {boolean} optValue - whether to opt the user in or out for the given opt type
 * @param {string} token - PostHog project capturing token
 * @param {Object} [options]
 * @param {captureFunction} [options.capture] - function used for capturing a PostHog event to record the opt-in action
 * @param {string} [options.captureEventName] - event name to be used for capturing the opt-in action
 * @param {Object} [options.captureProperties] - set of properties to be captured along with the opt-in action
 * @param {string} [options.persistencePrefix=__ph_opt_in_out] - custom prefix to be used in the cookie/localstorage name
 * @param {Number} [options.cookieExpiration] - number of days until the opt-in cookie expires
 * @param {boolean} [options.crossSubdomainCookie] - whether the opt-in cookie is set as cross-subdomain or not
 * @param {boolean} [options.secureCookie] - whether the opt-in cookie is set as secure or not
 */
function _optInOut(optValue: boolean, token: string, options: GDPROptions) {
    if (!_isString(token) || !token.length) {
        console.error('gdpr.' + (optValue ? 'optIn' : 'optOut') + ' called with an invalid token')
        return
    }

    options = options || {}

    _getStorage(options).set(
        _getStorageKey(token, options),
        optValue ? 1 : 0,
        _isNumber(options.cookieExpiration) ? options.cookieExpiration : null,
        options.crossSubdomainCookie,
        options.secureCookie
    )

    if (options.capture && optValue) {
        // only capture event if opting in (optValue=true)
        options.capture(options.captureEventName || '$opt_in', options.captureProperties || {}, {
            send_instantly: true,
        })
    }
}

export function userOptedOut(posthog: PostHog, silenceErrors: boolean | undefined) {
    let optedOut = false

    try {
        const token = posthog.get_config('token')
        const respectDnt = posthog.get_config('respect_dnt')
        const persistenceType = posthog.get_config('opt_out_capturing_persistence_type')
        const persistencePrefix = posthog.get_config('opt_out_capturing_cookie_prefix') || undefined
        const win = posthog.get_config('window' as any) as Window | undefined // used to override window during browser tests

        if (token) {
            // if there was an issue getting the token, continue method execution as normal
            optedOut = hasOptedOut(token, {
                respectDnt,
                persistenceType,
                persistencePrefix,
                window: win,
            })
        }
    } catch (err) {
        if (!silenceErrors) {
            console.error('Unexpected error when checking capturing opt-out status: ' + err)
        }
    }
    return optedOut
}

/**
 * Wrap a method with a check for whether the user is opted out of data capturing and cookies/localstorage for the given token
 * If the user has opted out, return early instead of executing the method.
 * If a callback argument was provided, execute it passing the 0 error code.
 * @param {PostHog} posthog - the posthog instance
 * @param {function} method - wrapped method to be executed if the user has not opted out
 * @param silenceErrors
 * @returns {*} the result of executing method OR undefined if the user has opted out
 */
export function addOptOutCheck<M extends (...args: any[]) => any = (...args: any[]) => any>(
    posthog: PostHog,
    method: M,
    silenceErrors?: boolean
): M {
    return function (...args) {
        const optedOut = userOptedOut(posthog, silenceErrors)

        if (!optedOut) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            return method.apply(this, args)
        }

        const callback = args[args.length - 1]
        if (typeof callback === 'function') {
            callback(0)
        }

        return
    } as M
}
