import type { ApiResponse } from '@posthog/browser-common'

import { createId } from './id'
import type { RequestRuntime } from './request'

const RETRYABLE_STATUSES = [408, 500, 502, 503, 504]

export interface CaptureV1Message {
    event: string
    uuid: string
    distinct_id: string
    timestamp: string
    properties: Record<string, unknown>
}

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
    generateRequestId?: () => string
    /** Re-checked before and after backoff so consent revocation or disposal stops retries. */
    canRetry?: () => boolean
}

type AttemptResult = [CaptureV1Result, CaptureV1Event[], Response | undefined]

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
const eventIds = (events: { uuid: string }[]): string[] => events.map(({ uuid }) => uuid)
const failedResult = (events: { uuid: string }[], error: unknown, statusCode = 0): CaptureV1Result => ({
    statusCode,
    retry: eventIds(events),
    drops: [],
    error,
})
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

const attemptOnce = async (
    runtime: RequestRuntime,
    events: CaptureV1Event[],
    libraryVersion: string,
    createdAt: string,
    requestId: string,
    attempt: number,
    now: () => number,
    timeoutMs: number,
    remainingTime: () => number
): Promise<AttemptResult> => {
    let body: string
    try {
        body = JSON.stringify({ created_at: createdAt, batch: events })
    } catch (error) {
        return [failedResult(events, error), [], undefined]
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
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${runtime[1]}`,
            'PostHog-Sdk-Info': `posthog-js/${libraryVersion}`,
            'PostHog-Attempt': String(attempt),
            'PostHog-Request-Id': requestId,
            'PostHog-Request-Timestamp': isoNow(now),
        },
        body,
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
    const retryEvents: CaptureV1Event[] = []
    const drops: CaptureV1Drop[] = []
    for (const event of events) {
        const outcome = results[event.uuid]
        if (!isRecord(outcome)) {
            continue
        }
        if (outcome.result === 'retry') {
            retryEvents.push(event)
        } else if (outcome.result === 'drop') {
            drops.push({
                uuid: event.uuid,
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
    const sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => globalThis.setTimeout(resolve, delayMs)))
    const maxAttempts = Math.floor(numberOption(options.maxAttempts, 4, 1))
    const initialDelayMs = numberOption(options.initialRetryDelayMs, 3_000, 0)
    const maxBackoffMs = numberOption(options.maxBackoffMs, 30_000, 0)
    const requestTimeoutMs = Math.floor(numberOption(options.requestTimeoutMs, 10_000, 1))
    const maxElapsedMs = Math.floor(numberOption(options.maxElapsedMs, 60_000, 1))
    const elapsedNow = options.elapsedNow ?? (() => globalThis.performance?.now() ?? Date.now())
    const startedAt = safeNow(elapsedNow)
    const remainingTime = (): number => maxElapsedMs - Math.max(0, safeNow(elapsedNow) - startedAt)
    let requestId: string
    try {
        requestId = (options.generateRequestId ?? createId)()
    } catch {
        requestId = `capture-${isoNow(now)}`
    }
    const createdAt = isoNow(now)

    let pending: CaptureV1Event[]
    try {
        pending = messages.map(buildCaptureV1Event)
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

        let retryEvents: CaptureV1Event[]
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
                remainingTime
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

        let allowed = true
        try {
            allowed = options.canRetry?.() ?? true
        } catch {
            allowed = false
        }
        if (!allowed) {
            return finish(new Error('Capture V1 retry was cancelled'))
        }

        const delay = retryDelay(attempt, initialDelayMs, maxBackoffMs, random, parseRetryAfter(response, now))
        if (delay >= remainingTime()) {
            return finish(new Error('Capture V1 exhausted its elapsed retry budget'))
        }
        try {
            await sleep(delay)
            if (options.canRetry && !options.canRetry()) {
                throw new Error('Capture V1 retry was cancelled')
            }
        } catch (error) {
            return finish(error)
        }
    }

    latest.retry = eventIds(pending)
    latest.drops = drops
    return latest
}
