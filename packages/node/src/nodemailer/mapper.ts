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
const IGNORED_HEADERS = new Set([
  'message-id',
  'date',
  'mime-version',
  'x-mailer',
  'content-type',
  'content-transfer-encoding',
])
const CARRIED_OPTIONS = ['from', 'to', 'cc', 'bcc', 'replyTo', 'subject', 'html', 'text', 'attachments', 'posthog']
const CHECKED_OPTIONS = ['sender', 'headers', 'envelope', 'priority']
const OPTIONS_POSTHOG_SETS_ITSELF = ['messageId', 'date', 'xMailer', 'normalizedHeaders']
const MIME_LAYOUT_OPTIONS = ['textEncoding', 'boundaryPrefix', 'baseBoundary', 'newline', 'normalizeHeaderKey']
const OPTIONS_NODEMAILER_APPLIED = ['disableFileAccess', 'disableUrlAccess', 'attachDataUrls', 'maxRecipients']
const KNOWN_OPTIONS = new Set([
  ...CARRIED_OPTIONS,
  ...CHECKED_OPTIONS,
  ...OPTIONS_POSTHOG_SETS_ITSELF,
  ...MIME_LAYOUT_OPTIONS,
  ...OPTIONS_NODEMAILER_APPLIED,
])
const HEADER_OPTIONS = new Set(['inReplyTo', 'references', 'list', 'otp'])
const PART_OPTIONS = new Set(['watchHtml', 'amp', 'icalEvent', 'alternatives', 'raw'])
const NODEMAILER_DATA_URL_CID = /^[0-9a-f]{20}@localhost$/

export function refuseWhatNormalizeDrops(
  data: { html?: unknown; text?: unknown; attachments?: unknown } | undefined
): void {
  const attachments = Array.isArray(data?.attachments) ? data.attachments : []
  if ([data?.html, data?.text, ...attachments].some(hasRawSource)) {
    throw unsupported('unsupported_part')
  }
  if ([data?.html, data?.text].some(hasOwnHeaders)) {
    throw unsupported('unsupported_header')
  }
}

export function refuseMimeChanges(mail: { mailer?: unknown; message?: unknown }): void {
  const streamPlugins = (mail.mailer as { _userPlugins?: { stream?: unknown[] } } | undefined)?._userPlugins?.stream
  const processFuncs = (mail.message as { _processFuncs?: unknown[] } | undefined)?._processFuncs
  if ([streamPlugins, processFuncs].some((changes) => Array.isArray(changes) && changes.length > 0)) {
    throw unsupported('unsupported_option')
  }
}

function hasRawSource(part: unknown): boolean {
  return typeof part === 'object' && part !== null && (part as { raw?: unknown }).raw !== undefined
}

function hasOwnHeaders(part: unknown): boolean {
  const headers = typeof part === 'object' && part !== null ? (part as { headers?: unknown }).headers : undefined
  return typeof headers === 'object' && headers !== null && Object.keys(headers).length > 0
}

export type MappedSend = Omit<SendCodeEmailOptions, 'subject' | 'html' | 'text'> & {
  subject?: string
  html?: string
  text?: string
}

