import { isNumber } from './type-utils'
import { logger } from './logger'

export function clampToRange(value: unknown, min: number, max: number, label?: string): number {
    if (!isNumber(value)) {
        label && logger.warn(label + ' must be a number. Defaulting to max value:' + max)
        return max
    } else if (value > max) {
        label && logger.warn(label + ' cannot be  greater than max: ' + max + '. Using max value instead.')
        return max
    } else if (value < min) {
        label && logger.warn(label + ' cannot be less than min: ' + min + '. Using min value instead.')
        return min
    } else {
        return value
    }
}
