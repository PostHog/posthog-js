import { isValidUUID, type JsonType, type PostHogApiResponse } from '@posthog/core'
import { emailContentHash } from './email-content-hash'

const SEND_PATH = '/api/projects/@current/messaging/send/email/'
const UPLOAD_PATH = (key: string): string => `/api/projects/@current/messaging_templates/by_key/${key}/`
const STATUS_PATH = (messageId: string): string =>
  `/api/projects/@current/messaging/emails/${encodeURIComponent(messageId)}/`

const TEMPLATE_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,400}$/
const CODE_ONLY_FIELDS = [
  'from',
  'replyTo',
  'subject',
  'html',
  'text',
  'cc',
  'bcc',
  'headers',
  'tags',
  'attachments',
] as const
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/
const SEND_OPTIONS = new Set([
  'to',
  'distinctId',
  'idempotencyKey',
  'captureEngagement',
  'maxRetries',
  'templateId',
  'templateKey',
  'templateData',
  'from',
  'replyTo',
  'subject',
  'html',
  'text',
  'cc',
  'bcc',
  'headers',
  'tags',
  'attachments',
])
const DEFAULT_MAX_RETRIES = 2
const FIRST_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000
const BASE64_CHUNK_BYTES = 0x8000

/** What every send takes, whatever its form. */
export interface SendEmailBase {
  /** One recipient email address. */
  to: string
  /**
   * The recipient's distinct ID in your app. The email's events, such as sent, opened and clicked, land on this
   * person and count as analytics events. Always pass it: without it, they land on a person keyed by the address.
   */
  distinctId?: string
  /**
   * Sends with a key PostHog already accepted queue nothing and return the first send's `id`, even after the email's
   * workflow was paused or the default sender changed. A deleted template, a local template whose content changed, or
   * a project that no longer has a default sender while you name no `from`, still refuses the send. Without it, the SDK
   * makes a UUID v4 that covers its own retries. When a job runner retries the send, pass a key derived from what the
   * email is for, such as `welcome:user_42`, and set `maxRetries: 0`.
   */
  idempotencyKey?: string
  /**
   * Whether PostHog captures the email's engagement events (sent, delivered, opened, clicked, bounced) as analytics
   * events of the recipient. They count as analytics events. Without it, PostHog decides: on for the code form.
   */
  captureEngagement?: boolean
  /** How often to retry this send, a whole number from 0. Overrides the `maxRetries` client option. */
  maxRetries?: number
}

/** A template made in PostHog, sent by its id. */
export interface TemplateEmailForm {
  /** The UUID of the template. */
  templateId: string
  /** Values for the template's `{{ variables.* }}`. The template can't read person properties. */
  templateData?: Record<string, unknown>
}

interface CodeEmailFields {
  /** Names the email, such as `'password-reset'`, so its metrics, logs and status group under it in PostHog. */
  templateKey: string
  subject: string
  /** A verified sender, such as `'Acme <security@acme.com>'`. Without it, the project's default sender. */
  from?: string
  replyTo?: string | string[]
  /** Bare addresses, such as `'finance@example.com'`, that get a copy. */
  cc?: string | string[]
  /** Bare addresses that get a copy the other recipients never see. */
  bcc?: string | string[]
  /** Custom email headers, such as `{ 'X-Entity-Ref-ID': 'order-123' }`. PostHog sets the standard ones itself. */
  headers?: Record<string, string>
  /** Added to the email's engagement events as `$email_tags`. */
  tags?: EmailTag[]
  attachments?: EmailAttachment[]
  /**
   * Leave it out to send rendered content: the email goes out as is, and PostHog never stores it. Pass it to send a
   * local template: PostHog fills its `{{ variables.* }}`, and the SDK uploads the template when PostHog does not hold
   * its content yet.
   */
  templateData?: Record<string, unknown>
}

/** A name and value that PostHog adds to the email's engagement events. ASCII letters, numbers, `_` and `-`. */
export type EmailTag = {
  name: string
  value: string
}

