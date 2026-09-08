// Minimal, side-effecting `Array.prototype.findLast` polyfill for the web-vitals attribution bundles.
//
// web-vitals@6 attribution calls `Array.prototype.findLast()` in its LCP attribution path to find
// the Resource Timing entry for the LCP element, which is unavailable on browsers that predate it
// (Chrome <97, iOS Safari <15.4). Our Babel preset-env config down-levels syntax only — it does not
// polyfill runtime prototype methods — so without this the attribution bundles throw an unhandled
// `TypeError: ....findLast is not a function` and capture no web vitals on those browsers.
//
// As with the `Array.prototype.at` polyfill next to this one, we ship a tiny bespoke polyfill rather
// than importing from `core-js`, which would more than double these intentionally small bundles.
// Import this as the very first import in an entrypoint so the polyfill is installed before
// `web-vitals` is evaluated.

if (typeof Array.prototype.findLast !== 'function') {
    Object.defineProperty(Array.prototype, 'findLast', {
        // matches the spec's Array.prototype.findLast (ECMAScript 2023)
        value: function findLast(
            this: unknown[],
            predicate: (value: unknown, index: number, array: unknown[]) => unknown,
            thisArg?: unknown
        ): unknown {
            for (let index = this.length - 1; index >= 0; index--) {
                const value = this[index]
                if (predicate.call(thisArg, value, index, this)) {
                    return value
                }
            }
        },
        // mirror the native descriptor: non-enumerable so it doesn't leak into `for..in`
        writable: true,
        enumerable: false,
        configurable: true,
    })
}
