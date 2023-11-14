import { _extend } from './utils'
import { PersistentStore, Properties } from './types'
import { DISTINCT_ID, SESSION_ID, SESSION_RECORDING_IS_SAMPLED } from './constants'

import { _isNull, _isUndefined } from './utils/type-utils'
import { logger } from './utils/logger'

const Y1970 = 'Thu, 01 Jan 1970 00:00:00 GMT'

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
function seekFirstNonPublicSubDomain(hostname: string): string {
    // eslint-disable-next-line no-console
    console.log('seekFirstNonPublicSubDomain:', hostname)
    const list = hostname.split('.')
    let len = list.length
    const key = 'dmn_chk_' + +new Date()
    const R = new RegExp('(^|;)\\s*' + key + '=1')

    while (len--) {
        const candidate = list.slice(len).join('.')
        const candidateCookieValue = key + '=1;domain=.' + candidate

        // try to set cookie
        document.cookie = candidateCookieValue

        if (R.test(document.cookie)) {
            // the cookie was accepted by the browser, remove the test cookie
            document.cookie = candidateCookieValue + ';expires=' + Y1970
            return candidate
        }
    }
    return ''
}
// TRICKY: this is important enough functionality that we need to test it
// but, it relies on browser behavior, so we set it on window here
// so that we can access it in browser-based tests
;(window as any).POSTHOG_INTERNAL_seekFirstNonPublicSubDomain = seekFirstNonPublicSubDomain

export function chooseCookieDomain(hostname: string, cross_subdomain: boolean | undefined): string {
    if (cross_subdomain) {
        // NOTE: Could we use this for cross domain tracking?
        const matchedSubDomain = seekFirstNonPublicSubDomain(hostname)
        return matchedSubDomain ? '; domain=.' + matchedSubDomain : ''
    }
    return ''
}

// Methods partially borrowed from quirksmode.org/js/cookies.html
export const cookieStore: PersistentStore = {
    is_supported: () => true,

    error: function (msg) {
        logger.error('cookieStore error: ' + msg)
    },

    get: function (name) {
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
        } catch (err) {}
        return null
    },

    parse: function (name) {
        let cookie
        try {
            cookie = JSON.parse(cookieStore.get(name)) || {}
        } catch (err) {
            // noop
        }
        return cookie
    },

    set: function (name, value, days, cross_subdomain, is_secure) {
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
            document.cookie = new_cookie_val
            return new_cookie_val
        } catch (err) {
            return
        }
    },

    remove: function (name, cross_subdomain) {
        try {
            cookieStore.set(name, '', -1, cross_subdomain)
        } catch (err) {
            return
        }
    },
}

let _localStorage_supported: boolean | null = null

export const localStore: PersistentStore = {
    is_supported: function () {
        if (!_isNull(_localStorage_supported)) {
            return _localStorage_supported
        }

        let supported = true
        if (!_isUndefined(window)) {
            try {
                const key = '__mplssupport__',
                    val = 'xyz'
                localStore.set(key, val)
                if (localStore.get(key) !== '"xyz"') {
                    supported = false
                }
                localStore.remove(key)
            } catch (err) {
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

    error: function (msg) {
        logger.error('localStorage error: ' + msg)
    },

    get: function (name) {
        try {
            return window.localStorage.getItem(name)
        } catch (err) {
            localStore.error(err)
        }
        return null
    },

    parse: function (name) {
        try {
            return JSON.parse(localStore.get(name)) || {}
        } catch (err) {
            // noop
        }
        return null
    },

    set: function (name, value) {
        try {
            window.localStorage.setItem(name, JSON.stringify(value))
        } catch (err) {
            localStore.error(err)
        }
    },

    remove: function (name) {
        try {
            window.localStorage.removeItem(name)
        } catch (err) {
            localStore.error(err)
        }
    },
}

// Use localstorage for most data but still use cookie for COOKIE_PERSISTED_PROPERTIES
// This solves issues with cookies having too much data in them causing headers too large
// Also makes sure we don't have to send a ton of data to the server
const COOKIE_PERSISTED_PROPERTIES = [DISTINCT_ID, SESSION_ID, SESSION_RECORDING_IS_SAMPLED]

export const localPlusCookieStore: PersistentStore = {
    ...localStore,
    parse: function (name) {
        try {
            let extend: Properties = {}
            try {
                // See if there's a cookie stored with data.
                extend = cookieStore.parse(name) || {}
            } catch (err) {}
            const value = _extend(extend, JSON.parse(localStore.get(name) || '{}'))
            localStore.set(name, value)
            return value
        } catch (err) {
            // noop
        }
        return null
    },

    set: function (name, value, days, cross_subdomain, is_secure) {
        try {
            localStore.set(name, value)
            const cookiePersistedProperties: Record<string, any> = {}
            COOKIE_PERSISTED_PROPERTIES.forEach((key) => {
                if (value[key]) {
                    cookiePersistedProperties[key] = value[key]
                }
            })

            if (Object.keys(cookiePersistedProperties).length) {
                cookieStore.set(name, cookiePersistedProperties, days, cross_subdomain, is_secure)
            }
        } catch (err) {
            localStore.error(err)
        }
    },

    remove: function (name, cross_subdomain) {
        try {
            window.localStorage.removeItem(name)
            cookieStore.remove(name, cross_subdomain)
        } catch (err) {
            localStore.error(err)
        }
    },
}

const memoryStorage: Properties = {}

// Storage that only lasts the length of the pageview if we don't want to use cookies
export const memoryStore: PersistentStore = {
    is_supported: function () {
        return true
    },

    error: function (msg) {
        logger.error('memoryStorage error: ' + msg)
    },

    get: function (name) {
        return memoryStorage[name] || null
    },

    parse: function (name) {
        return memoryStorage[name] || null
    },

    set: function (name, value) {
        memoryStorage[name] = value
    },

    remove: function (name) {
        delete memoryStorage[name]
    },
}

let sessionStorageSupported: boolean | null = null
export const resetSessionStorageSupported = () => {
    sessionStorageSupported = null
}
// Storage that only lasts the length of a tab/window. Survives page refreshes
export const sessionStore: PersistentStore = {
    is_supported: function () {
        if (!_isNull(sessionStorageSupported)) {
            return sessionStorageSupported
        }
        sessionStorageSupported = true
        if (!_isUndefined(window)) {
            try {
                const key = '__support__',
                    val = 'xyz'
                sessionStore.set(key, val)
                if (sessionStore.get(key) !== '"xyz"') {
                    sessionStorageSupported = false
                }
                sessionStore.remove(key)
            } catch (err) {
                sessionStorageSupported = false
            }
        } else {
            sessionStorageSupported = false
        }
        return sessionStorageSupported
    },

    error: function (msg) {
        logger.error('sessionStorage error: ', msg)
    },

    get: function (name) {
        try {
            return window.sessionStorage.getItem(name)
        } catch (err) {
            sessionStore.error(err)
        }
        return null
    },

    parse: function (name) {
        try {
            return JSON.parse(sessionStore.get(name)) || null
        } catch (err) {
            // noop
        }
        return null
    },

    set: function (name, value) {
        try {
            window.sessionStorage.setItem(name, JSON.stringify(value))
        } catch (err) {
            sessionStore.error(err)
        }
    },

    remove: function (name) {
        try {
            window.sessionStorage.removeItem(name)
        } catch (err) {
            sessionStore.error(err)
        }
    },
}
