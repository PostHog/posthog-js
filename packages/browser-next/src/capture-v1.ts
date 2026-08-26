import type { ApiResponse } from '@posthog/browser-common'

import type { AnalyticsMessage } from './analytics-internal'
import { createId } from './id'
import type { RequestRuntime } from './request'

const RETRYABLE_STATUSES = [408, 500, 502, 503, 504]

export const CAPTURE_V1_MAX_BATCH_EVENTS = 100
export const CAPTURE_V1_BATCH_TARGET_BYTES = 5 * 1024 * 1024
export const CAPTURE_V1_COMPRESSION_THRESHOLD_BYTES = 1024
const DEFAULT_COMPRESSION_TIMEOUT_MS = 1_000

export type CaptureV1Message = AnalyticsMessage

interface CaptureV1EventOptions {
    cookieless_mode?: boolean
    disable_skew_correction?: boolean
    process_person_profile?: boolean
    product_tour_id?: string
}

export interface CaptureV1Event {
    event: string
    uuid: string
    distinct_id: string
    timestamp: string
    session_id?: string
    window_id?: string
    options: CaptureV1EventOptions
    properties: Record<string, unknown>
}

export interface CaptureV1Drop {
    uuid: string
    details?: string
}

export interface CaptureV1Result extends ApiResponse {
    /** UUIDs still undelivered when the sender's own attempt budget ended. */
    retry: string[]
    drops: CaptureV1Drop[]
}

interface PreparedCaptureV1Event {
    readonly source: CaptureV1Message
    readonly event: CaptureV1Event
    readonly uuid: string
    readonly json: string
    readonly bytes: number
}

interface CaptureV1SenderOptions {
    maxAttempts?: number
    initialRetryDelayMs?: number
    maxBackoffMs?: number
    requestTimeoutMs?: number
    maxElapsedMs?: number
    now?: () => number
    elapsedNow?: () => number
    random?: () => number
    sleep?: (delayMs: number) => Promise<void>
    signal?: AbortSignal
    generateRequestId?: () => string
    compressionEnabled?: boolean
    compressionThresholdBytes?: number
    compressionTimeoutMs?: number
    compress?: (payload: string) => Promise<Blob | undefined>
    /** Re-checked before and after backoff so consent revocation or disposal stops retries. */
    canRetry?: () => boolean
    /** Prepared input shared by the byte partitioner so transformed events serialize only once. */
    prepared?: PreparedCaptureV1Event[]
    createdAt?: string
}

interface CaptureV1BatchesOptions extends CaptureV1SenderOptions {
    maxBatchEvents?: number
    targetBatchBytes?: number
}

interface CaptureV1BatchesResult extends CaptureV1Result {
    /** Original admitted messages still undelivered, preserving identity across duplicate UUIDs. */
    retryMessages: CaptureV1Message[]
}

type AttemptResult = [CaptureV1Result, PreparedCaptureV1Event[], Response | undefined]

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
const eventIds = (events: { uuid: string }[]): string[] => events.map(({ uuid }) => uuid)
const failedResult = (events: { uuid: string }[], error: unknown, statusCode = 0): CaptureV1Result => ({
    statusCode,
    retry: eventIds(events),
    drops: [],
    error,
})

const utf8Bytes = (value: string): number => {
    let bytes = 0
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index)
        if (code < 0x80) {
            bytes++
        } else if (code < 0x800) {
            bytes += 2
        } else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00) {
            bytes += 4
            index++
        } else {
            bytes += 3
        }
    }
    return bytes
}

const prepareEvents = (messages: CaptureV1Message[]): PreparedCaptureV1Event[] =>
    messages.map((source) => {
        const event = buildCaptureV1Event(source)
        const json = JSON.stringify(event)
        return { source, event, uuid: event.uuid, json, bytes: utf8Bytes(json) }
    })

const serializeEnvelope = (createdAt: string, events: PreparedCaptureV1Event[]): string =>
    `{"created_at":${JSON.stringify(createdAt)},"batch":[${events.map(({ json }) => json).join(',')}]}`

