/** Doublings the retry delay may grow by before it stops growing. */
export const MAX_FLUSH_BACKOFF_EXPONENT = 6

/**
 * Ceiling on the SDK's own retry delay, which the logs and traces contracts
 * both state as "exponential backoff capped at ~30s". A host that configured a
 * longer flush interval keeps it: the cap is there to stop the doubling running
 * away, not to flush more often than asked.
 */
export const MAX_FLUSH_BACKOFF_MS = 30_000

/**
 * How far a delay may be moved either side of its computed value. Clients that
 * fail together otherwise retry together, and arrive at the endpoint as one
 * burst each time it comes back — which is what OTel asks jitter to prevent.
 *
 * A quarter is enough to spread a fleet without a retry landing so early that
 * it beats the interval the host configured, or so late that a recovered
 * endpoint sits idle.
 */
const JITTER = 0.25

/** A multiplier in `[1 - JITTER, 1 + JITTER]`, drawn once per failure by the caller. */
export function drawJitter(): number {
  return 1 - JITTER + Math.random() * JITTER * 2
}

/** No jitter, for the delay a queue uses when nothing has failed. */
export const NO_JITTER = 1

/**
 * The delay before retrying an export, `baseMs` doubled once per failure past
 * the first and capped at `maxMs`.
 *
 * `jitter` is applied to the SDK's own delay only. A `Retry-After` the endpoint
 * sent is a floor underneath it, applied by the caller: spreading a fleet must
 * never move a retry earlier than the endpoint asked for.
 */
export function backoffDelayMs(baseMs: number, failures: number, jitter: number, maxMs?: number): number {
  const exponent = Math.min(Math.max(0, failures - 1), MAX_FLUSH_BACKOFF_EXPONENT)
  const delay = baseMs * 2 ** exponent
  const capped = maxMs === undefined ? delay : Math.min(delay, Math.max(maxMs, baseMs))
  return Math.round(capped * jitter)
}
