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

import { each, includes } from './utils'
import { window } from './utils/globals'
import { cookieStore, localStore, localPlusCookieStore } from './storage'
import { GDPROptions, PersistentStore } from './types'
import { PostHog } from './posthog-core'

import { isNumber, isString } from './utils/type-utils'
import { logger } from './utils/logger'

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
        const nav = win?.navigator
        let hasDntOn = false
        each(
            [
                nav?.doNotTrack, // standard
                (nav as any)['msDoNotTrack'],
                (win as any)['doNotTrack'],
            ],
            function (dntValue) {
                if (includes([true, 1, '1', 'yes'], dntValue)) {
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
    if (!isString(token) || !token.length) {
        logger.error('gdpr.' + (optValue ? 'optIn' : 'optOut') + ' called with an invalid token')
        return
    }

    options = options || {}

    _getStorage(options).set(
        _getStorageKey(token, options),
        optValue ? 1 : 0,
        isNumber(options.cookieExpiration) ? options.cookieExpiration : null,
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

export function userOptedOut(posthog: PostHog) {
    let optedOut = false

    try {
        const token = posthog.config.token
        const respectDnt = posthog.config.respect_dnt
        const persistenceType = posthog.config.opt_out_capturing_persistence_type
        const persistencePrefix = posthog.config.opt_out_capturing_cookie_prefix || undefined
        const win = (posthog.config as any).window as Window | undefined // used to override window during browser tests

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
        logger.error('Unexpected error when checking capturing opt-out status: ' + err)
    }
    return optedOut
}