/** A file sent with the email. */
export interface EmailAttachment {
  /** The name the recipient sees, such as `'invoice.pdf'`. */
  filename: string
  /** The file's bytes, or its content already Base64 encoded. */
  content: Buffer | Uint8Array | string
  /** A MIME type, such as `'application/pdf'`. */
  contentType?: string
  /** Shows the file inline where the HTML has `<img src="cid:...">` with this id. */
  contentId?: string
  /** PostHog can't fetch a file from a path or URL: read the file and pass its `content`. */
  path?: never
}

/**
 * Email content from your code, named by a key. Needs `html`, `text` or both. PostHog derives a missing `text` from
 * the `html`, and sends HTML with no text in it, such as a single image, without a text part.
 */
export type CodeEmailForm = CodeEmailFields & ({ html: string; text?: string } | { html?: string; text: string })

type Without<T> = { [K in keyof T]?: never }

export type SendTemplateEmailOptions = SendEmailBase &
  TemplateEmailForm &
  Without<Omit<CodeEmailFields, 'templateData'> & { html: string; text: string }>

export type SendCodeEmailOptions = SendEmailBase & CodeEmailForm & Without<Omit<TemplateEmailForm, 'templateData'>>

/** One email to send with `posthog.emails.send()`, in exactly one form. */
export type SendEmailOptions = SendTemplateEmailOptions | SendCodeEmailOptions

/** Something to know about a queued email. */
export interface EmailWarning {
  code: string
  message: string
  fix?: string
}

/** Why an email call failed. Branch on `code`, PostHog's stable code, or on `name`, which uses Resend's names. */
export interface EmailError {
  /**
   * `validation_error`, `missing_api_key`, `invalid_permission`, `not_found`, `concurrent_idempotent_requests`,
   * `invalid_idempotent_request`, `rate_limit_exceeded`, `monthly_quota_exceeded`, `service_unavailable` or
   * `application_error`.
   */
  name: EmailErrorName
  /**
   * PostHog's error code, such as `invalid_recipient`, or one of the SDK's own: `missing_secret_key`,
   * `missing_app_host`, `client_disabled`, `client_closed`, `network_error`, `api_error` for an answer without a
   * code, `unexpected_error`, `invalid_form`, `invalid_template_id`, `invalid_template_key`, `invalid_attachment` and
   * `invalid_idempotency_key` for a send the SDK refused before any request, and `invalid_message_id` for a read.
   */
  code: string
  message: string
  /** Why PostHog refused the email. */
  why?: string
  /** What to change so the email sends. */
  fix?: string
  /** The HTTP status, when PostHog answered. */
  statusCode?: number
  /** A link to the docs section that explains the fix. */
  docsUrl?: string
  /** The request field the error is about, such as `cc` or `attachments__0__filename`. */
  field?: string
}

export type EmailErrorName =
  | 'validation_error'
  | 'missing_api_key'
  | 'invalid_permission'
  | 'not_found'
  | 'concurrent_idempotent_requests'
  | 'invalid_idempotent_request'
  | 'rate_limit_exceeded'
  | 'monthly_quota_exceeded'
  | 'service_unavailable'
  | 'application_error'

/** The result of `posthog.emails.send()`: the queued email's `id`, or the `error`. */
export type SendEmailResult =
  | { data: { id: string; warnings: EmailWarning[] }; error: null }
  | { data: null; error: EmailError }

/** Where an email is. `sent` and later come from the email provider. */
export type EmailStatus =
  | 'queued'
  | 'waiting'
  | 'unknown'
  | 'skipped'
  | 'failed'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'complained'

/** The latest status PostHog knows of one email. */
export interface EmailStatusRecord {
  /** The `id` that `posthog.emails.send()` returned. */
  id: string
  status: EmailStatus
  /** When PostHog queued the email, as an ISO 8601 timestamp. */
  createdAt: string
  /** When the email reached its status, as an ISO 8601 timestamp. */
  statusAt: string
  /** Why the email was skipped, failed or bounced, when PostHog knows. */
  reason?: string
}

/** The result of `posthog.emails.get()`: the email's status, or the `error`. */
export type GetEmailResult = { data: EmailStatusRecord; error: null } | { data: null; error: EmailError }

