import { extend } from './utils'
import { PersistentStore, Properties } from './types'
import {
    DISTINCT_ID,
    ENABLE_PERSON_PROCESSING,
    INITIAL_PERSON_INFO,
    SESSION_ID,
    SESSION_RECORDING_IS_SAMPLED,
} from './constants'

import { isNull, isUndefined } from '@posthog/core'
import { logger } from './utils/logger'
import { window, document } from './utils/globals'
import { uuidv7 } from './uuidv7'

// we store the discovered subdomain in memory because it might be read multiple times
let firstNonPublicSubDomain = ''

// helper to allow tests to clear this "cache"
export const resetSubDomainCache = () => {
    firstNonPublicSubDomain = ''
}

/**
 * Browsers don't offer a way to check if something is a public suffix
 * e.g. `.com.au`, `.io`, `.org.uk`
 *
 * But they do reject cookies set on public suffixes
 * Setting a cookie on `.co.uk` would mean it was sent for every `.co.uk` site visited
 *
 * So, we can use this to check if a domain is a public suffix
 * by trying to set a cookie on a subdomain of the provided hostname
 * until the browser accepts it
 *
 * inspired by https://github.com/AngusFu/browser-root-domain
 */
export function seekFirstNonPublicSubDomain(hostname: string, cookieJar = document): string {
    if (firstNonPublicSubDomain) {
        return firstNonPublicSubDomain
    }

    if (!cookieJar) {
        return ''
    }
    if (['localhost', '127.0.0.1'].includes(hostname)) return ''

    const list = hostname.split('.')
    let len = Math.min(list.length, 8) // paranoia - we know this number should be small
    const key = 'dmn_chk_' + uuidv7()

    while (!firstNonPublicSubDomain && len--) {
        const candidate = list.slice(len).join('.')
        const candidateCookieValue = key + '=1;domain=.' + candidate + ';path=/'

        // try to set cookie, include a short expiry in seconds since we'll check immediately
        cookieJar.cookie = candidateCookieValue + ';max-age=3'

        if (cookieJar.cookie.includes(key)) {
            // the cookie was accepted by the browser, remove the test cookie
            cookieJar.cookie = candidateCookieValue + ';max-age=0'
            firstNonPublicSubDomain = candidate
        }
    }

    return firstNonPublicSubDomain
}

const DOMAIN_MATCH_REGEX = /[a-z0-9][a-z0-9-]+\.[a-z]{2,}$/i
const originalCookieDomainFn = (hostname: string): string => {
    const matches = hostname.match(DOMAIN_MATCH_REGEX)
    return matches ? matches[0] : ''
}

export function chooseCookieDomain(hostname: string, cross_subdomain: boolean | undefined): string {
    if (cross_subdomain) {
        // NOTE: Could we use this for cross domain tracking?
        let matchedSubDomain = seekFirstNonPublicSubDomain(hostname)

        if (!matchedSubDomain) {
            const originalMatch = originalCookieDomainFn(hostname)
            if (originalMatch !== matchedSubDomain) {
                logger.info('Warning: cookie subdomain discovery mismatch', originalMatch, matchedSubDomain)
            }
            matchedSubDomain = originalMatch
        }

        return matchedSubDomain ? '; domain=.' + matchedSubDomain : ''
    }
    return ''
}

// Methods partially borrowed from quirksmode.org/js/cookies.html
export const cookieStore: PersistentStore = {
    _is_supported: () => !!document,

    _error: function (msg) {
        logger.error('cookieStore error: ' + msg)
    },

    _get: function (name) {
        if (!document) {
            return
        }

        try {
            const nameEQ = name + '='
            const ca = document.cookie.split(';').filter((x) => x.length)
            for (let i = 0; i < ca.length; i++) {
                let c = ca[i]
                while (c.charAt(0) == ' ') {
                    c = c.substring(1, c.length)
                }
                if (c.indexOf(nameEQ) === 0) {
                    return decodeURIComponent(c.substring(nameEQ.length, c.length))
                }
            }
        } catch {}
        return null
    },

    _parse: function (name) {
        let cookie
        try {
            cookie = JSON.parse(cookieStore._get(name)) || {}
        } catch {
            // noop
        }
        return cookie
    },

    _set: function (name, value, days, cross_subdomain, is_secure) {
        if (!document) {
            return
        }
        try {
            let expires = '',
                secure = ''

            const cdomain = chooseCookieDomain(document.location.hostname, cross_subdomain)

            if (days) {
                const date = new Date()
                date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000)
                expires = '; expires=' + date.toUTCString()
            }

            if (is_secure) {
                secure = '; secure'
            }

            const new_cookie_val =
                name +
                '=' +
                encodeURIComponent(JSON.stringify(value)) +
                expires +
                '; SameSite=Lax; path=/' +
                cdomain +
                secure

            // 4096 bytes is the size at which some browsers (e.g. firefox) will not store a cookie, warn slightly before that
            if (new_cookie_val.length > 4096 * 0.9) {
                logger.warn('cookieStore warning: large cookie, len=' + new_cookie_val.length)
            }

            document.cookie = new_cookie_val
            return new_cookie_val
        } catch {
            return
        }
    },

    _remove: function (name, cross_subdomain) {
        if (!document?.cookie) {
            return
        }
        try {
            cookieStore._set(name, '', -1, cross_subdomain)
        } catch {
            return
        }
    },
}

