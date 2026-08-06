// Minimal, side-effecting `Array.prototype.at` polyfill for the web-vitals bundles.
//
// web-vitals@5 calls `Array.prototype.at()` internally (minified to `entries.at(-1)`), which
// is unavailable on browsers that predate it (Chrome <92, iOS Safari <15.4). Our Babel
// preset-env config down-levels syntax only — it does not polyfill runtime prototype methods —
// so without this the web-vitals bundles throw an unhandled `TypeError: ....at is not a
// function` and capture no web vitals on those browsers.
//
// We deliberately ship a tiny bespoke polyfill rather than importing `core-js/actual/array/at`,
// which pulls in ~6KB gzipped of shared machinery and would more than double these intentionally
// small bundles. See the note in rollup.config.mjs about keeping bundles small with bespoke
// approaches. Import this as the very first import in an entrypoint so the polyfill is installed
// before `web-vitals` is evaluated.

if (typeof Array.prototype.at !== 'function') {
    Object.defineProperty(Array.prototype, 'at', {
        // matches the spec's Array.prototype.at (ECMAScript 2022)
        value: function at(this: ArrayLike<unknown>, index: number): unknown {
            const len = this.length
            // ToIntegerOrInfinity: NaN/undefined become 0
            let relativeIndex = Math.trunc(index) || 0
            if (relativeIndex < 0) {
                relativeIndex += len
            }
            return relativeIndex < 0 || relativeIndex >= len ? undefined : this[relativeIndex]
        },
        // mirror the native descriptor: non-enumerable so it doesn't leak into `for..in`
        writable: true,
        enumerable: false,
        configurable: true,
    })
}
