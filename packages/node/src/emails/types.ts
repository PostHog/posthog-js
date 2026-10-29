import type { EmailError } from './errors'

/** What every send takes, whatever its form. */
export interface SendEmailBase {
  /** One recipient email address. */
  to: string
  /**
   * The recipient's distinct ID in your product. The email's events go to this person.
   * Without it, they go to a person whose distinct ID is the email address.
   */
  distinctId?: string
  /**
   * 1 to 255 visible ASCII characters. A send with a key that PostHog has already accepted
   * queues nothing and returns the first send's result. The same key with other options sends
   * nothing and returns `invalid_idempotent_request`. Without it, the client makes a UUID that
   * covers its own retries. Pass a key derived from what the email is for, such as
   * `welcome:user_123`, to cover retries outside this call too.
   */
  idempotencyKey?: string
  /** Overrides the client's `emailRequestMaxRetries` for this send. `0` turns retries off. */
  maxRetries?: number
}

/** A template made transactional in PostHog, sent by its ID. */
export interface TemplateEmailForm {
  /** The UUID of an email template made transactional in PostHog. */
  templateId: string
  /** Values for the template's `{{ variables.* }}` placeholders. Sent as `message_data`. */
  templateData?: Record<string, unknown>
}

interface CodeEmailFields {
  /**
   * Names the email, such as `'password-reset'`, so its metrics, logs and status group under it
   * in PostHog. Letters, digits, hyphens and underscores, at most 400.
   */
  templateKey: string
  subject: string
  /** A verified sender, such as `'Acme <security@example.com>'`. Without it, the project's default sender. */
  from?: string
  replyTo?: string | string[]
  /**
   * Whether PostHog captures the email's engagement events (sent, delivered, opened, clicked,
   * bounced) as events of the recipient. Defaults to `true`. A project whose admin turned
   * engagement capture off captures nothing, whatever the send asks. A template made in PostHog
   * follows the project's setting.
   */
  captureEngagement?: boolean
}

/**
 * Email content your code rendered, such as React Email output, named by a key. PostHog sends it
 * as is and never stores it. Needs `html`, `text` or both. PostHog derives a missing `text` from
 * the `html`.
 */
export type CodeEmailForm = CodeEmailFields & ({ html: string; text?: string } | { html?: string; text: string })

type Without<T> = { [K in keyof T]?: never }

export type SendTemplateEmailOptions = SendEmailBase &
  TemplateEmailForm &
  Without<CodeEmailFields & { html: string; text: string }>

export type SendCodeEmailOptions = SendEmailBase & CodeEmailForm & Without<TemplateEmailForm>

/** Options for `posthog.emails.send()`: a template made in PostHog, or content from your code. */
export type SendEmailOptions = SendTemplateEmailOptions | SendCodeEmailOptions

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
  /** The queued email's message ID. */
  id: string
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
 * What happened to an email. Later SDK versions can see values this list does not have yet.
 *
 * - `queued`: the email waits to go out.
 * - `sent`: PostHog handed the email to the email provider.
 * - `failed`: the email was not sent, and `reason` says why.
 * - `delivered`: the recipient's mail server accepted the email.
 * - `bounced` and `complained`: the recipient's mail provider reported them after delivery.
 */
export type EmailDeliveryStatus = 'queued' | 'sent' | 'failed' | 'delivered' | 'bounced' | 'complained'

/** The status of an email that `posthog.emails.send()` queued. */
export interface EmailStatus {
  /** The message ID that `send()` returned. */
  id: string
  status: EmailDeliveryStatus | (string & {})
  /** When PostHog queued the email, as an ISO 8601 timestamp. */
  createdAt: string
  /** When the email reached its current status, as an ISO 8601 timestamp. */
  statusAt: string
  /**
   * Why a failed email was not sent, such as `provider_error` or `recipient_suppressed`, or the
   * bounce type of a bounced email: `hard`, `soft` or `unknown`. Null otherwise.
   */
  reason: string | null
}

/**
 * What `posthog.emails.get()` resolves to. Exactly one of `data` and `error` is set.
 * The promise does not reject.
 */
export type GetEmailResponse = { data: EmailStatus; error: null } | { data: null; error: EmailError }

/**
 * The `posthog.emails` API: sends transactional email from PostHog email templates or from
 * content your code rendered, and reads the status of each email it sent.
 */
export interface Emails {
  /**
   * Queue one email, from a transactional email template or from content your code rendered.
   *
   * Resolves to `{ data, error }` and does not reject. `data` means PostHog queued the email,
   * not that it was delivered. Network errors, rate limits, an in-flight idempotency key and
   * an unavailable service are retried with the same idempotency key.
   */
  send(options: SendEmailOptions): Promise<SendEmailResponse>

  /**
   * Read the status of an email that `send()` queued, for 30 days after the send.
   *
   * Resolves to `{ data, error }` and does not reject. The error code is `not_found` when no
   * email of this project has the ID, when the email is older than 30 days, or for a few
   * seconds after the send. Network errors, rate limits and an unavailable service are retried.
   */
  get(id: string): Promise<GetEmailResponse>
}
