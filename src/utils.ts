import Config from './config'
import { Breaker, EventHandler, Properties } from './types'

/*
 * Saved references to long variable names, so that closure compiler can
 * minimize file size.
 */

const ArrayProto = Array.prototype
const ObjProto = Object.prototype
const toString = ObjProto.toString
const hasOwnProperty = ObjProto.hasOwnProperty
const win: Window & typeof globalThis = typeof window !== 'undefined' ? window : ({} as typeof window)
const navigator = win.navigator || { userAgent: '' }
const document = win.document || {}
const userAgent = navigator.userAgent
const localDomains = ['localhost', '127.0.0.1']

const nativeForEach = ArrayProto.forEach,
    nativeIndexOf = ArrayProto.indexOf,
    nativeIsArray = Array.isArray,
    breaker: Breaker = {}

// Console override
const logger = {
    /** @type {function(...*)} */
    log: function (...args: any[]) {
        if (Config.DEBUG && !_isUndefined(window.console) && window.console) {
            // Don't log PostHog debug messages in rrweb
            const log =
                '__rrweb_original__' in window.console.log
                    ? (window.console.log as any)['__rrweb_original__']
                    : window.console.log

            try {
                log.apply(window.console, args)
            } catch (err) {
                _eachArray(args, function (arg) {
                    log(arg)
                })
            }
        }
    },
    /** @type {function(...*)} */
    error: function (..._args: any[]) {
        if (Config.DEBUG && !_isUndefined(window.console) && window.console) {
            const args = ['PostHog error:', ..._args]
            // Don't log PostHog debug messages in rrweb
            const error =
                '__rrweb_original__' in window.console.error
                    ? (window.console.error as any)['__rrweb_original__']
                    : window.console.error
            try {
                error.apply(window.console, args)
            } catch (err) {
                _eachArray(args, function (arg) {
                    error(arg)
                })
            }
        }
    },
    /** @type {function(...*)} */
    critical: function (..._args: any[]) {
        if (!_isUndefined(window.console) && window.console) {
            const args = ['PostHog error:', ..._args]
            // Don't log PostHog debug messages in rrweb
            const error =
                '__rrweb_original__' in window.console.error
                    ? (window.console.error as any)['__rrweb_original__']
                    : window.console.error
            try {
                error.apply(window.console, args)
            } catch (err) {
                _eachArray(args, function (arg) {
                    error(arg)
                })
            }
        }
    },
}

// UNDERSCORE
// Embed part of the Underscore Library
export const _trim = function (str: string): string {
    return str.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '')
}

export const _bind_instance_methods = function (obj: Record<string, any>): void {
    for (const func in obj) {
        if (typeof obj[func] === 'function') {
            obj[func] = obj[func].bind(obj)
        }
    }
}

/**
 * @param {*=} obj
 * @param {function(...*)=} iterator
 * @param {Object=} thisArg
 */
export function _each(obj: any, iterator: (value: any, key: any) => void | Breaker, thisArg?: any): void {
    if (obj === null || obj === undefined) {
        return
    }
    if (nativeForEach && Array.isArray(obj) && obj.forEach === nativeForEach) {
        obj.forEach(iterator, thisArg)
    } else if ('length' in obj && obj.length === +obj.length) {
        for (let i = 0, l = obj.length; i < l; i++) {
            if (i in obj && iterator.call(thisArg, obj[i], i) === breaker) {
                return
            }
        }
    } else {
        for (const key in obj) {
            if (hasOwnProperty.call(obj, key)) {
                if (iterator.call(thisArg, obj[key], key) === breaker) {
                    return
                }
            }
        }
    }
}

export function _eachArray<E = any>(
    obj: E[] | null | undefined,
    iterator: (value: E, key: number) => void | Breaker,
    thisArg?: any
): void {
    if (Array.isArray(obj)) {
        if (nativeForEach && obj.forEach === nativeForEach) {
            obj.forEach(iterator, thisArg)
        } else if ('length' in obj && obj.length === +obj.length) {
            for (let i = 0, l = obj.length; i < l; i++) {
                if (i in obj && iterator.call(thisArg, obj[i], i) === breaker) {
                    return
                }
            }
        }
    }
}

