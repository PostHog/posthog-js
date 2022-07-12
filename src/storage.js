import { logger } from './utils'

var DOMAIN_MATCH_REGEX = /[a-z0-9][a-z0-9-]+\.[a-z.]{2,6}$/i

// Methods partially borrowed from quirksmode.org/js/cookies.html
export const cookieStore = {
    get: function (name) {
        try {
            var nameEQ = name + '='
            var ca = document.cookie.split(';')
            for (var i = 0; i < ca.length; i++) {
                var c = ca[i]
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
        var cookie
        try {
            cookie = JSON.parse(cookieStore.get(name)) || {}
        } catch (err) {
            // noop
        }
        return cookie
    },

    set: function (name, value, days, cross_subdomain, is_secure) {
        try {
            var cdomain = '',
                expires = '',
                secure = ''

            if (cross_subdomain) {
                var matches = document.location.hostname.match(DOMAIN_MATCH_REGEX),
                    domain = matches ? matches[0] : ''

                cdomain = domain ? '; domain=.' + domain : ''
            }

            if (days) {
                var date = new Date()
                date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000)
                expires = '; expires=' + date.toGMTString()
            }

            if (is_secure) {
                secure = '; secure'
            }

            var new_cookie_val =
                name + '=' + encodeURIComponent(JSON.stringify(value)) + expires + '; path=/' + cdomain + secure
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

var _localStorage_supported = null
export const localStore = {
    is_supported: function () {
        if (_localStorage_supported !== null) {
            return _localStorage_supported
        }

        var supported = true
        if (window) {
            try {
                var key = '__mplssupport__',
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

// Use localstorage for most data but still use cookie for distinct_id
// This solves issues with cookies having too much data in them causing headers too large
// Also makes sure we don't have to send a ton of data to the server
export const localPlusCookieStore = {
    ...localStore,
    parse: function (name) {
        try {
            let extend = {}
            try {
                // See if there's a cookie stored with data.
                extend = cookieStore.parse(name) || {}
                if (extend['distinct_id']) {
                    cookieStore.set(name, { distinct_id: extend['distinct_id'] })
                }
            } catch (err) {}
            const value = _extend(extend, JSON.parse(localStore.get(name) || '{}'))
            localStore.set(name, value)
            return value
        } catch (err) {
            // noop
        }
        return null
    },

    set: function (name, value) {
        try {
            localStore.set(name, value)
            if (value.distinct_id) {
                cookieStore.set(name, { distinct_id: value.distinct_id })
            }
        } catch (err) {
            localStore.error(err)
        }
    },

    remove: function (name) {
        try {
            window.localStorage.removeItem(name)
            cookieStore.remove(name)
        } catch (err) {
            localStore.error(err)
        }
    },
}

const memoryStorage = {}

// Storage that only lasts the length of the pageview if we don't want to use cookies
export const memoryStore = {
    is_supported: function () {
        return true
    },

    error: function (msg) {
        logger.error('memoryStorage error: ' + msg)
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

// Storage that only lasts the length of a tab/window. Survives page refreshes
export const sessionStore = {
    sessionStorageSupported: null,
    is_supported: function () {
        if (sessionStore.sessionStorageSupported !== null) {
            return sessionStore.sessionStorageSupported
        }
        sessionStore.sessionStorageSupported = true
        if (window) {
            try {
                let key = '__support__',
                    val = 'xyz'
                sessionStore.set(key, val)
                if (sessionStore.get(key) !== '"xyz"') {
                    sessionStore.sessionStorageSupported = false
                }
                sessionStore.remove(key)
            } catch (err) {
                sessionStore.sessionStorageSupported = false
            }
        } else {
            sessionStore.sessionStorageSupported = false
        }
        return sessionStore.sessionStorageSupported
    },
    error: function (msg) {
        if (Config.DEBUG) {
            logger.error('sessionStorage error: ', msg)
        }
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
