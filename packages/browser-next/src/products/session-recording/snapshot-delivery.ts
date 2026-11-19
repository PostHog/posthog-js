import { gzipText } from '@posthog/browser-common/replay/event-compression'
import { EventBuffer } from '../analytics/admission/event-buffer'
import { nativeGzip } from '../../platform/gzip'
import { Lane } from '../analytics/delivery/lane'
import type { RequestRuntime } from '../../platform/request'

/** One `$snapshot` event in the legacy replay envelope that the `/s/` endpoint accepts. */
export interface SnapshotMessage {
    readonly uuid: string
    readonly event: '$snapshot'
    readonly timestamp: string
    readonly properties: Readonly<Record<string, unknown>>
}

export interface SnapshotDeliveryHost {
    readonly runtime: RequestRuntime
    /** The replay endpoint path, `/s/` unless remote configuration overrides it. */
    endpoint(): string
    /** Whether the client currently permits sending replay data. */
    canDeliver(): boolean
    /** Whether the project accepts gzip request bodies. */
    gzipEnabled(): boolean
    reportFailure(error: unknown): void
    reportWarning(message: string): void
}

export interface SnapshotDelivery {
    enqueue(message: SnapshotMessage, bytes: number): void
    flush(): Promise<void>
    /** Synchronously hands queued snapshots to the browser before the page unloads. */
    teardown(): void
    /** Drops queued snapshots, for example after an opt-out. */
    purge(): void
    dispose(): Promise<void>
}

const MAX_QUEUED_SNAPSHOTS = 100
const MAX_QUEUED_BYTES = 25 * 1024 * 1024
const MAX_SNAPSHOT_AGE_MS = 10 * 60 * 1000
const MAX_BATCH_SNAPSHOTS = 10
const RETRY_INTERVAL_MS = 3000
// beacons and keepalive requests share ~64 KiB per page; analytics budgets 80% of it for its own teardown
const UNLOAD_BUDGET_BYTES = Math.floor(64 * 1024 * 0.15)

const isRetryable = (statusCode: number): boolean => statusCode === 0 || statusCode === 429 || statusCode >= 500

const snapshotBytes = (message: SnapshotMessage): number => {
    const bytes = Number(message.properties.$snapshot_bytes)
    return Number.isFinite(bytes) ? bytes : 0
}

const groupBySessionWindow = (messages: readonly SnapshotMessage[]): SnapshotMessage[][] => {
    const groups = new Map<string, SnapshotMessage[]>()
    for (const message of messages) {
        const key = `${String(message.properties.$session_id)}-${String(message.properties.$window_id)}`
        const group = groups.get(key)
        if (group) group.push(message)
        else groups.set(key, [message])
    }
    return [...groups.values()]
}

const withSentAt = (messages: readonly SnapshotMessage[]): Array<SnapshotMessage & { sent_at: string }> => {
    const sentAt = new Date().toISOString()
    return messages.map((message) => ({ ...message, sent_at: sentAt }))
}

// native compression keeps large batches off the main thread; its output is verified, with fflate as the fallback
const gzip = async (payload: string): Promise<Blob | Uint8Array> => (await nativeGzip(payload)) ?? gzipText(payload)

const base64Utf8 = (value: string): string => {
    const bytes = new TextEncoder().encode(value)
    let binary = ''
    for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    }
    return btoa(binary)
}

const endpointUrl = (host: SnapshotDeliveryHost, query?: string): string => {
    const path = host.endpoint()
    const base = `${host.runtime[0].api}${path.startsWith('/') ? path : `/${path}`}`
    return query ? `${base}${base.includes('?') ? '&' : '?'}${query}` : base
}

const post = async (
    host: SnapshotDeliveryHost,
    messages: readonly SnapshotMessage[],
    signal: AbortSignal | undefined
): Promise<number> => {
    const fetch = host.runtime[2]
    if (!fetch) return 0
    const payload = JSON.stringify(withSentAt(messages))
    // gzip bodies are recognized by their magic bytes; posthog-js sends them the same way
    const compressed = host.gzipEnabled() ? await gzip(payload) : undefined
    try {
        const response = await fetch(endpointUrl(host), {
            method: 'POST',
            credentials: 'omit',
            headers: { 'Content-Type': compressed ? 'text/plain' : 'application/json' },
            body: (compressed ?? payload) as BodyInit,
            ...(signal ? { signal } : {}),
        })
        return response.status
    } catch {
        return 0
    }
}

interface UnloadBody {
    readonly body: Uint8Array | string
    readonly bytes: number
    readonly query: string | undefined
}

const unloadBody = (host: SnapshotDeliveryHost, messages: readonly SnapshotMessage[]): UnloadBody => {
    const payload = JSON.stringify(withSentAt(messages))
    if (host.gzipEnabled()) {
        // compressed synchronously: the page will not wait for a native compression stream
        const body = gzipText(payload)
        return { body, bytes: body.byteLength, query: undefined }
    }
    // a CORS-simple body, since the page cannot wait for a preflight while it unloads
    const body = base64Utf8(payload)
    return { body, bytes: body.length, query: 'compression=base64' }
}

