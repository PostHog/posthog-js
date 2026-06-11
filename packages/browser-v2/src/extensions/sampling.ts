import { isArray, isUndefined, clampToRange } from '@posthog/core'
import { logger } from '../utils/logger'

export function appendArray(currentValue: string[] | undefined, sampleType: string | string[]): string[] {
    return [...(currentValue ? currentValue : []), ...(isArray(sampleType) ? sampleType : [sampleType])]
}

export function updateThreshold(currentValue: number | undefined, percent: number): number {
    return (isUndefined(currentValue) ? 1 : currentValue) * percent
}

export function simpleHash(str: string) {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i) // (hash * 31) + char code
        hash |= 0 // Convert to 32bit integer
    }
    return Math.abs(hash)
}

/*
 * receives percent as a number between 0 and 1
 */
export function sampleOnProperty(prop: string, percent: number): boolean {
    return simpleHash(prop) % 100 < clampToRange(percent * 100, 0, 100, logger)
}
