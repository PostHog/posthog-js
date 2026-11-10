import {
  type FetchLike,
  type Logger,
  type PostHogFetchResponse,
  parseRetryAfterMs,
  removeTrailingSlash,
  safeJsonStringify,
} from '@posthog/core'

import { type AttachmentFile, type HashedFile, attachmentFiles, attachmentReference, hashedFiles } from './attachments'
import { EmailError } from './errors'
import type {
  CodeEmailForm,
  EmailStatus,
  EmailWarning,
  Emails,
  GetEmailResponse,
  SendEmailBase,
  SendEmailOptions,
  SendEmailResponse,
  SendEmailResult,
  SendTemplateEmailOptions,
  TemplateEmailForm,
} from './types'

const SEND_PATH = '/api/projects/@current/messaging/send/email/'
const UPLOADS_PATH = '/api/projects/@current/messaging/attachments/uploads/'
const STATUS_PATH = '/api/projects/@current/messaging/emails/{messageId}/'
const US_APP_HOST = 'https://us.posthog.com'
const EU_APP_HOST = 'https://eu.posthog.com'
const CLOUD_APP_HOSTS: Record<string, string> = {
  'https://us.i.posthog.com': US_APP_HOST,
  'https://us.posthog.com': US_APP_HOST,
  'https://app.posthog.com': US_APP_HOST,
  'https://eu.i.posthog.com': EU_APP_HOST,
  'https://eu.posthog.com': EU_APP_HOST,
}
const MAX_RETRY_DELAY_MS = 30_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/
const TEMPLATE_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,400}$/

type EveryField<Form> = Record<keyof Form, true>
type UncheckedSend = { [Field in keyof SendTemplateEmailOptions]?: unknown }

interface SendForm {
  name: 'templateId' | 'templateKey'
  fields: ReadonlySet<string>
  why: string
  howToSend: string
}

const SHARED_FIELDS: EveryField<SendEmailBase> = {
  to: true,
  distinctId: true,
  idempotencyKey: true,
  maxRetries: true,
}
const TEMPLATE_FIELDS: EveryField<TemplateEmailForm> = { templateId: true, templateData: true }
const CODE_FIELDS: EveryField<CodeEmailForm> = {
  templateKey: true,
  subject: true,
  from: true,
  replyTo: true,
  captureEngagement: true,
  cc: true,
  bcc: true,
  attachments: true,
  html: true,
  text: true,
}
const TEMPLATE_FORM: SendForm = {
  name: 'templateId',
  fields: fieldSet(SHARED_FIELDS, TEMPLATE_FIELDS),
  why: "A template made in PostHog sets its own sender, subject and content, and follows the project's engagement setting.",
  howToSend: 'send a template made in PostHog with templateId',
}
const CODE_FORM: SendForm = {
  name: 'templateKey',
  fields: fieldSet(SHARED_FIELDS, CODE_FIELDS),
  why: 'A send with templateKey takes its content from your code.',
  howToSend: 'send content from your code with templateKey',
}

export const DEFAULT_EMAIL_REQUEST_TIMEOUT_MS = 15_000
export const DEFAULT_EMAIL_REQUEST_MAX_RETRIES = 2

export interface EmailSenderConfig {
  secretKey?: string
  /** The client's `host`. Used only when it is PostHog Cloud. */
  host: string
  appHost?: string
  requestTimeoutMs: number
  maxRetries: number
  migratedFrom?: string
}

export interface EmailSenderHooks {
  fetch: FetchLike
  isDisabled: () => boolean
  isClosed: () => boolean
  logger: Logger
  userAgent?: string
}

interface PreparedSend {
  content: Record<string, unknown>
  files: AttachmentFile[]
  idempotencyKey: string
  maxRetries: number
}

interface Upload {
  url: string
  headers: Record<string, string>
  bytes: Uint8Array<ArrayBuffer>
  field: string
}

interface Reply {
  status: number
  text: string
  retryAfterMs?: number
}

/**
 * Sends one transactional email per call to the messaging send API on the app host, and reads
 * the status of a sent email. Owns the attempt loop, so every attempt of a send carries the same
 * idempotency key.
 */
export class EmailSender implements Emails {
  private readonly config: EmailSenderConfig
  private readonly hooks: EmailSenderHooks
  private readonly inFlight = new Set<Promise<unknown>>()

