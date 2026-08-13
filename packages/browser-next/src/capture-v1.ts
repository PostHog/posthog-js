import type { ApiResponse } from '@posthog/browser-common'

import { createId } from './id'
import type { RequestRuntime } from './request'

const ANALYTICS_PATH = '/i/v1/analytics/events'
const RETRYABLE_STATUSES = [408, 500, 502, 503, 504]
const DEFAULT_MAX_ATTEMPTS = 4
const DEFAULT_RETRY_DELAY_MS = 3_000
const DEFAULT_MAX_BACKOFF_MS = 30_000

export interface CaptureV1Message {
    event: string
    uuid: string
    distinctId: string
    timestamp: string
    properties: Record<string, unknown>
    set?: Record<string, unknown>
    setOnce?: Record<string, unknown>
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
    now?: () => number
    random?: () => number
    sleep?: (delayMs: number) => Promise<void>
    generateRequestId?: () => string
    /** Re-checked before and after backoff so consent revocation or disposal stops retries. */
    canRetry?: () => boolean
}

interface AttemptResult {
    response?: Response
    result: CaptureV1Result
    retryEvents: CaptureV1Event[]
}

const isBoolean = (value: unknown): value is boolean => value === true || value === false
const isNumber = (value: unknown): value is number => Number.isFinite(value as number)
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
const eventIds = (events: CaptureV1Event[]): string[] => events.map(({ uuid }) => uuid)

const coerceBoolean = (value: unknown): boolean | undefined => {
    if (isBoolean(value)) {
        return value
    }
    if (isNumber(value)) {
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
    if (message.set !== undefined && properties.$set === undefined) {
        properties.$set = message.set
    }
    if (message.setOnce !== undefined && properties.$set_once === undefined) {
        properties.$set_once = message.setOnce
    }

    return {
        event: message.event,
        uuid: message.uuid,
        distinct_id: message.distinctId,
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
    now: () => number
): Promise<AttemptResult> => {
    let body: string
    try {
        body = JSON.stringify({ created_at: createdAt, batch: events })
    } catch (error) {
        return {
            result: { statusCode: 0, retry: eventIds(events), drops: [], error },
            retryEvents: [],
        }
    }

    let response: Response
    try {
        response = await runtime.fetch!(`${runtime.hosts.api}${ANALYTICS_PATH}`, {
            method: 'POST',
            credentials: 'omit',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${runtime.projectToken}`,
                'PostHog-Sdk-Info': `posthog-js/${libraryVersion}`,
                'PostHog-Attempt': String(attempt),
                'PostHog-Request-Id': requestId,
                'PostHog-Request-Timestamp': isoNow(now),
            },
            body,
        })
    } catch (error) {
        return {
            result: { statusCode: 0, retry: eventIds(events), drops: [], error },
            retryEvents: events,
        }
    }

    const status = response.status
    const retryableStatus = RETRYABLE_STATUSES.includes(status)
    let text: string
    try {
        text = await response.text()
    } catch (error) {
        const retryEvents = (status >= 200 && status < 300) || retryableStatus ? events : []
        return {
            response,
            result: { statusCode: status, retry: eventIds(retryEvents), drops: [], error },
            retryEvents,
        }
    }

    let json: unknown
    if (text) {
        try {
            json = JSON.parse(text)
        } catch {
            json = undefined
        }
    }
    const base = {
        statusCode: status,
        ...(text ? { text } : {}),
        ...(json !== undefined ? { json } : {}),
    }
    if (status < 200 || status >= 300) {
        const suffix = text ? `: ${text.slice(0, 512)}` : ''
        return {
            response,
            result: {
                ...base,
                retry: retryableStatus ? eventIds(events) : [],
                drops: [],
                error: new Error(`Capture V1 request failed with HTTP ${status}${suffix}`),
            },
            retryEvents: retryableStatus ? events : [],
        }
    }

    if (!isRecord(json) || (json.results !== undefined && !isRecord(json.results))) {
        return {
            response,
            result: {
                ...base,
                retry: [],
                drops: [],
                error: new Error(`Capture V1 returned an unparseable ${status} response body`),
            },
            retryEvents: [],
        }
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

    return {
        response,
        result: {
            ...base,
            retry: eventIds(retryEvents),
            drops,
            ...(retryEvents.length || drops.length
                ? { error: new Error('Capture V1 did not accept every event') }
                : {}),
        },
        retryEvents,
    }
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
    if (!runtime.fetch) {
        return {
            statusCode: 0,
            retry: messages.map(({ uuid }) => uuid),
            drops: [],
            error: new Error('Fetch is not available'),
        }
    }

    const now = options.now ?? Date.now
    const random = options.random ?? Math.random
    const sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => globalThis.setTimeout(resolve, delayMs)))
    const configuredAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
    const configuredInitialDelay = options.initialRetryDelayMs ?? DEFAULT_RETRY_DELAY_MS
    const configuredMaxBackoff = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
    const maxAttempts = Math.max(
        1,
        Number.isFinite(configuredAttempts) ? Math.floor(configuredAttempts) : DEFAULT_MAX_ATTEMPTS
    )
    const initialDelayMs = Math.max(
        0,
        Number.isFinite(configuredInitialDelay) ? configuredInitialDelay : DEFAULT_RETRY_DELAY_MS
    )
    const maxBackoffMs = Math.max(
        0,
        Number.isFinite(configuredMaxBackoff) ? configuredMaxBackoff : DEFAULT_MAX_BACKOFF_MS
    )
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
        return { statusCode: 0, retry: messages.map(({ uuid }) => uuid), drops: [], error }
    }

    const drops: CaptureV1Drop[] = []
    let latest: CaptureV1Result = { statusCode: 0, retry: eventIds(pending), drops: [] }
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let outcome: AttemptResult
        try {
            outcome = await attemptOnce(runtime, pending, libraryVersion, createdAt, requestId, attempt, now)
        } catch (error) {
            outcome = {
                result: { statusCode: 0, retry: eventIds(pending), drops: [], error },
                retryEvents: pending,
            }
        }
        latest = outcome.result
        drops.push(...latest.drops)
        if (outcome.retryEvents.length === 0) {
            return {
                ...latest,
                drops,
                ...(drops.length ? { error: latest.error ?? new Error('Capture V1 dropped one or more events') } : {}),
            }
        }
        pending = outcome.retryEvents
        if (attempt === maxAttempts) {
            return {
                ...latest,
                retry: eventIds(pending),
                drops,
                error: latest.error ?? new Error('Capture V1 exhausted its retry budget'),
            }
        }

        let canRetry = true
        try {
            canRetry = options.canRetry?.() ?? true
        } catch {
            canRetry = false
        }
        if (!canRetry) {
            return {
                ...latest,
                retry: eventIds(pending),
                drops,
                error: new Error('Capture V1 retry was cancelled'),
            }
        }

        const delay = retryDelay(attempt, initialDelayMs, maxBackoffMs, random, parseRetryAfter(outcome.response, now))
        try {
            await sleep(delay)
            if (options.canRetry && !options.canRetry()) {
                throw new Error('Capture V1 retry was cancelled')
            }
        } catch (error) {
            return { ...latest, retry: eventIds(pending), drops, error }
        }
    }

    return { ...latest, retry: eventIds(pending), drops }
}
