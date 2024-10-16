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

            const len = Math.min(Math.max(Number(items.length) || 0, 0), Number.MAX_SAFE_INTEGER)
            const result: (T | U)[] = isFunction(C) ? Object(new (C as any)(len)) : new Array(len)

            let k = 0

            if (isFunction(mapfn)) {
                while (k < len) {
                    const kValue = items[k]
                    result[k] = mapfn.call(thisArg, kValue, k)
                    k++
                }
            } else {
                while (k < len) {
                    result[k] = items[k]
                    k++
                }
            }

            result.length = len
            return result
        }
    })()
}
