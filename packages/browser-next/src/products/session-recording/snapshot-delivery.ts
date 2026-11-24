import { gzipText } from '@posthog/browser-common/replay/event-compression'
import { EventBuffer } from '../analytics/admission/event-buffer'
import { nativeGzip } from '../../platform/gzip'
import { cancelResponseBody } from '../analytics/delivery/capture-v1'
import { Lane } from '../analytics/delivery/lane'
import { parseRetryAfter, retryDelay } from '../analytics/delivery/retry-delay'
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
const RETRY_INTERVAL_MS = 1000
// posthog-js's default request timeout, so a stalled request cannot block later snapshots and flush()
const REQUEST_TIMEOUT_MS = 60_000
const MAX_RETRY_INTERVAL_MS = 30_000
// network errors (0) and the transient statuses the other client SDKs and sdk-specs retry-queue retry
const RETRYABLE_STATUSES = [0, 408, 429, 500, 502, 503, 504]

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
): Promise<[statusCode: number, retryAfterMs?: number | undefined]> => {
    const fetch = host.runtime[2]
    if (!fetch) return [0]
    const payload = JSON.stringify(withSentAt(messages))
    // gzip bodies are recognized by their magic bytes; posthog-js sends them the same way
    const compressed = host.gzipEnabled() ? await gzip(payload) : undefined
    const body = compressed ?? payload
    const bytes =
        typeof body === 'string' ? new TextEncoder().encode(body).length : 'size' in body ? body.size : body.length
    // as in posthog-js, every upload that fits the shared budget is keepalive, so one in flight at unload completes
    const budget = host.runtime[4]
    const reserved = bytes <= budget.remaining ? bytes : 0
    const controller = new AbortController()
    const abort = () => controller.abort()
    const timer = setTimeout(abort, REQUEST_TIMEOUT_MS)
    // oxlint-disable-next-line posthog-js/no-add-event-listener
    signal?.addEventListener('abort', abort)
    if (signal?.aborted) abort()
    budget.remaining -= reserved
    try {
        const response = await fetch(endpointUrl(host), {
            method: 'POST',
            credentials: 'omit',
            headers: { 'Content-Type': compressed ? 'text/plain' : 'application/json' },
            body: body as BodyInit,
            keepalive: !!reserved,
            signal: controller.signal,
        })
        const result: [number, number | undefined] = [response.status, parseRetryAfter(response, Date.now)]
        // posthog-js reads every response; an unread keepalive response keeps its bytes in Chromium's quota
        await cancelResponseBody(response)
        return result
    } catch {
        // network errors and timeouts are retried
        return [0]
    } finally {
        budget.remaining += reserved
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
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
 * Hands queued snapshots to the browser as the page unloads. Beacons and keepalive requests share the
 * browser's keepalive quota, so replay splits batches to fit this unload's allowance and sends what does
 * not fit as a regular request, which completes when the page lingers (for example in the back/forward
 * cache). Only keepalive requests reserve bytes from the client's keepalive budget, which analytics
 * shares, and they return them when they settle, as in posthog-js. Snapshots leave the queue while they
 * are sent, and return to it when that send fails, so a page that survives retries them instead of
 * losing or duplicating them.
 */
const sendOnUnload = (
    host: SnapshotDeliveryHost,
    messages: readonly SnapshotMessage[],
    allowance: { remaining: number },
    queue: { take(messages: readonly SnapshotMessage[]): void; restore(messages: readonly SnapshotMessage[]): void }
): void => {
    const encoded = unloadBody(host, messages)
    const url = endpointUrl(host, encoded.query)
    const navigator = host.runtime[3]
    const fetch = host.runtime[2]
    const request = (keepalive: boolean): void => {
        if (!fetch) return
        queue.take(messages)
        // a keepalive request holds its bytes in the shared budget until it settles, as capture-v1 holds them
        const budget = host.runtime[4]
        const reserved = keepalive ? encoded.bytes : 0
        const release = (): void => {
            budget.remaining += reserved
        }
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
            .then(release, release)
        // reserved only once fetch accepted the request, so a synchronous throw holds nothing
        budget.remaining -= reserved
    }
    if (encoded.bytes <= allowance.remaining) {
        allowance.remaining -= encoded.bytes
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
    // split only while a snapshot of average size still fits what is left, since every split encodes its half again
    if (messages.length > 1 && encoded.bytes <= allowance.remaining * messages.length) {
        const middle = Math.ceil(messages.length / 2)
        sendOnUnload(host, messages.slice(0, middle), allowance, queue)
        sendOnUnload(host, messages.slice(middle), allowance, queue)
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
    // consecutive failed deliveries; the retry interval backs off with them and resets on success
    let failures = 0
    let retryInterval = RETRY_INTERVAL_MS
    // the queue waits out the backoff, as the other client SDKs pause theirs, even once the failed batch is evicted or expires
    let retryAt = 0
    lane.attach({
        batchSize: MAX_BATCH_SNAPSHOTS,
        // each snapshot sends on arrival, except while a failed delivery waits to retry
        get flushAt() {
            return retryAt > buffer._now() ? MAX_QUEUED_SNAPSHOTS + 1 : 1
        },
        get flushInterval() {
            return retryInterval
        },
        canDeliver: () => !!host.runtime[2] && host.canDeliver(),
        async deliver(messages, context) {
            const retry: SnapshotMessage[] = []
            let posted = false
            let failed = false
            let retryAfter = 0
            for (const group of groupBySessionWindow(messages)) {
                // offline snapshots wait for the next retry without counting as failures
                if (!context.canContinue() || !host.canDeliver() || host.runtime[3]?.onLine === false) {
                    retry.push(...group)
                    continue
                }
                posted = true
                const [statusCode, groupRetryAfter] = await post(host, group, context.signal)
                if (RETRYABLE_STATUSES.includes(statusCode)) {
                    failed = true
                    retry.push(...group)
                    retryAfter = Math.max(retryAfter, groupRetryAfter ?? 0)
                } else if (statusCode >= 400) {
                    host.reportFailure(new Error(`Replay snapshot request failed with HTTP ${statusCode}`))
                }
            }
            if (failed) {
                retryInterval = retryDelay(
                    ++failures,
                    RETRY_INTERVAL_MS,
                    MAX_RETRY_INTERVAL_MS,
                    Math.random,
                    retryAfter
                )
            } else if (posted) {
                failures = 0
                retryInterval = RETRY_INTERVAL_MS
            }
            retryAt = retry.length ? buffer._now() + retryInterval : 0
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
            // this unload's share of the browser quota, which beacons spend without holding the shared budget
            const allowance = { remaining: host.runtime[4].remaining }
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
                    sendOnUnload(host, group, allowance, queue)
                } catch (error) {
                    host.reportFailure(error)
                }
            }
        },
        purge: () => buffer.purge(),
        dispose: () => lane.dispose(),
    }
}
