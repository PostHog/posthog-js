import { createHash } from 'node:crypto'
import type { PostHogFetchOptions, PostHogFetchResponse } from '@posthog/core'

import type { EmailFetchOptions } from '../../emails/emails'

const APP_HOST = 'https://us.posthog.com'
const UPLOADS_PATH = '/api/projects/@current/messaging/attachments/uploads/'
const SEND_PATH = '/api/projects/@current/messaging/send/email/'
const STORAGE_ORIGIN = 'https://email-files.s3.example.com'
const UPLOAD_ROUTE = 'POST /api/projects/{project_id}/messaging/attachments/uploads/'
const MESSAGE_LIMIT_BYTES = 40_000_000
const MESSAGE_HEADERS_BYTES = 64 * 1024
const SUBJECT_BYTES_PER_ENCODED_WORD = 42
const ENCODED_WORD_BYTES = 75
const MAX_FILES = 10
const MAX_ADDRESSES = 10
const UPLOAD_URL_TTL_MS = 15 * 60_000
const FILE_TTL_MS = 7 * 24 * 60 * 60_000
const SHA256_HEX = /^[0-9a-f]{64}$/
const MIME_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/
const BLOCKED_EXTENSIONS = new Set(
  'ade adp apk app appx asp bas bat cab chm cmd com cpl dll dmg exe hta img iso jar js jse lnk mjs msi msix msp ps1 reg scr sys vb vbe vbs ws wsf wsh'.split(
    ' '
  )
)
const TEMPLATE_FORM_FIELDS = new Set(['template_id', 'message_data', 'to', 'distinct_id'])
const CODE_FORM_FIELDS = new Set([
  'template_key',
  'subject',
  'html',
  'text',
  'from',
  'reply_to',
  'cc',
  'bcc',
  'capture_engagement',
  'tracking',
  'sensitive',
  'distinct_id',
  'to',
  'attachments',
])
const TRACKING_KINDS = new Set(['opens', 'clicks', 'engagement'])
const ATTACHMENT_FIELDS = new Set(['sha256', 'filename', 'content_type', 'content_id'])
const MESSAGE_TOO_LARGE_WHY =
  "PostHog's email provider takes emails up to 40 MB, and Base64 encoding makes each file about a third larger."
const MESSAGE_TOO_LARGE_FIX =
  'Keep the email under 40 MB after Base64 encoding, about 29 MB of files: send fewer or smaller files, or link to large files from the email body.'

export type Route = 'uploads' | 'storage' | 'send'

export type Fault =
  | { status: number; code?: string; message?: string; page?: string }
  | 'network error'
  | 'hang'
  | 'lost reply'

export interface FakePostHogOptions {
  secretKey: string
  filesAllowed?: boolean
  uploadRoute?: boolean
  fieldsNotTaken?: string[]
  storageAvailable?: boolean
  uploadQuotaBytes?: number
  messageLimitBytes?: number
  uploadUrlTtlMs?: number
  appHost?: string
  storageOrigin?: string
  storageRedirectOrigin?: string
}

export interface QueuedAttachment {
  filename: string
  contentType?: string
  contentId?: string
  bytes: Uint8Array
}

export interface QueuedEmail {
  id: string
  to: string
  cc: string[]
  bcc: string[]
  replyTo: string[]
  from?: string
  subject?: string
  html?: string
  text?: string
  captureEngagement?: boolean
  tracking?: EmailTracking
  sensitive?: boolean
  distinctId?: string
  templateId?: string
  messageData?: Record<string, unknown>
  attachments: QueuedAttachment[]
}

export interface EmailTracking {
  opens?: boolean
  clicks?: boolean
  engagement?: boolean
}

export type ServerChange = Partial<Omit<FakePostHogOptions, 'secretKey'>>

interface Recovery {
  route: Route
  refusals: number
  change: ServerChange
}

interface IssuedUpload {
  sha256: string
  size: number
  checksum: string
  expiresAt: number
}

interface Answer {
  status: number
  body?: unknown
  text?: string
  location?: string
}

type Json = Record<string, unknown>

class Refused extends Error {
  constructor(readonly answer: Answer) {
    super('refused')
  }
}

export class FakePostHog {
  readonly emails: QueuedEmail[] = []
  readonly writes: Uint8Array[] = []

