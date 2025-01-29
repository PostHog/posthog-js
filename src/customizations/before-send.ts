import { clampToRange } from '../utils/number-utils'
import { BeforeSendFn, CaptureResult, KnownEventName } from '../types'
import { includes } from '../utils/string-utils'
import { appendArray, sampleOnProperty, updateThreshold } from '../extensions/sampling'

/**
 * Provides an implementation of sampling that samples based on the distinct ID.
 * Using the provided percentage.
 * Can be used to create a beforeCapture fn for a PostHog instance.
 *
 * Setting 0.5 will cause roughly 50% of distinct ids to have events sent.
 * Not 50% of events for each distinct id.
 *
 * @param percent a number from 0 to 1, 1 means always send and, 0 means never send the event
 */
export function sampleByDistinctId(percent: number): BeforeSendFn {
    return (captureResult: CaptureResult | null): CaptureResult | null => {
        if (!captureResult) {
            return null
        }

        return sampleOnProperty(captureResult.properties.distinct_id, percent)
            ? {
                  ...captureResult,
                  properties: {
                      ...captureResult.properties,
                      $sample_type: ['sampleByDistinctId'],
                      $sample_threshold: percent,
                  },
              }
            : null
    }
}

/**
 * Provides an implementation of sampling that samples based on the session ID.
 * Using the provided percentage.
 * Can be used to create a beforeCapture fn for a PostHog instance.
 *
 * Setting 0.5 will cause roughly 50% of sessions to have events sent.
 * Not 50% of events for each session.
 *
 * @param percent a number from 0 to 1, 1 means always send and, 0 means never send the event
 */
export function sampleBySessionId(percent: number): BeforeSendFn {
    return (captureResult: CaptureResult | null): CaptureResult | null => {
        if (!captureResult) {
            return null
        }

        return sampleOnProperty(captureResult.properties.$session_id, percent)
            ? {
                  ...captureResult,
                  properties: {
                      ...captureResult.properties,
                      $sample_type: appendArray(captureResult.properties.$sample_type, 'sampleBySessionId'),
                      $sample_threshold: updateThreshold(captureResult.properties.$sample_threshold, percent),
                  },
              }
            : null
    }
}

/**
 * Provides an implementation of sampling that samples based on the event name.
 * Using the provided percentage.
 * Can be used to create a beforeCapture fn for a PostHog instance.
 *
 * @param eventNames an array of event names to sample, sampling is applied across events not per event name
 * @param percent a number from 0 to 1, 1 means always send, 0 means never send the event
 */
export function sampleByEvent(eventNames: KnownEventName[], percent: number): BeforeSendFn {
    return (captureResult: CaptureResult | null): CaptureResult | null => {
        if (!captureResult) {
            return null
        }

        if (!includes(eventNames, captureResult.event)) {
            return captureResult
        }

        const number = Math.random()
        return number * 100 < clampToRange(percent * 100, 0, 100)
            ? {
                  ...captureResult,
                  properties: {
                      ...captureResult.properties,
                      $sample_type: appendArray(captureResult.properties?.$sample_type, 'sampleByEvent'),
                      $sample_threshold: updateThreshold(captureResult.properties?.$sample_threshold, percent),
                      $sampled_events: appendArray(captureResult.properties?.$sampled_events, eventNames),
                  },
              }
            : null
    }
}

export const printAndDropEverything: BeforeSendFn = (result) => {
    // eslint-disable-next-line no-console
    console.log('Would have sent event:', result)
    return null
}
