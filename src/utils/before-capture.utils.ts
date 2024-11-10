import { clampToRange } from './number-utils'
import { CaptureResult, KnownEventName } from '../types'
import { includes } from './index'

function simpleHash(str: string) {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i) // (hash * 31) + char code
        hash |= 0 // Convert to 32bit integer
    }
    return Math.abs(hash)
}

function sampleOnProperty(prop: string, percent: number): boolean {
    return simpleHash(prop) % 100 < clampToRange(percent, 0, 100)
}

/**
 * Provides an implementation of sampling that samples based on the distinct ID.
 * Using the provided percentage.
 * Can be used to create a beforeCapture fn for a PostHog instance.
 *
 * Causes roughly 50% of distinct ids to have events sent.
 * Not 50% of events for each distinct id.
 *
 * @param percent a number from 0 to 100, 100 means never sample, 0 means never send the event
 */
export function sampleByDistinctId(percent: number): (c: CaptureResult) => CaptureResult | null {
    return (captureResult: CaptureResult): CaptureResult | null => {
        return sampleOnProperty(captureResult.properties.distinct_id, percent) ? captureResult : null
    }
}

/**
 * Provides an implementation of sampling that samples based on the session ID.
 * Using the provided percentage.
 * Can be used to create a beforeCapture fn for a PostHog instance.
 *
 * Causes roughly 50% of sessions to have events sent.
 * Not 50% of events for each session.
 *
 * @param percent a number from 0 to 100, 100 means never sample, 0 means never send the event
 */
export function sampleBySessionId(percent: number): (c: CaptureResult) => CaptureResult | null {
    return (captureResult: CaptureResult): CaptureResult | null => {
        return sampleOnProperty(captureResult.properties.$session_id, percent) ? captureResult : null
    }
}

/**
 * Provides an implementation of sampling that samples based on the event name.
 * Using the provided percentage.
 * Can be used to create a beforeCapture fn for a PostHog instance.
 *
 * @param eventNames an array of event names to sample, sampling is applied across events not per event name
 * @param percent a number from 0 to 100, 100 means never sample, 0 means never send the event
 */
export function sampleByEvent(
    eventNames: KnownEventName[],
    percent: number
): (c: CaptureResult) => CaptureResult | null {
    return (captureResult: CaptureResult): CaptureResult | null => {
        if (!includes(eventNames, captureResult.event)) {
            return captureResult
        }

        return Math.random() * 100 < clampToRange(percent, 0, 100) ? captureResult : null
    }
}