  private readonly options: Required<FakePostHogOptions>
  private readonly files = new Map<string, Uint8Array>()
  private readonly issued = new Map<string, IssuedUpload>()
  private readonly sends = new Map<string, { body: string; id: string }>()
  private readonly faults: Record<Route, Fault[]> = { uploads: [], storage: [], send: [] }
  private readonly recoveries: Recovery[] = []
  private uploadedBytes = 0

  constructor(options: FakePostHogOptions) {
    this.options = {
      filesAllowed: true,
      uploadRoute: true,
      fieldsNotTaken: [],
      storageAvailable: true,
      uploadQuotaBytes: Number.MAX_SAFE_INTEGER,
      messageLimitBytes: MESSAGE_LIMIT_BYTES,
      uploadUrlTtlMs: UPLOAD_URL_TTL_MS,
      appHost: APP_HOST,
      storageOrigin: STORAGE_ORIGIN,
      storageRedirectOrigin: '',
      ...options,
    }
  }

  failNext(route: Route, ...faults: Fault[]): void {
    this.faults[route].push(...faults)
  }

  recoverAfter(route: Route, refusals: number, change: ServerChange): void {
    this.recoveries.push({ route, refusals, change })
  }

  holdAlready(bytes: Uint8Array): void {
    this.files.set(toHex(digestOf(bytes)), new Uint8Array(bytes))
  }

