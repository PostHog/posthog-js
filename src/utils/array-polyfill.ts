// Polyfill for Array.from for IE11
// thanks ChatGPT 🙈
import { isFunction, isNullish } from './type-utils'

if (!Array.from) {
    Array.from = (function () {
        return function from<T, U>(arrayLike: ArrayLike<T>, mapfn?: (v: T, k: number) => U, thisArg?: any): (T | U)[] {
            // Use Array as the constructor without relying on `this`
            const C = Array
            const items = Object(arrayLike)

            if (isNullish(arrayLike)) {
                throw new TypeError('PostHog Array.from polyfill requires an array-like object - not null or undefined')
            }

            // Convert the length to a number and ensure it's finite and non-negative
            const len = Number(items.length)

            // Truncate the length to avoid any floating-point errors (i.e., avoid fractional lengths)
            const finalLen = Math.min(Math.max(Math.trunc(len), 0), Number.MAX_SAFE_INTEGER)
            if (isNaN(finalLen) || !isFinite(finalLen) || finalLen < 0) {
                // eslint-disable-next-line no-console
                console.warn(
                    'PostHog Array.from polyfill - Invalid length property (' +
                        finalLen +
                        ') in array-like object, defaulting length to 0:',
                    items.length
                )
                return [] // Return an empty array for invalid length
            }

            const result: (T | U)[] = isFunction(C) ? Object(new (C as any)(finalLen)) : new Array(finalLen)

            let k = 0

            if (isFunction(mapfn)) {
                while (k < finalLen) {
                    const kValue = items[k]
                    result[k] = mapfn.call(thisArg, kValue, k)
                    k++
                }
            } else {
                while (k < finalLen) {
                    result[k] = items[k]
                    k++
                }
            }

            result.length = finalLen
            return result
        }
    })()
}
