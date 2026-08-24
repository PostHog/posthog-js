import type { Extension } from '@posthog/browser-common'

import {
    createAnalyticsDelivery,
    type AnalyticsDeliveryContext,
    type InternalAnalyticsExtension,
} from './analytics-internal'
import { sendCaptureV1Batch } from './capture-v1'

/** Creates the first-party Capture Analytics V1 delivery extension. */
export const analytics = (): Extension => {
    const extension: InternalAnalyticsExtension = {
        name: 'analytics',
        setup() {},
        [createAnalyticsDelivery]: (context: AnalyticsDeliveryContext) => ({
            batchSize: 1,
            async deliver(events, delivery) {
                const canRetry = (): boolean => delivery.canContinue() && context.canRetry()
                if (!canRetry()) {
                    return delivery.canContinue() ? undefined : { retry: events }
                }
                const result = await sendCaptureV1Batch(context.runtime, [...events], context.libraryVersion, {
                    canRetry,
                    ...(delivery.signal ? { signal: delivery.signal } : {}),
                })
                if (!delivery.canContinue()) {
                    const retry = events.filter(({ uuid }) => result.retry.includes(uuid))
                    return retry.length ? { retry } : undefined
                }
                if (result.error || result.statusCode >= 400) {
                    context.reportFailure(result.error ?? result.statusCode)
                }
            },
        }),
    }
    return extension
}