export const _extend = function (obj: Record<string, any>, ...args: Record<string, any>[]): Record<string, any> {
    _eachArray(args, function (source) {
        for (const prop in source) {
            if (source[prop] !== void 0) {
                obj[prop] = source[prop]
            }
        }
    })
    return obj
}

export const _isArray =
    nativeIsArray ||
    function (obj: any): obj is any[] {
        return toString.call(obj) === '[object Array]'
    }

// from a comment on http://dbj.org/dbj/?p=286
// fails on only one very rare and deliberate custom object:
// let bomb = { toString : undefined, valueOf: function(o) { return "function BOMBA!"; }};
export const _isFunction = function (f: any): f is (...args: any[]) => any {
    try {
        return /^\s*\bfunction\b/.test(f)
    } catch (x) {
        return false
    }
}

export const _include = function (
    obj: null | string | Array<any> | Record<string, any>,
    target: any
): boolean | Breaker {
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
        return
    })
    return found
}

export function _includes<T = any>(str: T[] | string, needle: T): boolean {
    return (str as any).indexOf(needle) !== -1
}

/**
 * Object.entries() polyfill
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/entries
 */
export function _entries<T = any>(obj: Record<string, T>): [string, T][] {
    const ownProps = Object.keys(obj)
    let i = ownProps.length
    const resArray = new Array(i) // preallocate the Array

    while (i--) {
        resArray[i] = [ownProps[i], obj[ownProps[i]]]
    }
    return resArray
}

// Underscore Addons
export const _isObject = function (obj: any): obj is Record<string, any> {
    return obj === Object(obj) && !_isArray(obj)
}

export const _isEmptyObject = function (obj: any): obj is Record<string, any> {
    if (_isObject(obj)) {
        for (const key in obj) {
            if (hasOwnProperty.call(obj, key)) {
                return false
            }
        }
        return true
    }
    return false
}

export const _isUndefined = function (obj: any): obj is undefined {
    return obj === void 0
}

export const _isString = function (obj: any): obj is string {
    return toString.call(obj) == '[object String]'
}

export const _isDate = function (obj: any): obj is Date {
    return toString.call(obj) == '[object Date]'
}

export const _isNumber = function (obj: any): obj is number {
    return toString.call(obj) == '[object Number]'
}

export const _encodeDates = function (obj: Properties): Properties {
    _each(obj, function (v, k) {
        if (_isDate(v)) {
            obj[k] = _formatDate(v)
        } else if (_isObject(v)) {
            obj[k] = _encodeDates(v) // recurse
        }
    })
    return obj
}

export const _timestamp = function (): number {
    Date.now =
        Date.now ||
        function () {
            return +new Date()
        }
    return Date.now()
}

