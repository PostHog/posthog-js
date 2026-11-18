import type { AnalyticsDeliveryFactory, AnalyticsMessage } from '../analytics-internal'
import { MAX_ANALYTICS_BATCH_EVENTS } from '../analytics-internal'
import { buildCaptureV1Event } from './capture-v1'
import { createId } from '../../../primitives/id'

/**
 * Best-effort Capture V1 delivery: batches by count and timer, sends once with Fetch, and hands the queue
 * to a keepalive request on page hide. No retries, compression, payload splitting or immediate capture.
 */
export const createLiteDelivery: AnalyticsDeliveryFactory = (buffer, client, host, options, beforeTeardown) => {
    const [hosts, token, fetch] = host.runtime
    let timer: ReturnType<typeof setTimeout> | undefined

    const send = (messages: readonly AnalyticsMessage[], keepalive: boolean): Promise<void> => {
        if (!messages.length || !fetch || !host.canRetry()) return Promise.resolve()
        const now = new Date().toISOString()
        const batch = messages.map((message) => JSON.stringify(buildCaptureV1Event(message)))
        try {
            return fetch(`${hosts.api}/i/v1/analytics/events`, {
                method: 'POST',
                credentials: 'omit',
                keepalive,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'PostHog-Sdk-Info': `posthog-js/${client.library.version}`,
                    'PostHog-Attempt': '1',
                    'PostHog-Request-Id': createId(),
                    'PostHog-Request-Timestamp': now,
                },
                body: `{"created_at":${JSON.stringify(now)},"batch":[${batch.join(',')}]}`,
            }).then(
                (response) => {
                    if (!response.ok) host.reportFailure(response.status)
                },
                (error: unknown) => host.reportFailure(error)
            )
        } catch (error) {
            host.reportFailure(error)
            return Promise.resolve()
        }
    }

    const drain = (keepalive = false): Promise<void> => {
        clearTimeout(timer)
        timer = undefined
        const sends: Promise<void>[] = []
        while (buffer._queue.length) {
            const entries = buffer._takeQueue(MAX_ANALYTICS_BATCH_EVENTS)
            sends.push(
                send(
                    entries.map((entry) => entry[1]),
                    keepalive
                )
            )
        }
        return Promise.all(sends).then(() => undefined)
    }

    buffer.onChange = (change) => {
        if (change !== 'enqueue') return
        // Drain after the current capture commits, so an event rejected by session admission is never sent.
        if (buffer._queue.length >= options.flushAt) queueMicrotask(() => void drain())
        else if (!timer && options.flushInterval > 0) timer = setTimeout(() => void drain(), options.flushInterval)
    }

    const pagehide = (): void => {
        if (!host.canRetry()) return
        try {
            beforeTeardown?.()
        } finally {
            void drain(true)
        }
    }
    // oxlint-disable-next-line posthog-js/no-add-event-listener
    globalThis.addEventListener?.('pagehide', pagehide)

    return {
        flush: () => drain(),
        deliverUnload: (messages) => void send(messages, true),
        dispose: () => {
            clearTimeout(timer)
            globalThis.removeEventListener?.('pagehide', pagehide)
            buffer.onChange = undefined
            buffer.dispose()
            return Promise.resolve()
        },
    }
}
