import type {} from 'nodemailer/lib/mailer'

import type { Emails, EmailTracking } from '../emails/types'

/** The PostHog options of one message, passed to Nodemailer as `sendMail({ ..., posthog: { ... } })`. */
export interface PostHogMailOptions {
  /** The recipient's distinct ID in your product. Without it, PostHog uses the `to` address. */
  distinct_id?: string
  /** Groups the email in PostHog. Letters, digits, hyphens and underscores, at most 400. */
  template_key?: string
  /** A key derived from what the email is for, such as `order-981-shipped`, so a queue retry can't send it twice. */
  idempotency_key?: string
  /**
   * What PostHog tracks for this email: `true` or `false` for everything, or `{ opens, clicks, engagement }` to turn
   * each kind on or off. Without it, PostHog counts opens, captures engagement events, and counts clicks only when
   * the email isn't sensitive.
   */
  tracking?: boolean | EmailTracking
  /**
   * Marks the email as sensitive, such as one with a login link, a reset token or a code: PostHog keeps its links as
   * they are unless `tracking` turns clicks on, and keeps its subject and content out of its events and logs.
   */
  sensitive?: boolean
}

export interface PostHogTransportOptions {
  /** A posthog-node client built with `secretKey`, a project secret API key. */
  client: { emails: Pick<Emails, 'send'> }
  /** The template key of a message that sets none. Defaults to `nodemailer`. */
  defaultTemplateKey?: string
}

/** Why PostHog can't send a message. PostHog sends nothing for it. */
export type PostHogRefusal =
  | 'multiple_to'
  | 'inline_without_cid'
  | 'unsupported_header'
  | 'envelope_mismatch'
  | 'unsupported_priority'
  | 'unsupported_part'
  | 'invalid_template_key'
  | 'unsupported_option'

/** The error `sendMail` rejects with when PostHog can't carry part of a message. Nothing was sent. */
export interface PostHogUnsupportedError extends Error {
  code: 'EPOSTHOGUNSUPPORTED'
  refusal: PostHogRefusal
}

/** The error `sendMail` rejects with when the send failed. */
export interface PostHogSendError extends Error {
  /** PostHog's error code, such as `quota_limited`, or the client's, such as `network_error`. */
  code: string
  /** The HTTP status, when PostHog answered. */
  status?: number
  detail: string
  /** The request field the error is about, when PostHog named one. */
  attr?: string
  /**
   * Whether sending the same message again can succeed without a second copy reaching the recipient. Always `false`
   * for a message without `posthog.idempotency_key`, since an earlier attempt of the send may have queued it.
   */
  retryable: boolean
  /** How long PostHog asked to wait before a retry, in seconds. */
  retry_after?: number
}

export interface PostHogSentMessageInfo {
  /** The message ID of the email PostHog queued. */
  messageId: string
}

export interface NormalizedAddress {
  name?: string
  address?: string
  group?: NormalizedAddress[]
}

export interface NormalizedAttachment {
  filename?: string | false
  content?: string | Buffer
  encoding?: string
  contentType?: string
  contentDisposition?: string
  cid?: string
  headers?: object
}

/** The message as Nodemailer's `MailMessage.normalize()` hands it over: contents resolved, addresses parsed. */
export interface NormalizedMail {
  from?: NormalizedAddress | null
  sender?: NormalizedAddress | null
  to?: NormalizedAddress[] | null
  cc?: NormalizedAddress[] | null
  bcc?: NormalizedAddress[] | null
  replyTo?: NormalizedAddress[] | null
  subject?: string
  html?: string
  text?: string
  attachments?: NormalizedAttachment[]
  headers?: Record<string, unknown> | { key: string; value: unknown }[]
  envelope?: { from?: string | false; to?: string[] }
  priority?: string
  posthog?: PostHogMailOptions
}

/**
 * The part of Nodemailer's `MailMessage` a transport reads. `normalize` hands over Nodemailer's own data type, so
 * its data stays `unknown` here and the transport reads it as a `NormalizedMail`.
 */
export interface NodemailerMail {
  data?: { html?: unknown; text?: unknown; attachments?: unknown; envelope?: unknown }
  message?: unknown
  mailer?: unknown
  normalize(callback: (error: Error | null, data?: unknown) => void): void
}

export type NodemailerDone = (error: Error | null, info?: PostHogSentMessageInfo) => void

declare module 'nodemailer/lib/mailer' {
  interface Options {
    /** PostHog's options for this message, read by the transport from `posthog-node/nodemailer`. */
    posthog?: PostHogMailOptions
  }
}

/** A Nodemailer transport object, for `nodemailer.createTransport()`. */
export interface PostHogTransport {
  name: string
  version: string
  send(mail: NodemailerMail, done: NodemailerDone): void
}
