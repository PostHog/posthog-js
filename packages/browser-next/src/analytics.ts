import type { Disposable, Extension } from '@posthog/browser-common'

import {
    createAnalyticsDelivery,
    type AnalyticsDeliveryContext,
    type InternalAnalyticsExtension,
} from './analytics-internal'
import { CAPTURE_V1_MAX_BATCH_EVENTS, sendCaptureV1Batches } from './capture-v1'

/** Creates the first-party Capture Analytics V1 delivery extension. */
export const analytics = (): Extension => {
    let remoteConfigSubscription: Disposable | undefined
    let compressionEnabled = false
    const extension: InternalAnalyticsExtension = {
        name: 'analytics',
        setup(client) {
            compressionEnabled = false
            remoteConfigSubscription = client.onRemoteConfig((result) => {
                try {
                    compressionEnabled = result.ok && result.config.supportedCompression.includes('gzip-js')
                } catch {
                    compressionEnabled = false
                }
            })
        },
        dispose() {
            compressionEnabled = false
            remoteConfigSubscription?.dispose()
            remoteConfigSubscription = undefined
        },
        [createAnalyticsDelivery]: (context: AnalyticsDeliveryContext) => ({
            batchSize: CAPTURE_V1_MAX_BATCH_EVENTS,
            async deliver(events, delivery) {
                const canRetry = (): boolean => delivery.canContinue() && context.canRetry()
                if (!canRetry()) {
                    return delivery.canContinue() ? undefined : { retry: events }
                }
                const result = await sendCaptureV1Batches(context.runtime, [...events], context.libraryVersion, {
                    canRetry,
                    compressionEnabled,
                    ...(delivery.signal ? { signal: delivery.signal } : {}),
                })
                if (!delivery.canContinue()) {
                    const retry = events.filter((event) => result.retryMessages.includes(event))
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
