import type { SessionRecordingOptions } from '@posthog/types'

type RecordingOptions = Omit<
    SessionRecordingOptions,
    | `__${string}`
    | 'full_snapshot_interval_millis'
    | 'trigger_pending_buffer_interval_millis'
    | 'compress_events'
    | 'session_idle_threshold_ms'
>

export interface ReplayOptions extends RecordingOptions {
    fullSnapshotIntervalMs?: number
    triggerPendingBufferIntervalMs?: number
    compressEvents?: boolean
    sessionIdleThresholdMs?: number
    consoleLogRecordingEnabled?: boolean
    networkTiming?: boolean
    disableCaptureUrlHashes?: boolean
    maskPersonalData?: boolean
    personalDataQueryParams?: string[]
}

export type ReplayConfiguration = false | ReplayOptions

// Replay options contain callbacks and nested masking/sampling settings, not just JSON data.
export const snapshotReplayOptions = (options: ReplayOptions = {}): ReplayOptions => {
    const copy = (value: unknown): unknown => {
        if (value instanceof RegExp) return new RegExp(value.source, value.flags)
        if (Array.isArray(value)) return value.map(copy)
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copy(entry)]))
        }
        return value
    }
    return copy(options) as ReplayOptions
}