  constructor(config: EmailSenderConfig, hooks: EmailSenderHooks) {
    this.config = config
    this.hooks = hooks
  }

  send(options: SendEmailOptions, ...unexpected: unknown[]): Promise<SendEmailResponse> {
    return this.track(this.sendUntracked(options, unexpected))
  }

  get(id: string): Promise<GetEmailResponse> {
    return this.track(this.getUntracked(id))
  }

  private track<T>(pending: Promise<T>): Promise<T> {
    this.inFlight.add(pending)
    void pending.finally(() => this.inFlight.delete(pending))
    return pending
  }

  /**
   * Resolves when every send and status read in flight, retries included, has settled.
   * Kept apart from the client's pending-promise queue, so a send in its retry backoff does not hold back `flush()`.
   */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all(this.inFlight)
    }
  }

  private async sendUntracked(options: SendEmailOptions, unexpected: unknown[]): Promise<SendEmailResponse> {
    try {
      refuseSecondArgument(unexpected)
      const prepared = prepareSend(options, this.config.maxRetries)
      const { appHost, secretKey } = this.connect(
        'no email was sent',
        'Sending email needs secretKey, a project secret API key with the transactional_email:write scope.'
      )
      const attachments = await this.uploadAttachments(prepared, appHost, secretKey)
      const body = safeJsonStringify({ ...prepared.content, ...unlessEmpty('attachments', attachments) })
      const headers = this.headers(secretKey, {
        'Content-Type': 'application/json',
        'Idempotency-Key': prepared.idempotencyKey,
      })
      const result = await this.withRetries(prepared.maxRetries, async () =>
        parseSendReply(await this.request(appHost + SEND_PATH, 'POST', headers, body))
      )
      for (const warning of result.warnings) {
        this.hooks.logger.warn(`PostHog email warning ${warning.code}: ${warning.message}`)
      }
      return { data: result, error: null }
    } catch (error) {
      return { data: null, error: asEmailError(error, 'Sending the email failed unexpectedly.') }
    }
  }

  private async getUntracked(id: string): Promise<GetEmailResponse> {
    try {
      if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
        throw invalid('invalid_message_id', 'id must be the message ID that send() returned.', 'id')
      }
      const { appHost, secretKey } = this.connect(
        'no email status was read',
        'Reading an email status needs secretKey, a project secret API key with the transactional_email:read or transactional_email:write scope.'
      )
      const url = appHost + STATUS_PATH.replace('{messageId}', id.toLowerCase())
      const headers = this.headers(secretKey, {})
      const status = await this.withRetries(this.config.maxRetries, async () =>
        parseStatusReply(await this.request(url, 'GET', headers))
      )
      return { data: status, error: null }
    } catch (error) {
      return { data: null, error: asEmailError(error, 'Reading the email status failed unexpectedly.') }
    }
  }

  private async uploadAttachments(
    { files, maxRetries }: PreparedSend,
    appHost: string,
    secretKey: string
  ): Promise<Record<string, unknown>[]> {
    if (files.length === 0) {
      return []
    }
    const hashed = await hashedFiles(files)
    const distinct = new Map<string, HashedFile>()
    for (const file of hashed) {
      if (!distinct.has(file.sha256)) {
        distinct.set(file.sha256, file)
      }
    }
    const requested = [...distinct.values()]
    const body = safeJsonStringify({
      files: requested.map(({ sha256, bytes }) => ({ sha256, size: bytes.byteLength })),
    })
    const headers = this.headers(secretKey, { 'Content-Type': 'application/json' })
    const uploads = await this.withRetries(maxRetries, async () =>
      parseUploadsReply(await this.request(appHost + UPLOADS_PATH, 'POST', headers, body), requested)
    )
    for (const upload of uploads) {
      await this.withRetries(maxRetries, () => this.uploadFile(upload))
    }
    return hashed.map(attachmentReference)
  }

  private async uploadFile({ url, headers, bytes, field }: Upload): Promise<void> {
    let reply: Reply
    try {
      reply = await this.request(url, 'PUT', headers, bytes)
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') {
        throw new EmailError({
          code: 'network_error',
          message: `The upload of ${field} timed out after ${this.config.requestTimeoutMs}ms, so no email was sent.`,
          fix: 'Raise emailRequestTimeoutMs on the client, or send smaller files.',
          field,
          cause,
        })
      }
      throw new EmailError({
        code: 'network_error',
        message: `The upload of ${field} didn't reach PostHog's file storage, so no email was sent.`,
        field,
        cause,
      })
    }
    if (reply.status < 200 || reply.status >= 300) {
      throw new EmailError({
        code: 'attachment_upload_failed',
        message: `PostHog's file storage refused the upload of ${field}, so no email was sent. ${storageAnswer(reply)}`,
        statusCode: reply.status,
        fix: 'Send the email again. Each send asks for new upload URLs.',
        field,
        retryAfterMs: reply.retryAfterMs,
      })
    }
  }

  private connect(nothingDone: string, missingSecretKey: string): { appHost: string; secretKey: string } {
    if (this.hooks.isDisabled()) {
      throw new EmailError({
        code: 'client_disabled',
        message: `The PostHog client is disabled, so ${nothingDone}.`,
      })
    }
    if (this.hooks.isClosed()) {
      throw new EmailError({
        code: 'client_closed',
        message: `The PostHog client is shut down, so ${nothingDone}.`,
      })
    }
    const appHost = resolveAppHost(this.config.host, this.config.appHost)
    if (!appHost) {
      // A custom host is often an ingestion proxy, which must not receive the secret key.
      throw new EmailError({
        code: 'missing_app_host',
        message:
          "The client's host is not PostHog Cloud, so the client can't tell where to send email. Set appHost to your PostHog app host on the client.",
      })
    }
    const secretKey = this.config.secretKey?.trim()
    if (!secretKey) {
      throw new EmailError({ code: 'missing_secret_key', message: missingSecretKey })
    }
    return { appHost, secretKey }
  }

  private headers(secretKey: string, extra: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${secretKey}`,
      Accept: 'application/json',
      ...extra,
    }
    if (this.hooks.userAgent) {
      headers['User-Agent'] = this.hooks.userAgent
    }
    if (this.config.migratedFrom) {
      headers['X-PostHog-Migrated-From'] = this.config.migratedFrom
    }
    return headers
  }

  private async withRetries<T>(maxRetries: number, attemptOnce: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let error: EmailError
      try {
        return await attemptOnce()
      } catch (caught) {
        error =
          caught instanceof EmailError
            ? caught
            : new EmailError({
                code: 'network_error',
                message: 'The request to PostHog failed.',
                cause: caught,
              })
      }
      const delayMs = retryDelayMs(error, attempt, maxRetries)
      if (delayMs === undefined) {
        throw error
      }
      // A plain timer, not an unref'd one: the caller awaits the request, so the process must stay up for the retry.
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  private async request(
    url: string,
    method: 'GET' | 'POST' | 'PUT',
    headers: Record<string, string>,
    body?: string | Uint8Array<ArrayBuffer>
  ): Promise<Reply> {
    const controller = new AbortController()
    const timeoutMs = this.config.requestTimeoutMs
    let timer: ReturnType<typeof setTimeout>
    // `fetch` is injectable and may ignore the abort signal, so both phases race the deadline.
    // A plain timer, not an unref'd one: an injected fetch may hold no handle, and the process must stay up until
    // the deadline settles the send.
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const timeoutError = new Error(`Email request timed out after ${timeoutMs}ms`)
        timeoutError.name = 'AbortError'
        reject(timeoutError)
        controller.abort(timeoutError)
      }, timeoutMs)
    })
    const fetchPromise = Promise.resolve().then(() =>
      this.hooks.fetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      })
    )
    void fetchPromise
      .then((lateResponse) => {
        if (controller.signal.aborted) {
          // Release a late response from an injected fetch that ignored the deadline, so it frees its connection.
          void Promise.resolve(lateResponse.body?.cancel()).catch(() => {})
        }
      })
      .catch(() => {})
    let response: PostHogFetchResponse | undefined
    try {
      response = await Promise.race([fetchPromise, deadline])
      let text: string
      try {
        text = await Promise.race([response.text(), deadline])
      } catch (error) {
        // An accepted send may already be queued, so a failed read stays a retryable network error.
        if (response.status >= 200 && response.status < 300) {
          throw error
        }
        // The status and Retry-After still decide the retry when an error body can't be read.
        return { status: response.status, text: '', retryAfterMs: readRetryAfter(response) }
      }
      return { status: response.status, text, retryAfterMs: readRetryAfter(response) }
    } finally {
      clearTimeout(timer!)
      if (controller.signal.aborted && response) {
        // Release a body whose read passed the deadline. Do not await: an injected cancel may never settle.
        void Promise.resolve(response.body?.cancel()).catch(() => {})
      }
    }
  }
}

function refuseSecondArgument(unexpected: unknown[]): void {
  if (unexpected.some((argument) => argument !== undefined)) {
    throw new EmailError({
      code: 'invalid_form',
      message: 'send takes one options object, so no email was sent. Put idempotencyKey and every other option in it.',
    })
  }
}

function prepareSend(options: SendEmailOptions, defaultMaxRetries: number): PreparedSend {
  const send: UncheckedSend = options ?? {}
  const { to, distinctId, idempotencyKey, maxRetries } = send
  if (typeof to !== 'string' || !to.trim()) {
    throw invalid('invalid_recipient', 'to must be one email address as a nonempty string.', 'to')
  }
  if (distinctId !== undefined && (typeof distinctId !== 'string' || !distinctId)) {
    throw invalid('invalid_distinct_id', 'distinctId must be a nonempty string.', 'distinctId')
  }
  const { content, files } = contentOf(send, distinctId)
  if (
    idempotencyKey !== undefined &&
    (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey))
  ) {
    throw invalid(
      'invalid_idempotency_key',
      'idempotencyKey must be 1 to 255 visible ASCII characters without spaces.',
      'idempotencyKey'
    )
  }
  if (maxRetries !== undefined && !isRetryCount(maxRetries)) {
    throw invalid('invalid_max_retries', 'maxRetries must be a nonnegative integer.', 'maxRetries')
  }

  return {
    content: snapshotOf({ ...content, to }),
    files,
    idempotencyKey: idempotencyKey ?? globalThis.crypto.randomUUID(),
    maxRetries: isRetryCount(maxRetries) ? maxRetries : defaultMaxRetries,
  }
}

function snapshotOf(content: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(safeJsonStringify(content))
}

function isRetryCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

interface SendContent {
  content: Record<string, unknown>
  files: AttachmentFile[]
}

function contentOf(send: UncheckedSend, distinctId: string | undefined): SendContent {
  if ((send.templateId === undefined) === (send.templateKey === undefined)) {
    throw new EmailError({
      code: 'invalid_form',
      message: 'Send either templateId, or templateKey with subject and html or text.',
    })
  }
  return send.templateKey === undefined
    ? { content: templateContent(send, distinctId), files: [] }
    : codeContent(send, distinctId)
}

function templateContent(send: UncheckedSend, distinctId: string | undefined): Record<string, unknown> {
  const { templateId, templateData } = send
  if (typeof templateId !== 'string' || !UUID_PATTERN.test(templateId)) {
    throw invalid('invalid_template_id', "templateId must be the template's UUID.", 'templateId')
  }
  if (
    templateData !== undefined &&
    (typeof templateData !== 'object' || templateData === null || Array.isArray(templateData))
  ) {
    throw invalid('invalid_template_data', 'templateData must be an object.', 'templateData')
  }
  refuseFieldsOutside(send, TEMPLATE_FORM, CODE_FORM)
  return {
    template_id: templateId.toLowerCase(),
    message_data: templateData ?? {},
    ...(distinctId !== undefined && { distinct_id: distinctId }),
  }
}

function codeContent(send: UncheckedSend, distinctId: string | undefined): SendContent {
  const { templateKey, subject, html, text } = send
  if (typeof templateKey !== 'string' || !TEMPLATE_KEY_PATTERN.test(templateKey)) {
    throw invalid(
      'invalid_template_key',
      'templateKey can only have letters, digits, hyphens (-) and underscores (_), at most 400.',
      'templateKey'
    )
  }
  refuseFieldsOutside(send, CODE_FORM, TEMPLATE_FORM)
  if (typeof subject !== 'string') {
    throw invalid('invalid_form', 'A send with templateKey needs a subject.', 'subject')
  }
  if (html !== undefined && typeof html !== 'string') {
    throw invalid('invalid_form', 'html must be a string.', 'html')
  }
  if (text !== undefined && typeof text !== 'string') {
    throw invalid('invalid_form', 'text must be a string.', 'text')
  }
  if (html === undefined && text === undefined) {
    throw invalid('invalid_form', 'A send with templateKey needs html, text or both.', 'html')
  }
  const files = send.attachments === undefined ? [] : attachmentFiles(send.attachments, [html ?? '', text ?? ''])
  return {
    content: {
      template_key: templateKey,
      subject,
      ...(html !== undefined && { html }),
      ...(text !== undefined && { text }),
      ...codeFormFields(send),
      ...(distinctId !== undefined && { distinct_id: distinctId }),
    },
    files,
  }
}

function codeFormFields(send: UncheckedSend): Record<string, unknown> {
  const { from, replyTo, cc, bcc, captureEngagement } = send
  return {
    ...(from !== undefined && { from }),
    ...(replyTo !== undefined && unlessEmpty('reply_to', addressList(replyTo))),
    ...(cc !== undefined && unlessEmpty('cc', addressList(cc))),
    ...(bcc !== undefined && unlessEmpty('bcc', addressList(bcc))),
    capture_engagement: captureEngagement ?? true,
  }
}

function unlessEmpty(field: string, list: unknown): Record<string, unknown> {
  return Array.isArray(list) && list.length === 0 ? {} : { [field]: list }
}

function addressList(addresses: unknown): unknown {
  return typeof addresses === 'string' ? [addresses] : addresses
}

function refuseFieldsOutside(send: UncheckedSend, form: SendForm, otherForm: SendForm): void {
  const field = Object.entries(send).find(([name, value]) => value !== undefined && !form.fields.has(name))?.[0]
  if (field === undefined) {
    return
  }
  const message = `A send with ${form.name} doesn't take ${field}, so no email was sent.`
  if (!otherForm.fields.has(field)) {
    throw new EmailError({ code: 'invalid_form', message, field, fix: `Remove ${field} and send again.` })
  }
  throw new EmailError({
    code: 'invalid_form',
    message,
    field,
    why: form.why,
    fix: `Remove ${field}, or ${otherForm.howToSend}.`,
  })
}