/**
 * Hands queued snapshots to the browser as the page unloads. Beacons and keepalive requests share a
 * small per-page quota with analytics and logs, so replay uses at most its own share, splits batches to
 * fit it, and sends what does not fit as a regular request, which completes when the page lingers (for
 * example in the back/forward cache). Snapshots leave the queue while they are sent, and return to it
 * when that send fails, so a page that survives retries them instead of losing or duplicating them.
 */
const sendOnUnload = (
    host: SnapshotDeliveryHost,
    messages: readonly SnapshotMessage[],
    budget: { remaining: number },
    queue: { take(messages: readonly SnapshotMessage[]): void; restore(messages: readonly SnapshotMessage[]): void }
): void => {
    const encoded = unloadBody(host, messages)
    const url = endpointUrl(host, encoded.query)
    const navigator = host.runtime[3]
    const fetch = host.runtime[2]
    const request = (keepalive: boolean): void => {
        if (!fetch) return
        queue.take(messages)
        void fetch(url, {
            method: 'POST',
            credentials: 'omit',
            headers: { 'Content-Type': 'text/plain' },
            body: encoded.body as BodyInit,
            ...(keepalive ? { keepalive } : {}),
        })
            .then((response) => {
                if (response.status < 200 || response.status >= 300) queue.restore(messages)
            })
            .catch(() => queue.restore(messages))
    }
    if (encoded.bytes <= budget.remaining) {
        budget.remaining -= encoded.bytes
        if (navigator?.sendBeacon) {
            const data = new Blob([encoded.body as BlobPart], { type: 'text/plain' })
            if (navigator.sendBeacon.call(navigator, url, data)) {
                queue.take(messages)
                return
            }
            request(false)
            return
        }
        request(true)
        return
    }
    if (messages.length > 1) {
        const middle = Math.ceil(messages.length / 2)
        sendOnUnload(host, messages.slice(0, middle), budget, queue)
        sendOnUnload(host, messages.slice(middle), budget, queue)
        return
    }
    request(false)
}

/** A replay-owned lane: its own queue, endpoint, wire shape and retry policy, separate from analytics. */
export const createSnapshotDelivery = (host: SnapshotDeliveryHost): SnapshotDelivery => {
    const buffer = new EventBuffer<SnapshotMessage>(
        MAX_QUEUED_SNAPSHOTS,
        (_total, count = 1, reason = 'overflow') =>
            host.reportWarning(`Dropped ${count} replay snapshot${count === 1 ? '' : 's'} (${reason})`),
        MAX_QUEUED_BYTES,
        MAX_SNAPSHOT_AGE_MS
    )
    const lane = new Lane(buffer, (error) => host.reportFailure(error))
    lane.attach({
        batchSize: MAX_BATCH_SNAPSHOTS,
        // each snapshot sends on arrival, except while a failed batch at the front of the queue waits to retry
        get flushAt() {
            return (buffer._queue[0]?.[5] ?? 0) > buffer._now() ? MAX_QUEUED_SNAPSHOTS + 1 : 1
        },
        flushInterval: RETRY_INTERVAL_MS,
        canDeliver: () => !!host.runtime[2] && host.canDeliver(),
        async deliver(messages, context) {
            const retry: SnapshotMessage[] = []
            for (const group of groupBySessionWindow(messages)) {
                if (!context.canContinue() || !host.canDeliver()) {
                    retry.push(...group)
                    continue
                }
                const statusCode = await post(host, group, context.signal)
                if (isRetryable(statusCode)) {
                    retry.push(...group)
                } else if (statusCode >= 400) {
                    host.reportFailure(new Error(`Replay snapshot request failed with HTTP ${statusCode}`))
                }
            }
            return retry.length ? { retry } : undefined
        },
    })
    return {
        enqueue: (message, bytes) => {
            buffer.enqueue(message, bytes)
        },
        flush: () => lane.flush(),
        teardown: () => {
            // snapshots already in flight finish on their own; resending them would duplicate them
            const queued = buffer._queue.map((entry) => entry[1])
            if (!queued.length || !host.canDeliver()) return
            const budget = { remaining: UNLOAD_BUDGET_BYTES }
            const queue = {
                take: (messages: readonly SnapshotMessage[]) => {
                    for (const message of messages) buffer.discardQueued(message)
                },
                restore: (messages: readonly SnapshotMessage[]) => {
                    for (const message of messages) buffer.enqueue(message, snapshotBytes(message))
                },
            }
            for (const group of groupBySessionWindow(queued)) {
                try {
                    sendOnUnload(host, group, budget, queue)
                } catch (error) {
                    host.reportFailure(error)
                }
            }
        },
        purge: () => buffer.purge(),
        dispose: () => lane.dispose(),
    }
}
