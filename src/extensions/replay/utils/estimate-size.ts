import { isObject } from '../../../utils/type-utils'
import type { eventWithTime } from '@rrweb/types'

// taken from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Cyclic_object_value#circular_references
function circularReferenceReplacer() {
    const ancestors: any[] = []
    return function (_key: string, value: any) {
        if (isObject(value)) {
            // `this` is the object that value is contained in,
            // i.e., its direct parent.
            // @ts-expect-error - TS was unhappy with `this` on the next line but the code is copied in from MDN
            while (ancestors.length > 0 && ancestors.at(-1) !== this) {
                ancestors.pop()
            }
            if (ancestors.includes(value)) {
                return '[Circular]'
            }
            ancestors.push(value)
            return value
        } else {
            return value
        }
    }
}

export function estimateSize(event: eventWithTime | Record<string, any>): number {
    return JSON.stringify(event, circularReferenceReplacer()).length
}
