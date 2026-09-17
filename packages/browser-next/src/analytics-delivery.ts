import type { Disposable } from '@posthog/browser-common'

import type {
    AnalyticsDelivery,
    AnalyticsDeliveryContext,
    AnalyticsDeliveryFactory,
    AnalyticsMessage,
} from './analytics-internal'
import { Lane } from './lane'
import { captureFailure } from './capture-summary'
import type { CaptureOutcome, CaptureSummary } from './types'
import {
    CAPTURE_V1_MAX_BATCH_EVENTS,
    CAPTURE_V1_TEARDOWN_BUDGET_BYTES,
    sendCaptureV1Batches,
    sendCaptureV1TeardownBatches,
} from './capture-v1'

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
            // oxlint-disable-next-line posthog-js/no-add-event-listener
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

/** Attaches delivery machinery to the analytics extension's existing event buffer. */
export const createAnalyticsDelivery: AnalyticsDeliveryFactory = (buffer, client, host, options) => {
    const lane = new Lane(
        buffer,
        (error) => host.reportFailure(error),
        () => host.onAvailable()
    )
    const context: AnalyticsDeliveryContext = {
        ...host,
        libraryVersion: client.library.version,
        retryNow: () => lane.retryNow(),
        pause: () => lane.pause(),
        teardown: (maxBytes) => lane.teardown(maxBytes),
    }
    let remoteConfigSubscription: Disposable | undefined
    let lifecycleSubscription: Disposable | undefined
    let compressionEnabled = false
    let online = true
    const immediateControllers = new Set<AbortController>()
    const dispose = (): Promise<void> => {
        const disposal = lane.dispose()
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
        return disposal
    }
    remoteConfigSubscription = client.onRemoteConfig((result) => {
        try {
            compressionEnabled = result.ok && result.config.supportedCompression.includes('gzip-js')
        } catch {
            compressionEnabled = false
        }
    })
    try {
        online = isOnline(context)
        lifecycleSubscription = observeLifecycle(context, (value) => {
            online = value
        })
    } catch (error) {
        context.reportFailure(error)
    }
    const delivery: AnalyticsDelivery = {
        batchSize: CAPTURE_V1_MAX_BATCH_EVENTS,
        flushAt: options.flushAt,
        flushInterval: options.flushInterval,
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
                    !controller?.signal.aborted && (immediateCanContinue?.() ?? true) && context.canRetry() && online
                const result = await sendCaptureV1Batches(context.runtime, [...messages], context.libraryVersion, {
                    canRetry,
                    compressionEnabled,
                    ...(controller ? { signal: controller.signal } : {}),
                })
                const summary = summarizeCapture(messages, result.outcomes)
                if (result.terminalError !== undefined) {
                    return captureFailure(result.terminalError, summary)
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
    lane.attach(delivery)
    return { flush: () => lane.flush(), deliverImmediate: delivery.deliverImmediate, dispose }
}