/** The `posthog.emails` API: send transactional email from your server. */
export interface Emails {
  /**
   * Queue one email. A result with `data` means PostHog stored the send in its queue, not that it was delivered.
   *
   * Never throws: it returns `{ data, error }`. Every send carries an idempotency key, so the SDK retries network
   * errors, an in-flight key, throttling and an unavailable pipeline, up to `maxRetries` times, without sending twice.
   * It never retries an exhausted monthly quota. The SDK captures no event: the send and its engagement events come
   * from PostHog and count as analytics events.
   *
   * Needs the `secretKey` client option, a project secret API key (`phs_`) with the `hog_flow:write` scope. When the
   * key can't read feature flags, also set `enableLocalEvaluation: false`, or the client polls flag definitions with it.
   *
   * @example A template made in PostHog, by its id
   * ```ts
   * const { data, error } = await posthog.emails.send({
   *   to: 'jane@example.com',
   *   distinctId: user.id,
   *   templateId: '0190f6d2-7c1e-4b3a-9f5e-1c2d3e4f5a6b',
   *   templateData: { firstName: 'Jane' },
   *   idempotencyKey: `welcome:${user.id}`,
   * })
   * ```
   *
   * @example Rendered content, such as React Email rendered to HTML in your app
   * ```ts
   * await posthog.emails.send({
   *   to: 'jane@example.com',
   *   distinctId: user.id,
   *   templateKey: 'password-reset',
   *   subject: 'Reset your password',
   *   html: await render(<PasswordReset url={url} />),
   * })
   * ```
   *
   * @example A local template: your code holds it, PostHog fills in the variables
   * ```ts
   * await posthog.emails.send({
   *   to: 'jane@example.com',
   *   distinctId: user.id,
   *   templateKey: 'welcome',
   *   subject: 'Welcome, {{ variables.name }}',
   *   html: welcomeHtml,
   *   templateData: { name: 'Jane' },
   * })
   * ```
   *
   * @example A copy, a tag and an attachment
   * ```ts
   * await posthog.emails.send({
   *   to: 'jane@example.com',
   *   distinctId: user.id,
   *   templateKey: 'invoice',
   *   subject: 'Your invoice',
   *   html: invoiceHtml,
   *   cc: 'finance@example.com',
   *   tags: [{ name: 'category', value: 'billing' }],
   *   attachments: [{ filename: 'invoice.pdf', content: await readFile('invoice.pdf') }],
   * })
   * ```
   */
  send(options: SendEmailOptions): Promise<SendEmailResult>

  /**
   * Read the latest status of an email that `send` queued.
   *
   * `status` is not Resend's `last_event`: it is where the email is now, from `queued` to `delivered`, `bounced`
   * or `complained`. A new email can take a few seconds to show up, and until then the read answers `not_found`.
   * Never throws, and never retries: call it again later to see a newer status.
   *
   * Needs the `secretKey` client option, a project secret API key with the `hog_flow:read` scope.
   *
   * @example
   * ```ts
   * const { data, error } = await posthog.emails.get(sent.id)
   * if (data?.status === 'bounced') {
   *   console.log(`Bounced: ${data.reason}`)
   * }
   * ```
   */
  get(id: string): Promise<GetEmailResult>
}

/** @internal */
export interface EmailsApi {
  isDisabled(): boolean
  isClosed(): boolean
  secretKey(): string | undefined
  /** `undefined` when the client's host may be a proxy and no `appHost` was set. */
  appHost(): string | undefined
  maxRetries(): number | undefined
  headers(): Record<string, string>
  warn(message: string): void
  track<T>(work: Promise<T>): Promise<T>
  /** Rejects only when PostHog never answered. */
  request(
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    headers: Record<string, string>,
    body: string | undefined
  ): Promise<PostHogApiResponse>
}

type Outcome<T> = { data: T; error: null } | Failure
type Failure = { data: null; error: EmailError }

interface Delivery {
  idempotencyKey?: string
  maxRetries: number
}

const READ_ONCE: Delivery = { maxRetries: 0 }

interface EmailCall {
  action: string
  scope: string
}

const SENDING: EmailCall = { action: 'Sending email', scope: 'hog_flow:write' }
const READING: EmailCall = { action: 'Reading an email', scope: 'hog_flow:read' }

