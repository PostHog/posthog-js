import { Breaker, EventHandler, Properties } from '../types'
import { hasOwnProperty, isArray, isFormData, isFunction, isNull, isNullish, isString } from './type-utils'
import { logger } from './logger'
import { nativeForEach, nativeIndexOf, window } from './globals'

const breaker: Breaker = {}

export function eachArray<E = any>(
    obj: E[] | null | undefined,
    iterator: (value: E, key: number) => void | Breaker,
    thisArg?: any
): void {
    if (isArray(obj)) {
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
export function each(obj: any, iterator: (value: any, key: any) => void | Breaker, thisArg?: any): void {
    if (isNullish(obj)) {
        return
    }
    if (isArray(obj)) {
        return eachArray(obj, iterator, thisArg)
    }
    if (isFormData(obj)) {
        for (const pair of obj.entries()) {
            if (iterator.call(thisArg, pair[1], pair[0]) === breaker) {
                return
            }
        }
        return
    }
    for (const key in obj) {
        if (hasOwnProperty.call(obj, key)) {
            if (iterator.call(thisArg, obj[key], key) === breaker) {
                return
            }
        }
    }
}

export const extend = function (obj: Record<string, any>, ...args: Record<string, any>[]): Record<string, any> {
    eachArray(args, function (source) {
        for (const prop in source) {
            if (source[prop] !== void 0) {
                obj[prop] = source[prop]
            }
        }
    })
    return obj
}

export const extendArray = function <T>(obj: T[], ...args: T[][]): T[] {
    eachArray(args, function (source) {
        eachArray(source, function (item) {
            obj.push(item)
        })
    })
    return obj
}

export const include = function (
    obj: null | string | Array<any> | Record<string, any>,
    target: any
): boolean | Breaker {
    let found = false
    if (isNull(obj)) {
        return found
    }
    if (nativeIndexOf && obj.indexOf === nativeIndexOf) {
        return obj.indexOf(target) != -1
    }
    each(obj, function (value) {
        if (found || (found = value === target)) {
            return breaker
        }
        return
    })
    return found
}

/**
 * Object.entries() polyfill
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/entries
 */
export function entries<T = any>(obj: Record<string, T>): [string, T][] {
    const ownProps = Object.keys(obj)
    let i = ownProps.length
    const resArray = new Array(i) // preallocate the Array

    while (i--) {
        resArray[i] = [ownProps[i], obj[ownProps[i]]]
    }
    return resArray
}

export const isValidRegex = function (str: string): boolean {
    try {
        new RegExp(str)
    } catch {
        return false
    }
    return true
}

export const trySafe = function <T>(fn: () => T): T | undefined {
    try {
        return fn()
    } catch {
        return undefined
    }
}

export const safewrap = function <F extends (...args: any[]) => any = (...args: any[]) => any>(f: F): F {
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

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const safewrapClass = function (klass: Function, functions: string[]): void {
    for (let i = 0; i < functions.length; i++) {
        klass.prototype[functions[i]] = safewrap(klass.prototype[functions[i]])
    }
}

export const stripEmptyProperties = function (p: Properties): Properties {
    const ret: Properties = {}
    each(p, function (v, k) {
        if (isString(v) && v.length > 0) {
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

        if (isArray(value)) {
            result = [] as any as T
            eachArray(value, (it) => {
                result.push(internalDeepCircularCopy(it))
            })
        } else {
            result = {} as T
            each(value, (val, key) => {
                if (!COPY_IN_PROGRESS_SET.has(val)) {
                    ;(result as any)[key] = internalDeepCircularCopy(val, key)
                }
            })
        }
        return result
    }
    return internalDeepCircularCopy(value)
}

export function _copyAndTruncateStrings<T extends Record<string, any> = Record<string, any>>(
    object: T,
    maxStringLength: number | null
): T {
    return deepCircularCopy(object, (value: any) => {
        if (isString(value) && !isNull(maxStringLength)) {
            return (value as string).slice(0, maxStringLength)
        }
        return value
    }) as T
}

export const registerEvent = (function () {
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

            if (isFunction(old_handlers)) {
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

export function isCrossDomainCookie(documentLocation: Location | undefined) {
    const hostname = documentLocation?.hostname

    if (!isString(hostname)) {
        return false
    }
    // split and slice isn't a great way to match arbitrary domains,
    // but it's good enough for ensuring we only match herokuapp.com when it is the TLD
    // for the hostname
    return hostname.split('.').slice(-2).join('.') !== 'herokuapp.com'
}

export function find<T>(value: T[], predicate: (value: T) => boolean): T | undefined {
    for (let i = 0; i < value.length; i++) {
        if (predicate(value[i])) {
            return value[i]
        }
    }
    return undefined
}
