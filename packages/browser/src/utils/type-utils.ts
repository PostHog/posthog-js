import { window } from './globals'

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

// Underscore Addons
export const isObject = (x: unknown): x is Record<string, any> => {
    // eslint-disable-next-line posthog-js/no-direct-object-check
    return x === Object(x) && !isArray(x)
}
export const isEmptyObject = (x: unknown) => {
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

// When angular patches functions they pass the above `isNativeFunction` check (at least the MutationObserver)
export const isAngularZonePresent = (): boolean => {
    return !!(window as any).Zone
}

export const isDocument = (x: unknown): x is Document => {
    // eslint-disable-next-line posthog-js/no-direct-document-check
    return x instanceof Document
}