interface ApiRequest {
  method: 'GET' | 'POST' | 'PUT'
  path: string
  body?: JsonType
}

interface Attempt {
  outcome: Outcome<PostHogApiResponse>
  retryAfterMs?: number
}

/** @internal */
export class PostHogEmails implements Emails {
  constructor(private readonly api: EmailsApi) {}

  send(options: SendEmailOptions): Promise<SendEmailResult> {
    if (!isRecord(options)) {
      return Promise.resolve(
        failure('invalid_form', 'send needs an options object with to, and templateId or templateKey.')
      )
    }
    const refusal = this.refusalBeforeRequest(options)
    if (refusal) {
      return Promise.resolve(refusal)
    }
    const delivery = {
      idempotencyKey: options.idempotencyKey ?? crypto.randomUUID(),
      maxRetries: retryCount(options.maxRetries) ?? retryCount(this.api.maxRetries()) ?? DEFAULT_MAX_RETRIES,
    }
    return this.api.track(
      this.sendForm(options, delivery)
        .then((result) => this.logWarnings(result))
        .catch(unexpectedFailure)
    )
  }

  get(id: string): Promise<GetEmailResult> {
    const refusal = this.clientRefusal(READING)
    if (refusal) {
      return Promise.resolve(refusal)
    }
    const path = statusPath(id)
    if (path === undefined) {
      return Promise.resolve(failure('invalid_message_id', 'id must be the id that send returned.', { field: 'id' }))
    }
    return this.api.track(
      this.exchange({ method: 'GET', path }, READ_ONCE)
        .then((outcome) => (outcome.error ? outcome : statusRecord(outcome.data)))
        .catch(unexpectedFailure)
    )
  }

  private refusalBeforeRequest(options: SendEmailOptions): Failure | undefined {
    return (
      this.clientRefusal(SENDING) ??
      formRefusal(options) ??
      unknownOptionRefusal(options) ??
      idempotencyKeyRefusal(options.idempotencyKey)
    )
  }

  private clientRefusal({ action, scope }: EmailCall): Failure | undefined {
    if (this.api.isDisabled()) {
      return failure('client_disabled', 'The PostHog client is disabled, so the SDK made no request.')
    }
    if (this.api.isClosed()) {
      return failure('client_closed', 'The PostHog client was shut down, so the SDK made no request.')
    }
    if (!this.api.secretKey()) {
      return failure(
        'missing_secret_key',
        `${action} needs the secretKey client option, a project secret API key with the ${scope} scope.`
      )
    }
    if (!this.api.appHost()) {
      return failure(
        'missing_app_host',
        `${action} needs the appHost client option when host is not PostHog Cloud, so the secret key never goes ` +
          'to a proxy.'
      )
    }
    return undefined
  }

  private async sendForm(options: SendEmailOptions, delivery: Delivery): Promise<SendEmailResult> {
    if (isTemplateForm(options)) {
      return this.post(templateBody(options), delivery)
    }
    if (options.templateData === undefined) {
      return this.post(renderedContentBody(options), delivery)
    }
    return this.sendLocalTemplate(options, delivery)
  }

  /** Sends the content's hash, and uploads the content only when PostHog does not hold it. */
  private async sendLocalTemplate(options: SendCodeEmailOptions, delivery: Delivery): Promise<SendEmailResult> {
    const { templateKey } = options
    const content = { subject: options.subject, html: options.html, text: options.text }
    const fields = jsonCopy(localTemplateFields(options))
    const body = { template: { key: templateKey, hash: await emailContentHash(content) }, ...fields }
    const sent = await this.post(body, delivery)
    if (!isOutdated(sent)) {
      return sent
    }
    const uploaded = await this.exchange(
      { method: 'PUT', path: UPLOAD_PATH(templateKey), body: uploadBody(templateKey, content) },
      delivery
    )
    return uploaded.error ? uploaded : this.post(body, delivery)
  }

  private async post(body: JsonType, delivery: Delivery): Promise<SendEmailResult> {
    const outcome = await this.exchange({ method: 'POST', path: SEND_PATH, body }, delivery)
    return outcome.error ? outcome : queuedEmail(outcome.data)
  }

