import { isValidUUID, type JsonType, type PostHogApiResponse } from '@posthog/core'

const TEMPLATE_SEND_PATH = (templateId: string): string =>
  `/api/projects/@current/messaging_templates/${templateId}/send/`

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/
const SEND_OPTIONS = new Set(['to', 'distinctId', 'idempotencyKey', 'maxRetries', 'templateId', 'templateData'])
const DEFAULT_MAX_RETRIES = 2
const FIRST_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000

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
   * workflow was paused or the default sender changed. A deleted template, or a project that no longer has a default
   * sender, still refuses the send. Without it, the SDK makes a UUID v4 that covers its own retries. When a job runner
   * retries the send, pass a key derived from what the email is for, such as `welcome:user_42`, and set
   * `maxRetries: 0`.
   */
  idempotencyKey?: string
  /** How often to retry this send, a whole number from 0. Overrides the `maxRetries` client option. */
  maxRetries?: number
}

/** A template made in PostHog, sent by its id. */
export interface SendTemplateEmailOptions extends SendEmailBase {
  /** The UUID of the template. */
  templateId: string
  /** Values for the template's `{{ variables.* }}`. The template can't read person properties. */
  templateData?: Record<string, unknown>
}

/** One email to send with `posthog.emails.send()`. */
export type SendEmailOptions = SendTemplateEmailOptions

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
   * `missing_app_host`, `client_disabled`, `client_closed`, `network_error`, `api_error` for an answer without a code,
   * `unexpected_error`, and `invalid_form`, `invalid_template_id` and `invalid_idempotency_key` for a send the SDK
   * refused before any request.
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
  /** The request field the error is about. */
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
   * @example
   * ```ts
   * const { data, error } = await posthog.emails.send({
   *   to: 'jane@example.com',
   *   distinctId: user.id,
   *   templateId: '0190f6d2-7c1e-4b3a-9f5e-1c2d3e4f5a6b',
   *   templateData: { firstName: 'Jane' },
   *   idempotencyKey: `welcome:${user.id}`,
   * })
   * ```
   */
  send(options: SendEmailOptions): Promise<SendEmailResult>
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
  request(url: string, headers: Record<string, string>, body: string): Promise<PostHogApiResponse>
}

type Failure = { data: null; error: EmailError }

interface PreparedSend {
  path: string
  body: JsonType
  idempotencyKey: string
  maxRetries: number
}

interface Attempt {
  result: SendEmailResult
  retryAfterMs?: number
}

/** @internal */
export class PostHogEmails implements Emails {
  constructor(private readonly api: EmailsApi) {}

  send(options: SendEmailOptions): Promise<SendEmailResult> {
    if (!isRecord(options)) {
      return Promise.resolve(failure('invalid_form', 'send needs an options object with to and templateId.'))
    }
    const refusal = this.refusalBeforeRequest(options)
    if (refusal) {
      return Promise.resolve(refusal)
    }
    return this.api.track(this.deliver(this.prepare(options)).catch(unexpectedFailure))
  }

  private refusalBeforeRequest(options: SendEmailOptions): Failure | undefined {
    const { templateId, idempotencyKey } = options
    if (this.api.isDisabled()) {
      return failure('client_disabled', 'The PostHog client is disabled, so nothing was sent.')
    }
    if (this.api.isClosed()) {
      return failure('client_closed', 'The PostHog client was shut down, so nothing was sent.')
    }
    if (!this.api.secretKey()) {
      return failure(
        'missing_secret_key',
        'Sending email needs the secretKey client option, a project secret API key with the hog_flow:write scope.'
      )
    }
    if (!this.api.appHost()) {
      return failure(
        'missing_app_host',
        'Sending email needs the appHost client option when host is not PostHog Cloud, so the secret key never ' +
          'goes to a proxy.'
      )
    }
    if (!isValidUUID(templateId)) {
      return failure('invalid_template_id', 'templateId must be the UUID of a template.', { field: 'templateId' })
    }
    const unknownOption = unknownOptionRefusal(options)
    if (unknownOption) {
      return unknownOption
    }
    if (idempotencyKey !== undefined && !isIdempotencyKey(idempotencyKey)) {
      return failure(
        'invalid_idempotency_key',
        'idempotencyKey must be 1 to 255 visible ASCII characters, with no spaces.',
        { field: 'idempotencyKey' }
      )
    }
    return undefined
  }

  private prepare({
    to,
    distinctId,
    idempotencyKey,
    maxRetries,
    templateId,
    templateData,
  }: SendEmailOptions): PreparedSend {
    return {
      path: TEMPLATE_SEND_PATH(templateId),
      body: {
        to,
        ...(templateData !== undefined && { message_data: templateData as JsonType }),
        ...(distinctId !== undefined && { identifiers: { distinct_id: distinctId } }),
      },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      maxRetries: retryCount(maxRetries) ?? retryCount(this.api.maxRetries()) ?? DEFAULT_MAX_RETRIES,
    }
  }

  private async deliver(send: PreparedSend): Promise<SendEmailResult> {
    const body = JSON.stringify(send.body)
    for (let retry = 0; ; retry++) {
      const { result, retryAfterMs } = await this.attempt(send, body)
      if (retry >= send.maxRetries || !isRetryable(result)) {
        return this.logWarnings(result)
      }
      await sleep(retryDelayMs(retry, retryAfterMs))
    }
  }

  private async attempt(send: PreparedSend, body: string): Promise<Attempt> {
    const headers = {
      ...this.api.headers(),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.api.secretKey()}`,
      'Idempotency-Key': send.idempotencyKey,
    }
    let response: PostHogApiResponse
    try {
      response = await this.api.request(`${this.api.appHost()}${send.path}`, headers, body)
    } catch (error) {
      return { result: failure('network_error', error instanceof Error ? error.message : 'Request failed') }
    }
    return { result: sendResult(response), retryAfterMs: response.retryAfterMs }
  }

  private logWarnings(result: SendEmailResult): SendEmailResult {
    for (const warning of result.data?.warnings ?? []) {
      this.api.warn(`Email ${result.data?.id} was queued with a warning, ${warning.code}: ${warning.message}`)
    }
    return result
  }
}

function sendResult(response: PostHogApiResponse): SendEmailResult {
  const { status, body } = response
  if (!isSuccess(status)) {
    return { data: null, error: apiError(response) }
  }
  if (!isRecord(body) || typeof body.message_id !== 'string') {
    return failure('api_error', `PostHog answered HTTP ${status} with an unexpected body.`, { statusCode: status })
  }
  return { data: { id: body.message_id, warnings: warningsOf(body.warnings) }, error: null }
}

function isRetryable({ error }: SendEmailResult): boolean {
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
