import type { Disposable, Extension } from '@posthog/browser-common'

import type { AnalyticsOptions } from './analytics-options'
import {
    createAnalyticsDelivery,
    type AnalyticsDeliveryContext,
    type InternalAnalyticsExtension,
} from './analytics-internal'
import {
    CAPTURE_V1_MAX_BATCH_EVENTS,
    CAPTURE_V1_TEARDOWN_BUDGET_BYTES,
    sendCaptureV1Batches,
    sendCaptureV1TeardownBatches,
} from './capture-v1'

export type { AnalyticsOptions } from './analytics-options'

const numberOption = (read: () => number | undefined, fallback: number, minimum: number, maximum: number): number => {
    try {
        const value = read()
        return Math.max(minimum, Math.min(maximum, Math.floor(Number.isFinite(value) ? value! : fallback)))
    } catch {
        return fallback
    }
}

const isOnline = (context: AnalyticsDeliveryContext): boolean => {
    try {
        return context.runtime[3]?.onLine !== false
    } catch {
        return true
    }
}

const observeLifecycle = (context: AnalyticsDeliveryContext, setOnline: (online: boolean) => void): Disposable => {
    let teardownEvent: 'pagehide' | 'unload' = 'unload'
    try {
        if ('onpagehide' in globalThis) {
            teardownEvent = 'pagehide'
        }
    } catch {
        // Unload remains the compatibility fallback.
    }
    const listeners: Array<[string, EventListener]> = []
    const invoke = (callback: () => void): void => {
        try {
            callback()
        } catch (error) {
            try {
                context.reportFailure(error)
            } catch {
                // Lifecycle failures must not escape into the host page.
            }
        }
    }
    const register = (event: string, listener: EventListener): void => {
        try {
            // eslint-disable-next-line posthog-js/no-add-event-listener
            globalThis.addEventListener(event, listener)
            listeners.push([event, listener])
        } catch {
            // Explicit flush and queue retention remain available without lifecycle events.
        }
    }
    register('online', () =>
        invoke(() => {
            setOnline(true)
            context.retryNow()
        })
    )
    register('offline', () =>
        invoke(() => {
            setOnline(false)
            context.pause()
        })
    )
    register(teardownEvent, () =>
        invoke(() => {
            if (context.canRetry()) {
                context.teardown(CAPTURE_V1_TEARDOWN_BUDGET_BYTES)
            }
        })
    )
    return {
        dispose: () => {
            for (const [event, listener] of listeners.splice(0)) {
                try {
                    globalThis.removeEventListener(event, listener)
                } catch {
                    // Listener cleanup is best effort.
                }
            }
        },
    }
}

/** Creates the first-party Capture Analytics V1 delivery extension. */
export const analytics = (options: AnalyticsOptions = {}): Extension => {
    const flushAt = numberOption(() => options.flushAt, 20, 1, CAPTURE_V1_MAX_BATCH_EVENTS)
    const flushInterval = numberOption(() => options.flushInterval, 3_000, 0, Number.MAX_SAFE_INTEGER)
    let remoteConfigSubscription: Disposable | undefined
    let lifecycleSubscription: Disposable | undefined
    let compressionEnabled = false
    let online = true
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
            online = true
            lifecycleSubscription?.dispose()
            lifecycleSubscription = undefined
            remoteConfigSubscription?.dispose()
            remoteConfigSubscription = undefined
        },
        [createAnalyticsDelivery]: (context: AnalyticsDeliveryContext) => {
            try {
                online = isOnline(context)
                lifecycleSubscription = observeLifecycle(context, (value) => {
                    online = value
                })
            } catch (error) {
                context.reportFailure(error)
            }
            return {
                batchSize: CAPTURE_V1_MAX_BATCH_EVENTS,
                flushAt,
                flushInterval,
                canDeliver: () => !!context.runtime[2] && online && context.canRetry(),
                async deliver(events, delivery) {
                    const canRetry = (): boolean => delivery.canContinue() && context.canRetry() && online
                    if (!canRetry()) {
                        return { retry: events }
                    }
                    const result = await sendCaptureV1Batches(context.runtime, [...events], context.libraryVersion, {
                        canRetry,
                        compressionEnabled,
                        ...(delivery.signal ? { signal: delivery.signal } : {}),
                    })
                    const retry = events.filter((event) => result.retryMessages.includes(event))
                    if (result.error || result.statusCode >= 400) {
                        context.reportFailure(result.error ?? result.statusCode)
                    }
                    return retry.length ? { retry } : undefined
                },
                teardown(events, maxBytes) {
                    const result = sendCaptureV1TeardownBatches(context.runtime, [...events], context.libraryVersion, {
                        maxBytes,
                        canContinue: context.canRetry,
                        onError: context.reportFailure,
                    })
                    if (result.overflow.length) {
                        context.reportWarning(
                            `Analytics teardown skipped ${result.overflow.length} event${result.overflow.length === 1 ? '' : 's'} outside the keepalive budget`
                        )
                    }
                },
            }
        },
    }
    return extension
}