const partitionEvents = (
    events: PreparedCaptureV1Event[],
    createdAt: string,
    maxBatchEvents: number,
    targetBatchBytes: number
): PreparedCaptureV1Event[][] => {
    const batches: PreparedCaptureV1Event[][] = []
    const emptyBytes = utf8Bytes(serializeEnvelope(createdAt, []))
    let batch: PreparedCaptureV1Event[] = []
    let bytes = emptyBytes

    for (const event of events) {
        const addedBytes = event.bytes + (batch.length ? 1 : 0)
        if (batch.length && (batch.length >= maxBatchEvents || bytes + addedBytes > targetBatchBytes)) {
            batches.push(batch)
            batch = []
            bytes = emptyBytes
        }
        batch.push(event)
        bytes += event.bytes + (batch.length > 1 ? 1 : 0)
    }
    if (batch.length) {
        batches.push(batch)
    }
    return batches
}

let gzipCrcTable: number[] | undefined
const gzipCrc32 = (bytes: Uint8Array): number => {
    if (!gzipCrcTable) {
        gzipCrcTable = Array.from({ length: 256 }, (_, value) => {
            let crc = value
            for (let bit = 0; bit < 8; bit++) {
                crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
            }
            return crc >>> 0
        })
    }
    let crc = 0xffffffff
    for (const byte of bytes) {
        crc = gzipCrcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
}

const nativeGzip = async (payload: string): Promise<Blob | undefined> => {
    try {
        const CompressionStreamConstructor = globalThis.CompressionStream
        const TextEncoderConstructor = globalThis.TextEncoder
        const ResponseConstructor = globalThis.Response
        if (
            typeof CompressionStreamConstructor !== 'function' ||
            typeof TextEncoderConstructor !== 'function' ||
            typeof ResponseConstructor !== 'function'
        ) {
            return undefined
        }

        const input = new TextEncoderConstructor().encode(payload)
        const stream = new CompressionStreamConstructor('gzip')
        const writer = stream.writable.getWriter()
        const write = writer
            .write(input)
            .then(() => writer.close())
            .catch(async (error) => {
                try {
                    await writer.abort(error)
                } catch {
                    // Preserve the original compression failure.
                }
                throw error
            })
        const compressed = await Promise.all([new ResponseConstructor(stream.readable).blob(), write]).then(
            ([blob]) => blob
        )
        if (compressed.size < 18) {
            return undefined
        }
        const [headerBuffer, trailerBuffer] = await Promise.all([
            compressed.slice(0, 3).arrayBuffer(),
            compressed.slice(compressed.size - 8).arrayBuffer(),
        ])
        const header = new Uint8Array(headerBuffer)
        const trailer = new DataView(trailerBuffer)
        return header[0] === 0x1f &&
            header[1] === 0x8b &&
            header[2] === 0x08 &&
            trailer.getUint32(0, true) === gzipCrc32(input) &&
            trailer.getUint32(4, true) === input.length >>> 0
            ? compressed
            : undefined
    } catch {
        return undefined
    }
}

const compressWithDeadline = async (
    payload: string,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    compress: (payload: string) => Promise<Blob | undefined>
): Promise<Blob | undefined> => {
    let timer: number | undefined
    let onAbort: (() => void) | undefined
    const operation = Promise.resolve()
        .then(() => compress(payload))
        .catch(() => undefined)
    const interrupted = new Promise<undefined>((resolve) => {
        try {
            timer = globalThis.setTimeout(resolve, timeoutMs)
        } catch {
            resolve(undefined)
            return
        }
        if (signal) {
            onAbort = () => resolve(undefined)
            try {
                // eslint-disable-next-line posthog-js/no-add-event-listener
                signal.addEventListener('abort', onAbort, { once: true })
                if (signal.aborted) {
                    onAbort()
                }
            } catch {
                onAbort = undefined
            }
        }
    })
    try {
        return await Promise.race([operation, interrupted])
    } finally {
        if (timer !== undefined) {
            globalThis.clearTimeout(timer)
        }
        if (onAbort) {
            try {
                signal?.removeEventListener('abort', onAbort)
            } catch {
                // Listener cleanup is best effort for injected signals.
            }
        }
    }
}

const cancelResponseBody = (response: Response | undefined): void => {
    try {
        void response?.body?.cancel().catch(() => {})
    } catch {
        // Cancellation is best-effort for late or timed-out responses.
    }
}

const coerceBoolean = (value: unknown): boolean | undefined => {
    // eslint-disable-next-line posthog-js/no-direct-boolean-check
    if (typeof value === 'boolean') {
        return value
    }
    // eslint-disable-next-line posthog-js/no-direct-number-check
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value !== 0
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (normalized === 'true' || normalized === '1') {
            return true
        }
        if (normalized === 'false' || normalized === '0') {
            return false
        }
    }
    return undefined
}

