import Config from './config'

/*
 * Saved references to long variable names, so that closure compiler can
 * minimize file size.
 */

const ArrayProto = Array.prototype,
    FuncProto = Function.prototype,
    ObjProto = Object.prototype,
    slice = ArrayProto.slice,
    toString = ObjProto.toString,
    hasOwnProperty = ObjProto.hasOwnProperty,
    win = typeof window !== 'undefined' ? window : {},
    navigator = win.navigator || { userAgent: '' },
    document = win.document || {},
    userAgent = navigator.userAgent

const nativeBind = FuncProto.bind,
    nativeForEach = ArrayProto.forEach,
    nativeIndexOf = ArrayProto.indexOf,
    nativeIsArray = Array.isArray,
    breaker = {}

// Console override
const logger = {
    /** @type {function(...*)} */
    log: function () {
        if (Config.DEBUG && !_isUndefined(window.console) && window.console) {
            // Don't log PostHog debug messages in rrweb
            const log = window.console.log['__rrweb_original__']
                ? window.console.log['__rrweb_original__']
                : window.console.log

            try {
                log.apply(window.console, arguments)
            } catch (err) {
                _each(arguments, function (arg) {
                    log(arg)
                })
            }
        }
    },
    /** @type {function(...*)} */
    error: function () {
        if (Config.DEBUG && !_isUndefined(window.console) && window.console) {
            let args = ['PostHog error:', ...arguments]
            // Don't log PostHog debug messages in rrweb
            const error = window.console.error['__rrweb_original__']
                ? window.console.error['__rrweb_original__']
                : window.console.error
            try {
                error.apply(window.console, args)
            } catch (err) {
                _each(args, function (arg) {
                    error(arg)
                })
            }
        }
    },
    /** @type {function(...*)} */
    critical: function () {
        if (!_isUndefined(window.console) && window.console) {
            let args = ['PostHog error:', ...arguments]
            // Don't log PostHog debug messages in rrweb
            const error = window.console.error['__rrweb_original__']
                ? window.console.error['__rrweb_original__']
                : window.console.error
            try {
                error.apply(window.console, args)
            } catch (err) {
                _each(args, function (arg) {
                    error(arg)
                })
            }
        }
    },
}

// UNDERSCORE
// Embed part of the Underscore Library
export const _trim = function (str) {
    return str.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '')
}

export const _bind = function (func, context) {
    let args, bound
    if (nativeBind && func.bind === nativeBind) {
        return nativeBind.apply(func, slice.call(arguments, 1))
    }
    if (!_isFunction(func)) {
        throw new TypeError()
    }
    args = slice.call(arguments, 2)
    bound = function () {
        if (!(this instanceof bound)) {
            return func.apply(context, args.concat(slice.call(arguments)))
        }
        const ctor = {}
        ctor.prototype = func.prototype
        const self = new ctor()
        ctor.prototype = null
        const result = func.apply(self, args.concat(slice.call(arguments)))
        if (Object(result) === result) {
            return result
        }
        return self
    }
    return bound
}

export const _bind_instance_methods = function (obj) {
    for (let func in obj) {
        if (typeof obj[func] === 'function') {
            obj[func] = _bind(obj[func], obj)
        }
    }
}

/**
 * @param {*=} obj
 * @param {function(...*)=} iterator
 * @param {Object=} context
 */
export const _each = function <V = any, O = Record<string, V> | V[], C = any>(
    obj: O,
    iterator: (value: V, key: O extends Record<string, V> ? keyof O : number) => void,
    context?: C
): void {
    if (obj === null || obj === undefined) {
        return
    }
    if (nativeForEach && 'forEach' in obj && obj.forEach === nativeForEach) {
        obj.forEach(iterator, context)
    } else if ('length' in obj && obj.length === +obj.length) {
        for (let i = 0, l = obj.length; i < l; i++) {
            if (i in obj && iterator.call(context, obj[i], i, obj) === breaker) {
                return
            }
        }
    } else {
        for (let key in obj) {
            if (hasOwnProperty.call(obj, key)) {
                if (iterator.call(context, obj[key], key, obj) === breaker) {
                    return
                }
            }
        }
    }
}

