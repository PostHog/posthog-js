import { Breaker, EventHandler, Properties } from '../types'
import {
    _isArray,
    _isDate,
    _isFunction,
    _isNull,
    _isObject,
    _isString,
    _isUndefined,
    hasOwnProperty,
} from './type-utils'
import { logger } from './logger'
import { window, document, nativeForEach, nativeIndexOf } from './globals'

const breaker: Breaker = {}

// UNDERSCORE
// Embed part of the Underscore Library
export const _trim = function (str: string): string {
    return str.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '')
}

export const _bind_instance_methods = function (obj: Record<string, any>): void {
    for (const func in obj) {
        if (_isFunction(obj[func])) {
            obj[func] = obj[func].bind(obj)
        }
    }
}

export function _eachArray<E = any>(
    obj: E[] | null | undefined,
    iterator: (value: E, key: number) => void | Breaker,
    thisArg?: any
): void {
    if (_isArray(obj)) {
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

/**
 * @param {*=} obj
 * @param {function(...*)=} iterator
 * @param {Object=} thisArg
 */
export function _each(obj: any, iterator: (value: any, key: any) => void | Breaker, thisArg?: any): void {
    if (_isNull(obj) || _isUndefined(obj)) {
        return
    }
    if (_isArray(obj)) {
        return _eachArray(obj, iterator, thisArg)
    }
    for (const key in obj) {
        if (hasOwnProperty.call(obj, key)) {
            if (iterator.call(thisArg, obj[key], key) === breaker) {
                return
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

export const _include = function (
    obj: null | string | Array<any> | Record<string, any>,
    target: any
): boolean | Breaker {
    let found = false
    if (_isNull(obj)) {
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

export const _isValidRegex = function (str: string): boolean {
    try {
        new RegExp(str)
    } catch (error) {
        return false
    }
    return true
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

export const _try = function <T>(fn: () => T): T | undefined {
    try {
        return fn()
    } catch (e) {
        return undefined
    }
}

export const _safewrap = function <F extends (...args: any[]) => any = (...args: any[]) => any>(f: F): F {
    return function (...args) {
        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            return f.apply(this, args)
        } catch (e) {
            logger.critical(
                'Implementation error. Please turn on debug mode and open a ticket on https://app.posthog.com/home#panel=support%3Asupport%3A.'
            )
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
        if (_isFunction(obj[func])) {
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
        if (_isString(value) && !_isNull(maxStringLength)) {
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
        if (!_isNull(enc)) {
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
            event = event || fixEvent(window?.event)

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

export function loadScript(scriptUrlToLoad: string, callback: (error?: string | Event, event?: Event) => void): void {
    const addScript = () => {
        if (!document) {
            return callback('document not found')
        }
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

    if (document?.body) {
        addScript()
    } else {
        document?.addEventListener('DOMContentLoaded', addScript)
    }
}

export function isCrossDomainCookie(documentLocation: Location | undefined) {
    const hostname = documentLocation?.hostname

    if (!_isString(hostname)) {
        return false
    }
    // split and slice isn't a great way to match arbitrary domains,
    // but it's good enough for ensuring we only match herokuapp.com when it is the TLD
    // for the hostname
    return hostname.split('.').slice(-2).join('.') !== 'herokuapp.com'
}

export function isDistinctIdStringLike(value: string): boolean {
    return ['distinct_id', 'distinctid'].includes(value.toLowerCase())
}
