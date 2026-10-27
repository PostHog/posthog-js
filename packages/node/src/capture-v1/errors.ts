import type { CaptureEndpoint } from './types'

/** A single event the server explicitly rejected (`drop`). */
export interface CaptureDroppedEvent {
  uuid: string
  details?: string
}

export interface CaptureErrorParams {
  /** The capture lane the batch was sent to. */
  endpoint: CaptureEndpoint
  requestId: string
  /** Events the server rejected outright (billing/validation). */
  drops: CaptureDroppedEvent[]
  /** UUIDs of events still pending `retry` after the attempt budget was exhausted, or lost to a batch-level failure. */
  retryExhausted: string[]
  /** The underlying transport/HTTP/parse failure, when the whole batch failed. */
  cause?: unknown
}

/**
 * Surfaced on the client error channel whenever a capture batch did not
 * fully deliver: some events were `drop`ped, some `retry` events outlived the
 * attempt budget, or the batch hit a terminal transport/HTTP/parse failure.
 *
 * A 2xx with drops is still a partial failure and is reported here — a
 * successful HTTP status does not mean every event was accepted.
 */
export class CaptureError extends Error {
  name = 'CaptureError'
  readonly endpoint: CaptureEndpoint
  readonly requestId: string
  readonly drops: CaptureDroppedEvent[]
  readonly retryExhausted: string[]
  cause?: unknown

  constructor({ endpoint, requestId, drops, retryExhausted, cause }: CaptureErrorParams) {
    super(CaptureError.buildMessage(endpoint, requestId, drops, retryExhausted, cause))
    this.endpoint = endpoint
    this.requestId = requestId
    this.drops = drops
    this.retryExhausted = retryExhausted
    this.cause = cause
  }

  private static buildMessage(
    endpoint: CaptureEndpoint,
    requestId: string,
    drops: CaptureDroppedEvent[],
    retryExhausted: string[],
    cause: unknown
  ): string {
    let message = `Capture batch ${requestId} to ${endpoint} did not fully deliver: ${drops.length} dropped, ${retryExhausted.length} undelivered`
    if (cause instanceof Error) {
      message += ` (${cause.message})`
    }
    return message
  }
}