export const _extend = function (obj: Record<string, any>, ...args: Record<string, any>[]): Record<string, any> {
    _each(args, function (source) {
        for (let prop in source) {
            if (source[prop] !== void 0) {
                obj[prop] = source[prop]
            }
        }
    })
    return obj
}

export const _isArray =
    nativeIsArray ||
    function (obj) {
        return toString.call(obj) === '[object Array]'
    }

// from a comment on http://dbj.org/dbj/?p=286
// fails on only one very rare and deliberate custom object:
// let bomb = { toString : undefined, valueOf: function(o) { return "function BOMBA!"; }};
export const _isFunction = function (f) {
    try {
        return /^\s*\bfunction\b/.test(f)
    } catch (x) {
        return false
    }
}

export const _include = function (obj, target) {
    let found = false
    if (obj === null) {
        return found
    }
    if (nativeIndexOf && obj.indexOf === nativeIndexOf) {
        return obj.indexOf(target) != -1
    }
    _each(obj, function (value) {
        if (found || (found = value === target)) {
            return breaker
        }
    })
    return found
}

export const _includes = function (str, needle) {
    return str.indexOf(needle) !== -1
}

// Underscore Addons
export const _isObject = function (obj) {
    return obj === Object(obj) && !_isArray(obj)
}

export const _isEmptyObject = function (obj) {
    if (_isObject(obj)) {
        for (let key in obj) {
            if (hasOwnProperty.call(obj, key)) {
                return false
            }
        }
        return true
    }
    return false
}

export const _isUndefined = function (obj) {
    return obj === void 0
}

export const _isString = function (obj) {
    return toString.call(obj) == '[object String]'
}

export const _isDate = function (obj) {
    return toString.call(obj) == '[object Date]'
}

export const _isNumber = function (obj) {
    return toString.call(obj) == '[object Number]'
}

export const _encodeDates = function (obj) {
    _each(obj, function (v, k) {
        if (_isDate(v)) {
            obj[k] = _formatDate(v)
        } else if (_isObject(v)) {
            obj[k] = _encodeDates(v) // recurse
        }
    })
    return obj
}

export const _timestamp = function () {
    Date.now =
        Date.now ||
        function () {
            return +new Date()
        }
    return Date.now()
}

export const _formatDate = function (d) {
    // YYYY-MM-DDTHH:MM:SS in UTC
    function pad(n) {
        return n < 10 ? '0' + n : n
    }
    return (
        d.getUTCFullYear() +
        '-' +
        pad(d.getUTCMonth() + 1) +
        '-' +
        pad(d.getUTCDate()) +
        'T' +
        pad(d.getUTCHours()) +
        ':' +
        pad(d.getUTCMinutes()) +
        ':' +
        pad(d.getUTCSeconds())
    )
}

export const _safewrap = function (f) {
    return function () {
        try {
            return f.apply(this, arguments)
        } catch (e) {
            logger.critical('Implementation error. Please turn on debug and contact support@posthog.com.')
            if (Config.DEBUG) {
                logger.critical(e)
            }
        }
    }
}

export const _safewrap_class = function (klass, functions) {
    for (let i = 0; i < functions.length; i++) {
        klass.prototype[functions[i]] = _safewrap(klass.prototype[functions[i]])
    }
}

export const _safewrap_instance_methods = function (obj) {
    for (let func in obj) {
        if (typeof obj[func] === 'function') {
            obj[func] = _safewrap(obj[func])
        }
    }
}

export const _strip_empty_properties = function (p) {
    let ret = {}
    _each(p, function (v, k) {
        if (_isString(v) && v.length > 0) {
            ret[k] = v
        }
    })
    return ret
}

const COPY_IN_PROGRESS_ATTRIBUTE =
    typeof Symbol !== 'undefined' ? Symbol('__deepCircularCopyInProgress__') : '__deepCircularCopyInProgress__'

/**
 * Deep copies an object.
 * It handles cycles by replacing all references to them with `undefined`
 * Also supports customizing native values
 *
 * @param value
 * @param customizer
 * @param [key] if provided this is the object key associated with the value to be copied. It allows the customizer function to have context when it runs
 * @returns {{}|undefined|*}
 */
