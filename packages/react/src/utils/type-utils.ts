// from a comment on http://dbj.org/dbj/?p=286
// fails on only one very rare and deliberate custom object:
// let bomb = { toString : undefined, valueOf: function(o) { return "function BOMBA!"; }};
export const isFunction = function (f: any): f is (...args: any[]) => any {
    // oxlint-disable-next-line posthog-js/no-direct-function-check
    return typeof f === 'function'
}

export const isUndefined = function (x: unknown): x is undefined {
    return x === void 0
}

export const isString = function (x: unknown): x is string {
    return typeof x === 'string'
}

export const isBoolean = function (x: unknown): x is boolean {
    // oxlint-disable-next-line posthog-js/no-direct-boolean-check
    return typeof x === 'boolean'
}

export const isNull = function (x: unknown): x is null {
    return x === null
}
