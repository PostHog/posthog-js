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
}

/**
 * The built-in message category of `posthog.emails.send()`: transactional email with no category. Unlike a
 * send without a category, it doesn't follow the category of the template that `templateKey` names.
 */
export const TRANSACTIONAL_EMAIL_CATEGORY = 'transactional'

/**
 * A message category that a send defines in code. PostHog creates the category when the project has
 * none with this key, and restores it when it was deleted. Both creation and restoration need room
 * under the project's active category limit. Otherwise the send leaves the category as it is: a send
 * never renames a category or changes its description. Change those in PostHog.
 */
export interface MessageCategory {
  /**
   * Identifies the category in the project, such as `'newsletter'`. Recipients opt out of a category
   * by its key: pass this same key as a topic key in `posthog.emails.setPreferences({ topics })`.
   */
  key: string
  /** A marketing category honors the recipient's opt-outs. A transactional one only files the email. */
  type: 'marketing' | 'transactional'
  /** The category's name, shown in PostHog. Used only when the send creates the category. */
  name: string
  /** Notes about which emails belong to the category. Used only when the send creates the category. */
  description?: string
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
  /** Bare addresses, such as `'finance@example.com'`, that get a copy. */
  cc?: string | string[]
  /** Bare addresses that get a copy the other recipients never see. */
  bcc?: string | string[]
  /**
   * Files sent with the email: at most 10, and at most 40 MB for the whole email after Base64
   * encoding, about 29 MB of files. The SDK checks both before any request. It uploads each file
   * PostHog doesn't have yet, then sends the email. When an upload fails, it sends nothing.
   */
  attachments?: EmailAttachment[]
  /**
   * Whether PostHog captures the email's engagement events (sent, delivered, opened, clicked,
   * bounced) as events of the recipient. Defaults to `true`. A project whose admin turned
   * engagement capture off captures nothing, whatever the send asks. A template made in PostHog
   * follows the project's setting.
   *
   * @deprecated Use `tracking: { engagement: false }`. It keeps working, but PostHog refuses a
   * send that sets both `captureEngagement` and `tracking`.
   */
  captureEngagement?: boolean
  /**
   * Marks the email as sensitive, such as one that carries login links, reset tokens or codes.
   * A sensitive email keeps its links as they are unless `tracking` turns clicks on, leaves its
   * subject off engagement events, and keeps its content out of PostHog's logs.
   *
   * Without it, a send whose `templateKey` matches a template saved in PostHog follows that
   * template's setting, and any other send is sensitive. PostHog refuses `sensitive: false` when
   * the matching template is sensitive.
   */
  sensitive?: boolean
  /**
   * What PostHog tracks for this email. Without it, PostHog counts opens with its open pixel,
   * captures engagement events, and counts clicks only when the email isn't sensitive.
   *
   * - `true` turns on opens, clicks and engagement events.
   * - `false` turns off all tracking, including kinds PostHog adds later. PostHog can't count the
   *   email's opens or clicks, and captures no engagement events.
   * - An object turns each kind on or off. A key you leave out keeps its default.
   *
   * Turn clicks on for a sensitive email only when its links are safe to send through PostHog's
   * click tracking.
   */
  tracking?: boolean | EmailTracking
  /**
   * The email's message category. Without it, the email follows the category of the template that
   * `templateKey` names (when code-send categories are enabled), or is transactional with no
   * category. A template made in PostHog must be enabled for transactional sends first: PostHog
   * refuses a template that isn't enabled for transactional sends with `template_not_transactional`,
   * and refuses an enabled template whose category is marketing with `marketing_template`.
   *
   * When `templateKey` names a sendable template, that template fixes the category: for an
   * uncategorized template, leave `category` out or pass `TRANSACTIONAL_EMAIL_CATEGORY`; for a
   * template in a transactional category, leave `category` out or pass a `MessageCategory` with the
   * matching `key` and `type`. `TRANSACTIONAL_EMAIL_CATEGORY` asks for transactional email with no
   * category, so PostHog refuses it with `category_mismatch` when `templateKey` names a sendable
   * template in a transactional category.
   *
   * A `MessageCategory` files the email under that category. A marketing email honors the
   * recipient's opt-outs and gets unsubscribe headers. Its `html` needs a link with
   * `<a href="{{ unsubscribe_url }}">`, or its `text` needs `{{ unsubscribe_url }}` when it has no
   * `html`.
   *
   * The send returns an error with code `category_mismatch` when a category with this key has
   * another type, or when `templateKey` names a sendable template in another category (including an
   * uncategorized template given a `MessageCategory`); `too_many_categories` when creating or
   * restoring a category would pass the project's active category limit;
   * `unsubscribe_link_required` when a marketing email has no unsubscribe link placeholder;
   * `copies_not_allowed` when a marketing email has `cc` or `bcc`; `recipient_opted_out` when the
   * recipient opted out of the category or of all marketing email; `template_not_transactional` when
   * `templateKey` names a template not enabled for transactional sends; and `marketing_template`
   * when `templateKey` names an enabled template in a marketing category.
   */
  category?: typeof TRANSACTIONAL_EMAIL_CATEGORY | MessageCategory
}

/** Which kinds of tracking a send with `templateKey` turns on. */
export interface EmailTracking {
  /** Counts opens with PostHog's open pixel. Defaults to `true`. */
  opens?: boolean
  /**
   * Counts clicks by sending the email's links through PostHog's click tracking. Defaults to
   * `false` for a sensitive email and `true` for any other. Needs `opens`: PostHog refuses a send
   * with `opens: false` and `clicks: true`.
   */
  clicks?: boolean
  /**
   * Captures the email's engagement events (sent, delivered, opened, clicked, bounced) as events
   * of the recipient. Defaults to `true`. A project whose admin turned engagement capture off
   * captures nothing, whatever the send asks.
   */
  engagement?: boolean
}

/** A file sent with the email. */
export interface EmailAttachment {
  /** The name the recipient sees, such as `'invoice.pdf'`. */
  filename: string
  /** The file's bytes, or its content already Base64 encoded. At least one byte. */
  content: Uint8Array | string
  /** A MIME type, such as `'application/pdf'`. */
  contentType?: string
  /** Shows the file inline where the HTML has `<img src="cid:...">` with this id. */
  contentId?: string
  /** PostHog can't fetch a file from a path or URL: read the file and pass its `content`. */
  path?: never
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
 * The `posthog.emails` API: sends transactional or marketing email from PostHog email templates or
 * from content your code rendered, reads the status of each email it sent, and sets a recipient's
 * topic preferences.
 */
export interface Emails {
  /**
   * Queue one transactional or marketing email, from a PostHog email template or from content your
   * code rendered.
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