  private async exchange(request: ApiRequest, delivery: Delivery): Promise<Outcome<PostHogApiResponse>> {
    const body = request.body === undefined ? undefined : JSON.stringify(request.body)
    for (let retry = 0; ; retry++) {
      const { outcome, retryAfterMs } = await this.attempt(request, body, delivery)
      if (retry >= delivery.maxRetries || !isRetryable(outcome)) {
        return outcome
      }
      await sleep(retryDelayMs(retry, retryAfterMs))
    }
  }

  private async attempt(request: ApiRequest, body: string | undefined, delivery: Delivery): Promise<Attempt> {
    const headers = {
      ...this.api.headers(),
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${this.api.secretKey()}`,
      ...(delivery.idempotencyKey !== undefined && { 'Idempotency-Key': delivery.idempotencyKey }),
    }
    let response: PostHogApiResponse
    try {
      response = await this.api.request(request.method, `${this.api.appHost()}${request.path}`, headers, body)
    } catch (error) {
      return { outcome: failure('network_error', error instanceof Error ? error.message : 'Request failed') }
    }
    const outcome = isSuccess(response.status)
      ? { data: response, error: null }
      : { data: null, error: apiError(response) }
    return { outcome, retryAfterMs: response.retryAfterMs }
  }

  private logWarnings(result: SendEmailResult): SendEmailResult {
    for (const warning of result.data?.warnings ?? []) {
      this.api.warn(`Email ${result.data?.id} was queued with a warning, ${warning.code}: ${warning.message}`)
    }
    return result
  }
}

function isTemplateForm(options: SendEmailOptions): options is SendTemplateEmailOptions {
  return options.templateId !== undefined
}

function formRefusal(options: SendEmailOptions): Failure | undefined {
  if ((options.templateId === undefined) === (options.templateKey === undefined)) {
    return failure('invalid_form', 'Send either templateId, or templateKey with subject and html or text.')
  }
  if (isTemplateForm(options)) {
    return isValidUUID(options.templateId)
      ? codeOnlyFieldRefusal(options)
      : failure('invalid_template_id', 'templateId must be the UUID of a template.', { field: 'templateId' })
  }
  if (typeof options.templateKey !== 'string' || !TEMPLATE_KEY_PATTERN.test(options.templateKey)) {
    return failure(
      'invalid_template_key',
      'templateKey can only have letters, digits, hyphens (-) and underscores (_), at most 400.',
      { field: 'templateKey' }
    )
  }
  return contentRefusal(options) ?? attachmentRefusal(options.attachments)
}

function codeOnlyFieldRefusal(options: SendTemplateEmailOptions): Failure | undefined {
  const field = CODE_ONLY_FIELDS.find((name) => options[name] !== undefined)
  if (field === undefined) {
    return undefined
  }
  return failure('invalid_form', `Send ${field} with templateKey. A template made in PostHog sets its own.`, { field })
}

function contentRefusal({ subject, html, text }: SendCodeEmailOptions): Failure | undefined {
  if (typeof subject !== 'string') {
    return failure('invalid_form', 'A send with templateKey needs a subject.', { field: 'subject' })
  }
  if (html !== undefined && typeof html !== 'string') {
    return failure('invalid_form', 'html must be a string.', { field: 'html' })
  }
  if (text !== undefined && typeof text !== 'string') {
    return failure('invalid_form', 'text must be a string.', { field: 'text' })
  }
  if (html === undefined && text === undefined) {
    return failure('invalid_form', 'A send with templateKey needs html, text or both.', { field: 'html' })
  }
  return undefined
}

function attachmentRefusal(attachments: EmailAttachment[] | undefined): Failure | undefined {
  if (attachments !== undefined && !Array.isArray(attachments)) {
    return failure('invalid_attachment', 'attachments must be a list of files.', { field: 'attachments' })
  }
  for (const [index, attachment] of (attachments ?? []).entries()) {
    if (attachment?.path !== undefined) {
      return failure(
        'invalid_attachment',
        "PostHog can't fetch an attachment from a path or URL. Read the file and pass its content instead.",
        { field: `attachments__${index}__path` }
      )
    }
    if (typeof attachment?.content !== 'string' && !(attachment?.content instanceof Uint8Array)) {
      return failure('invalid_attachment', 'An attachment needs content: a Buffer, a Uint8Array or a Base64 string.', {
        field: `attachments__${index}__content`,
      })
    }
  }
  return undefined
}

function idempotencyKeyRefusal(idempotencyKey: string | undefined): Failure | undefined {
  if (idempotencyKey === undefined || isIdempotencyKey(idempotencyKey)) {
    return undefined
  }
  return failure(
    'invalid_idempotency_key',
    'idempotencyKey must be 1 to 255 visible ASCII characters, with no spaces.',
    {
      field: 'idempotencyKey',
    }
  )
}

function templateBody(options: SendTemplateEmailOptions): JsonType {
  return {
    template: { id: options.templateId },
    ...recipientFields(options),
    ...templateDataField(options.templateData),
  }
}

function renderedContentBody(options: SendCodeEmailOptions): JsonType {
  return {
    template_key: options.templateKey,
    subject: options.subject,
    ...definedFields({ html: options.html, text: options.text }),
    ...recipientFields(options),
    ...codeFormFields(options),
  }
}

function localTemplateFields(options: SendCodeEmailOptions): Record<string, JsonType> {
  return {
    ...recipientFields(options),
    ...templateDataField(options.templateData),
    ...codeFormFields(options),
  }
}

function uploadBody(key: string, content: { subject: string; html?: string; text?: string }): JsonType {
  return { name: key, ...definedFields(content), if_code_managed: true, if_not_superseded: true }
}

function recipientFields({ to, distinctId, captureEngagement }: SendEmailBase): Record<string, JsonType> {
  return {
    to,
    ...(distinctId !== undefined && { identifiers: { distinct_id: distinctId } }),
    ...(captureEngagement !== undefined && { capture_engagement: captureEngagement }),
  }
}

function codeFormFields(options: SendCodeEmailOptions): Record<string, JsonType> {
  const { from, replyTo, cc, bcc, headers, tags, attachments } = options
  return {
    ...(from !== undefined && { from }),
    ...(replyTo !== undefined && { reply_to: addressList(replyTo) }),
    ...(cc !== undefined && { cc: addressList(cc) }),
    ...(bcc !== undefined && { bcc: addressList(bcc) }),
    ...(headers !== undefined && { headers }),
    ...(tags !== undefined && { tags }),
    ...(attachments !== undefined && { attachments: attachments.map(attachmentFields) }),
  }
}

function addressList(addresses: string | string[]): string[] {
  return typeof addresses === 'string' ? [addresses] : addresses
}

function attachmentFields({ filename, content, contentType, contentId }: EmailAttachment): Record<string, string> {
  return {
    filename,
    content: typeof content === 'string' ? content : base64Of(content),
    ...definedFields({ content_type: contentType, content_id: contentId }),
  }
}

function base64Of(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK_BYTES) {
    chunks.push(String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK_BYTES)))
  }
  return btoa(chunks.join(''))
}

function templateDataField(templateData: Record<string, unknown> | undefined): Record<string, JsonType> {
  return templateData === undefined ? {} : { message_data: templateData as JsonType }
}

function jsonCopy<T extends JsonType>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function definedFields(fields: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Record<string, string>
}

/** PostHog does not hold this local template's content, so nothing was sent and an upload fixes it. */
function isOutdated({ error }: SendEmailResult): boolean {
  return error?.statusCode === 409 && error.code === 'template_outdated'
}

function queuedEmail({ status, body }: PostHogApiResponse): SendEmailResult {
  if (!isRecord(body) || typeof body.message_id !== 'string') {
    return failure('api_error', `PostHog answered HTTP ${status} with an unexpected body.`, { statusCode: status })
  }
  return { data: { id: body.message_id, warnings: warningsOf(body.warnings) }, error: null }
}

function isRetryable({ error }: Outcome<PostHogApiResponse>): boolean {
  switch (error?.name) {
    case 'concurrent_idempotent_requests':
    case 'rate_limit_exceeded':
      return true
    case 'service_unavailable':
      return error.code === 'network_error' || error.statusCode === 503
    default:
      return false
  }
}

function unknownOptionRefusal(options: SendEmailOptions): Failure | undefined {
  const field = Object.entries(options).find(([name, value]) => value !== undefined && !SEND_OPTIONS.has(name))?.[0]
  if (field === undefined) {
    return undefined
  }
  return failure('invalid_form', `send doesn't take ${field}, so it sent nothing. Remove ${field} and send again.`, {
    field,
  })
}

