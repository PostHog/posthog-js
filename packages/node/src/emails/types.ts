import type { EmailError } from './errors'

/**
 * Options for `posthog.emails.send()`.
 */
export interface SendEmailOptions {
  /** One recipient email address. */
  to: string
  /** The UUID of an email template made transactional in PostHog. */
  templateId: string
  /** Values for the template's `{{ variables.* }}` placeholders. Sent as `message_data`. */
  templateData?: Record<string, unknown>
  /**
   * The recipient's distinct ID in your product. The email's events go to this person.
   * Without it, they go to a person whose distinct ID is the email address.
   */
  distinctId?: string
  /**
   * 1 to 255 visible ASCII characters. A send with a key that PostHog has already accepted
   * queues nothing and returns the first send's result. Without it, the client makes a
   * UUID that covers its own retries. Pass a key derived from what the email is for, such
   * as `welcome:user_123`, to cover retries outside this call too.
   */
  idempotencyKey?: string
  /** Overrides the client's `emailRequestMaxRetries` for this send. `0` turns retries off. */
  maxRetries?: number
}

/** A warning PostHog returned with a queued email. */
export interface EmailWarning {
  code: string
  message: string
  fix?: string
}

/**
 * The queued email. A result means PostHog queued the email, not that it was delivered.
 */
export interface SendEmailResult {
  /** The queued email's message ID. `null` when the client is disabled and sent nothing. */
  id: string | null
  /** True when PostHog had already accepted this idempotency key and returned the first send's result. */
  replayed: boolean
  warnings: EmailWarning[]
}

/**
 * What `posthog.emails.send()` resolves to. Exactly one of `data` and `error` is set.
 * The promise does not reject.
 */
export type SendEmailResponse = { data: SendEmailResult; error: null } | { data: null; error: EmailError }

/**
 * The `posthog.emails` API: sends transactional email from PostHog email templates.
 */
export interface Emails {
  /**
   * Queue one email from a transactional email template.
   *
   * Resolves to `{ data, error }` and does not reject. `data` means PostHog queued the email,
   * not that it was delivered. Network errors, rate limits, an in-flight idempotency key and
   * an unavailable service are retried with the same idempotency key.
   */
  send(options: SendEmailOptions): Promise<SendEmailResponse>
}