export const buildCaptureV1Event = (message: CaptureV1Message): CaptureV1Event => {
    const properties = { ...message.properties }
    const options: CaptureV1EventOptions = {}
    const optionSentinels = [
        ['$cookieless_mode', 'cookieless_mode'],
        ['$ignore_sent_at', 'disable_skew_correction'],
        ['$process_person_profile', 'process_person_profile'],
    ] as const
    for (const [property, option] of optionSentinels) {
        const value = coerceBoolean(properties[property])
        if (value !== undefined) {
            options[option] = value
        }
        delete properties[property]
    }
    if (typeof properties.$product_tour_id === 'string') {
        options.product_tour_id = properties.$product_tour_id
    }
    delete properties.$product_tour_id

    const sessionId = properties.$session_id
    const windowId = properties.$window_id
    delete properties.$session_id
    delete properties.$window_id
    delete properties.$lib
    delete properties.$lib_version
    delete properties.token
    delete properties.distinct_id

    return {
        event: message.event,
        uuid: message.uuid,
        distinct_id: message.distinct_id,
        timestamp: message.timestamp,
        ...(typeof sessionId === 'string' ? { session_id: sessionId } : {}),
        ...(typeof windowId === 'string' ? { window_id: windowId } : {}),
        options,
        properties,
    }
}

const safeNow = (now: () => number): number => {
    try {
        const value = now()
        return Number.isFinite(value) ? value : 0
    } catch {
        return 0
    }
}

const isoNow = (now: () => number): string => {
    try {
        return new Date(safeNow(now)).toISOString()
    } catch {
        return '1970-01-01T00:00:00.000Z'
    }
}

const parseRetryAfter = (response: Response | undefined, now: () => number): number | undefined => {
    try {
        const raw = response?.headers.get('Retry-After')?.trim()
        if (!raw) {
            return undefined
        }
        if (/^\d+$/.test(raw)) {
            const milliseconds = Number(raw) * 1_000
            return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : undefined
        }
        const delay = Date.parse(raw) - safeNow(now)
        return delay > 0 ? delay : undefined
    } catch {
        return undefined
    }
}

const numberOption = (value: number | undefined, fallback: number, minimum: number): number =>
    Math.max(minimum, Number.isFinite(value) ? value! : fallback)

const retryDelay = (
    attempt: number,
    initialDelayMs: number,
    maxBackoffMs: number,
    random: () => number,
    retryAfterMs?: number
): number => {
    const exponential = Math.min(initialDelayMs * 2 ** (attempt - 1), maxBackoffMs)
    let randomValue = 0.5
    try {
        const candidate = random()
        if (Number.isFinite(candidate)) {
            randomValue = Math.max(0, Math.min(1, candidate))
        }
    } catch {
        // The midpoint gives an unjittered delay when randomness is unavailable.
    }
    const jittered = Math.min(maxBackoffMs, Math.ceil(exponential * (0.5 + randomValue)))
    return retryAfterMs === undefined ? jittered : Math.max(jittered, Math.min(retryAfterMs, maxBackoffMs))
}

const cancellationError = (): Error => new Error('Capture V1 retry was cancelled')
const canContinue = (check: (() => boolean) | undefined): boolean => {
    try {
        return check?.() ?? true
    } catch {
        return false
    }
}

const waitForRetry = async (
    delayMs: number,
    sleep: ((delayMs: number) => Promise<void>) | undefined,
    signal: AbortSignal | undefined
): Promise<void> => {
    if (signal?.aborted) {
        throw cancellationError()
    }
    if (!signal && sleep) {
        return sleep(delayMs)
    }

    let timer: ReturnType<typeof globalThis.setTimeout> | undefined
    let onAbort: (() => void) | undefined
    const wait = sleep
        ? sleep(delayMs)
        : new Promise<void>((resolve) => {
              timer = globalThis.setTimeout(resolve, delayMs)
          })
    if (!signal) {
        return wait
    }

    const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => {
            if (timer !== undefined) {
                globalThis.clearTimeout(timer)
            }
            reject(cancellationError())
        }
        try {
            // eslint-disable-next-line posthog-js/no-add-event-listener
            signal.addEventListener('abort', onAbort, { once: true })
            if (signal.aborted) {
                onAbort()
            }
        } catch {
            onAbort = undefined
        }
    })
    try {
        await (onAbort ? Promise.race([wait, cancelled]) : wait)
    } finally {
        if (onAbort) {
            try {
                signal.removeEventListener('abort', onAbort)
            } catch {
                // Listener cleanup is best effort for injected signals.
            }
        }
    }
}

