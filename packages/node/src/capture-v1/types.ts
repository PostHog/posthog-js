import type { PostHogEventProperties } from '@posthog/core'

/** Capture lane for analytics events. */
export const ANALYTICS_CAPTURE_ENDPOINT = '/i/v1/analytics/events'

/** Capture lane for events sent through `captureAi`. */
export const AI_CAPTURE_ENDPOINT = '/i/v1/ai/events'

export type CaptureEndpoint = typeof ANALYTICS_CAPTURE_ENDPOINT | typeof AI_CAPTURE_ENDPOINT

/**
 * Typed `options` object on a Capture V1 event. Legacy `$`-prefixed sentinel
 * properties are lifted here (renamed + strictly typed) by the transform.
 * Always serialized as an object (`{}` when empty), never `null`.
 */
export interface V1EventOptions {
  cookieless_mode?: boolean
  disable_skew_correction?: boolean
  process_person_profile?: boolean
  product_tour_id?: string
}

/**
 * A single event in a Capture V1 batch.
 * `session_id`/`window_id` are promoted from the `$session_id`/`$window_id`
 * sentinels; there is no top-level `api_key`.
 */
export interface V1Event {
  event: string
  uuid: string
  distinct_id: string
  timestamp: string
  session_id?: string
  window_id?: string
  options: V1EventOptions
  properties: PostHogEventProperties
}

/**
 * Per-event result codes in a v1 2xx response body. Unknown strings are
 * tolerated as terminal success for forward compatibility.
 */
export type V1ResultCode = 'ok' | 'warning' | 'drop' | 'retry'

export interface V1EventResult {
  result: V1ResultCode | string
  details?: string | null
  /** How many later copies of this uuid in the request the server dropped as duplicates. */
  duplicates_dropped?: number
}

/** Shape of a v1 2xx response body: a per-uuid map of results. */
export interface V1BatchResponse {
  results: Record<string, V1EventResult>
}