  readonly fetch = async (url: string, options: EmailFetchOptions): Promise<PostHogFetchResponse> => {
    const route = this.routeOf(url)
    const fault = route ? this.faults[route].shift() : undefined
    if (fault === 'network error') {
      throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') })
    }
    if (fault === 'hang') {
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason))
      })
    }
    let answer: Answer
    if (route && fault && typeof fault === 'object') {
      answer = faultAnswer(route, fault)
    } else {
      try {
        answer = await this.answer(route, url, options)
      } catch (error) {
        if (!(error instanceof Refused)) {
          throw error
        }
        answer = error.answer
      }
    }
    if (route && (answer.status < 200 || answer.status >= 300)) {
      this.recover(route)
    }
    if (fault === 'lost reply') {
      throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') })
    }
    if (answer.location && options.redirect !== 'manual') {
      return this.fetch(answer.location, options)
    }
    const text = answer.text ?? (answer.body === undefined ? '' : JSON.stringify(answer.body))
    const headers = new Headers(answer.text === undefined ? { 'Content-Type': 'application/json' } : {})
    if (answer.location) {
      headers.set('Location', answer.location)
    }
    return { status: answer.status, headers, text: async () => text, json: async () => JSON.parse(text) }
  }

  private answer(route: Route | undefined, url: string, options: PostHogFetchOptions): Answer {
    switch (route) {
      case 'uploads':
        return this.prepareUploads(options)
      case 'storage':
        return this.store(url, options)
      case 'send':
        return this.send(options)
      default:
        return { status: 404, body: { type: 'invalid_request', code: 'not_found', detail: 'Not found.', attr: null } }
    }
  }

  private routeOf(url: string): Route | undefined {
    if (url === this.options.appHost + UPLOADS_PATH) {
      return 'uploads'
    }
    if (url === this.options.appHost + SEND_PATH) {
      return 'send'
    }
    const { storageOrigin, storageRedirectOrigin } = this.options
    return url.startsWith(`${storageOrigin}/`) || (storageRedirectOrigin && url.startsWith(`${storageRedirectOrigin}/`))
      ? 'storage'
      : undefined
  }

  private recover(route: Route): void {
    for (const recovery of this.recoveries) {
      if (recovery.route === route && recovery.refusals > 0) {
        recovery.refusals -= 1
        if (recovery.refusals === 0) {
          Object.assign(this.options, recovery.change)
        }
      }
    }
  }

  private prepareUploads(options: PostHogFetchOptions): Answer {
    if (!this.options.uploadRoute) {
      return {
        status: 404,
        body: { type: 'invalid_request', code: 'not_found', detail: 'Endpoint not found.', attr: null },
      }
    }
    this.authenticate(options)
    const requested = uploadRequest(jsonBody(options))
    if (!this.options.filesAllowed) {
      throw refusal(400, 'invalid_request', 'field_not_accepted', 'files', {
        detail: "This project can't send files yet, so PostHog didn't prepare the uploads.",
        why: "Sending files isn't available to this project yet.",
        fix: 'Send the email without files, or try again once files are available to this project.',
      })
    }
    if (!this.options.storageAvailable) {
      throw refusal(503, 'server_error', 'delivery_unavailable', null, {
        detail: "File storage didn't answer, so PostHog didn't prepare the uploads.",
        why: "PostHog couldn't check its file storage for these files.",
        fix: 'Send the same request again shortly.',
      })
    }
    const largest = this.largestOverLimit(requested.map(({ size }) => size))
    if (largest !== undefined) {
      throw refusal(400, 'invalid_request', 'message_too_large', `files__${largest}__size`, {
        detail: "These files are too large for one email, so PostHog didn't prepare the uploads.",
        why: MESSAGE_TOO_LARGE_WHY,
        fix: MESSAGE_TOO_LARGE_FIX,
      })
    }
    const toUpload = requested.filter(({ sha256 }) => !this.files.has(sha256))
    const uploadBytes = toUpload.reduce((total, { size }) => total + size, 0)
    if (this.uploadedBytes + uploadBytes > this.options.uploadQuotaBytes) {
      throw refusal(429, 'throttled_error', 'upload_quota_exceeded', null, {
        detail: "This project uploaded as many file bytes as it can today, so PostHog didn't prepare the uploads.",
        why: 'Each project can upload a limited number of file bytes per day, counted in UTC.',
        fix: "Send files this project already uploaded, which don't count, or upload again after midnight UTC.",
      })
    }
    this.uploadedBytes += uploadBytes
    const now = Date.now()
    return {
      status: 200,
      body: {
        files: requested.map(({ sha256, size }) => {
          if (this.files.has(sha256)) {
            return { sha256, status: 'present', expires_at: new Date(now + FILE_TTL_MS).toISOString() }
          }
          const expiresAt = now + this.options.uploadUrlTtlMs
          const url = `${this.options.storageOrigin}/team/2/${sha256}?X-Amz-Expires=900&X-Amz-Signature=${globalThis.crypto.randomUUID()}`
          const checksum = toBase64(fromHex(sha256))
          this.issued.set(url, { sha256, size, checksum, expiresAt })
          return {
            sha256,
            status: 'upload',
            url,
            method: 'PUT',
            headers: { 'Content-Length': String(size), 'x-amz-checksum-sha256': checksum },
            url_expires_at: new Date(expiresAt).toISOString(),
          }
        }),
      },
    }
  }

  private store(url: string, options: PostHogFetchOptions): Answer {
    const { storageOrigin, storageRedirectOrigin } = this.options
    if (storageRedirectOrigin && url.startsWith(`${storageOrigin}/`)) {
      return { status: 307, text: '', location: storageRedirectOrigin + url.slice(storageOrigin.length) }
    }
    const signed = storageRedirectOrigin ? url.replace(storageRedirectOrigin, storageOrigin) : url
    const upload = this.issued.get(signed)
    if (options.method !== 'PUT' || !upload) {
      return storageError(403, 'AccessDenied', 'Access Denied')
    }
    const headers = new Headers(options.headers)
    if (headers.has('authorization')) {
      return storageError(
        400,
        'InvalidArgument',
        'Only one auth mechanism allowed; only the X-Amz-Algorithm query parameter, Signature query string parameter or the Authorization header should be specified'
      )
    }
    if (Date.now() >= upload.expiresAt) {
      return storageError(403, 'AccessDenied', 'Request has expired')
    }
    const body = bodyBytes(options.body)
    if (headers.get('content-length') !== String(upload.size) || body.byteLength !== upload.size) {
      return storageError(
        400,
        'IncompleteBody',
        'You did not provide the number of bytes specified by the Content-Length HTTP header.'
      )
    }
    const digest = toBase64(digestOf(body))
    if (headers.get('x-amz-checksum-sha256') !== upload.checksum || digest !== upload.checksum) {
      return storageError(400, 'BadDigest', 'The SHA256 you specified did not match the calculated checksum.')
    }
    const bytes = new Uint8Array(body)
    this.files.set(upload.sha256, bytes)
    this.writes.push(bytes)
    return { status: 200, text: '' }
  }

  private send(options: PostHogFetchOptions): Answer {
    this.authenticate(options)
    const raw = typeof options.body === 'string' ? options.body : ''
    const body = jsonBody(options)
    const notTaken = this.options.fieldsNotTaken.find((field) => field in body)
    if (notTaken !== undefined) {
      throw refusal(400, 'validation_error', 'field_not_accepted', notTaken, {
        detail: "PostHog doesn't take this field yet, so it didn't send the email.",
        why: "This PostHog version doesn't take the field yet, so it refused the email instead of sending it without it.",
        fix: 'Send the email without this field, or send it again once PostHog takes the field.',
      })
    }
    const email = 'template_id' in body ? templateEmail(body) : this.codeEmail(body)
    const key = new Headers(options.headers).get('idempotency-key')
    const earlier = key === null ? undefined : this.sends.get(key)
    if (earlier) {
      if (earlier.body !== raw) {
        throw refusal(422, 'invalid_request', 'idempotency_key_reused', null, {
          detail: 'This idempotency key was used for a different email.',
        })
      }
      return { status: 200, body: { message_id: earlier.id, replayed: true, warnings: [] } }
    }
    const queued = { id: globalThis.crypto.randomUUID(), ...email }
    this.emails.push(queued)
    if (key !== null) {
      this.sends.set(key, { body: raw, id: queued.id })
    }
    return { status: 202, body: { message_id: queued.id, replayed: false, warnings: [] } }
  }

  private codeEmail(body: Json): Omit<QueuedEmail, 'id'> {
    refuseUnknown(body, CODE_FORM_FIELDS, '')
    const { to, template_key, subject, html, text, from, distinct_id, capture_engagement } = body
    requireString(to, 'to')
    requireString(template_key, 'template_key')
    requireString(subject, 'subject')
    optionalString(html, 'html')
    optionalString(text, 'text')
    optionalString(from, 'from')
    optionalString(distinct_id, 'distinct_id')
    if (html === undefined && text === undefined) {
      throw invalidField('html', 'Send html, text or both.')
    }
    if (capture_engagement !== undefined && typeof capture_engagement !== 'boolean') {
      throw invalidField('capture_engagement', 'Must be a valid boolean.')
    }
    if (body.sensitive !== undefined && typeof body.sensitive !== 'boolean') {
      throw invalidField('sensitive', 'Must be a valid boolean.')
    }
    const tracking = body.tracking === undefined ? undefined : trackingOf(body.tracking)
    if (tracking !== undefined && capture_engagement !== undefined) {
      throw invalidField(
        'tracking',
        'Send either `tracking` or `capture_engagement`. `capture_engagement` is deprecated, so set `tracking.engagement` instead.'
      )
    }
    const attachments = this.attachmentsOf(body.attachments, [html ?? '', text || textFromHtml(html ?? '')], subject)
    return {
      to,
      cc: addresses(body.cc, 'cc'),
      bcc: addresses(body.bcc, 'bcc'),
      replyTo: addresses(body.reply_to, 'reply_to'),
      subject,
      ...(html !== undefined && { html }),
      ...(text !== undefined && { text }),
      ...(from !== undefined && { from }),
      ...(distinct_id !== undefined && { distinctId: distinct_id }),
      captureEngagement: capture_engagement ?? true,
      ...(tracking !== undefined && { tracking }),
      ...(body.sensitive !== undefined && { sensitive: body.sensitive }),
      attachments,
    }
  }

  private attachmentsOf(value: unknown, bodies: string[], subject: string): QueuedAttachment[] {
    if (value === undefined) {
      return []
    }
    if (!Array.isArray(value)) {
      throw invalidField('attachments', 'Expected a list of items.')
    }
    if (value.length > MAX_FILES) {
      throw refusal(400, 'invalid_request', 'too_many_attachments', 'attachments', {
        detail: `Send at most ${MAX_FILES} attachments.`,
      })
    }
    const references = value.map((reference: unknown, index) => attachmentReference(reference, index))
    const attachments = references.map(({ sha256, ...file }, index) => {
      const bytes = this.files.get(sha256)
      if (!bytes) {
        throw refusal(400, 'invalid_request', 'attachment_not_uploaded', `attachments__${index}__sha256`, {
          detail: "A file this email names isn't uploaded, so PostHog didn't send the email.",
          why: "This project has no uploaded file with this SHA-256. Its upload didn't finish, it expired, or it went to another project.",
          fix: `Upload the file through \`${UPLOAD_ROUTE}\` and wait for its upload to succeed, then send again.`,
        })
      }
      return { ...file, bytes }
    })
    const encoder = new TextEncoder()
    const bodySizes = bodies.map((body) => encoder.encode(body).byteLength)
    const largest = this.largestOverLimit(
      attachments.map(({ bytes }) => bytes.byteLength),
      bodySizes,
      encoder.encode(subject).byteLength
    )
    if (largest !== undefined) {
      throw refusal(400, 'invalid_request', 'message_too_large', `attachments__${largest}__sha256`, {
        detail: "These files make the email larger than PostHog can send, so it didn't send the email.",
        why: MESSAGE_TOO_LARGE_WHY,
        fix: MESSAGE_TOO_LARGE_FIX,
      })
    }
    return attachments
  }

  private largestOverLimit(fileSizes: number[], bodySizes: number[] = [], subjectBytes = 0): number | undefined {
    const estimate = [...fileSizes, ...bodySizes].reduce(
      (total, size) => total + Math.ceil((Math.ceil(size / 3) * 4 * 78) / 76),
      MESSAGE_HEADERS_BYTES + Math.ceil(subjectBytes / SUBJECT_BYTES_PER_ENCODED_WORD) * ENCODED_WORD_BYTES
    )
    if (estimate <= this.options.messageLimitBytes) {
      return undefined
    }
    return fileSizes.indexOf(Math.max(...fileSizes))
  }

  private authenticate(options: PostHogFetchOptions): void {
    if (new Headers(options.headers).get('authorization') !== `Bearer ${this.options.secretKey}`) {
      throw refusal(401, 'authentication_error', 'authentication_failed', null, {
        detail: 'Incorrect authentication credentials.',
      })
    }
  }
}