let _localStorage_supported: boolean | null = null
export const resetLocalStorageSupported = () => {
    _localStorage_supported = null
}

export const localStore: PersistentStore = {
    _is_supported: function () {
        if (!isNull(_localStorage_supported)) {
            return _localStorage_supported
        }

        let supported = true
        if (!isUndefined(window)) {
            try {
                const key = '__mplssupport__',
                    val = 'xyz'
                localStore._set(key, val)
                if (localStore._get(key) !== '"xyz"') {
                    supported = false
                }
                localStore._remove(key)
            } catch {
                supported = false
            }
        } else {
            supported = false
        }
        if (!supported) {
            logger.error('localStorage unsupported; falling back to cookie store')
        }

        _localStorage_supported = supported
        return supported
    },

    _error: function (msg) {
        logger.error('localStorage error: ' + msg)
    },

    _get: function (name) {
        try {
            return window?.localStorage.getItem(name)
        } catch (err) {
            localStore._error(err)
        }
        return null
    },

    _parse: function (name) {
        try {
            return JSON.parse(localStore._get(name)) || {}
        } catch {
            // noop
        }
        return null
    },

    _set: function (name, value) {
        try {
            window?.localStorage.setItem(name, JSON.stringify(value))
        } catch (err) {
            localStore._error(err)
        }
    },

    _remove: function (name) {
        try {
            window?.localStorage.removeItem(name)
        } catch (err) {
            localStore._error(err)
        }
    },
}

// Use localstorage for most data but still use cookie for COOKIE_PERSISTED_PROPERTIES
// This solves issues with cookies having too much data in them causing headers too large
// Also makes sure we don't have to send a ton of data to the server
const COOKIE_PERSISTED_PROPERTIES = [
    DISTINCT_ID,
    SESSION_ID,
    SESSION_RECORDING_IS_SAMPLED,
    ENABLE_PERSON_PROCESSING,
    INITIAL_PERSON_INFO,
]

export const localPlusCookieStore: PersistentStore = {
    ...localStore,
    _parse: function (name) {
        try {
            let cookieProperties: Properties = {}
            try {
                // See if there's a cookie stored with data.
                cookieProperties = cookieStore._parse(name) || {}
            } catch {}
            const value = extend(cookieProperties, JSON.parse(localStore._get(name) || '{}'))
            localStore._set(name, value)
            return value
        } catch {
            // noop
        }
        return null
    },

    _set: function (name, value, days, cross_subdomain, is_secure, debug) {
        try {
            localStore._set(name, value, undefined, undefined, debug)
            const cookiePersistedProperties: Record<string, any> = {}
            COOKIE_PERSISTED_PROPERTIES.forEach((key) => {
                if (value[key]) {
                    cookiePersistedProperties[key] = value[key]
                }
            })

            if (Object.keys(cookiePersistedProperties).length) {
                cookieStore._set(name, cookiePersistedProperties, days, cross_subdomain, is_secure, debug)
            }
        } catch (err) {
            localStore._error(err)
        }
    },

    _remove: function (name, cross_subdomain) {
        try {
            window?.localStorage.removeItem(name)
            cookieStore._remove(name, cross_subdomain)
        } catch (err) {
            localStore._error(err)
        }
    },
}

const memoryStorage: Properties = {}

// Storage that only lasts the length of the pageview if we don't want to use cookies
export const memoryStore: PersistentStore = {
    _is_supported: function () {
        return true
    },

    _error: function (msg) {
        logger.error('memoryStorage error: ' + msg)
    },

    _get: function (name) {
        return memoryStorage[name] || null
    },

    _parse: function (name) {
        return memoryStorage[name] || null
    },

    _set: function (name, value) {
        memoryStorage[name] = value
    },

    _remove: function (name) {
        delete memoryStorage[name]
    },
}

let sessionStorageSupported: boolean | null = null
export const resetSessionStorageSupported = () => {
    sessionStorageSupported = null
}
// Storage that only lasts the length of a tab/window. Survives page refreshes
export const sessionStore: PersistentStore = {
    _is_supported: function () {
        if (!isNull(sessionStorageSupported)) {
            return sessionStorageSupported
        }
        sessionStorageSupported = true
        if (!isUndefined(window)) {
            try {
                const key = '__support__',
                    val = 'xyz'
                sessionStore._set(key, val)
                if (sessionStore._get(key) !== '"xyz"') {
                    sessionStorageSupported = false
                }
                sessionStore._remove(key)
            } catch {
                sessionStorageSupported = false
            }
        } else {
            sessionStorageSupported = false
        }
        return sessionStorageSupported
    },

    _error: function (msg) {
        logger.error('sessionStorage error: ', msg)
    },

    _get: function (name) {
        try {
            return window?.sessionStorage.getItem(name)
        } catch (err) {
            sessionStore._error(err)
        }
        return null
    },

    _parse: function (name) {
        try {
            return JSON.parse(sessionStore._get(name)) || null
        } catch {
            // noop
        }
        return null
    },

    _set: function (name, value) {
        try {
            window?.sessionStorage.setItem(name, JSON.stringify(value))
        } catch (err) {
            sessionStore._error(err)
        }
    },

    _remove: function (name) {
        try {
            window?.sessionStorage.removeItem(name)
        } catch (err) {
            sessionStore._error(err)
        }
    },
}