export function mapMail(mail: NormalizedMail, defaultTemplateKey: string | undefined): MappedSend {
  const to = addressesOf(mail.to)
  if (to.length !== 1) {
    throw unsupported('multiple_to')
  }
  const cc = addressesOf(mail.cc)
  const bcc = addressesOf(mail.bcc)
  const refusal =
    unsupportedOption(mail) ??
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
  const { html, attachments } = withStableDataUrlCids(mail.html, mail.attachments)
  return {
    to: to[0],
    templateKey: options.template_key ?? defaultTemplateKey ?? INTEGRATION_NAME,
    subject: mail.subject ?? '',
    html,
    text: mail.text,
    ...(mail.from?.address && { from: formatSender(mail.from) }),
    ...(cc.length > 0 && { cc }),
    ...(bcc.length > 0 && { bcc }),
    ...(mail.replyTo && { replyTo: addressesOf(mail.replyTo) }),
    ...(attachments?.length && { attachments: attachments.map(attachmentOf) }),
    ...(options.distinct_id !== undefined && { distinctId: options.distinct_id }),
    ...(options.idempotency_key !== undefined && { idempotencyKey: options.idempotency_key }),
    ...(options.tracking !== undefined && { tracking: options.tracking }),
    ...(options.sensitive !== undefined && { sensitive: options.sensitive }),
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

function unsupportedOption(mail: NormalizedMail): PostHogRefusal | undefined {
  const setOptions = Object.entries(mail)
    .filter(([, value]) => isSet(value))
    .map(([name]) => name)
  const unknown = setOptions.filter((name) => !KNOWN_OPTIONS.has(name))
  if (unknown.some((name) => HEADER_OPTIONS.has(name))) {
    return 'unsupported_header'
  }
  if (unknown.some((name) => PART_OPTIONS.has(name))) {
    return 'unsupported_part'
  }
  return unknown.length > 0 ? 'unsupported_option' : undefined
}

function isSet(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false && !(Array.isArray(value) && value.length === 0)
}

function unsupportedHeader(mail: NormalizedMail): PostHogRefusal | undefined {
  const { sender, from } = mail
  const hasHeader = headerNames(mail.headers).some((name) => !IGNORED_HEADERS.has(name.toLowerCase()))
  const hasAttachmentHeader = Boolean(
    mail.attachments?.some((attachment) => attachment.headers && Object.keys(attachment.headers).length > 0)
  )
  const hasSender = Boolean(sender?.address) && !sameAddress(sender?.address, from?.address)
  return hasHeader || hasAttachmentHeader || hasSender ? 'unsupported_header' : undefined
}

function headerNames(headers: NormalizedMail['headers']): string[] {
  if (Array.isArray(headers)) {
    return headers.filter((header) => header?.value).map((header) => header.key)
  }
  return Object.keys(headers ?? {}).filter((name) => headers?.[name])
}

function envelopeMismatch(mail: NormalizedMail, recipients: string[]): PostHogRefusal | undefined {
  const { envelope } = mail
  if (!envelope) {
    return undefined
  }
  const sameSender = sameAddress(envelope.from || undefined, mail.from?.address)
  return sameSender && sameAddresses(envelope.to ?? [], recipients) ? undefined : 'envelope_mismatch'
}

function sameAddresses(left: string[], right: string[]): boolean {
  const [a, b] = [new Set(left.map(mailboxOf)), new Set(right.map(mailboxOf))]
  return a.size === b.size && [...a].every((mailbox) => b.has(mailbox))
}

function sameAddress(left: string | undefined, right: string | undefined): boolean {
  return left === right || (left !== undefined && right !== undefined && mailboxOf(left) === mailboxOf(right))
}

function mailboxOf(address: string): string {
  const at = address.lastIndexOf('@')
  return at < 0 ? address : address.slice(0, at) + address.slice(at).toLowerCase()
}

function unsupportedPriority(priority: string | undefined): PostHogRefusal | undefined {
  return priority === undefined || priority.toLowerCase() === 'normal' ? undefined : 'unsupported_priority'
}

function inlineWithoutCid(attachments: NormalizedAttachment[] | undefined): PostHogRefusal | undefined {
  return attachments?.some((attachment) => attachment.contentDisposition === 'inline' && !attachment.cid)
    ? 'inline_without_cid'
    : undefined
}

function withStableDataUrlCids(
  html: string | undefined,
  attachments: NormalizedAttachment[] | undefined
): { html: string | undefined; attachments: NormalizedAttachment[] | undefined } {
  let stableHtml = html
  let count = 0
  const taken = new Set(attachments?.map((attachment) => attachment.cid))
  const nextFreeCid = (): string => {
    let cid: string
    do {
      cid = `data-url-${++count}@localhost`
    } while (taken.has(cid))
    return cid
  }
  const stableAttachments = attachments?.map((attachment) => {
    if (!attachment.cid || !NODEMAILER_DATA_URL_CID.test(attachment.cid)) {
      return attachment
    }
    const cid = nextFreeCid()
    stableHtml = stableHtml?.replaceAll(`cid:${attachment.cid}`, `cid:${cid}`)
    return { ...attachment, cid }
  })
  return { html: stableHtml, attachments: stableAttachments }
}

function attachmentOf(attachment: NormalizedAttachment): EmailAttachment {
  const { filename, contentType, cid } = attachment
  return {
    filename: filename || '',
    content: bytesOrBase64Of(attachment),
    ...(contentType && { contentType }),
    ...(cid && { contentId: cid }),
  }
}

function bytesOrBase64Of({ content = '', encoding }: NormalizedAttachment): EmailAttachment['content'] {
  return typeof content === 'string' && encoding !== 'base64'
    ? Buffer.from(content, (encoding as BufferEncoding) ?? 'utf8')
    : content
}