function deepCircularCopy(value, customizer, key) {
    if (value !== Object(value)) return customizer ? customizer(value, key) : value // primitive value

    if (value[COPY_IN_PROGRESS_ATTRIBUTE]) return undefined

    value[COPY_IN_PROGRESS_ATTRIBUTE] = true
    let result

    if (_isArray(value)) {
        result = []
        _each(value, (it) => {
            result.push(deepCircularCopy(it, customizer))
        })
    } else {
        result = {}
        _each(value, (val, key) => {
            if (key !== COPY_IN_PROGRESS_ATTRIBUTE) {
                result[key] = deepCircularCopy(val, customizer, key)
            }
        })
    }
    delete value[COPY_IN_PROGRESS_ATTRIBUTE]
    return result
}

const LONG_STRINGS_ALLOW_LIST = ['$performance_raw']

export const _copyAndTruncateStrings = (object, maxStringLength) =>
    deepCircularCopy(object, (value, key) => {
        if (key && LONG_STRINGS_ALLOW_LIST.indexOf(key) > -1) {
            return value
        }
        if (typeof value === 'string' && maxStringLength !== null) {
            value = value.slice(0, maxStringLength)
        }
        return value
    })

export const _base64Encode = function (data) {
    let b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
    let o1,
        o2,
        o3,
        h1,
        h2,
        h3,
        h4,
        bits,
        i = 0,
        ac = 0,
        enc = '',
        tmp_arr = []

    if (!data) {
        return data
    }

    data = _utf8Encode(data)

    do {
        // pack three octets into four hexets
        o1 = data.charCodeAt(i++)
        o2 = data.charCodeAt(i++)
        o3 = data.charCodeAt(i++)

        bits = (o1 << 16) | (o2 << 8) | o3

        h1 = (bits >> 18) & 0x3f
        h2 = (bits >> 12) & 0x3f
        h3 = (bits >> 6) & 0x3f
        h4 = bits & 0x3f

        // use hexets to index into b64, and append result to encoded string
        tmp_arr[ac++] = b64.charAt(h1) + b64.charAt(h2) + b64.charAt(h3) + b64.charAt(h4)
    } while (i < data.length)

    enc = tmp_arr.join('')

    switch (data.length % 3) {
        case 1:
            enc = enc.slice(0, -2) + '=='
            break
        case 2:
            enc = enc.slice(0, -1) + '='
            break
    }

    return enc
}