function fieldSet(...groups: object[]): ReadonlySet<string> {
  return new Set(groups.flatMap((group) => Object.keys(group)))
}

function invalid(code: string, message: string, field: string): EmailError {
  return new EmailError({ code, message, field })
}

/**
 * The app host for a send, or undefined when the client can't tell it.
 * PostHog Cloud ingestion hosts don't serve the app API, so they map to their region's app host.
 */
function resolveAppHost(host: string, appHost: string | undefined): string | undefined {
  const explicit = typeof appHost === 'string' ? removeTrailingSlash(appHost.trim()) : ''
  if (explicit) {
    return CLOUD_APP_HOSTS[explicit] ?? explicit
  }
  return CLOUD_APP_HOSTS[removeTrailingSlash(host)]
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function readRetryAfter(response: PostHogFetchResponse): number | undefined {
  try {
    // The full wait, not the shared five minute cap: callers schedule their own retry from it, and the retry ceiling
    // here applies separately in retryDelayMs.
    return parseRetryAfterMs(response.headers?.get('retry-after'), Date.now(), Number.MAX_SAFE_INTEGER)
  } catch {
    return undefined
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function replyFields(payload: unknown): Record<string, unknown> {
  return (payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) as Record<
    string,
    unknown
  >
}

function parseSendReply({ status, text: body, retryAfterMs }: Reply): SendEmailResult {
  const fields = replyFields(parseJson(body))
  if (status >= 200 && status < 300) {
    const id = text(fields.message_id)
    if (!id) {
      throw new EmailError({
        code: 'api_error',
        message: 'PostHog answered without a message ID.',
        statusCode: status,
      })
    }
    const warnings: EmailWarning[] = []
    if (Array.isArray(fields.warnings)) {
      for (const warning of fields.warnings) {
        if (warning !== null && typeof warning === 'object') {
          warnings.push({
            code: text(warning.code) ?? 'warning',
            message: text(warning.detail) ?? text(warning.message) ?? '',
            fix: text(warning.fix),
          })
        }
      }
    }
    return { id, replayed: fields.replayed === true, warnings }
  }
  throw replyError(fields, status, retryAfterMs)
}

function parseStatusReply({ status, text: body, retryAfterMs }: Reply): EmailStatus {
  const fields = replyFields(parseJson(body))
  if (status < 200 || status >= 300) {
    throw replyError(fields, status, retryAfterMs)
  }
  const id = text(fields.id)
  const deliveryStatus = text(fields.status)
  const createdAt = text(fields.created_at)
  const statusAt = text(fields.status_at)
  if (!id || !deliveryStatus || !createdAt || !statusAt) {
    throw new EmailError({
      code: 'api_error',
      message: 'PostHog answered without an email status.',
      statusCode: status,
    })
  }
  return { id, status: deliveryStatus, createdAt, statusAt, reason: text(fields.reason) ?? null }
}

function parseUploadsReply({ status, text: body, retryAfterMs }: Reply, requested: HashedFile[]): Upload[] {
  const fields = replyFields(parseJson(body))
  if (status === 404) {
    throw replyError({ code: 'not_found', ...fields, attr: text(fields.attr) ?? 'attachments' }, status, retryAfterMs)
  }
  if (status < 200 || status >= 300) {
    throw replyError({ ...fields, attr: callerField(text(fields.attr), requested) }, status, retryAfterMs)
  }
  const answers = Array.isArray(fields.files) ? fields.files.map(replyFields) : []
  const uploads: Upload[] = []
  for (const { sha256, bytes, field } of requested) {
    const answer = answers.find((file) => file.sha256 === sha256)
    if (answer?.status === 'present') {
      continue
    }
    const url = text(answer?.url)
    if (answer?.status !== 'upload' || !url || !isStringRecord(answer.headers)) {
      throw new EmailError({
        code: 'api_error',
        message: 'PostHog answered without telling where to upload every file.',
        statusCode: status,
      })
    }
    uploads.push({ url, headers: answer.headers, bytes, field })
  }
  return uploads
}

function callerField(attr: string | undefined, requested: HashedFile[]): string | undefined {
  const file = attr === undefined ? null : /^files(?:__(\d+))?(?:__|$)/.exec(attr)
  if (!file) {
    return attr
  }
  return file[1] === undefined ? 'attachments' : (requested[Number(file[1])]?.field ?? 'attachments')
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  )
}

function storageAnswer({ status, text: body }: Reply): string {
  const code = /<Code>([^<]{1,100})<\/Code>/.exec(body)?.[1]
  const message = /<Message>([^<]{1,300})<\/Message>/.exec(body)?.[1]
  const answer = `It answered HTTP ${status}${code ? ` ${code}` : ''}${message ? `: ${message}` : ''}`
  return answer.endsWith('.') ? answer : `${answer}.`
}

function replyError(fields: Record<string, unknown>, status: number, retryAfterMs: number | undefined): EmailError {
  return new EmailError({
    code: text(fields.code) ?? 'api_error',
    message: text(fields.detail) ?? `PostHog answered HTTP ${status}.`,
    statusCode: status,
    why: text(fields.why),
    fix: text(fields.fix),
    docsUrl: text(fields.docs_url),
    field: text(fields.attr),
    retryAfterMs,
  })
}

function asEmailError(error: unknown, message: string): EmailError {
  return error instanceof EmailError ? error : new EmailError({ code: 'unexpected_error', message, cause: error })
}

function isRetryable(error: EmailError): boolean {
  // A send carries an idempotency key, so a retry can't queue a second email. A status read changes nothing.
  if (error.statusCode === undefined) {
    return error.code === 'network_error'
  }
  if (error.code === 'attachment_upload_failed') {
    return error.statusCode === 429 || error.statusCode >= 500
  }
  if (error.statusCode === 409) {
    return error.code === 'idempotency_key_in_flight'
  }
  if (error.statusCode === 429) {
    return error.code !== 'quota_limited' && error.code !== 'upload_quota_exceeded'
  }
  return error.statusCode === 503
}

function retryDelayMs(error: EmailError, attempt: number, maxRetries: number): number | undefined {
  if (attempt >= maxRetries || !isRetryable(error)) {
    return undefined
  }
  // Retrying before a longer Retry-After would break the server's rate limit.
  if (error.retryAfterMs !== undefined && error.retryAfterMs > MAX_RETRY_DELAY_MS) {
    return undefined
  }
  const backoffMs = Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** attempt * (0.8 + Math.random() * 0.4))
  return Math.max(backoffMs, error.retryAfterMs ?? 0)
}
