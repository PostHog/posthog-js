import { EmailError } from './errors'
import type { EmailAttachment } from './types'

const MAX_ATTACHMENTS = 10
const MAX_MESSAGE_BYTES = 40_000_000
const MESSAGE_HEADERS_BYTES = 64 * 1024
const MESSAGE_LIMIT = '40 MB after Base64 encoding, about 29 MB of files'
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/

export interface AttachmentFile {
  filename: string
  bytes: Uint8Array<ArrayBuffer>
  contentType?: string
  contentId?: string
}

export interface HashedFile extends AttachmentFile {
  sha256: string
  field: string
}

interface CheckedAttachment {
  filename: string
  content: string | Uint8Array
  size: number
  contentType?: string
  contentId?: string
}

/**
 * The files of a send, copied at the call. Refuses a list PostHog would refuse, before any request, and checks the
 * email's size before it copies any file.
 */
export function attachmentFiles(attachments: unknown, bodies: string[]): AttachmentFile[] {
  if (!Array.isArray(attachments)) {
    throw invalid('attachments must be a list of files.', 'attachments')
  }
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new EmailError({
      code: 'too_many_attachments',
      message: `An email carries at most ${MAX_ATTACHMENTS} files, so no email was sent.`,
      field: 'attachments',
      fix: `Attach at most ${MAX_ATTACHMENTS} files, and link to any others from the email body.`,
    })
  }
  const checked = Array.from(attachments, checkedAttachment)
  refuseMessageOverLimit(
    checked.map(({ size }) => size),
    bodies
  )
  return checked.map(({ content, size, ...file }) => ({
    ...file,
    bytes: typeof content === 'string' ? bytesOfBase64(content) : new Uint8Array(content),
  }))
}

export async function hashedFiles(files: AttachmentFile[]): Promise<HashedFile[]> {
  return Promise.all(
    files.map(async (file, index) => ({
      ...file,
      sha256: await sha256Hex(file.bytes),
      field: `attachments__${index}`,
    }))
  )
}

export function attachmentReference({ sha256, filename, contentType, contentId }: HashedFile): Record<string, unknown> {
  return {
    sha256,
    filename,
    ...(contentType !== undefined && { content_type: contentType }),
    ...(contentId !== undefined && { content_id: contentId }),
  }
}

function checkedAttachment(attachment: unknown, index: number): CheckedAttachment {
  if (
    typeof attachment !== 'object' ||
    attachment === null ||
    Array.isArray(attachment) ||
    ArrayBuffer.isView(attachment)
  ) {
    throw invalid(
      "An attachment is an object with filename and content. Pass the file's bytes as its content.",
      `attachments__${index}`
    )
  }
  const { filename, content, contentType, contentId, path, ...unsupported } = attachment as Partial<
    Record<keyof EmailAttachment, unknown>
  >
  if (path !== undefined) {
    throw invalid(
      "PostHog can't fetch an attachment from a path or URL. Read the file and pass its content instead.",
      `attachments__${index}__path`
    )
  }
  const unsupportedKey = Object.entries(unsupported).find(([, value]) => value !== undefined)?.[0]
  if (unsupportedKey !== undefined) {
    throw invalid(
      `An attachment takes filename, content, contentType and contentId, not ${unsupportedKey}.`,
      `attachments__${index}__${unsupportedKey}`
    )
  }
  if (typeof filename !== 'string' || filename === '') {
    throw invalid("An attachment needs a filename, such as 'invoice.pdf'.", `attachments__${index}__filename`)
  }
  if (typeof content !== 'string' && !(content instanceof Uint8Array)) {
    throw invalid(
      'An attachment needs content: a Buffer, a Uint8Array or a Base64 string.',
      `attachments__${index}__content`
    )
  }
  if (typeof content === 'string' && !isBase64(content)) {
    throw invalid(
      "An attachment's content string must be Base64. Pass text as a Buffer or a Uint8Array.",
      `attachments__${index}__content`
    )
  }
  if (contentType !== undefined && typeof contentType !== 'string') {
    throw invalid(
      "An attachment's contentType must be a string, such as 'application/pdf'.",
      `attachments__${index}__contentType`
    )
  }
  if (contentId !== undefined && typeof contentId !== 'string') {
    throw invalid("An attachment's contentId must be a string.", `attachments__${index}__contentId`)
  }
  const size = typeof content === 'string' ? base64DecodedBytes(content) : content.byteLength
  if (size === 0) {
    throw invalid('An attachment needs at least one byte.', `attachments__${index}__content`)
  }
  return {
    filename,
    content,
    size,
    ...(contentType !== undefined && { contentType }),
    ...(contentId !== undefined && { contentId }),
  }
}

function isBase64(text: string): boolean {
  return text.length % 4 === 0 && BASE64_PATTERN.test(text)
}

function base64DecodedBytes(text: string): number {
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  return (text.length / 4) * 3 - padding
}

function bytesOfBase64(text: string): Uint8Array<ArrayBuffer> {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(text, 'base64')
  }
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function refuseMessageOverLimit(fileSizes: number[], bodies: string[]): void {
  if (fileSizes.length === 0) {
    return
  }
  const encoder = new TextEncoder()
  const sizes = [...fileSizes, ...bodies.map((body) => encoder.encode(body).byteLength)]
  if (sizes.reduce((total, size) => total + base64LinesBytes(size), MESSAGE_HEADERS_BYTES) > MAX_MESSAGE_BYTES) {
    throw new EmailError({
      code: 'message_too_large',
      message: `These files make the email larger than ${MESSAGE_LIMIT}, so no email was sent.`,
      field: 'attachments',
      why: "PostHog's email provider takes emails up to 40 MB, and Base64 encoding makes each file about a third larger.",
      fix: 'Send fewer or smaller files, or link to large files from the email body.',
    })
  }
}

function base64LinesBytes(size: number): number {
  return Math.ceil((Math.ceil(size / 3) * 4 * 78) / 76)
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function invalid(message: string, field: string): EmailError {
  return new EmailError({ code: 'invalid_attachment', message, field })
}
