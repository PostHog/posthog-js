// Polyfill for Array.from for IE11
// thanks ChatGPT 🙈
import { isFunction } from './type-utils'

if (!Array.from) {
    Array.from = (function () {
        return function from<T, U>(arrayLike: ArrayLike<T>, mapfn?: (v: T, k: number) => U, thisArg?: any): (T | U)[] {
            // Use Array as the constructor without relying on `this`
            const C = Array
            const items = Object(arrayLike)

            if (arrayLike == null) {
                throw new TypeError('Array.from requires an array-like object - not null or undefined')
            }

            // Convert the length to a number and ensure it's finite and non-negative
            const len = Number(items.length)

            // Truncate the length to avoid any floating-point errors (i.e., avoid fractional lengths)
            const finalLen = Math.min(Math.max(Math.trunc(len), 0), Number.MAX_SAFE_INTEGER)
            if (!isFinite(finalLen) || finalLen < 0) {
                throw new RangeError('Array length must be a finite positive integer')
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
