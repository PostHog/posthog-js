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
   * nothing and returns an error with code `idempotency_key_reused`. Without it, the client makes a UUID that
   * covers its own retries. Pass a key derived from what the email is for, such as
   * `welcome:user_123`, to cover retries outside this call too.
   */
  idempotencyKey?: string
  /** Overrides the client's `emailRequestMaxRetries` for this send. `0` turns retries off. */
  maxRetries?: number
  /**
   * Send the email later, at most 30 days after this call: a `Date`, or an ISO 8601 string with
   * an offset, such as `'2026-12-01T09:00:00Z'` or `'2026-12-01T10:00:00+01:00'`. A string without
   * an offset fails before any request, so the email never goes out in a timezone you didn't pick.
   * A time at or before now sends at once. The idempotency key covers the time, so the same key
   * with another time sends nothing and returns `idempotency_key_reused`.
   *
   * Move the email with `emails.update()`, or stop it with `emails.cancel()`, until PostHog starts
   * sending it. posthog-node releases from before this option don't take it: from 5.62.0 they
   * refuse it before any request, and before 5.62.0 they drop it and send the email at once. A
   * self-hosted PostHog from before scheduled sends also sends it at once, and the result carries
   * the warning `scheduling_unsupported`.
   */
  scheduledAt?: Date | string
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
 * A React element, such as `<WelcomeEmail firstName="Ada" />`. Typed by its shape, so
 * posthog-node needs no React types.
 */
export interface EmailReactElement {
  type: unknown
  props: unknown
}

/**
 * Email content from your code, named by a key: `html`, `text` or both, or a `react` element
 * the client renders. PostHog sends it as is and never stores it. PostHog derives a missing
 * `text` from the `html`.
 */
export type CodeEmailForm = CodeEmailFields &
  (
    | { html: string; text?: string; react?: never }
    | { html?: string; text: string; react?: never }
    | {
        /**
         * A React Email element. The client renders it into `html`, and into `text` when the
         * send has none. Needs the `@react-email/render` package installed next to posthog-node.
         * The client renders the element after `send()` returns, so give each send its own
         * element and props, and don't change them while the send is pending.
         */
        react: EmailReactElement
        text?: string
        html?: never
      }
  )

type Without<T> = { [K in keyof T]?: never }

export type SendTemplateEmailOptions = SendEmailBase &
  TemplateEmailForm &
  Without<CodeEmailFields & { html: string; text: string; react: EmailReactElement }>

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
  /**
   * `scheduled` when the email waits for its `scheduledAt`, else `queued`. A replay returns the
   * first send's status; read the current one with `emails.get()`.
   */
  status: 'queued' | 'scheduled' | (string & {})
  /** When PostHog will send a scheduled email, as an ISO 8601 timestamp. Null for an email sent now. */
  scheduledAt: string | null
}

/**
 * What `posthog.emails.send()` resolves to. Exactly one of `data` and `error` is set.
 * The promise does not reject.
 */
export type SendEmailResponse = { data: SendEmailResult; error: null } | { data: null; error: EmailError }

/**
 * What happened to an email. Later SDK versions can see values this list does not have yet.
 *
 * - `scheduled`: the email waits for its `scheduledAt`, and stays `scheduled` after a move.
 * - `canceled`: `emails.cancel()` stopped the email before PostHog started sending it.
 * - `queued`: the email waits to go out.
 * - `sent`: PostHog handed the email to the email provider.
 * - `failed`: the email was not sent, and `reason` says why.
 * - `delivered`: the recipient's mail server accepted the email.
 * - `bounced` and `complained`: the recipient's mail provider reported them after delivery.
 */
export type EmailDeliveryStatus =
  | 'scheduled'
  | 'canceled'
  | 'queued'
  | 'sent'
  | 'failed'
  | 'delivered'
  | 'bounced'
  | 'complained'

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

/** Options for `posthog.emails.update()`. Only the time of a scheduled email can change. */
export interface UpdateEmailOptions {
  /** The message ID that `send()` returned. */
  id: string
  /**
   * The new send time: a `Date`, or an ISO 8601 string with an offset. It must stay within 30 days
   * of the first send call. A time at or before now sends the email at once.
   */
  scheduledAt: Date | string
}

/** A scheduled email after its move. */
export interface UpdateEmailResult {
  id: string
  /** `scheduled` until PostHog sends the email. */
  status: 'scheduled' | (string & {})
  /** When PostHog will send the email, as an ISO 8601 timestamp. */
  scheduledAt: string
}

/**
 * What `posthog.emails.update()` resolves to. Exactly one of `data` and `error` is set.
 * The promise does not reject.
 */
export type UpdateEmailResponse = { data: UpdateEmailResult; error: null } | { data: null; error: EmailError }

/** A canceled email. */
export interface CancelEmailResult {
  id: string
  status: 'canceled'
}

/**
 * What `posthog.emails.cancel()` resolves to. Exactly one of `data` and `error` is set.
 * The promise does not reject.
 */
export type CancelEmailResponse = { data: CancelEmailResult; error: null } | { data: null; error: EmailError }

/** Options for `posthog.emails.list()`. */
export interface ListEmailsOptions {
  /** Which emails to list. Only `scheduled` emails can be listed. */
  status: 'scheduled'
  /** The `next` cursor of the page before. Leave it out for the first page. */
  cursor?: string
  /** At most this many emails, 1 to 100. Defaults to 100. */
  limit?: number
}

/** A scheduled email that waits to go out. */
export interface ScheduledEmail {
  /** The message ID that `send()` returned. */
  id: string
  to: string
  /** When PostHog will send the email, as an ISO 8601 timestamp, after any move. */
  scheduledAt: string
  /** When PostHog accepted the send, as an ISO 8601 timestamp. */
  createdAt: string
}