function faultAnswer(route: Route, { status, code, message, page }: Exclude<Fault, string>): Answer {
  if (page !== undefined) {
    return { status, text: page }
  }
  if (route === 'storage') {
    return code ? storageError(status, code, message ?? code) : { status, text: '' }
  }
  return { status, body: code ? { type: 'server_error', code, detail: message ?? code, attr: null } : undefined }
}

function refusal(status: number, type: string, code: string, attr: string | null, explained: Json): Refused {
  return new Refused({ status, body: { type, code, attr, ...explained } })
}

function trackingOf(value: unknown): EmailTracking {
  if (typeof value === 'boolean') {
    return { opens: value, clicks: value, engagement: value }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidField('tracking', 'Must be a valid boolean.')
  }
  const kinds = Object.entries(value)
  if (kinds.some(([kind]) => !TRACKING_KINDS.has(kind))) {
    throw invalidField('tracking', '`tracking` takes `opens`, `clicks` and `engagement`.')
  }
  if (kinds.some(([, on]) => typeof on !== 'boolean')) {
    throw invalidField('tracking', 'Must be a valid boolean.')
  }
  const tracking: EmailTracking = Object.fromEntries(kinds)
  if (tracking.clicks && tracking.opens === false) {
    throw invalidField('tracking', 'Click tracking needs open tracking. Turn on `opens`, or turn off `clicks`.')
  }
  return tracking
}

