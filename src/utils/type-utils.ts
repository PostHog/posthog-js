// eslint-disable-next-line posthog-js/no-direct-array-check
const nativeIsArray = Array.isArray
const ObjProto = Object.prototype
export const hasOwnProperty = ObjProto.hasOwnProperty
const toString = ObjProto.toString

export const _isArray =
    nativeIsArray ||
    function (obj: any): obj is any[] {
        return toString.call(obj) === '[object Array]'
    }
export const _isUint8Array = function (x: unknown): x is Uint8Array {
    return toString.call(x) === '[object Uint8Array]'
}
// from a comment on http://dbj.org/dbj/?p=286
// fails on only one very rare and deliberate custom object:
// let bomb = { toString : undefined, valueOf: function(o) { return "function BOMBA!"; }};
export const _isFunction = function (f: any): f is (...args: any[]) => any {
    // eslint-disable-next-line posthog-js/no-direct-function-check
    return typeof f === 'function'
}
// Underscore Addons
export const _isObject = function (x: unknown): x is Record<string, any> {
    // eslint-disable-next-line posthog-js/no-direct-object-check
    return x === Object(x) && !_isArray(x)
}
export const _isEmptyObject = function (x: unknown): x is Record<string, any> {
    if (_isObject(x)) {
        for (const key in x) {
            if (hasOwnProperty.call(x, key)) {
                return false
            }
        }
        return true
    }
    return false
}
export const _isUndefined = function (x: unknown): x is undefined {
    return x === void 0
}
export const _isString = function (x: unknown): x is string {
    // eslint-disable-next-line posthog-js/no-direct-string-check
    return toString.call(x) == '[object String]'
}
export const _isBlob = function (x: unknown): x is Blob {
    return toString.call(x) === '[object Blob]'
}
export const _isNull = function (x: unknown): x is null {
    // eslint-disable-next-line posthog-js/no-direct-null-check
    return x === null
}
export const _isDate = function (x: unknown): x is Date {
    // eslint-disable-next-line posthog-js/no-direct-date-check
    return toString.call(x) == '[object Date]'
}
export const _isNumber = function (x: unknown): x is number {
    // eslint-disable-next-line posthog-js/no-direct-number-check
    return toString.call(x) == '[object Number]'
}
export const _isBoolean = function (x: unknown): x is boolean {
    // eslint-disable-next-line posthog-js/no-direct-boolean-check
    return toString.call(x) === '[object Boolean]'
}
