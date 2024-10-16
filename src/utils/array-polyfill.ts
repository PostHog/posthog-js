// Polyfill for Array.from for IE11
// thanks ChatGPT 🙈
import { isFunction } from './type-utils'

if (!Array.from) {
    Array.from = (function () {
        // Polyfill for TypeScript signature:
        // from<T>(arrayLike: ArrayLike<T>): T[];
        // from<T, U>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => U, thisArg?: any): U[];
        return function from<T, U>(arrayLike: ArrayLike<T>, mapfn?: (v: T, k: number) => U, thisArg?: any): (T | U)[] {
            // Use Array as the constructor without relying on `this`
            const C = Array
            const items = Object(arrayLike)

            if (arrayLike == null) {
                throw new TypeError('Array.from requires an array-like object - not null or undefined')
            }

            const len = Number(items.length) // Get the length as a number

            // Ensure length is a finite, positive integer, or set to 0
            if (isNaN(len) || len < 0 || !isFinite(len)) {
                throw new RangeError('Array length must be a finite positive integer')
            }

            const finalLen = Math.min(Math.max(len, 0), Number.MAX_SAFE_INTEGER) // Ensure within bounds

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
