// from a comment on http://dbj.org/dbj/?p=286
// fails on only one very rare and deliberate custom object:
// let bomb = { toString : undefined, valueOf: function(o) { return "function BOMBA!"; }};
export const isFunction = function (f: any): f is (...args: any[]) => any {
    // eslint-disable-next-line posthog-js/no-direct-function-check
    return typeof f === 'function'
}

export const isUndefined = function (x: unknown): x is undefined {
    return x === void 0
}

export const isNull = function (x: unknown): x is null {
    // eslint-disable-next-line posthog-js/no-direct-null-check
    return x === null
}
