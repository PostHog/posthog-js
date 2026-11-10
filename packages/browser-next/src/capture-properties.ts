import type { CaptureOptions } from '@posthog/browser-common'

export interface CaptureProperties {
    message: Record<string, unknown>
    observed: Record<string, unknown>
    /** A root toJSON function controls the complete application context. */
    overrides: ReadonlySet<string> | undefined
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
    registered: Record<string, unknown> | undefined,
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
    const combined = { ...registered, ...supplied }
    const overrides = typeof combined.toJSON === 'function' ? undefined : new Set(Object.keys(supplied))
    const json = JSON.stringify(combined)
    const message = parseMessageProperties(json)
    const observed: Record<string, unknown> = JSON.parse(json)
    return { message, observed, overrides, uuid, timestamp }
}

/** Session values override persistent defaults, not explicit caller or dynamic values. */
export const applySessionProperties = (snapshot: CaptureProperties, values: Record<string, unknown>): boolean => {
    const overrides = snapshot.overrides
    if (!overrides) return false
    const entries = Object.entries(values).filter(([key]) => !overrides.has(key))
    if (entries.length === 0) return false
    const session = Object.fromEntries(entries)
    const message = parseMessageProperties(JSON.stringify(session))
    for (const [key] of entries) delete snapshot.message[key]
    snapshot.message = { ...snapshot.message, ...message }
    snapshot.observed = { ...snapshot.observed, ...session }
    return true
}

/** A session layer cannot shrink explicit caller values or protected SDK metadata. */
export const unavoidableProperties = (
    snapshot: CaptureProperties,
    metadata: Record<string, unknown>
): Record<string, unknown> => ({
    ...Object.fromEntries(
        Object.entries(snapshot.message).filter(
            ([key]) => snapshot.overrides === undefined || snapshot.overrides.has(key)
        )
    ),
    ...metadata,
})
