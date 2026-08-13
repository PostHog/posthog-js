import type { ApiResponse } from '@posthog/browser-common'

import { createId } from './id'
import type { RequestRuntime } from './request'

const ANALYTICS_PATH = '/i/v1/analytics/events'
const RETRYABLE_STATUSES = [408, 500, 502, 503, 504]

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
    retry: string[]
    drops: CaptureV1Drop[]
}

const isoNow = (): string => {
    try {
        return new Date().toISOString()
    } catch {
        return '1970-01-01T00:00:00.000Z'
    }
}

const isBoolean = (value: unknown): value is boolean => value === true || value === false
const isNumber = (value: unknown): value is number => Number.isFinite(value as number)

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

const failedResult = (messages: CaptureV1Message[], error: unknown): CaptureV1Result => ({
    statusCode: 0,
    retry: messages.map(({ uuid }) => uuid),
    drops: [],
    error,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

export const sendCaptureV1Batch = async (
    runtime: RequestRuntime,
    messages: CaptureV1Message[],
    libraryVersion: string
): Promise<CaptureV1Result> => {
    if (messages.length === 0) {
        return { statusCode: 204, retry: [], drops: [] }
    }
    if (!runtime.fetch) {
        return failedResult(messages, new Error('Fetch is not available'))
    }

    const createdAt = isoNow()
    let body: string
    try {
        body = JSON.stringify({
            created_at: createdAt,
            batch: messages.map(buildCaptureV1Event),
        })
    } catch (error) {
        return failedResult(messages, error)
    }

    let response: Response
    try {
        response = await runtime.fetch(`${runtime.hosts.api}${ANALYTICS_PATH}`, {
            method: 'POST',
            credentials: 'omit',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${runtime.projectToken}`,
                'PostHog-Sdk-Info': `posthog-js/${libraryVersion}`,
                'PostHog-Attempt': '1',
                'PostHog-Request-Id': createId(),
                'PostHog-Request-Timestamp': isoNow(),
            },
            body,
        })
    } catch (error) {
        return failedResult(messages, error)
    }

    let text: string
    try {
        text = await response.text()
    } catch (error) {
        const retry =
            response.ok || RETRYABLE_STATUSES.includes(response.status) ? messages.map(({ uuid }) => uuid) : []
        return { statusCode: response.status, retry, drops: [], error }
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
        statusCode: response.status,
        ...(text ? { text } : {}),
        ...(json !== undefined ? { json } : {}),
    }
    if (!response.ok) {
        return {
            ...base,
            retry: RETRYABLE_STATUSES.includes(response.status) ? messages.map(({ uuid }) => uuid) : [],
            drops: [],
        }
    }

    if (!isRecord(json) || (json.results !== undefined && !isRecord(json.results))) {
        return {
            ...base,
            retry: [],
            drops: [],
            error: new Error(`Capture V1 returned an unparseable ${response.status} response body`),
        }
    }

    const results = isRecord(json.results) ? json.results : {}
    const retry: string[] = []
    const drops: CaptureV1Drop[] = []
    for (const { uuid } of messages) {
        const result = results[uuid]
        if (!isRecord(result)) {
            continue
        }
        if (result.result === 'retry') {
            retry.push(uuid)
        } else if (result.result === 'drop') {
            drops.push({ uuid, ...(typeof result.details === 'string' ? { details: result.details } : {}) })
        }
    }

    return {
        ...base,
        retry,
        drops,
        ...(retry.length || drops.length ? { error: new Error('Capture V1 did not accept every event') } : {}),
    }
}