export const _utf8Encode = function (string: string): string {
    string = (string + '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

    let utftext = '',
        start,
        end
    let stringl = 0,
        n

    start = end = 0
    stringl = string.length

    for (n = 0; n < stringl; n++) {
        let c1 = string.charCodeAt(n)
        let enc = null

        if (c1 < 128) {
            end++
        } else if (c1 > 127 && c1 < 2048) {
            enc = String.fromCharCode((c1 >> 6) | 192, (c1 & 63) | 128)
        } else {
            enc = String.fromCharCode((c1 >> 12) | 224, ((c1 >> 6) & 63) | 128, (c1 & 63) | 128)
        }
        if (enc !== null) {
            if (end > start) {
                utftext += string.substring(start, end)
            }
            utftext += enc
            start = end = n + 1
        }
    }

    if (end > start) {
        utftext += string.substring(start, string.length)
    }

    return utftext
}

export const _UUID = (function () {
    // Time/ticks information
    // 1*new Date() is a cross browser version of Date.now()
    let T = function () {
        let d = 1 * new Date(),
            i = 0

        // this while loop figures how many browser ticks go by
        // before 1*new Date() returns a new number, ie the amount
        // of ticks that go by per millisecond
        while (d == 1 * new Date()) {
            i++
        }

        return d.toString(16) + i.toString(16)
    }

    // Math.Random entropy
    let R = function () {
        return Math.random().toString(16).replace('.', '')
    }

    // User agent entropy
    // This function takes the user agent string, and then xors
    // together each sequence of 8 bytes.  This produces a final
    // sequence of 8 bytes which it returns as hex.
    let UA = function () {
        let ua = userAgent,
            i,
            ch,
            buffer = [],
            ret = 0

        function xor(result, byte_array) {
            let j,
                tmp = 0
            for (j = 0; j < byte_array.length; j++) {
                tmp |= buffer[j] << (j * 8)
            }
            return result ^ tmp
        }

        for (i = 0; i < ua.length; i++) {
            ch = ua.charCodeAt(i)
            buffer.unshift(ch & 0xff)
            if (buffer.length >= 4) {
                ret = xor(ret, buffer)
                buffer = []
            }
        }

        if (buffer.length > 0) {
            ret = xor(ret, buffer)
        }

        return ret.toString(16)
    }

    return function () {
        let se = (window.screen.height * window.screen.width).toString(16)
        return T() + '-' + R() + '-' + UA() + '-' + se + '-' + T()
    }
})()

// _.isBlockedUA()
// This is to block various web spiders from executing our JS and
// sending false captureing data
export const _isBlockedUA = function (ua) {
    if (
        /(google web preview|baiduspider|yandexbot|bingbot|googlebot|yahoo! slurp|ahrefsbot|facebookexternalhit|facebookcatalog)/i.test(
            ua
        )
    ) {
        return true
    }
    return false
}

/**
 * @param {Object=} formdata
 * @param {string=} arg_separator
 */
export const _HTTPBuildQuery = function (formdata, arg_separator) {
    let use_val,
        use_key,
        tph_arr = []

    if (_isUndefined(arg_separator)) {
        arg_separator = '&'
    }

    _each(formdata, function (val, key) {
        use_val = encodeURIComponent(val.toString())
        use_key = encodeURIComponent(key)
        tph_arr[tph_arr.length] = use_key + '=' + use_val
    })

    return tph_arr.join(arg_separator)
}

export const _getQueryParam = function (url, param) {
    // Expects a raw URL

    param = param.replace(/[[]/, '\\[').replace(/[\]]/, '\\]')
    let regexS = '[\\?&]' + param + '=([^&#]*)',
        regex = new RegExp(regexS),
        results = regex.exec(url)
    if (results === null || (results && typeof results[1] !== 'string' && results[1].length)) {
        return ''
    } else {
        let result = results[1]
        try {
            result = decodeURIComponent(result)
        } catch (err) {
            logger.error('Skipping decoding for malformed query param: ' + result)
        }
        return result.replace(/\+/g, ' ')
    }
}

export const _getHashParam = function (hash, param) {
    let matches = hash.match(new RegExp(param + '=([^&]*)'))
    return matches ? matches[1] : null
}

export const _register_event = (function () {
    // written by Dean Edwards, 2005
    // with input from Tino Zijdel - crisp@xs4all.nl
    // with input from Carl Sverre - mail@carlsverre.com
    // with input from PostHog
    // http://dean.edwards.name/weblog/2005/10/add-event/
    // https://gist.github.com/1930440

    /**
     * @param {Object} element
     * @param {string} type
     * @param {function(...*)} handler
     * @param {boolean=} oldSchool
     * @param {boolean=} useCapture
     */
    let register_event = function (element, type, handler, oldSchool, useCapture) {
        if (!element) {
            logger.error('No valid element provided to register_event')
            return
        }

        if (element.addEventListener && !oldSchool) {
            element.addEventListener(type, handler, !!useCapture)
        } else {
            let ontype = 'on' + type
            let old_handler = element[ontype] // can be undefined
            element[ontype] = makeHandler(element, handler, old_handler)
        }
    }

    function makeHandler(element, new_handler, old_handlers) {
        let handler = function (event) {
            event = event || fixEvent(window.event)

            // this basically happens in firefox whenever another script
            // overwrites the onload callback and doesn't pass the event
            // object to previously defined callbacks.  All the browsers
            // that don't define window.event implement addEventListener
            // so the dom_loaded handler will still be fired as usual.
            if (!event) {
                return undefined
            }

            let ret = true
            let old_result, new_result

            if (_isFunction(old_handlers)) {
                old_result = old_handlers(event)
            }
            new_result = new_handler.call(element, event)

            if (false === old_result || false === new_result) {
                ret = false
            }

            return ret
        }

        return handler
    }

    function fixEvent(event) {
        if (event) {
            event.preventDefault = fixEvent.preventDefault
            event.stopPropagation = fixEvent.stopPropagation
        }
        return event
    }
    fixEvent.preventDefault = function () {
        this.returnValue = false
    }
    fixEvent.stopPropagation = function () {
        this.cancelBubble = true
    }

    return register_event
})()

export const _info = {
    campaignParams: function () {
        const campaign_keywords = 'utm_source utm_medium utm_campaign utm_content utm_term gclid fbclid msclkid'.split(
            ' '
        )
        const params = {}
        _each(campaign_keywords, function (kwkey) {
            let kw = _getQueryParam(document.URL, kwkey)
            if (kw.length) {
                params[kwkey] = kw
            }
        })

        return params
    },

    searchEngine: function (referrer) {
        if (referrer.search('https?://(.*)google.([^/?]*)') === 0) {
            return 'google'
        } else if (referrer.search('https?://(.*)bing.com') === 0) {
            return 'bing'
        } else if (referrer.search('https?://(.*)yahoo.com') === 0) {
            return 'yahoo'
        } else if (referrer.search('https?://(.*)duckduckgo.com') === 0) {
            return 'duckduckgo'
        } else {
            return null
        }
    },

    searchInfo: function (referrer) {
        let search = _info.searchEngine(referrer),
            param = search != 'yahoo' ? 'q' : 'p',
            ret = {}

        if (search !== null) {
            ret['$search_engine'] = search

            let keyword = _getQueryParam(referrer, param)
            if (keyword.length) {
                ret['ph_keyword'] = keyword
            }
        }

        return ret
    },

    /**
     * This function detects which browser is running this script.
     * The order of the checks are important since many user agents
     * include key words used in later checks.
     */
    browser: function (user_agent, vendor, opera) {
        vendor = vendor || '' // vendor is undefined for at least IE9
        if (opera || _includes(user_agent, ' OPR/')) {
            if (_includes(user_agent, 'Mini')) {
                return 'Opera Mini'
            }
            return 'Opera'
        } else if (/(BlackBerry|PlayBook|BB10)/i.test(user_agent)) {
            return 'BlackBerry'
        } else if (_includes(user_agent, 'IEMobile') || _includes(user_agent, 'WPDesktop')) {
            return 'Internet Explorer Mobile'
        } else if (_includes(user_agent, 'SamsungBrowser/')) {
            // https://developer.samsung.com/internet/user-agent-string-format
            return 'Samsung Internet'
        } else if (_includes(user_agent, 'Edge') || _includes(user_agent, 'Edg/')) {
            return 'Microsoft Edge'
        } else if (_includes(user_agent, 'FBIOS')) {
            return 'Facebook Mobile'
        } else if (_includes(user_agent, 'Chrome')) {
            return 'Chrome'
        } else if (_includes(user_agent, 'CriOS')) {
            return 'Chrome iOS'
        } else if (_includes(user_agent, 'UCWEB') || _includes(user_agent, 'UCBrowser')) {
            return 'UC Browser'
        } else if (_includes(user_agent, 'FxiOS')) {
            return 'Firefox iOS'
        } else if (_includes(vendor, 'Apple')) {
            if (_includes(user_agent, 'Mobile')) {
                return 'Mobile Safari'
            }
            return 'Safari'
        } else if (_includes(user_agent, 'Android')) {
            return 'Android Mobile'
        } else if (_includes(user_agent, 'Konqueror')) {
            return 'Konqueror'
        } else if (_includes(user_agent, 'Firefox')) {
            return 'Firefox'
        } else if (_includes(user_agent, 'MSIE') || _includes(user_agent, 'Trident/')) {
            return 'Internet Explorer'
        } else if (_includes(user_agent, 'Gecko')) {
            return 'Mozilla'
        } else {
            return ''
        }
    },

    /**
     * This function detects which browser version is running this script,
     * parsing major and minor version (e.g., 42.1). User agent strings from:
     * http://www.useragentstring.com/pages/useragentstring.php
     */
    browserVersion: function (userAgent, vendor, opera) {
        let browser = _info.browser(userAgent, vendor, opera)
        let versionRegexs = {
            'Internet Explorer Mobile': /rv:(\d+(\.\d+)?)/,
            'Microsoft Edge': /Edge?\/(\d+(\.\d+)?)/,
            Chrome: /Chrome\/(\d+(\.\d+)?)/,
            'Chrome iOS': /CriOS\/(\d+(\.\d+)?)/,
            'UC Browser': /(UCBrowser|UCWEB)\/(\d+(\.\d+)?)/,
            Safari: /Version\/(\d+(\.\d+)?)/,
            'Mobile Safari': /Version\/(\d+(\.\d+)?)/,
            Opera: /(Opera|OPR)\/(\d+(\.\d+)?)/,
            Firefox: /Firefox\/(\d+(\.\d+)?)/,
            'Firefox iOS': /FxiOS\/(\d+(\.\d+)?)/,
            Konqueror: /Konqueror:(\d+(\.\d+)?)/,
            BlackBerry: /BlackBerry (\d+(\.\d+)?)/,
            'Android Mobile': /android\s(\d+(\.\d+)?)/,
            'Samsung Internet': /SamsungBrowser\/(\d+(\.\d+)?)/,
            'Internet Explorer': /(rv:|MSIE )(\d+(\.\d+)?)/,
            Mozilla: /rv:(\d+(\.\d+)?)/,
        }
        let regex = versionRegexs[browser]
        if (regex === undefined) {
            return null
        }
        let matches = userAgent.match(regex)
        if (!matches) {
            return null
        }
        return parseFloat(matches[matches.length - 2])
    },

    os: function () {
        let a = userAgent
        if (/Windows/i.test(a)) {
            if (/Phone/.test(a) || /WPDesktop/.test(a)) {
                return 'Windows Phone'
            }
            return 'Windows'
        } else if (/(iPhone|iPad|iPod)/.test(a)) {
            return 'iOS'
        } else if (/Android/.test(a)) {
            return 'Android'
        } else if (/(BlackBerry|PlayBook|BB10)/i.test(a)) {
            return 'BlackBerry'
        } else if (/Mac/i.test(a)) {
            return 'Mac OS X'
        } else if (/Linux/.test(a)) {
            return 'Linux'
        } else if (/CrOS/.test(a)) {
            return 'Chrome OS'
        } else {
            return ''
        }
    },

    device: function (user_agent) {
        if (/Windows Phone/i.test(user_agent) || /WPDesktop/.test(user_agent)) {
            return 'Windows Phone'
        } else if (/iPad/.test(user_agent)) {
            return 'iPad'
        } else if (/iPod/.test(user_agent)) {
            return 'iPod Touch'
        } else if (/iPhone/.test(user_agent)) {
            return 'iPhone'
        } else if (/(BlackBerry|PlayBook|BB10)/i.test(user_agent)) {
            return 'BlackBerry'
        } else if (/Android/.test(user_agent) && !/Mobile/.test(user_agent)) {
            return 'Android Tablet'
        } else if (/Android/.test(user_agent)) {
            return 'Android'
        } else {
            return ''
        }
    },

    deviceType: function (user_agent) {
        const device = this.device(user_agent)
        if (device === 'iPad' || device === 'Android Tablet') {
            return 'Tablet'
        } else if (device) {
            return 'Mobile'
        } else {
            return 'Desktop'
        }
    },

    referringDomain: function (referrer) {
        let split = referrer.split('/')
        if (split.length >= 3) {
            return split[2]
        }
        return ''
    },

    properties: function () {
        return _extend(
            _strip_empty_properties({
                $os: _info.os(),
                $browser: _info.browser(userAgent, navigator.vendor, window.opera),
                $device: _info.device(userAgent),
                $device_type: _info.deviceType(userAgent),
            }),
            {
                $current_url: window.location.href,
                $host: window.location.host,
                $pathname: window.location.pathname,
                $browser_version: _info.browserVersion(userAgent, navigator.vendor, window.opera),
                $screen_height: window.screen.height,
                $screen_width: window.screen.width,
                $viewport_height: window.innerHeight,
                $viewport_width: window.innerWidth,
                $lib: 'web',
                $lib_version: Config.LIB_VERSION,
                $insert_id: Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10),
                $time: _timestamp() / 1000, // epoch time in seconds
            }
        )
    },

    people_properties: function () {
        return _extend(
            _strip_empty_properties({
                $os: _info.os(),
                $browser: _info.browser(userAgent, navigator.vendor, window.opera),
            }),
            {
                $browser_version: _info.browserVersion(userAgent, navigator.vendor, window.opera),
            }
        )
    },
}

export { win as window, userAgent, logger, document }

// Exports For Test ONLY
export { COPY_IN_PROGRESS_ATTRIBUTE }