function isIdempotencyKey(value: unknown): boolean {
  return typeof value === 'string' && IDEMPOTENCY_KEY_PATTERN.test(value)
}

function retryCount(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function retryDelayMs(retry: number, retryAfterMs = 0): number {
  const backoff = FIRST_RETRY_DELAY_MS * 2 ** retry * (0.8 + Math.random() * 0.4)
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(backoff, retryAfterMs))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Resend's error name for an answer, so migrated code that branches on `error.name` keeps working. */
function errorName(code: string, statusCode?: number): EmailErrorName {
  switch (code) {
    case 'missing_secret_key':
      return 'missing_api_key'
    case 'network_error':
      return 'service_unavailable'
    case 'invalid_form':
    case 'invalid_template_id':
    case 'invalid_template_key':
    case 'invalid_attachment':
    case 'invalid_message_id':
    case 'invalid_idempotency_key':
      return 'validation_error'
  }
  switch (statusCode) {
    case 400:
      return 'validation_error'
    case 401:
      return 'missing_api_key'
    case 403:
      return 'invalid_permission'
    case 404:
      return 'not_found'
    case 409:
      return code === 'idempotency_key_in_flight' ? 'concurrent_idempotent_requests' : 'validation_error'
    case 422:
      return 'invalid_idempotent_request'
    case 429:
      return code === 'quota_limited' ? 'monthly_quota_exceeded' : 'rate_limit_exceeded'
    case 503:
      return 'service_unavailable'
    default:
      return 'application_error'
  }
}

function failure(code: string, message: string, details: Partial<EmailError> = {}): Failure {
  return { data: null, error: { name: errorName(code, details.statusCode), code, message, ...details } }
}

function unexpectedFailure(error: unknown): Failure {
  return failure('unexpected_error', error instanceof Error ? error.message : 'The email call failed unexpectedly.')
}

function apiError({ status, body }: PostHogApiResponse): EmailError {
  const fields = isRecord(body) ? body : {}
  const code = textOf(fields.code) ?? 'api_error'
  return {
    name: errorName(code, status),
    code,
    message: textOf(fields.detail) ?? `PostHog answered HTTP ${status}.`,
    ...optional('why', textOf(fields.why)),
    ...optional('fix', textOf(fields.fix)),
    statusCode: status,
    ...optional('docsUrl', textOf(fields.docs_url)),
    ...optional('field', textOf(fields.attr)),
  }
}

function statusPath(id: unknown): string | undefined {
  if (typeof id !== 'string' || !id) {
    return undefined
  }
  try {
    return STATUS_PATH(id)
  } catch {
    return undefined
  }
}

function statusRecord({ status, body }: PostHogApiResponse): GetEmailResult {
  const fields = isRecord(body) ? body : {}
  const [id, emailStatus, createdAt, statusAt] = [fields.id, fields.status, fields.created_at, fields.status_at].map(
    textOf
  )
  if (!id || !emailStatus || !createdAt || !statusAt) {
    return failure('api_error', `PostHog answered HTTP ${status} with an unexpected body.`, { statusCode: status })
  }
  return {
    data: { id, status: emailStatus as EmailStatus, createdAt, statusAt, ...optional('reason', textOf(fields.reason)) },
    error: null,
  }
}

function warningsOf(warnings: unknown): EmailWarning[] {
  return (Array.isArray(warnings) ? warnings : []).flatMap((warning) => {
    if (!isRecord(warning) || !textOf(warning.code) || !textOf(warning.detail)) {
      return []
    }
    return [{ code: textOf(warning.code)!, message: textOf(warning.detail)!, ...optional('fix', textOf(warning.fix)) }]
  })
}

function optional<K extends string>(key: K, value: string | undefined): { [P in K]?: string } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: string }
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
