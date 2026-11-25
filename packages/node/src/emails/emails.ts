import {
  type Logger,
  type PostHogFetchOptions,
  type PostHogFetchResponse,
  parseRetryAfterMs,
  removeTrailingSlash,
  safeJsonStringify,
} from '@posthog/core'

import {
  type AttachmentFile,
  type HashedFile,
  attachmentFiles,
  attachmentReference,
  hashedFiles,
  refuseRenderedMessageOverLimit,
} from './attachments'
import {
  IDEMPOTENCY_KEY_PATTERN,
  type Slot,
  batchBody,
  fieldsOf,
  mayHaveQueued,
  prepareRecipients,
  recordAnswer,
  recordFailure,
  resultOf,
} from './batch'
import { EmailError } from './errors'
import { type Reply, parseJson, replyError, replyFields, text, warningsOf } from './replies'
import type {
  BatchEmailOptions,
  BatchEmailRecipient,
  BatchEmailResponse,
  CodeEmailForm,
  EmailPreferences,
  EmailReactElement,
  EmailStatus,
  EmailWarning,
  Emails,
  GetEmailResponse,
  SendEmailBase,
  SendEmailOptions,
  SendEmailResponse,
  SendEmailResult,
  SendTemplateEmailOptions,
  SetEmailPreferencesOptions,
  SetEmailPreferencesResponse,
  TemplateEmailForm,
} from './types'

const SEND_PATH = '/api/messaging/send/email/'
const BATCH_PATH = '/api/messaging/send/email_batch/'
const UPLOADS_PATH = '/api/messaging/attachments/uploads/'
const STATUS_PATH = '/api/messaging/emails/{messageId}/'
const PREFERENCES_PATH = '/api/messaging/preferences/'
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
const BATCH_REQUEST_TIMEOUT_MS = 45_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TEMPLATE_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,400}$/
const SCHEDULED_AT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-](\d{2}):(\d{2}))$/
const CLOUD_APP_HOST_SET: ReadonlySet<string> = new Set([US_APP_HOST, EU_APP_HOST])

type EveryField<Form> = Record<keyof Form, true>
interface ReactRenderer {
  render(element: EmailReactElement): Promise<string>
  toPlainText(html: string): string
}
type UncheckedSend = { [Field in keyof SendTemplateEmailOptions]?: unknown }

interface SendForm {
  name: 'templateId' | 'templateKey'
  call: 'send' | 'batch'
  fields: ReadonlySet<string>
  why: string
  howToSend: string
  fixes?: Record<string, string>
}

