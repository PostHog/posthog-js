import { BeforeSendFn, CaptureResult, KnownEventName } from '../types'
import { includes, clampToRange } from '@posthog/core'
import { appendArray, sampleOnProperty, updateThreshold } from '../extensions/sampling'
import { logger } from '@posthog/browser-common/utils/logger'

/**
 * Return a `before_send` hook that samples by distinct ID.
 * A given ID sends either all its events or none. A rate of 0.5 keeps roughly
 * half of distinct IDs, not half of each ID's events.
 *
 * Import it from `posthog-js/customizations` and pass it to `before_send`.
 *
 * @example
 * ```ts
 * import { sampleByDistinctId } from 'posthog-js/customizations'
 *
 * posthog.init('<ph_project_token>', { before_send: sampleByDistinctId(0.4) })
 * ```
 *
 * @param percent Fraction of IDs to keep, from 0 (none) to 1 (all).
 */
export function sampleByDistinctId(percent: number): BeforeSendFn {
    return (captureResult: CaptureResult): CaptureResult | null => {
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
 * Return a `before_send` hook that samples by session ID.
 * A given session sends either all its events or none. A rate of 0.5 keeps
 * roughly half of sessions, not half of each session's events.
 *
 * Import it from `posthog-js/customizations` and pass it to `before_send`.
 *
 * @example
 * ```ts
 * import { sampleBySessionId } from 'posthog-js/customizations'
 *
 * posthog.init('<ph_project_token>', { before_send: sampleBySessionId(0.25) })
 * ```
 *
 * @param percent Fraction of sessions to keep, from 0 (none) to 1 (all).
 */
export function sampleBySessionId(percent: number): BeforeSendFn {
    return (captureResult: CaptureResult): CaptureResult | null => {
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
 * Return a `before_send` hook that samples events with the listed names.
 * Other events are kept. Sampling applies to individual events.
 *
 * Import it from `posthog-js/customizations` and pass it to `before_send`.
 *
 * @param eventNames Event names to sample.
 * @param percent Fraction of matching events to keep, from 0 (none) to 1 (all).
 */
export function sampleByEvent(eventNames: (KnownEventName | string)[], percent: number): BeforeSendFn {
    return (captureResult: CaptureResult): CaptureResult | null => {
        if (!includes(eventNames, captureResult.event)) {
            return captureResult
        }

        const number = Math.random()
        return number * 100 < clampToRange(percent * 100, 0, 100, logger)
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
    // oxlint-disable-next-line no-console
    console.log('Would have sent event:', result)
    return null
}