function invalidField(attr: string, detail: string): Refused {
  return refusal(400, 'validation_error', 'invalid_input', attr, { detail })
}

function storageError(status: number, code: string, message: string): Answer {
  return {
    status,
    text: `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${message}</Message><RequestId>fake</RequestId></Error>`,
  }
}

function jsonBody(options: PostHogFetchOptions): Json {
  if (options.method !== 'POST' || typeof options.body !== 'string') {
    throw invalidField('', 'Send a JSON body.')
  }
  try {
    const body: unknown = JSON.parse(options.body)
    if (isRecord(body)) {
      return body
    }
  } catch {}
  throw refusal(400, 'invalid_request', 'parse_error', null, { detail: 'JSON parse error.' })
}

function uploadRequest(body: Json): { sha256: string; size: number }[] {
  const invalid = (attr: string): Refused =>
    refusal(400, 'invalid_request', 'invalid_request', attr, { detail: 'Invalid upload request.' })
  refuseUnknown(body, new Set(['files']), '')
  const { files } = body
  if (!Array.isArray(files) || files.length === 0) {
    throw invalid('files')
  }
  if (files.length > MAX_FILES) {
    throw refusal(400, 'invalid_request', 'too_many_attachments', 'files', { detail: 'Too many files.' })
  }
  return files.map((file: unknown, index) => {
    if (!isRecord(file)) {
      throw invalid(`files__${index}`)
    }
    const unknown = Object.keys(file).find((key) => key !== 'sha256' && key !== 'size')
    if (unknown !== undefined) {
      throw invalid(`files__${index}__${unknown}`)
    }
    const { sha256, size } = file
    if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) {
      throw invalid(`files__${index}__sha256`)
    }
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) {
      throw invalid(`files__${index}__size`)
    }
    return { sha256, size }
  })
}