const SHARED_FIELDS: EveryField<SendEmailBase> = {
  to: true,
  distinctId: true,
  idempotencyKey: true,
  maxRetries: true,
  scheduledAt: true,
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
  sensitive: true,
  tracking: true,
  html: true,
  text: true,
  react: true,
}
const KNOWN_FIELDS = fieldSet(SHARED_FIELDS, TEMPLATE_FIELDS, CODE_FIELDS)
const TEMPLATE_FORM: SendForm = {
  name: 'templateId',
  call: 'send',
  fields: fieldSet(SHARED_FIELDS, TEMPLATE_FIELDS),
  why: "A template made in PostHog sets its own sender, subject and content, and follows the project's engagement setting.",
  howToSend: 'send a template made in PostHog with templateId',
}
const CODE_FORM: SendForm = {
  name: 'templateKey',
  call: 'send',
  fields: fieldSet(SHARED_FIELDS, CODE_FIELDS),
  why: 'A send with templateKey takes its content from your code.',
  howToSend: 'send content from your code with templateKey',
}
const SEND_ONLY_FIX = 'Remove {field}, or send each email with emails.send().'
const PER_RECIPIENT_FIX = 'Set {field} on each recipient in recipients.'
const BATCH_FIXES: Record<string, string> = {
  to: PER_RECIPIENT_FIX,
  distinctId: PER_RECIPIENT_FIX,
  idempotencyKey: PER_RECIPIENT_FIX,
  scheduledAt: SEND_ONLY_FIX,
  cc: SEND_ONLY_FIX,
  bcc: SEND_ONLY_FIX,
  attachments: SEND_ONLY_FIX,
}
const BATCH_TEMPLATE_FORM: SendForm = {
  ...TEMPLATE_FORM,
  call: 'batch',
  fields: new Set([...fieldSet(TEMPLATE_FIELDS), 'maxRetries']),
  howToSend: 'send a batch of a template made in PostHog with templateId',
  fixes: BATCH_FIXES,
}
const BATCH_CODE_FORM: SendForm = {
  ...CODE_FORM,
  call: 'batch',
  fields: new Set([...[...fieldSet(CODE_FIELDS)].filter((field) => !(field in BATCH_FIXES)), 'maxRetries']),
  howToSend: 'send a batch of content from your code with templateKey',
  fixes: BATCH_FIXES,
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

export interface EmailFetchOptions extends PostHogFetchOptions {
  redirect?: 'manual'
}

export interface EmailSenderHooks {
  fetch: (url: string, options: EmailFetchOptions) => Promise<PostHogFetchResponse>
  isDisabled: () => boolean
  isClosed: () => boolean
  logger: Logger
  userAgent?: string
}

interface PreparedSend {
  content: Record<string, unknown>
  files: AttachmentFile[]
  react?: EmailReactElement
  idempotencyKey: string
  maxRetries: number
  scheduledAtMs?: number
  callerChoseKey: boolean
}

interface Upload {
  url: string
  headers: Record<string, string>
  bytes: Uint8Array<ArrayBuffer>
  field: string
}

/**
 * Sends one transactional email per call to the messaging send API on the app host, reads the
 * status of a sent email, and sets a recipient's topic preferences. Owns the attempt loop, so every
 * attempt of a send carries the same idempotency key.
 */
export class EmailSender implements Emails {
  private readonly config: EmailSenderConfig
  private readonly hooks: EmailSenderHooks
  private readonly inFlight = new Set<Promise<unknown>>()
  private readonly retryWaitsToEndAtShutdown = new Set<() => void>()

  constructor(config: EmailSenderConfig, hooks: EmailSenderHooks) {
    this.config = config
    this.hooks = hooks
  }

  send(options: SendEmailOptions, ...unexpected: unknown[]): Promise<SendEmailResponse> {
    return this.track(this.sendUntracked(options, unexpected))
  }

  batch(email: BatchEmailOptions, recipients: BatchEmailRecipient[]): Promise<BatchEmailResponse> {
    return this.track(this.batchUntracked(email, recipients))
  }

  get(id: string): Promise<GetEmailResponse> {
    return this.track(this.getUntracked(id))
  }

  setPreferences(options: SetEmailPreferencesOptions): Promise<SetEmailPreferencesResponse> {
    return this.track(this.setPreferencesUntracked(options))
  }

  private track<T>(pending: Promise<T>): Promise<T> {
    this.inFlight.add(pending)
    void pending.finally(() => this.inFlight.delete(pending))
    return pending
  }

  /**
   * Resolves when every send, status read and preferences change in flight, retries included, has settled.
   * Kept apart from the client's pending-promise queue, so a send in its retry backoff does not hold back `flush()`.
   */
  async drain(): Promise<void> {
    for (const endWait of this.retryWaitsToEndAtShutdown) {
      endWait()
    }
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
        'Sending email needs secretKey, a project secret API key with the transactional_email:write scope.',
        prepared.scheduledAtMs !== undefined
      )
      const content =
        prepared.react === undefined
          ? prepared.content
          : await withRenderedReact(prepared.content, prepared.react, this.config.requestTimeoutMs)
      if (prepared.react !== undefined) {
        refuseRenderedMessageOverLimit(prepared.files, content)
      }
      const attachments = await this.uploadAttachments(prepared, appHost, secretKey)
      const body = safeJsonStringify({ ...content, ...unlessEmpty('attachments', attachments) })
      const headers = this.headers(secretKey, {
        'Content-Type': 'application/json',
        'Idempotency-Key': prepared.idempotencyKey,
      })
      const firstSentAtMs = Date.now()
      const result = await this.withRetries(prepared.maxRetries, async () =>
        parseSendReply(
          await this.request(appHost + SEND_PATH, 'POST', headers, body),
          prepared.scheduledAtMs,
          firstSentAtMs,
          prepared.callerChoseKey
        )
      )
      for (const warning of result.warnings) {
        this.hooks.logger.warn(`PostHog email warning ${warning.code}: ${warning.message}`)
      }
      return { data: result, error: null }
    } catch (error) {
      return { data: null, error: asEmailError(error, 'Sending the email failed unexpectedly.') }
    }
  }

  private async batchUntracked(email: BatchEmailOptions, recipients: unknown): Promise<BatchEmailResponse> {
    let slots: Slot[] = []
    try {
      const prepared = prepareBatchEmail(email, this.config.maxRetries)
      slots = prepareRecipients(recipients, prepared.templateForm, KNOWN_FIELDS)
      const { appHost, secretKey } = this.connect(
        'no email was sent',
        'Sending email needs secretKey, a project secret API key with the transactional_email:write scope.'
      )
      const content =
        prepared.react === undefined
          ? prepared.content
          : await withRenderedReact(prepared.content, prepared.react, this.config.requestTimeoutMs)
      if (this.hooks.isClosed()) {
        throw new EmailError({
          code: 'client_closed',
          message: 'The PostHog client shut down before the batch went out, so no email was sent.',
        })
      }
      const headers = this.headers(secretKey, { 'Content-Type': 'application/json' })
      const timeoutMs = Math.max(BATCH_REQUEST_TIMEOUT_MS, this.config.requestTimeoutMs)
      const body = batchBody(content, slots)
      let warnings: EmailWarning[]
      let mayHaveQueuedBefore = false
      try {
        const stopAtShutdown = (): void => {
          if (this.hooks.isClosed()) {
            throw new EmailError({
              code: 'client_closed',
              message: 'The PostHog client shut down during the batch, so it sent no retry.',
              fix: 'Send the batch again from a running client, unchanged and with the same idempotency keys.',
            })
          }
        }
        warnings = await this.withRetries(
          prepared.maxRetries,
          async (attempt) => {
            try {
              return recordAnswer(
                slots,
                await this.request(
                  appHost + BATCH_PATH,
                  'POST',
                  headers,
                  body,
                  undefined,
                  timeoutMs,
                  attempt > 0 ? stopAtShutdown : undefined
                ),
                mayHaveQueuedBefore
              )
            } catch (caught) {
              const failure = asRequestError(caught)
              if (mayHaveQueued(failure)) {
                mayHaveQueuedBefore = true
              }
              throw failure
            }
          },
          stopAtShutdown
        )
      } catch (caught) {
        const failure = recordFailure(slots, asRequestError(caught), mayHaveQueuedBefore)
        return { data: null, error: withResults(failure, slots) }
      }
      this.logWarnings(warnings)
      return { data: { results: slots.map(resultOf), warnings }, error: null }
    } catch (caught) {
      return { data: null, error: asEmailError(caught, 'Sending the batch failed unexpectedly.') }
    }
  }

  private logWarnings(warnings: EmailWarning[]): void {
    for (const warning of warnings) {
      this.hooks.logger.warn(`PostHog email warning ${warning.code}: ${warning.message}`)
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
    const unencrypted = isPlainHttp(appHost) ? undefined : uploads.find(({ url }) => !isHttps(url))
    if (unencrypted) {
      throw new EmailError({
        code: 'api_error',
        message: `PostHog named an upload URL for ${unencrypted.field} that isn't https, so the file would travel unencrypted. No email was sent.`,
        field: unencrypted.field,
        fix: "Make your PostHog's file storage URL use https. For local development over plain HTTP, set appHost to your http app host.",
      })
    }
    for (const upload of uploads) {
      await this.withRetries(maxRetries, () => this.uploadFile(upload))
    }
    return hashed.map(attachmentReference)
  }

  private async uploadFile({ url, headers, bytes, field }: Upload): Promise<void> {
    let reply: Reply
    try {
      reply = await this.request(url, 'PUT', headers, bytes, 'manual')
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
    if (reply.status >= 300 && reply.status < 400) {
      throw new EmailError({
        code: 'attachment_upload_failed',
        message: `PostHog's file storage redirected the upload of ${field} elsewhere. The SDK uploads only to the URL PostHog signed, so no email was sent.`,
        statusCode: reply.status,
        fix: "Make your PostHog's file storage URL point straight at the storage, over https.",
        field,
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

  private async setPreferencesUntracked(options: SetEmailPreferencesOptions): Promise<SetEmailPreferencesResponse> {
    try {
      const body = preparePreferences(options)
      const { appHost, secretKey } = this.connect(
        'no preferences changed',
        'Setting email preferences needs secretKey, a project secret API key with the messaging_preference:write scope.'
      )
      const headers = this.headers(secretKey, { 'Content-Type': 'application/json' })
      const preferences = await this.withRetries(this.config.maxRetries, async () =>
        parsePreferencesReply(await this.request(appHost + PREFERENCES_PATH, 'POST', headers, body))
      )
      return { data: preferences, error: null }
    } catch (error) {
      return { data: null, error: asEmailError(error, 'Setting the email preferences failed unexpectedly.') }
    }
  }

  private connect(
    nothingDone: string,
    missingSecretKey: string,
    scheduling = false
  ): { appHost: string; secretKey: string } {
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
    if (scheduling && !(appHost && CLOUD_APP_HOST_SET.has(appHost))) {
      throw new EmailError({
        code: 'scheduling_requires_cloud',
        message: `This client sends email to ${appHost ?? removeTrailingSlash(this.config.host)}, and only PostHog Cloud schedules emails, so ${nothingDone}.`,
        field: 'scheduledAt',
        why: 'A self-hosted PostHog, or a proxy in front of PostHog Cloud, may send the email at once instead of at scheduledAt.',
        fix: 'Send through PostHog Cloud US or EU, or leave out scheduledAt to send the email now.',
      })
    }
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

  private async withRetries<T>(
    maxRetries: number,
    attemptOnce: (attempt: number) => Promise<T>,
    stopAtShutdown?: () => void
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let error: EmailError
      try {
        return await attemptOnce(attempt)
      } catch (caught) {
        error = asRequestError(caught)
      }
      const delayMs = retryDelayMs(error, attempt, maxRetries)
      if (delayMs === undefined) {
        throw error
      }
      if (stopAtShutdown) {
        stopAtShutdown()
        await this.waitUnlessShutdown(delayMs)
      } else {
        // A plain timer, not an unref'd one: the caller awaits the request, so the process must stay up for the retry.
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }

  private waitUnlessShutdown(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      const end = (): void => {
        clearTimeout(timer)
        this.retryWaitsToEndAtShutdown.delete(end)
        resolve()
      }
      const timer = setTimeout(end, delayMs)
      this.retryWaitsToEndAtShutdown.add(end)
    })
  }

  private async request(
    url: string,
    method: 'GET' | 'POST' | 'PUT',
    headers: Record<string, string>,
    body?: string | Uint8Array<ArrayBuffer>,
    redirect?: 'manual',
    timeoutMs = this.config.requestTimeoutMs,
    beforeFetch?: () => void
  ): Promise<Reply> {
    const controller = new AbortController()
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
    const fetchPromise = Promise.resolve().then(() => {
      beforeFetch?.()
      return this.hooks.fetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        ...(redirect ? { redirect } : {}),
        signal: controller.signal,
      })
    })
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
  const send: UncheckedSend = fieldsOf(options, KNOWN_FIELDS)
  const { to, distinctId, idempotencyKey, maxRetries } = send
  if (typeof to !== 'string' || !to.trim()) {
    throw invalid('invalid_recipient', 'to must be one email address as a nonempty string.', 'to')
  }
  if (distinctId !== undefined && (typeof distinctId !== 'string' || !distinctId)) {
    throw invalid('invalid_distinct_id', 'distinctId must be a nonempty string.', 'distinctId')
  }
  const { content, files } = contentOf(send, distinctId)
  const scheduledAtMs = send.scheduledAt === undefined ? undefined : scheduledInstantOf(send.scheduledAt)
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
    content: snapshotOf({
      ...content,
      to,
      ...(scheduledAtMs !== undefined && { scheduled_at: new Date(scheduledAtMs).toISOString() }),
    }),
    files,
    react: isReactElement(send.react) ? send.react : undefined,
    idempotencyKey: idempotencyKey ?? globalThis.crypto.randomUUID(),
    maxRetries: isRetryCount(maxRetries) ? maxRetries : defaultMaxRetries,
    scheduledAtMs,
    callerChoseKey: idempotencyKey !== undefined,
  }
}

function scheduledInstantOf(scheduledAt: unknown): number {
  const instant = scheduledAt instanceof Date ? scheduledAt.getTime() : timeWithOffsetToTheMillisecond(scheduledAt)
  if (instant === undefined || Number.isNaN(instant)) {
    throw new EmailError({
      code: 'invalid_scheduled_at',
      message: 'scheduledAt must be a Date, or an ISO 8601 time with an offset, so no email was sent.',
      field: 'scheduledAt',
      fix: 'Pass a Date, or a time such as 2026-12-01T09:00:00Z or 2026-12-01T10:00:00+01:00.',
    })
  }
  return instant
}

/** The instant of an ISO 8601 time with an offset, rounded up to the next millisecond, or undefined when it isn't one. */
function timeWithOffsetToTheMillisecond(time: unknown): number | undefined {
  const parts = typeof time === 'string' ? SCHEDULED_AT_PATTERN.exec(time) : null
  if (!parts) {
    return undefined
  }
  const [, year, month, day, hour, minute, second = '00', fraction = '', offset, offsetHours, offsetMinutes] = parts
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
  const inRange = (value: string | undefined, low: number, high: number): boolean =>
    value === undefined || (Number(value) >= low && Number(value) <= high)
  if (
    !inRange(month, 1, 12) ||
    !inRange(day, 1, daysInMonth) ||
    !inRange(hour, 0, 23) ||
    !inRange(minute, 0, 59) ||
    !inRange(second, 0, 59) ||
    !inRange(offsetHours, 0, 23) ||
    !inRange(offsetMinutes, 0, 59)
  ) {
    return undefined
  }
  const toTheMillisecond = `${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction.slice(0, 3).padEnd(3, '0')}`
  const roundUp = /[1-9]/.test(fraction.slice(3)) ? 1 : 0
  return Date.parse(toTheMillisecond + offset) + roundUp
}

function snapshotOf(content: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(safeJsonStringify(content))
}

function preparePreferences(options: SetEmailPreferencesOptions): string {
  const fallback: Partial<SetEmailPreferencesOptions> = {}
  const { to, allMarketing, topics } = options ?? fallback
  if (typeof to !== 'string' || !to.trim()) {
    throw invalid('invalid_recipient', 'to must be one email address as a nonempty string.', 'to')
  }
  if (allMarketing !== undefined && typeof allMarketing !== 'boolean') {
    throw invalid('invalid_preferences', 'allMarketing must be true or false.', 'allMarketing')
  }
  if (
    topics !== undefined &&
    (typeof topics !== 'object' ||
      topics === null ||
      Array.isArray(topics) ||
      !Object.values(topics).every((value) => typeof value === 'boolean'))
  ) {
    throw invalid('invalid_preferences', 'topics must map each topic key to true or false.', 'topics')
  }
  const hasTopics = topics !== undefined && Object.keys(topics).length > 0
  if (allMarketing === undefined && !hasTopics) {
    throw invalid('invalid_preferences', 'Set allMarketing, topics, or both.', 'topics')
  }
  return safeJsonStringify({
    identifier: to,
    ...(allMarketing === undefined ? {} : { all_marketing: allMarketing }),
    ...(hasTopics ? { topics } : {}),
  })
}

function isRetryCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

interface SendContent {
  content: Record<string, unknown>
  files: AttachmentFile[]
}

function prepareBatchEmail(
  options: BatchEmailOptions,
  defaultMaxRetries: number
): {
  content: Record<string, unknown>
  react?: EmailReactElement
  templateForm: boolean
  maxRetries: number
} {
  const send: UncheckedSend = fieldsOf(options, KNOWN_FIELDS)
  const maxRetries = send.maxRetries
  if (maxRetries !== undefined && !isRetryCount(maxRetries)) {
    throw invalid('invalid_max_retries', 'maxRetries must be a nonnegative integer.', 'maxRetries')
  }
  if ((send.templateId === undefined) === (send.templateKey === undefined)) {
    throw new EmailError({
      code: 'invalid_form',
      message: 'Send either templateId, or templateKey with subject and html, text or react.',
    })
  }
  const templateForm = send.templateKey === undefined
  const content = templateForm
    ? templateContent(send, undefined, BATCH_TEMPLATE_FORM, BATCH_CODE_FORM)
    : codeContent(send, undefined, BATCH_CODE_FORM, BATCH_TEMPLATE_FORM).content
  return {
    content: snapshotOf(content),
    react: isReactElement(send.react) ? send.react : undefined,
    templateForm,
    maxRetries: isRetryCount(maxRetries) ? maxRetries : defaultMaxRetries,
  }
}

function contentOf(send: UncheckedSend, distinctId: string | undefined): SendContent {
  if ((send.templateId === undefined) === (send.templateKey === undefined)) {
    throw new EmailError({
      code: 'invalid_form',
      message: 'Send either templateId, or templateKey with subject and html, text or react.',
    })
  }
  return send.templateKey === undefined
    ? { content: templateContent(send, distinctId), files: [] }
    : codeContent(send, distinctId)
}

function templateContent(
  send: UncheckedSend,
  distinctId: string | undefined,
  form = TEMPLATE_FORM,
  otherForm = CODE_FORM
): Record<string, unknown> {
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
  refuseFieldsOutside(send, form, otherForm)
  return {
    template_id: templateId.toLowerCase(),
    message_data: templateData ?? {},
    ...(distinctId !== undefined && { distinct_id: distinctId }),
  }
}

function codeContent(
  send: UncheckedSend,
  distinctId: string | undefined,
  form = CODE_FORM,
  otherForm = TEMPLATE_FORM
): SendContent {
  const { templateKey, subject, html, text, react } = send
  if (typeof templateKey !== 'string' || !TEMPLATE_KEY_PATTERN.test(templateKey)) {
    throw invalid(
      'invalid_template_key',
      'templateKey can only have letters, digits, hyphens (-) and underscores (_), at most 400.',
      'templateKey'
    )
  }
  refuseFieldsOutside(send, form, otherForm)
  if (typeof subject !== 'string') {
    throw invalid('invalid_form', 'A send with templateKey needs a subject.', 'subject')
  }
  if (html !== undefined && typeof html !== 'string') {
    throw invalid('invalid_form', 'html must be a string.', 'html')
  }
  if (text !== undefined && typeof text !== 'string') {
    throw invalid('invalid_form', 'text must be a string.', 'text')
  }
  if (react !== undefined) {
    checkReactContent(react, html)
  } else if (html === undefined && text === undefined) {
    throw invalid('invalid_form', 'A send with templateKey needs html, text or react.', 'html')
  }
  const files = send.attachments === undefined ? [] : attachmentFiles(send.attachments, { html, text, subject })
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
  const { from, replyTo, cc, bcc, captureEngagement, sensitive, tracking } = send
  return {
    ...(from !== undefined && { from }),
    ...(replyTo !== undefined && unlessEmpty('reply_to', addressList(replyTo))),
    ...(cc !== undefined && unlessEmpty('cc', addressList(cc))),
    ...(bcc !== undefined && unlessEmpty('bcc', addressList(bcc))),
    ...(captureEngagement !== undefined && { capture_engagement: captureEngagement }),
    ...(sensitive !== undefined && { sensitive }),
    ...(tracking !== undefined && { tracking }),
  }
}

function unlessEmpty(field: string, list: unknown): Record<string, unknown> {
  return Array.isArray(list) && list.length === 0 ? {} : { [field]: list }
}

function addressList(addresses: unknown): unknown {
  return typeof addresses === 'string' ? [addresses] : addresses
}

function checkReactContent(react: unknown, html: unknown): void {
  if (!isReactElement(react)) {
    throw invalid('invalid_form', 'react must be a React element, such as <WelcomeEmail />.', 'react')
  }
  if (html !== undefined) {
    throw new EmailError({
      code: 'invalid_form',
      message: 'A send with react renders its own html, so it takes no html. No email was sent.',
      field: 'html',
      fix: 'Remove html to send the rendered react element, or remove react to send your html.',
    })
  }
}

const REACT_18_AND_19_ELEMENT_MARKERS: unknown[] = [
  Symbol.for('react.element'),
  Symbol.for('react.transitional.element'),
]

function isReactElement(value: unknown): value is EmailReactElement {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$$typeof' in value &&
    REACT_18_AND_19_ELEMENT_MARKERS.includes(value.$$typeof) &&
    'type' in value &&
    'props' in value
  )
}

async function withRenderedReact(
  content: Record<string, unknown>,
  react: EmailReactElement,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const { render, toPlainText } = await loadReactRenderer()
  try {
    const html = await settleWithin(render(react), timeoutMs, 'Rendering the react element')
    return { ...content, html, ...(content.text === undefined && { text: toPlainText(html) }) }
  } catch (cause) {
    throw new EmailError({
      code: 'react_render_failed',
      message: 'Rendering the react element failed, so no email was sent.',
      cause,
    })
  }
}

async function settleWithin<T>(work: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${timeoutMs}ms.`)), timeoutMs)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    clearTimeout(timer)
  }
}

async function loadReactRenderer(): Promise<ReactRenderer> {
  try {
    return await import('@react-email/render')
  } catch (cause) {
    throw new EmailError({
      code: 'missing_react_renderer',
      message:
        "react needs the @react-email/render package, which isn't installed or failed to load, so no email was sent.",
      fix: 'Install @react-email/render with react and react-dom next to posthog-node, or render the email yourself and send html.',
      cause,
    })
  }
}

function refuseFieldsOutside(send: UncheckedSend, form: SendForm, otherForm: SendForm): void {
  const field = Object.entries(send).find(([name, value]) => value !== undefined && !form.fields.has(name))?.[0]
  if (field === undefined) {
    return
  }
  const message = `A ${form.call} with ${form.name} doesn't take ${field}, so no email was sent.`
  if (!otherForm.fields.has(field)) {
    const hint = form.fixes && Object.hasOwn(form.fixes, field) ? form.fixes[field] : undefined
    const fix = hint?.replace('{field}', field) ?? `Remove ${field} and send again.`
    throw new EmailError({ code: 'invalid_form', message, field, fix })
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

function isHttps(url: string): boolean {
  return url.toLowerCase().startsWith('https://')
}

function isPlainHttp(url: string): boolean {
  return url.toLowerCase().startsWith('http://')
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

function readRetryAfter(response: PostHogFetchResponse): number | undefined {
  try {
    // The full wait, not the shared five minute cap: callers schedule their own retry from it, and the retry ceiling
    // here applies separately in retryDelayMs.
    return parseRetryAfterMs(response.headers?.get('retry-after'), Date.now(), Number.MAX_SAFE_INTEGER)
  } catch {
    return undefined
  }
}

function parseSendReply(
  { status, text: body, retryAfterMs }: Reply,
  scheduledAtMs: number | undefined,
  firstSentAtMs: number,
  callerChoseKey: boolean
): SendEmailResult {
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
    const result = { id, replayed: fields.replayed === true, warnings: warningsOf(fields) }
    return scheduledAtMs === undefined
      ? result
      : { ...result, scheduledAt: confirmedSchedule(fields, scheduledAtMs, firstSentAtMs, id, status, callerChoseKey) }
  }
  throw replyError(fields, status, retryAfterMs)
}

const CLOCK_SKEW_MS = 60_000

function confirmedSchedule(
  fields: Record<string, unknown>,
  scheduledAtMs: number,
  firstSentAtMs: number,
  messageId: string,
  status: number,
  callerChoseKey: boolean
): string | null {
  if (fields.status === 'queued' && fields.scheduled_at === null && scheduledAtMs - firstSentAtMs <= CLOCK_SKEW_MS) {
    return null
  }
  if (fields.status === 'scheduled' && timeWithOffsetToTheMillisecond(fields.scheduled_at) === scheduledAtMs) {
    return new Date(scheduledAtMs).toISOString()
  }
  throw new EmailError({
    code: 'schedule_not_confirmed',
    message: `PostHog accepted the email ${messageId} without confirming it waits for scheduledAt, so it may go out now.`,
    statusCode: status,
    messageId,
    field: 'scheduledAt',
    fix: callerChoseKey
      ? 'Read what happened to the email with emails.get(error.messageId). Sending it again with the same idempotencyKey queues no second email, and it cannot schedule this one again.'
      : "Read what happened to the email with emails.get(error.messageId). Don't send it again: the client chose this send's idempotencyKey, so a new send with any key queues a second email.",
  })
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

function parsePreferencesReply({ status, text: body, retryAfterMs }: Reply): EmailPreferences {
  const fields = replyFields(parseJson(body))
  if (status < 200 || status >= 300) {
    throw replyError(fields, status, retryAfterMs)
  }
  const to = text(fields.identifier)
  const allMarketing = fields.all_marketing
  const topics = fields.topics
  if (
    !to ||
    !(allMarketing === null || typeof allMarketing === 'boolean') ||
    topics === null ||
    typeof topics !== 'object' ||
    Array.isArray(topics) ||
    !Object.values(topics).every((value) => typeof value === 'boolean')
  ) {
    throw new EmailError({
      code: 'api_error',
      message: 'PostHog answered without the preferences.',
      statusCode: status,
    })
  }
  return { to, allMarketing, topics: topics as Record<string, boolean> }
}

function asEmailError(error: unknown, message: string): EmailError {
  return error instanceof EmailError ? error : new EmailError({ code: 'unexpected_error', message, cause: error })
}

function asRequestError(error: unknown): EmailError {
  return error instanceof EmailError
    ? error
    : new EmailError({ code: 'network_error', message: 'The request to PostHog failed.', cause: error })
}

function withResults(error: EmailError, slots: Slot[]): EmailError {
  return new EmailError({
    code: error.code,
    message: error.message,
    statusCode: error.statusCode,
    why: error.why,
    fix: error.fix,
    docsUrl: error.docsUrl,
    field: error.field,
    retryAfterMs: error.retryAfterMs,
    messageId: error.messageId,
    results: slots.map(resultOf),
    cause: error.cause,
  })
}

function isRetryable(error: EmailError): boolean {
  // A send carries an idempotency key, so a retry can't queue a second email. A status read changes nothing.
  // A preferences change sets each named choice to a value, so repeating it ends the same.
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
  return Math.max(backoffMs(attempt), error.retryAfterMs ?? 0)
}

function backoffMs(attempt: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** attempt * (0.8 + Math.random() * 0.4))
}
