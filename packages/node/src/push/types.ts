import type { PushError } from './errors'

/**
 * Options for `posthog.push.send()`.
 */
export interface SendPushOptions {
  /** The UUID of a push notification template made transactional in PostHog. */
  templateId: string
  /**
   * The distinct ID of the person to notify. The notification goes to every device this person
   * registered for the template's push channels. A person with no registered device gets nothing,
   * and the send shows as skipped in the template's sends.
   */
  distinctId: string
  /**
   * Values for the template's `{{ variables.* }}` placeholders. Sent as `message_data`. The template
   * can't read the person's properties, so pass everything it needs here.
   */
  templateData?: Record<string, unknown>
  /**
   * 1 to 255 visible ASCII characters. A send with a key that PostHog has already accepted queues
   * nothing and returns the first send's result. Without it, the client makes a UUID that covers its
   * own retries. Pass a key derived from what the notification is for, such as `order-shipped:1042`,
   * to cover retries outside this call too.
   */
  idempotencyKey?: string
  /** Overrides the client's `emailRequestMaxRetries` for this send. `0` turns retries off. */
  maxRetries?: number
}

/**
 * The queued push notification. A result means PostHog queued it, not that a device received it.
 */
export interface SendPushResult {
  /** The queued send's message ID. */
  id: string
  /** True when PostHog had already accepted this idempotency key and returned the first send's result. */
  replayed: boolean
}

/**
 * What `posthog.push.send()` resolves to. Exactly one of `data` and `error` is set.
 * The promise does not reject.
 */
export type SendPushResponse = { data: SendPushResult; error: null } | { data: null; error: PushError }

/**
 * What happened to a sent push notification:
 *
 * - `sending`: it is still going out, or PostHog hasn't recorded its outcome yet.
 * - `sent`: Apple or Google accepted it for at least one of the person's devices.
 * - `not_sent`: none of the person's devices got it, and `reason` says why.
 * - `failed`: the send stopped with an error.
 */
export type PushDeliveryStatus = 'sending' | 'sent' | 'not_sent' | 'failed'

/** The status of a push notification that `posthog.push.send()` queued. */
export interface PushStatus {
  /** The message ID that `send()` returned. */
  id: string
  status: PushDeliveryStatus | (string & {})
  /** When PostHog accepted the send, as an ISO 8601 timestamp. */
  createdAt: string
  /** Why a push notification was not sent or failed, such as `no_device` or `provider_error`. Null otherwise. */
  reason: string | null
}

/**
 * What `posthog.push.get()` resolves to. Exactly one of `data` and `error` is set.
 * The promise does not reject.
 */
export type GetPushResponse = { data: PushStatus; error: null } | { data: null; error: PushError }

/**
 * The `posthog.push` API: sends transactional push notifications from PostHog push templates, and
 * reads what happened to a sent one.
 */
export interface Push {
  /**
   * Queue one push notification from a transactional push template, to every device of one person.
   *
   * Resolves to `{ data, error }` and does not reject. `data` means PostHog queued the notification,
   * not that a device received it. Network errors, rate limits, an in-flight idempotency key and an
   * unavailable service are retried with the same idempotency key.
   */
  send(options: SendPushOptions): Promise<SendPushResponse>

  /**
   * Read what happened to a push notification that `send()` queued, for 30 days after the send.
   *
   * Resolves to `{ data, error }` and does not reject. The error code is `not_found` when no push
   * notification of this project has the ID, when it is older than 30 days, or for a few seconds
   * after the send. Network errors, rate limits and an unavailable service are retried.
   */
  get(id: string): Promise<GetPushResponse>
}
