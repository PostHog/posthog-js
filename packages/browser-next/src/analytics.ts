import type { Disposable, Extension } from '@posthog/browser-common'

import type { AnalyticsOptions } from './analytics-options'
import {
    createAnalyticsDelivery,
    type AnalyticsDeliveryContext,
    type AnalyticsMessage,
    type InternalAnalyticsExtension,
} from './analytics-internal'
import type { CaptureOutcome, CaptureSummary } from './types'
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

const summarizeCapture = (
    messages: readonly AnalyticsMessage[],
    outcomes: Readonly<Record<string, CaptureOutcome>>
): CaptureSummary => {
    const results: Record<string, CaptureOutcome> = {}
    for (const [uuid, outcome] of Object.entries(outcomes)) {
        Object.defineProperty(results, uuid, {
            enumerable: true,
            value: Object.freeze({ ...outcome }),
        })
    }
    const persisted = messages.reduce((count, message) => {
        const result = Object.hasOwn(outcomes, message.uuid) ? outcomes[message.uuid]?.result : undefined
        return count + (result === 'ok' || result === 'warning' ? 1 : 0)
    }, 0)
    const submitted = messages.length
    const notPersisted = Math.max(0, submitted - persisted)
    return Object.freeze({
        submitted,
        notPersisted,
        allPersisted: notPersisted === 0,
        results: Object.freeze(results),
    })
}

const immediateCaptureError = (cause: unknown, summary: CaptureSummary): Error => {
    const error = new Error(cause instanceof Error ? cause.message : 'Immediate capture failed', { cause })
    error.name = 'PostHogCaptureError'
    try {
        Object.defineProperty(error, 'summary', { value: summary, enumerable: true })
    } catch {
        // The rejection still carries the original delivery failure as its cause.
    }
    return error
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
    const immediateControllers = new Set<AbortController>()
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
            for (const controller of immediateControllers) {
                try {
                    controller.abort()
                } catch {
                    // The client delivery gate still prevents future retries.
                }
            }
            immediateControllers.clear()
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
                async deliverImmediate(messages, immediateCanContinue) {
                    let controller: AbortController | undefined
                    try {
                        controller = new AbortController()
                        immediateControllers.add(controller)
                    } catch {
                        // Delivery still observes consent and disposal before each retry.
                    }
                    try {
                        const canRetry = (): boolean =>
                            !controller?.signal.aborted &&
                            (immediateCanContinue?.() ?? true) &&
                            context.canRetry() &&
                            online
                        const result = await sendCaptureV1Batches(
                            context.runtime,
                            [...messages],
                            context.libraryVersion,
                            {
                                canRetry,
                                compressionEnabled,
                                ...(controller ? { signal: controller.signal } : {}),
                            }
                        )
                        const summary = summarizeCapture(messages, result.outcomes)
                        if (result.terminalError !== undefined) {
                            throw immediateCaptureError(result.terminalError, summary)
                        }
                        return summary
                    } finally {
                        if (controller) {
                            immediateControllers.delete(controller)
                        }
                    }
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