/** One page of scheduled emails, in send-time order. */
export interface ListEmailsResult {
  results: ScheduledEmail[]
  /** Pass it as `cursor` to read the next page. Null on the last page. */
  next: string | null
}

/**
 * What `posthog.emails.list()` resolves to. Exactly one of `data` and `error` is set.
 * The promise does not reject.
 */
export type ListEmailsResponse = { data: ListEmailsResult; error: null } | { data: null; error: EmailError }

/**
 * Options for `posthog.emails.setPreferences()`. Set `allMarketing`, `topics`, or both.
 */
export interface SetEmailPreferencesOptions {
  /**
   * The recipient's email address, exactly as Workflows sends to it. Matching is exact, so `Jane@example.com` and
   * `jane@example.com` are two recipients.
   */
  to: string
  /** `false` opts the recipient out of every marketing topic. `true` lifts that opt-out. Applied before `topics`. */
  allMarketing?: boolean
  /**
   * Topic key to `false` to opt the recipient out of that topic, or `true` to opt them back in. Topic keys are the
   * ones you set under Workflows opt-outs. Opting back in to one marketing topic after an all-marketing opt-out lifts
   * that opt-out, so `allMarketing` becomes `true`, and keeps the other marketing topics opted out. Topics you leave out
   * keep their current choice.
   */
  topics?: Record<string, boolean>
}

/** A recipient's preferences after the change. */
export interface EmailPreferences {
  to: string
  /** `false` when the recipient opted out of all marketing, `true` when they opted back in, `null` when they never chose. */
  allMarketing: boolean | null
  /** Topic key to `false` (opted out) or `true` (opted in), for every topic the recipient chose. */
  topics: Record<string, boolean>
}

/**
 * What `posthog.emails.setPreferences()` resolves to. Exactly one of `data` and `error` is set.
 * The promise does not reject.
 */
export type SetEmailPreferencesResponse = { data: EmailPreferences; error: null } | { data: null; error: EmailError }

/**
 * The `posthog.emails` API: sends transactional email from PostHog email templates or from
 * content your code rendered, now or at a later time, reads the status of each email it sent,
 * moves, cancels and lists scheduled emails, and sets a recipient's topic preferences.
 */
export interface Emails {
  /**
   * Queue one email, from a transactional email template or from content your code rendered.
   *
   * Resolves to `{ data, error }` and does not reject. `data` means PostHog queued the email,
   * not that it was delivered. Network errors, rate limits, an in-flight idempotency key and
   * an unavailable service are retried with the same idempotency key. With `scheduledAt`, the
   * email waits until that time, and `data.status` is `scheduled`.
   */
  send(options: SendEmailOptions): Promise<SendEmailResponse>

  /**
   * Read the status of an email that `send()` queued, for 30 days after the send. A cancel can
   * take a few seconds to show here, as `emails.list()` says.
   *
   * Resolves to `{ data, error }` and does not reject. The error code is `not_found` when no
   * email of this project has the ID, when the email is older than 30 days, or for a few
   * seconds after the send. Network errors, rate limits and an unavailable service are retried.
   */
  get(id: string): Promise<GetEmailResponse>

  /**
   * Move a scheduled email to a new time. Only the time changes: to change the content, the
   * recipient or the sender, cancel the email and send it again.
   *
   * Resolves to `{ data, error }` and does not reject. The error code is `already_sending` while
   * PostHog sends the email, `not_found` a few seconds after it went out, `canceled` after a
   * cancel, and `invalid_scheduled_at` for a time more than 30 days after the first send call. A time at or before now sends the
   * email at once. Network errors, rate limits and an unavailable service are retried, because
   * the same move twice ends the same; after a move to now, the retry can answer `already_sending`,
   * which means the email is going out. Moves of one email from this client run one after another,
   * in call order, so a retry never undoes a later move.
   */
  update(options: UpdateEmailOptions): Promise<UpdateEmailResponse>

  /**
   * Stop a scheduled email before PostHog starts sending it. Its result reads `canceled` at once;
   * reads can lag it, as `emails.list()` says.
   *
   * Resolves to `{ data, error }` and does not reject. The error code is `already_sending` while
   * PostHog sends the email, and `not_found` a few seconds after it went out. A second cancel
   * answers the same as the first while PostHog can still tell, and `not_found` after that. Network errors, rate limits and an unavailable service
   * are retried.
   */
  cancel(id: string): Promise<CancelEmailResponse>

  /**
   * List the project's scheduled emails that wait to go out, in send-time order, one page per call.
   * A move or a cancel can take a few seconds to show here, and a cancel in `emails.get()`:
   * `emails.update()` returns the new time, and `emails.cancel()` returns `canceled`.
   *
   * Resolves to `{ data, error }` and does not reject. Never retried: call it again to read the
   * page again.
   */
  list(options: ListEmailsOptions): Promise<ListEmailsResponse>

  /**
   * Opt one recipient out of topics, or back in, in one request. PostHog saves the whole change at once. The same
   * change twice ends the same, but a retry that lands after a newer change for the same recipient undoes that
   * change. A failed call may still have saved the change. Workflows sends skip a marketing topic the recipient
   * opted out of.
   *
   * Resolves to `{ data, error }` and does not reject. The error code is `unknown_topic` when a topic key names no
   * topic of the project, and nothing is saved. A plain `not_found` means the PostHog instance has no preferences
   * API yet. Network errors, rate limits and an unavailable service are retried.
   */
  setPreferences(options: SetEmailPreferencesOptions): Promise<SetEmailPreferencesResponse>
}