const attemptOnce = async (
    runtime: RequestRuntime,
    events: PreparedCaptureV1Event[],
    libraryVersion: string,
    createdAt: string,
    requestId: string,
    attempt: number,
    now: () => number,
    timeoutMs: number,
    remainingTime: () => number,
    compressionEnabled: boolean,
    compressionThresholdBytes: number,
    compressionTimeoutMs: number,
    compress: (payload: string) => Promise<Blob | undefined>,
    signal: AbortSignal | undefined,
    continuationCheck: (() => boolean) | undefined
): Promise<AttemptResult> => {
    if (!canContinue(continuationCheck)) {
        return [failedResult(events, cancellationError()), events, undefined]
    }
    const body = serializeEnvelope(createdAt, events)
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${runtime[1]}`,
        'PostHog-Sdk-Info': `posthog-js/${libraryVersion}`,
        'PostHog-Attempt': String(attempt),
        'PostHog-Request-Id': requestId,
        'PostHog-Request-Timestamp': isoNow(now),
    }
    let requestBody: BodyInit = body
    if (compressionEnabled && utf8Bytes(body) >= compressionThresholdBytes) {
        const compressed = await compressWithDeadline(
            body,
            Math.max(1, Math.min(compressionTimeoutMs, remainingTime())),
            signal,
            compress
        )
        if (signal?.aborted || !canContinue(continuationCheck)) {
            return [failedResult(events, cancellationError()), events, undefined]
        }
        if (compressed && compressed.size < utf8Bytes(body)) {
            requestBody = compressed
            headers['Content-Encoding'] = 'gzip'
        }
    }

    let controller: AbortController | undefined
    try {
        controller = new AbortController()
    } catch {
        // The deadline race still bounds injected Fetch implementations without AbortController.
    }

    const requestInit: RequestInit = {
        method: 'POST',
        credentials: 'omit',
        headers,
        body: requestBody,
        ...(controller ? { signal: controller.signal } : {}),
    }
    const remainingAfterSetup = remainingTime()
    if (remainingAfterSetup <= 0) {
        return [failedResult(events, new Error('Capture V1 exhausted its elapsed retry budget')), events, undefined]
    }
    const attemptTimeoutMs = Math.max(1, Math.min(timeoutMs, remainingAfterSetup))

    let response: Response | undefined
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined
    let timedOut = false
    let timeoutPhase = 'waiting for response headers'
    const deadline = new Promise<never>((_resolve, reject) => {
        timer = globalThis.setTimeout(() => {
            timedOut = true
            const error = new Error(`Capture V1 request timed out ${timeoutPhase} after ${attemptTimeoutMs}ms`)
            error.name = 'AbortError'
            // Reject first so this error wins if an abort-aware Fetch rejects synchronously.
            reject(error)
            try {
                controller?.abort(error)
            } catch {
                // The deadline race remains authoritative when abort throws.
            }
            cancelResponseBody(response)
        }, attemptTimeoutMs)
    })

    let text: string
    try {
        const fetchPromise = runtime[2]!(`${runtime[0].api}/i/v1/analytics/events`, requestInit)
        void fetchPromise.then(
            (lateResponse) => {
                if (timedOut && !response) {
                    cancelResponseBody(lateResponse)
                }
            },
            () => {}
        )
        response = await Promise.race([fetchPromise, deadline])
        timeoutPhase = 'while reading the response body'
        text = await Promise.race([response.text(), deadline])
    } catch (error) {
        const status = response?.status ?? 0
        const retryEvents =
            !response || (status >= 200 && status < 300) || RETRYABLE_STATUSES.includes(status) ? events : []
        return [failedResult(retryEvents, error, status), retryEvents, response]
    } finally {
        if (timer !== undefined) {
            globalThis.clearTimeout(timer)
        }
    }

    const status = response.status
    const retryableStatus = RETRYABLE_STATUSES.includes(status)

    let json: unknown
    if (text) {
        try {
            json = JSON.parse(text)
        } catch {
            json = undefined
        }
    }
    if (status < 200 || status >= 300) {
        const suffix = text ? `: ${text.slice(0, 512)}` : ''
        const retryEvents = retryableStatus ? events : []
        return [
            failedResult(retryEvents, new Error(`Capture V1 request failed with HTTP ${status}${suffix}`), status),
            retryEvents,
            response,
        ]
    }

    if (!isRecord(json) || (json.results !== undefined && !isRecord(json.results))) {
        return [
            failedResult([], new Error(`Capture V1 returned an unparseable ${status} response body`), status),
            [],
            response,
        ]
    }

    const results = isRecord(json.results) ? json.results : {}
    const retryEvents: PreparedCaptureV1Event[] = []
    const drops: CaptureV1Drop[] = []
    for (const prepared of events) {
        const outcome = results[prepared.uuid]
        if (!isRecord(outcome)) {
            continue
        }
        if (outcome.result === 'retry') {
            retryEvents.push(prepared)
        } else if (outcome.result === 'drop') {
            drops.push({
                uuid: prepared.uuid,
                ...(typeof outcome.details === 'string' ? { details: outcome.details } : {}),
            })
        }
    }

    return [{ statusCode: status, retry: eventIds(retryEvents), drops }, retryEvents, response]
}

export const sendCaptureV1Batch = async (
    runtime: RequestRuntime,
    messages: CaptureV1Message[],
    libraryVersion: string,
    options: CaptureV1SenderOptions = {}
): Promise<CaptureV1Result> => {
    if (messages.length === 0) {
        return { statusCode: 204, retry: [], drops: [] }
    }
    if (!runtime[2]) {
        return failedResult(messages, new Error('Fetch is not available'))
    }

    const now = options.now ?? Date.now
    const random = options.random ?? Math.random
    // Defaults: 4 attempts, 3s initial delay, 30s backoff, 10s request timeout, 60s total.
    const maxAttempts = Math.floor(numberOption(options.maxAttempts, 4, 1))
    const initialDelayMs = numberOption(options.initialRetryDelayMs, 3_000, 0)
    const maxBackoffMs = numberOption(options.maxBackoffMs, 30_000, 0)
    const requestTimeoutMs = Math.floor(numberOption(options.requestTimeoutMs, 10_000, 1))
    const maxElapsedMs = Math.floor(numberOption(options.maxElapsedMs, 60_000, 1))
    const compressionThresholdBytes = Math.floor(
        numberOption(options.compressionThresholdBytes, CAPTURE_V1_COMPRESSION_THRESHOLD_BYTES, 0)
    )
    const compressionTimeoutMs = Math.floor(
        numberOption(options.compressionTimeoutMs, DEFAULT_COMPRESSION_TIMEOUT_MS, 1)
    )
    const elapsedNow = options.elapsedNow ?? (() => globalThis.performance?.now() ?? Date.now())
    const startedAt = safeNow(elapsedNow)
    const remainingTime = (): number => maxElapsedMs - Math.max(0, safeNow(elapsedNow) - startedAt)
    let requestId: string
    try {
        requestId = (options.generateRequestId ?? createId)()
    } catch {
        requestId = `capture-${isoNow(now)}`
    }
    const createdAt = options.createdAt ?? isoNow(now)

    let pending: PreparedCaptureV1Event[]
    try {
        pending = options.prepared ?? prepareEvents(messages)
    } catch (error) {
        return failedResult(messages, error)
    }

    const drops: CaptureV1Drop[] = []
    let latest: CaptureV1Result = { statusCode: 0, retry: eventIds(pending), drops: [] }
    const finish = (error: unknown): CaptureV1Result => {
        latest.retry = eventIds(pending)
        latest.drops = drops
        latest.error = error
        return latest
    }
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const remainingBeforeAttempt = remainingTime()
        if (remainingBeforeAttempt <= 0) {
            return finish(new Error('Capture V1 exhausted its elapsed retry budget'))
        }

        let retryEvents: PreparedCaptureV1Event[]
        let response: Response | undefined
        try {
            ;[latest, retryEvents, response] = await attemptOnce(
                runtime,
                pending,
                libraryVersion,
                createdAt,
                requestId,
                attempt,
                now,
                requestTimeoutMs,
                remainingTime,
                options.compressionEnabled ?? false,
                compressionThresholdBytes,
                compressionTimeoutMs,
                options.compress ?? nativeGzip,
                options.signal,
                options.canRetry
            )
        } catch (error) {
            latest = failedResult(pending, error)
            retryEvents = pending
        }
        drops.push(...latest.drops)
        if (retryEvents.length === 0) {
            latest.drops = drops
            if (drops.length) {
                latest.error ??= new Error('Capture V1 dropped one or more events')
            }
            return latest
        }
        pending = retryEvents
        if (attempt === maxAttempts) {
            return finish(latest.error ?? new Error('Capture V1 exhausted its retry budget'))
        }

        if (!canContinue(options.canRetry)) {
            return finish(new Error('Capture V1 retry was cancelled'))
        }

        const delay = retryDelay(attempt, initialDelayMs, maxBackoffMs, random, parseRetryAfter(response, now))
        if (delay >= remainingTime()) {
            return finish(new Error('Capture V1 exhausted its elapsed retry budget'))
        }
        try {
            await waitForRetry(delay, options.sleep, options.signal)
            if (!canContinue(options.canRetry)) {
                throw cancellationError()
            }
        } catch (error) {
            return finish(error)
        }
    }

    latest.retry = eventIds(pending)
    latest.drops = drops
    return latest
}

/**
 * Greedily partitions one admitted FIFO slice by event count and exact uncompressed
 * Capture V1 envelope bytes, then sends each logical request in order. The byte
 * target is soft: one admitted event is always allowed to form a request by itself.
 */
export const sendCaptureV1Batches = async (
    runtime: RequestRuntime,
    messages: CaptureV1Message[],
    libraryVersion: string,
    options: CaptureV1BatchesOptions = {}
): Promise<CaptureV1BatchesResult> => {
    if (messages.length === 0) {
        return { statusCode: 204, retry: [], retryMessages: [], drops: [] }
    }

    const now = options.now ?? Date.now
    const elapsedNow = options.elapsedNow ?? (() => globalThis.performance?.now() ?? Date.now())
    const maxElapsedMs = Math.floor(numberOption(options.maxElapsedMs, 60_000, 1))
    const startedAt = safeNow(elapsedNow)
    const remainingTime = (): number => maxElapsedMs - Math.max(0, safeNow(elapsedNow) - startedAt)
    const partitionCreatedAt = isoNow(now)
    let events: PreparedCaptureV1Event[]
    try {
        events = prepareEvents(messages)
    } catch (error) {
        return { ...failedResult(messages, error), retryMessages: messages }
    }

    const maxBatchEvents = Math.floor(numberOption(options.maxBatchEvents, CAPTURE_V1_MAX_BATCH_EVENTS, 1))
    const targetBatchBytes = Math.floor(numberOption(options.targetBatchBytes, CAPTURE_V1_BATCH_TARGET_BYTES, 1))
    const batches = partitionEvents(events, partitionCreatedAt, maxBatchEvents, targetBatchBytes)
    const aggregate: CaptureV1BatchesResult = { statusCode: 204, retry: [], retryMessages: [], drops: [] }

    for (let index = 0; index < batches.length; index++) {
        const remaining = remainingTime()
        const cancelled = !canContinue(options.canRetry) || options.signal?.aborted
        if (cancelled || remaining <= 0) {
            const unsent = batches.slice(index).flat()
            aggregate.retry.push(...eventIds(unsent))
            aggregate.retryMessages.push(...unsent.map(({ source }) => source))
            aggregate.error ??= new Error(
                cancelled ? 'Capture V1 retry was cancelled' : 'Capture V1 exhausted its elapsed retry budget'
            )
            return aggregate
        }

        const batch = batches[index]!
        const createdAt = isoNow(now)
        const result = await sendCaptureV1Batch(
            runtime,
            batch.map(({ source }) => source),
            libraryVersion,
            {
                ...options,
                createdAt,
                prepared: batch,
                maxElapsedMs: remaining,
            }
        )
        aggregate.statusCode = result.statusCode
        aggregate.retry.push(...result.retry)
        const retryIds = new Set(result.retry)
        aggregate.retryMessages.push(...batch.filter(({ uuid }) => retryIds.has(uuid)).map(({ source }) => source))
        aggregate.drops.push(...result.drops)
        if (result.error !== undefined) {
            aggregate.error ??= result.error
        }
    }

    return aggregate
}