export const _formatDate = function (d: Date): string {
    // YYYY-MM-DDTHH:MM:SS in UTC
    function pad(n: number) {
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

export const _safewrap = function <F extends (...args: any[]) => any = (...args: any[]) => any>(f: F): F {
    return function (...args) {
        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            return f.apply(this, args)
        } catch (e) {
            logger.critical('Implementation error. Please turn on debug and contact support@posthog.com.')
            logger.critical(e)
        }
    } as F
}

// eslint-disable-next-line @typescript-eslint/ban-types
export const _safewrap_class = function (klass: Function, functions: string[]): void {
    for (let i = 0; i < functions.length; i++) {
        klass.prototype[functions[i]] = _safewrap(klass.prototype[functions[i]])
    }
}

export const _safewrap_instance_methods = function (obj: Record<string, any>): void {
    for (const func in obj) {
        if (typeof obj[func] === 'function') {
            obj[func] = _safewrap(obj[func])
        }
    }
}

export const _strip_empty_properties = function (p: Properties): Properties {
    const ret: Properties = {}
    _each(p, function (v, k) {
        if (_isString(v) && v.length > 0) {
            ret[k] = v
        }
    })
    return ret
}

/**
 * Deep copies an object.
 * It handles cycles by replacing all references to them with `undefined`
 * Also supports customizing native values
 *
 * @param value
 * @param customizer
 * @returns {{}|undefined|*}
 */
function deepCircularCopy<T extends Record<string, any> = Record<string, any>>(
    value: T,
    customizer?: <K extends keyof T = keyof T>(value: T[K], key?: K) => T[K]
): T | undefined {
    const COPY_IN_PROGRESS_SET = new Set()

    function internalDeepCircularCopy(value: T, key?: string): T | undefined {
        if (value !== Object(value)) return customizer ? customizer(value as any, key) : value // primitive value

        if (COPY_IN_PROGRESS_SET.has(value)) return undefined
        COPY_IN_PROGRESS_SET.add(value)
        let result: T

        if (_isArray(value)) {
            result = [] as any as T
            _eachArray(value, (it) => {
                result.push(internalDeepCircularCopy(it))
            })
        } else {
            result = {} as T
            _each(value, (val, key) => {
                if (!COPY_IN_PROGRESS_SET.has(val)) {
                    ;(result as any)[key] = internalDeepCircularCopy(val, key)
                }
            })
        }
        return result
    }
    return internalDeepCircularCopy(value)
}

const LONG_STRINGS_ALLOW_LIST = ['$performance_raw']

export function _copyAndTruncateStrings<T extends Record<string, any> = Record<string, any>>(
    object: T,
    maxStringLength: number | null
): T {
    return deepCircularCopy(object, (value: any, key) => {
        if (key && LONG_STRINGS_ALLOW_LIST.indexOf(key as string) > -1) {
            return value
        }
        if (typeof value === 'string' && maxStringLength !== null) {
            return (value as string).slice(0, maxStringLength)
        }
        return value
    }) as T
}

export function _base64Encode(data: null): null
export function _base64Encode(data: undefined): undefined
export function _base64Encode(data: string): string
export function _base64Encode(data: string | null | undefined): string | null | undefined {
    const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
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
        enc = ''
    const tmp_arr: string[] = []

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
        const c1 = string.charCodeAt(n)
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
    const T = function () {
        const d = new Date().valueOf()
        let i = 0

        // this while loop figures how many browser ticks go by
        // before 1*new Date() returns a new number, ie the amount
        // of ticks that go by per millisecond
        while (d == new Date().valueOf()) {
            i++
        }

        return d.toString(16) + i.toString(16)
    }

    // Math.Random entropy
    const R = function () {
        return Math.random().toString(16).replace('.', '')
    }

    // User agent entropy
    // This function takes the user agent string, and then xors
    // together each sequence of 8 bytes.  This produces a final
    // sequence of 8 bytes which it returns as hex.
    const UA = function () {
        const ua = userAgent
        let i,
            ch,
            ret = 0,
            buffer: number[] = []

        function xor(result: number, byte_array: number[]) {
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
        const se = typeof window !== 'undefined' ? (window.screen.height * window.screen.width).toString(16) : '0'
        return T() + '-' + R() + '-' + UA() + '-' + se + '-' + T()
    }
})()

// _.isBlockedUA()
// This is to block various web spiders from executing our JS and
// sending false capturing data
export const _isBlockedUA = function (ua: string): boolean {
    if (
        /(google web preview|baiduspider|yandexbot|bingbot|googlebot|yahoo! slurp|ahrefsbot|facebookexternalhit|facebookcatalog|applebot|semrushbot|duckduckbot|twitterbot|rogerbot|linkedinbot|mj12bot|sitebulb|bot.htm|bot.php|hubspot|crawler)/i.test(
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
export const _HTTPBuildQuery = function (formdata: Record<string, any>, arg_separator = '&'): string {
    let use_val: string
    let use_key: string
    const tph_arr: string[] = []

    _each(formdata, function (val, key) {
        use_val = encodeURIComponent(val.toString())
        use_key = encodeURIComponent(key)
        tph_arr[tph_arr.length] = use_key + '=' + use_val
    })

    return tph_arr.join(arg_separator)
}

export const _getQueryParam = function (url: string, param: string): string {
    // Expects a raw URL

    const cleanParam = param.replace(/[[]/, '\\[').replace(/[\]]/, '\\]')
    const regexS = '[\\?&]' + cleanParam + '=([^&#]*)'
    const regex = new RegExp(regexS)
    const results = regex.exec(url)
    if (results === null || (results && typeof results[1] !== 'string' && (results[1] as any).length)) {
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

export const _getHashParam = function (hash: string, param: string): string | null {
    const matches = hash.match(new RegExp(param + '=([^&]*)'))
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
    const register_event = function (
        element: Element | Window | Document | Node,
        type: string,
        handler: EventHandler,
        oldSchool?: boolean,
        useCapture?: boolean
    ) {
        if (!element) {
            logger.error('No valid element provided to register_event')
            return
        }

        if (element.addEventListener && !oldSchool) {
            element.addEventListener(type, handler, !!useCapture)
        } else {
            const ontype = 'on' + type
            const old_handler = (element as any)[ontype] // can be undefined
            ;(element as any)[ontype] = makeHandler(element, handler, old_handler)
        }
    }

    function makeHandler(
        element: Element | Window | Document | Node,
        new_handler: EventHandler,
        old_handlers: EventHandler
    ) {
        return function (event: Event): boolean | void {
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
            let old_result: any

            if (_isFunction(old_handlers)) {
                old_result = old_handlers(event)
            }
            const new_result = new_handler.call(element, event)

            if (false === old_result || false === new_result) {
                ret = false
            }

            return ret
        }
    }

    function fixEvent(event: Event | undefined): Event | undefined {
        if (event) {
            event.preventDefault = fixEvent.preventDefault
            event.stopPropagation = fixEvent.stopPropagation
        }
        return event
    }
    fixEvent.preventDefault = function () {
        ;(this as any as Event).returnValue = false
    }
    fixEvent.stopPropagation = function () {
        ;(this as any as Event).cancelBubble = true
    }

    return register_event
})()

export const isLocalhost = (): boolean => {
    return localDomains.includes(location.hostname)
}

export function loadScript(scriptUrlToLoad: string, callback: (error?: string | Event, event?: Event) => void): void {
    const addScript = () => {
        const scriptTag = document.createElement('script')
        scriptTag.type = 'text/javascript'
        scriptTag.src = scriptUrlToLoad
        scriptTag.onload = (event) => callback(undefined, event)
        scriptTag.onerror = (error) => callback(error)

        const scripts = document.querySelectorAll('body > script')
        if (scripts.length > 0) {
            scripts[0].parentNode?.insertBefore(scriptTag, scripts[0])
        } else {
            // In exceptional situations this call might load before the DOM is fully ready.
            document.body.appendChild(scriptTag)
        }
    }

    if (document.body) {
        addScript()
    } else {
        document.addEventListener('DOMContentLoaded', addScript)
    }
}

export const _info = {
    campaignParams: function (customParams?: string[]): Record<string, any> {
        const campaign_keywords = [
            'utm_source',
            'utm_medium',
            'utm_campaign',
            'utm_content',
            'utm_term',
            'gclid',
            'fbclid',
            'msclkid',
        ].concat(customParams || [])

        const params: Record<string, any> = {}
        _each(campaign_keywords, function (kwkey) {
            const kw = _getQueryParam(document.URL, kwkey)
            if (kw.length) {
                params[kwkey] = kw
            }
        })

        return params
    },

    searchEngine: function (): string | null {
        const referrer = document.referrer
        if (!referrer) {
            return null
        } else if (referrer.search('https?://(.*)google.([^/?]*)') === 0) {
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

    searchInfo: function (): Record<string, any> {
        const search = _info.searchEngine(),
            param = search != 'yahoo' ? 'q' : 'p',
            ret: Record<string, any> = {}

        if (search !== null) {
            ret['$search_engine'] = search

            const keyword = _getQueryParam(document.referrer, param)
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
    browser: function (user_agent: string, vendor: string, opera?: any): string {
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
    browserVersion: function (userAgent: string, vendor: string, opera: string): number | null {
        const browser = _info.browser(userAgent, vendor, opera)
        const versionRegexs = {
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
        const regex: RegExp | undefined = versionRegexs[browser as keyof typeof versionRegexs]
        if (regex === undefined) {
            return null
        }
        const matches = userAgent.match(regex)
        if (!matches) {
            return null
        }
        return parseFloat(matches[matches.length - 2])
    },

    browserLanguage: function (): string {
        return (
            navigator.language || // Any modern browser
            (navigator as Record<string, any>).userLanguage // IE11
        )
    },

    os: function (user_agent: string): { os_name: string; os_version: string } {
        if (/Windows/i.test(user_agent)) {
            if (/Phone/.test(user_agent) || /WPDesktop/.test(user_agent)) {
                return { os_name: 'Windows Phone', os_version: '' }
            }
            const match = /Windows NT ([0-9.]+)/i.exec(user_agent)
            if (match && match[1]) {
                const version = match[1]
                return { os_name: 'Windows', os_version: version }
            }
            return { os_name: 'Windows', os_version: '' }
        } else if (/(iPhone|iPad|iPod)/.test(user_agent)) {
            const match = /OS (\d+)_(\d+)_?(\d+)?/i.exec(user_agent)
            if (match && match[1]) {
                const versionParts = [match[1], match[2], match[3] || '0']
                return { os_name: 'iOS', os_version: versionParts.join('.') }
            }
            return { os_name: 'iOS', os_version: '' }
        } else if (/Android/.test(user_agent)) {
            const match = /Android (\d+)\.(\d+)\.?(\d+)?/i.exec(user_agent)
            if (match && match[1]) {
                const versionParts = [match[1], match[2], match[3] || '0']
                return { os_name: 'Android', os_version: versionParts.join('.') }
            }
            return { os_name: 'Android', os_version: '' }
        } else if (/(BlackBerry|PlayBook|BB10)/i.test(user_agent)) {
            return { os_name: 'BlackBerry', os_version: '' }
        } else if (/Mac/i.test(user_agent)) {
            const match = /Mac OS X (\d+)[_.](\d+)[_.]?(\d+)?/i.exec(user_agent)
            if (match && match[1]) {
                const versionParts = [match[1], match[2], match[3] || '0']
                return { os_name: 'Mac OS X', os_version: versionParts.join('.') }
            }
            return { os_name: 'Mac OS X', os_version: '' }
        } else if (/Linux/.test(user_agent)) {
            return { os_name: 'Linux', os_version: '' }
        } else if (/CrOS/.test(user_agent)) {
            return { os_name: 'Chrome OS', os_version: '' }
        } else {
            return { os_name: '', os_version: '' }
        }
    },

    device: function (user_agent: string): string {
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

    deviceType: function (user_agent: string): string {
        const device = this.device(user_agent)
        if (device === 'iPad' || device === 'Android Tablet') {
            return 'Tablet'
        } else if (device) {
            return 'Mobile'
        } else {
            return 'Desktop'
        }
    },

    referrer: function (): string {
        return document.referrer || '$direct'
    },

    referringDomain: function (): string {
        if (!document.referrer) {
            return '$direct'
        }
        const parser = document.createElement('a') // Unfortunately we cannot use new URL due to IE11
        parser.href = document.referrer
        return parser.host
    },

    properties: function (): Properties {
        const { os_name, os_version } = _info.os(userAgent)
        return _extend(
            _strip_empty_properties({
                $os: os_name,
                $os_version: os_version,
                $browser: _info.browser(userAgent, navigator.vendor, (win as any).opera),
                $device: _info.device(userAgent),
                $device_type: _info.deviceType(userAgent),
            }),
            {
                $current_url: win?.location.href,
                $host: win?.location.host,
                $pathname: win?.location.pathname,
                $browser_version: _info.browserVersion(userAgent, navigator.vendor, (win as any).opera),
                $browser_language: _info.browserLanguage(),
                $screen_height: win?.screen.height,
                $screen_width: win?.screen.width,
                $viewport_height: win?.innerHeight,
                $viewport_width: win?.innerWidth,
                $lib: 'web',
                $lib_version: Config.LIB_VERSION,
                $insert_id: Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10),
                $time: _timestamp() / 1000, // epoch time in seconds
            }
        )
    },

    people_properties: function (): Properties {
        const { os_name, os_version } = _info.os(userAgent)
        return _extend(
            _strip_empty_properties({
                $os: os_name,
                $os_version: os_version,
                $browser: _info.browser(userAgent, navigator.vendor, (win as any).opera),
            }),
            {
                $browser_version: _info.browserVersion(userAgent, navigator.vendor, (win as any).opera),
            }
        )
    },
}

export { win as window, userAgent, logger, document }
