import { _, console } from './utils'

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
            cookie = _.JSONDecode(cookieStore.get(name)) || {}
        } catch (err) {
            // noop
        }
        return cookie
    },

    set_seconds: function (name, value, seconds, cross_subdomain, is_secure) {
        try {
            var cdomain = '',
                expires = '',
                secure = ''

            if (cross_subdomain) {
                var matches = document.location.hostname.match(DOMAIN_MATCH_REGEX),
                    domain = matches ? matches[0] : ''

                cdomain = domain ? '; domain=.' + domain : ''
            }

            if (seconds) {
                var date = new Date()
                date.setTime(date.getTime() + seconds * 1000)
                expires = '; expires=' + date.toGMTString()
            }

            if (is_secure) {
                secure = '; secure'
            }

            document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/' + cdomain + secure
        } catch (err) {
            return
        }
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

            var new_cookie_val = name + '=' + encodeURIComponent(value) + expires + '; path=/' + cdomain + secure
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
        try {
            var key = '__mplssupport__',
                val = 'xyz'
            localStore.set(key, val)
            if (localStore.get(key) !== val) {
                supported = false
            }
            localStore.remove(key)
        } catch (err) {
            supported = false
        }
        if (!supported) {
            console.error('localStorage unsupported; falling back to cookie store')
        }

        _localStorage_supported = supported
        return supported
    },

    error: function (msg) {
        console.error('localStorage error: ' + msg)
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
            return _.JSONDecode(localStore.get(name)) || {}
        } catch (err) {
            // noop
        }
        return null
    },

    set: function (name, value) {
        try {
            window.localStorage.setItem(name, value)
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

// Storage that only lasts the length of the pageview if we don't want to use cookies
export const memoryStore = {
    is_supported: function () {
        return true
    },

    error: function (msg) {
        console.error('localStorage error: ' + msg)
    },

    parse: function (name) {
        return disabledStorage[name] || null
    },

    set: function (name, value) {
        disabledStorage[name] = value
    },

    remove: function (name) {
        delete disabledStorage[name]
    },
}
