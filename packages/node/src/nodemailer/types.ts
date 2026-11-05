import type {} from 'nodemailer/lib/mailer'

import type { Emails } from '../emails/types'

/** The PostHog options of one message, passed to Nodemailer as `sendMail({ ..., posthog: { ... } })`. */
export interface PostHogMailOptions {
  /** The recipient's distinct ID in your product. Without it, PostHog uses the `to` address. */
  distinct_id?: string
  /** Groups the email in PostHog. Letters, digits, hyphens and underscores, at most 400. */
  template_key?: string
  /** A key derived from what the email is for, such as `order-981-shipped`, so a queue retry can't send it twice. */
  idempotency_key?: string
  /** Whether PostHog captures the email's engagement events. Defaults to `true`. */
  capture_engagement?: boolean
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
  /** Whether sending the same message again, with the same `idempotency_key`, can succeed. */
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
  raw?: unknown
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
  watchHtml?: unknown
  amp?: unknown
  icalEvent?: unknown
  alternatives?: unknown[]
  raw?: unknown
  attachments?: NormalizedAttachment[]
  normalizedHeaders?: Record<string, string>
  envelope?: { from?: string | false; to?: string[] }
  priority?: string
  posthog?: PostHogMailOptions
}

/** The part of Nodemailer's `MailMessage` a transport reads. */
export interface NodemailerMail {
  normalize(callback: (error: Error | null, data?: NormalizedMail) => void): void
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
