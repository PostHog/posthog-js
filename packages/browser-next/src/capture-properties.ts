import type { CaptureOptions } from '@posthog/browser-common'

export interface CaptureProperties {
    message: Record<string, unknown>
    observed: Record<string, unknown>
    uuid: string | undefined
    timestamp: Date | undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

const parseMessageProperties = (json: string): Record<string, unknown> => {
    const properties: unknown = JSON.parse(json, function (this: unknown, _key: string, value: unknown) {
        return value === null && !Array.isArray(this) ? undefined : value
    })
    if (!isRecord(properties)) throw new Error('Event properties must serialize to an object')
    return properties
}

/** Invoke caller serialization once, before selecting the authoritative session. */
export const snapshotCaptureProperties = (
    dynamic: Record<string, unknown>,
    properties: Record<string, unknown> | null,
    options: CaptureOptions
): CaptureProperties => {
    const supplied = { ...dynamic, ...(properties ?? {}) }
    const set = options.set
    const setOnce = options.setOnce
    const uuid = options.uuid
    const timestamp = options.timestamp
    if (set) supplied['$set'] = set
    if (setOnce) supplied['$set_once'] = setOnce
    const json = JSON.stringify(supplied)
    const message = parseMessageProperties(json)
    const observed: Record<string, unknown> = JSON.parse(json)
    return { message, observed, uuid, timestamp }
}
