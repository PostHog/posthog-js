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
 * The `posthog.push` API: sends transactional push notifications from PostHog push templates.
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
}
