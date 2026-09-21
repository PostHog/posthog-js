import { isArray, isUndefined } from '@posthog/core'

export function appendArray(currentValue: string[] | undefined, sampleType: string | string[]): string[] {
    return [...(currentValue ? currentValue : []), ...(isArray(sampleType) ? sampleType : [sampleType])]
}

export function updateThreshold(currentValue: number | undefined, percent: number): number {
    return (isUndefined(currentValue) ? 1 : currentValue) * percent
}

export { simpleHash, sampleOnProperty } from './replay/sampling'