function templateEmail(body: Json): Omit<QueuedEmail, 'id'> {
  refuseUnknown(body, TEMPLATE_FORM_FIELDS, '')
  const { to, template_id, message_data, distinct_id } = body
  requireString(to, 'to')
  requireString(template_id, 'template_id')
  optionalString(distinct_id, 'distinct_id')
  if (message_data !== undefined && !isRecord(message_data)) {
    throw invalidField('message_data', 'Expected a dictionary of items.')
  }
  return {
    to,
    cc: [],
    bcc: [],
    replyTo: [],
    templateId: template_id,
    messageData: message_data ?? {},
    ...(distinct_id !== undefined && { distinctId: distinct_id }),
    attachments: [],
  }
}

function attachmentReference(
  reference: unknown,
  index: number
): { sha256: string; filename: string; contentType?: string; contentId?: string } {
  const attr = `attachments__${index}`
  if (!isRecord(reference)) {
    throw invalidField(attr, 'Expected a dictionary of items.')
  }
  refuseUnknown(reference, ATTACHMENT_FIELDS, `${attr}__`)
  const { sha256, filename, content_type, content_id } = reference
  if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) {
    throw invalidField(`${attr}__sha256`, 'Send the SHA-256 as 64 lowercase hex characters.')
  }
  if (typeof filename !== 'string' || !filename || filename.length > 255) {
    throw invalidField(`${attr}__filename`, 'Send a file name.')
  }
  if (/[/\\]/.test(filename) || hasControlCharacter(filename)) {
    throw refusal(400, 'invalid_request', 'unsafe_filename', `${attr}__filename`, { detail: 'Unsafe file name.' })
  }
  const [, extension] = /\.([^.]*)$/.exec(filename.replace(/[. ]+$/, '')) ?? []
  if (extension !== undefined && BLOCKED_EXTENSIONS.has(extension.toLowerCase())) {
    throw refusal(400, 'invalid_request', 'blocked_file_type', `${attr}__filename`, { detail: 'Blocked file type.' })
  }
  if (content_type !== undefined && (typeof content_type !== 'string' || !MIME_TYPE.test(content_type))) {
    throw refusal(400, 'invalid_request', 'not_mime_type', `${attr}__content_type`, { detail: 'Not a MIME type.' })
  }
  if (
    content_id !== undefined &&
    (typeof content_id !== 'string' || /[<>]/.test(content_id) || hasControlCharacter(content_id))
  ) {
    throw refusal(400, 'invalid_request', 'unsafe_content_id', `${attr}__content_id`, { detail: 'Unsafe content ID.' })
  }
  return {
    sha256,
    filename,
    ...(content_type !== undefined && { contentType: content_type }),
    ...(content_id !== undefined && { contentId: content_id }),
  }
}

function refuseUnknown(body: Json, known: ReadonlySet<string>, prefix: string): void {
  const unknown = Object.keys(body).find((key) => !known.has(key))
  if (unknown !== undefined) {
    throw refusal(400, 'invalid_request', 'invalid_request', `${prefix}${unknown}`, {
      detail: `${unknown} is not a field this route takes.`,
    })
  }
}

function addresses(value: unknown, attr: string): string[] {
  if (value === undefined) {
    return []
  }
  const list = typeof value === 'string' ? [value] : value
  if (!Array.isArray(list) || list.length > MAX_ADDRESSES || !list.every((item) => typeof item === 'string')) {
    throw invalidField(attr, 'Send one address or a list of up to 10 addresses.')
  }
  return list
}

function requireString(value: unknown, attr: string): asserts value is string {
  if (typeof value !== 'string' || !value) {
    throw invalidField(attr, 'This field is required.')
  }
}

function optionalString(value: unknown, attr: string): asserts value is string | undefined {
  if (value !== undefined && typeof value !== 'string') {
    throw invalidField(attr, 'Not a valid string.')
  }
}

function hasControlCharacter(text: string): boolean {
  return Array.from(text).some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)
}

function textFromHtml(html: string): string {
  let text = ''
  let inTag = false
  for (const character of html) {
    if (character === '<') {
      inTag = true
    } else if (inTag && character === '>') {
      inTag = false
    } else if (!inTag) {
      text += character
    }
  }
  return text
}

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function bodyBytes(body: PostHogFetchOptions['body']): Uint8Array {
  if (typeof body === 'string') {
    return new TextEncoder().encode(body)
  }
  return ArrayBuffer.isView(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : new Uint8Array(0)
}

function digestOf(bytes: Uint8Array): Uint8Array {
  return createHash('sha256').update(bytes).digest()
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16))
}

function toBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
}
