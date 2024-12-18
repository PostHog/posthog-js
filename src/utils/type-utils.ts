import { window } from './globals'
import { knownUnsafeEditableEvent, KnownUnsafeEditableEvent } from '../types'
import { includes } from './string-utils'

// eslint-disable-next-line posthog-js/no-direct-array-check
const nativeIsArray = Array.isArray
const ObjProto = Object.prototype
export const hasOwnProperty = ObjProto.hasOwnProperty
const toString = ObjProto.toString

export const isArray =
    nativeIsArray ||
    function (obj: any): obj is any[] {
        return toString.call(obj) === '[object Array]'
    }

// from a comment on http://dbj.org/dbj/?p=286
// fails on only one very rare and deliberate custom object:
// let bomb = { toString : undefined, valueOf: function(o) { return "function BOMBA!"; }};
export const isFunction = (x: unknown): x is (...args: any[]) => any => {
    // eslint-disable-next-line posthog-js/no-direct-function-check
    return typeof x === 'function'
}

export const isNativeFunction = (x: unknown): x is (...args: any[]) => any =>
    isFunction(x) && x.toString().indexOf('[native code]') !== -1

// When angular patches functions they pass the above `isNativeFunction` check (at least the MutationObserver)
export const isAngularZonePresent = (): boolean => {
    return !!(window as any).Zone
}

// Underscore Addons
export const isObject = (x: unknown): x is Record<string, any> => {
    // eslint-disable-next-line posthog-js/no-direct-object-check
    return x === Object(x) && !isArray(x)
}
export const isEmptyObject = (x: unknown): x is Record<string, any> => {
    if (isObject(x)) {
        for (const key in x) {
            if (hasOwnProperty.call(x, key)) {
                return false
            }
        }
        return true
    }
    return false
}
export const isUndefined = (x: unknown): x is undefined => x === void 0

export const isString = (x: unknown): x is string => {
    // eslint-disable-next-line posthog-js/no-direct-string-check
    return toString.call(x) == '[object String]'
}

export const isEmptyString = (x: unknown): boolean => isString(x) && x.trim().length === 0

export const isNull = (x: unknown): x is null => {
    // eslint-disable-next-line posthog-js/no-direct-null-check
    return x === null
}

/*
    sometimes you want to check if something is null or undefined
    that's what this is for
 */
export const isNullish = (x: unknown): x is null | undefined => isUndefined(x) || isNull(x)

export const isNumber = (x: unknown): x is number => {
    // eslint-disable-next-line posthog-js/no-direct-number-check
    return toString.call(x) == '[object Number]'
}
export const isBoolean = (x: unknown): x is boolean => {
    // eslint-disable-next-line posthog-js/no-direct-boolean-check
    return toString.call(x) === '[object Boolean]'
}

export const isDocument = (x: unknown): x is Document => {
    // eslint-disable-next-line posthog-js/no-direct-document-check
    return x instanceof Document
}

export const isFormData = (x: unknown): x is FormData => {
    // eslint-disable-next-line posthog-js/no-direct-form-data-check
    return x instanceof FormData
}

export const isFile = (x: unknown): x is File => {
    // eslint-disable-next-line posthog-js/no-direct-file-check
    return x instanceof File
}

export const isKnownUnsafeEditableEvent = (x: unknown): x is KnownUnsafeEditableEvent => {
    return includes(knownUnsafeEditableEvent as unknown as string[], x)
}
