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
