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
import { createChunkLoader } from './chunk-loader'

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
    let disposed = false
    const buffer = new EventBuffer<AnalyticsMessage>(
        1_000,
        (total, count = 1, reason = 'overflow') =>
            host.reportWarning(
                `Analytics queue dropped ${count} ${reason} event${count === 1 ? '' : 's'} (${total} total)`
            ),
        MAX_ANALYTICS_BYTES,
        60 * 60 * 1000
    )

    const delivery =
        load &&
        createChunkLoader(async () => {
            try {
                const createDelivery = await load()
                if (!disposed) {
                    driver = createDelivery(buffer, client, host, scheduling)
                }
            } catch (error) {
                client.logger.error('Automatic analytics loading failed', error)
                throw error
            }
        })

    const ensureDelivery = async (reason: LoadReason): Promise<void> => {
        if (!delivery || disposed || driver) {
            return
        }
        if (reason === 'capture' && delivery.failed && !delivery.loading) {
            return
        }
        const shouldRetry =
            delivery.loading && reason !== 'capture' ? () => !disposed && buffer.hasPending() : undefined
        try {
            await delivery.load(shouldRetry)
        } catch {
            // Keep buffered work for the next explicit delivery attempt.
        }
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
            if (reason === 'shutdown' && delivery?.loading) {
                try {
                    await delivery.loading
                } catch {
                    // Shutdown joins the current attempt without starting another load.
                }
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
