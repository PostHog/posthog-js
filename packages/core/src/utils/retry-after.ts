/**
 * Longest `Retry-After` the SDK will wait. A rate-limit window can legitimately
 * be long, but nothing upstream of the SDK bounds this header — it is as likely
 * to come from a proxy or CDN as from PostHog — and an unbounded value would
 * strand a queue for hours, so the wait is capped and the retry happens early.
 *
 * Deliberately outside the `utils` barrel: that barrel is re-exported wholesale
 * from the package entry point, and this is internal policy, not public API.
 */
export const MAX_RETRY_AFTER_MS = 5 * 60_000

/**
 * How far the wall clock may run behind the moment a window was installed before
 * the window is discarded. NTP corrections on a healthy host are milliseconds,
 * so a step past this is a clock change the deadline can no longer measure.
 */
const CLOCK_STEP_TOLERANCE_MS = 5_000

/**
 * `Retry-After` as milliseconds from now. The header is either delta-seconds or
 * an HTTP-date; anything else, a date already in the past, or a non-positive
 * delta yields `undefined` so the caller keeps its own backoff. The result is
 * capped at `MAX_RETRY_AFTER_MS`.
 */
export function parseRetryAfterMs(value: unknown, now: number = Date.now()): number | undefined {
  if (typeof value !== 'string' || !value) {
    return undefined
  }
  const raw = value.trim()
  // `headers.get` joins repeated headers with ", ", so a CDN and a load
  // balancer that each append one yield "60, 120". Read the first, which the
  // outermost hop set — but only for delta-seconds, since an HTTP-date carries
  // a comma of its own ("Wed, 21 Oct 2015 07:28:00 GMT").
  const trimmed = /^\d+\s*,/.test(raw) ? raw.slice(0, raw.indexOf(',')).trim() : raw
  // Integer seconds. Not parseFloat: "10 minutes" must not read as 10 seconds.
  const seconds = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
  if (!Number.isFinite(seconds) && /^[+-]?[\d.]+$/.test(trimmed)) {
    // Numeric but not delta-seconds, so it is malformed. `Date.parse` reads
    // "-5", "+5" and "5.5" as dates in 2001 rather than rejecting them, which
    // on a device whose clock predates that would surface as a real wait.
    return undefined
  }
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(trimmed) - now
  if (!Number.isFinite(ms) || ms <= 0) {
    return undefined
  }
  return Math.min(ms, MAX_RETRY_AFTER_MS)
}

/** The part of an export outcome the window reads. */
export type RetryAfterOutcome = {
  kind: 'ok' | 'retry-later' | 'too-large' | 'fatal'
  retryAfterMs?: number
}

/**
 * The wait an ingestion endpoint asked for, shared by the logs, metrics and
 * traces export queues.
 *
 * Held as an absolute deadline rather than a duration, so a timer armed while
 * the wait is already part-served counts down the remainder instead of
 * restarting it.
 */
export class RetryAfterWindow {
  private _until = 0
  private _installedAt = 0

  /**
   * Folds one export outcome into the window.
   *
   * A window still open is left as it stands, even when the refusal names a
   * longer wait than the one being served. Sliding the deadline on each refusal
   * means the window never elapses for a host that flushes faster than the
   * window is long: logs gates its size trigger and `onReconnect` on the
   * window, and metrics re-arms its timer from it, so neither would recover
   * while such a host kept sending. Whether it is still open is read here
   * rather than passed in, so a send that outlives the wait it was made under
   * installs the fresh deadline it came back with.
   */
  record(outcome: RetryAfterOutcome): void {
    if (outcome.kind === 'too-large') {
      // A verdict on the body's size, whether the SDK's own or the endpoint's
      // 413, and either way silent on the endpoint's rate limit.
      return
    }
    if (outcome.kind !== 'retry-later') {
      // A stale deadline left set here would pin every later send at a window
      // the endpoint has moved on from.
      this.reset()
      return
    }
    if (!outcome.retryAfterMs || this.isOpen()) {
      // A refusal that names no wait — a network error, a timeout, a
      // header-less 503 — does not revoke one the endpoint already named.
      return
    }
    this._installedAt = Date.now()
    this._until = this._installedAt + Math.min(outcome.retryAfterMs, MAX_RETRY_AFTER_MS)
  }

  /**
   * Milliseconds left of the wait, `0` when none is open. Closes a window it
   * finds spent, so a later backward clock step cannot bring it back.
   */
  remainingMs(): number {
    const now = Date.now()
    if (now < this._installedAt - CLOCK_STEP_TOLERANCE_MS) {
      this.reset()
      return 0
    }
    const remaining = Math.min(MAX_RETRY_AFTER_MS, Math.max(0, this._until - now))
    if (remaining === 0) {
      this.reset()
    }
    return remaining
  }

  isOpen(): boolean {
    return this.remainingMs() > 0
  }

  reset(): void {
    this._until = 0
    this._installedAt = 0
  }
}
