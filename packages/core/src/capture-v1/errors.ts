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

/** Counts of undelivered events by cause, in the order the causes first occurred. */
export class CaptureLossTally {
  private readonly counts = new Map<string, number>()

  add(cause: string, count: number): void {
    if (count > 0) {
      this.counts.set(cause, (this.counts.get(cause) ?? 0) + count)
    }
  }

  get total(): number {
    let total = 0
    for (const count of this.counts.values()) {
      total += count
    }
    return total
  }

  entries(): [cause: string, count: number][] {
    return [...this.counts]
  }
}

/**
 * The one line logged for a capture loss when nothing listens for `'error'`. It holds the lane,
 * counts and causes only: never server response text, event content or uuids.
 */
export function describeCaptureLoss(endpoint: CaptureEndpoint, loss: CaptureLossTally): string {
  const causes = loss.entries().map(([cause, count]) => `${count} ${cause}`)
  return `${loss.total} event(s) were not delivered to ${endpoint}: ${causes.join(', ')}`
}
