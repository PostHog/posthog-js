import type { EmailAttachment, SendCodeEmailOptions } from '../emails/types'
import type {
  NormalizedAddress,
  NormalizedAttachment,
  NormalizedMail,
  PostHogRefusal,
  PostHogUnsupportedError,
} from './types'

const INTEGRATION_NAME = 'nodemailer'
const TEMPLATE_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,400}$/
const NEEDS_QUOTES = /[()<>[\]:;@\\,."]/
const IGNORED_HEADERS = new Set(['message-id', 'date', 'mime-version', 'x-mailer'])

/** A send the SDK checks again: subject, html and text stay as Nodemailer has them. */
export type MappedSend = Omit<SendCodeEmailOptions, 'subject' | 'html' | 'text'> & {
  subject?: string
  html?: string
  text?: string
}

/**
 * Turns one normalized Nodemailer message into one send.
 * Throws a `PostHogUnsupportedError` for a message PostHog can't send.
 */
export function mapMail(mail: NormalizedMail, defaultTemplateKey: string | undefined): MappedSend {
  const to = addressesOf(mail.to)
  if (to.length !== 1) {
    throw unsupported('multiple_to')
  }
  const cc = addressesOf(mail.cc)
  const bcc = addressesOf(mail.bcc)
  const refusal =
    unsupportedPart(mail) ??
    unsupportedHeader(mail) ??
    envelopeMismatch(mail, [...to, ...cc, ...bcc]) ??
    unsupportedPriority(mail.priority) ??
    inlineWithoutCid(mail.attachments)
  if (refusal) {
    throw unsupported(refusal)
  }
  const options = mail.posthog ?? {}
  if (options.template_key !== undefined && !TEMPLATE_KEY_PATTERN.test(options.template_key)) {
    throw unsupported('invalid_template_key')
  }
  return {
    to: to[0],
    templateKey: options.template_key ?? defaultTemplateKey ?? INTEGRATION_NAME,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    ...(mail.from?.address && { from: formatSender(mail.from) }),
    ...(cc.length > 0 && { cc }),
    ...(bcc.length > 0 && { bcc }),
    ...(mail.replyTo && { replyTo: addressesOf(mail.replyTo) }),
    ...(mail.attachments?.length && { attachments: mail.attachments.map(attachmentOf) }),
    ...(options.distinct_id !== undefined && { distinctId: options.distinct_id }),
    ...(options.idempotency_key !== undefined && { idempotencyKey: options.idempotency_key }),
    ...(options.capture_engagement !== undefined && { captureEngagement: options.capture_engagement }),
  }
}

function unsupported(refusal: PostHogRefusal): PostHogUnsupportedError {
  return Object.assign(new Error(`PostHog cannot send this email: ${refusal}`), {
    code: 'EPOSTHOGUNSUPPORTED' as const,
    refusal,
  })
}

function addressesOf(entries: NormalizedAddress[] | null | undefined): string[] {
  return (entries ?? []).flatMap((entry) =>
    entry.group ? addressesOf(entry.group) : entry.address ? [entry.address] : []
  )
}

function formatSender({ name, address }: NormalizedAddress): string {
  if (!name) {
    return address!
  }
  const displayName = NEEDS_QUOTES.test(name) ? `"${name.replace(/(["\\])/g, '\\$1')}"` : name
  return `${displayName} <${address}>`
}

function unsupportedPart(mail: NormalizedMail): PostHogRefusal | undefined {
  const hasExtraPart =
    Boolean(mail.watchHtml || mail.amp || mail.icalEvent || mail.raw || mail.alternatives?.length) ||
    Boolean(mail.attachments?.some((attachment) => attachment.raw !== undefined))
  return hasExtraPart ? 'unsupported_part' : undefined
}

function unsupportedHeader({ normalizedHeaders, sender, from }: NormalizedMail): PostHogRefusal | undefined {
  const isIgnored = (name: string): boolean => IGNORED_HEADERS.has(name) || name.startsWith('content-')
  const hasHeader = Object.keys(normalizedHeaders ?? {}).some((name) => !isIgnored(name.toLowerCase()))
  const hasSender = Boolean(sender?.address) && sender?.address?.toLowerCase() !== from?.address?.toLowerCase()
  return hasHeader || hasSender ? 'unsupported_header' : undefined
}

function envelopeMismatch(mail: NormalizedMail, recipients: string[]): PostHogRefusal | undefined {
  const envelope = mail.envelope ?? {}
  const sameSender = (envelope.from || undefined)?.toLowerCase() === mail.from?.address?.toLowerCase()
  return sameSender && sameAddresses(envelope.to ?? [], recipients) ? undefined : 'envelope_mismatch'
}

function sameAddresses(left: string[], right: string[]): boolean {
  const lower = (addresses: string[]): Set<string> => new Set(addresses.map((address) => address.toLowerCase()))
  const [a, b] = [lower(left), lower(right)]
  return a.size === b.size && [...a].every((address) => b.has(address))
}

function unsupportedPriority(priority: string | undefined): PostHogRefusal | undefined {
  return priority === undefined || priority.toLowerCase() === 'normal' ? undefined : 'unsupported_priority'
}

function inlineWithoutCid(attachments: NormalizedAttachment[] | undefined): PostHogRefusal | undefined {
  return attachments?.some((attachment) => attachment.contentDisposition === 'inline' && !attachment.cid)
    ? 'inline_without_cid'
    : undefined
}

function attachmentOf(attachment: NormalizedAttachment): EmailAttachment {
  const { content = '', encoding, filename, contentType, cid } = attachment
  return {
    filename: filename || '',
    content: typeof content === 'string' ? Buffer.from(content, (encoding as BufferEncoding) ?? 'utf8') : content,
    ...(contentType && { contentType }),
    ...(cid && { contentId: cid }),
  }
}
