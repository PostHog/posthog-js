import type { Client } from '@posthog/browser-common'

import {
    Analytics,
    MAX_ANALYTICS_BATCH_EVENTS,
    MAX_ANALYTICS_BYTES,
    type AnalyticsDeliveryFactory,
    type AnalyticsDriver,
    type AnalyticsExtension,
    type CaptureHost,
    type AnalyticsMessage,
} from './analytics-internal'
import type { AnalyticsOptions, AutomaticAnalyticsOptions } from './analytics-options'
import { EventBuffer } from './event-buffer'
import { captureFailure } from './capture-summary'

const numberOption = (read: () => number | undefined, fallback: number, minimum: number, maximum: number): number => {
    try {
        const value = read()
        return Math.max(minimum, Math.min(maximum, Math.floor(Number.isFinite(value) ? value! : fallback)))
    } catch {
        return fallback
    }
}

type LoadReason = 'capture' | 'immediate' | 'flush' | 'shutdown' | 'eager'

/** One analytics instance owns admission and storage before and after delivery loads. */
export const createAnalyticsExtension = (
    options: AutomaticAnalyticsOptions = {},
    load?: () => Promise<AnalyticsDeliveryFactory>,
    deliveryFactory?: AnalyticsDeliveryFactory
): AnalyticsExtension => {
    let eager = false
    if (load) {
        try {
            eager = options.load === 'eager'
        } catch {
            // Unavailable configuration uses lazy loading.
        }
    }
    const scheduling: Readonly<Required<AnalyticsOptions>> = {
        flushAt: numberOption(() => options.flushAt, 20, 1, MAX_ANALYTICS_BATCH_EVENTS),
        flushInterval: numberOption(() => options.flushInterval, 3_000, 0, Number.MAX_SAFE_INTEGER),
    }
    let client: Client
    let host: CaptureHost
    let driver: AnalyticsDriver | undefined
    let loading: Promise<void> | undefined
    let disposed = false
    let failures = 0
    const buffer = new EventBuffer<AnalyticsMessage>(
        1_000,
        (total, count = 1, reason = 'overflow') =>
            host.reportWarning(
                `Analytics queue dropped ${count} ${reason} event${count === 1 ? '' : 's'} (${total} total)`
            ),
        MAX_ANALYTICS_BYTES,
        60 * 60 * 1000
    )

    const ensureDelivery = async (reason: LoadReason, retryAfterPending = true): Promise<void> => {
        if (!load || disposed || driver) {
            return
        }
        if (loading) {
            if (reason === 'capture' || !retryAfterPending) {
                return loading
            }
            const previousFailures = failures
            await loading
            if (failures > previousFailures && buffer.hasPending()) {
                await ensureDelivery(reason, false)
            }
            return
        }
        if (reason === 'capture' && failures > 0) {
            return
        }
        const loadDelivery = async () => {
            // Assign the shared promise before invoking a loader that can throw or reenter.
            await Promise.resolve()
            try {
                const createDelivery = await load()
                if (disposed) {
                    return
                }
                driver = createDelivery(buffer, client, host, scheduling)
            } catch (error: unknown) {
                if (!driver) {
                    failures++
                    client.logger.error('Automatic analytics loading failed', error)
                }
            } finally {
                if (loading === pending) {
                    loading = undefined
                }
            }
        }
        const pending = loadDelivery()
        loading = pending
        return pending
    }

    return {
        name: Analytics,
        setup(value) {
            client = value
        },
        initialize(value) {
            host = value
            if (deliveryFactory) {
                driver = deliveryFactory(buffer, client, host, scheduling)
            }
        },
        enqueue: (message, bytes) => buffer.enqueue(message, bytes),
        discardQueued: (message) => {
            buffer.discardQueued(message)
        },
        admitted() {
            void ensureDelivery('capture')
        },
        start: () => (eager ? ensureDelivery('eager') : Promise.resolve()),
        async flush(reason = 'flush') {
            if (disposed) {
                return
            }
            if (reason === 'shutdown' && loading) {
                await loading
            } else if (buffer.hasPending()) {
                await ensureDelivery(reason)
            }
            await driver?.flush()
        },
        async deliverImmediate(message, canContinue) {
            await ensureDelivery('immediate')
            let deliverImmediate: AnalyticsDriver['deliverImmediate'] | undefined
            try {
                deliverImmediate = driver?.deliverImmediate
            } catch {
                deliverImmediate = undefined
            }
            if (!canContinue()) {
                return captureFailure(new Error('Immediate analytics delivery was cancelled'))
            }
            if (!driver || typeof deliverImmediate !== 'function' || disposed) {
                return captureFailure(new Error('Immediate analytics delivery is unavailable'))
            }
            return deliverImmediate.call(driver, [message], canContinue)
        },
        purge: () => buffer.purge(),
        dispose() {
            disposed = true
            if (driver) {
                return driver.dispose()
            }
            buffer.dispose()
            return undefined
        },
    }
}
