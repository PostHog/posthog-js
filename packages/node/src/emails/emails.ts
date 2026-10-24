import {
  type FetchLike,
  type Logger,
  type PostHogFetchResponse,
  parseRetryAfterMs,
  removeTrailingSlash,
  safeJsonStringify,
  safeSetTimeout,
} from '@posthog/core'

import { EmailError } from './errors'
import type { EmailWarning, Emails, SendEmailOptions, SendEmailResponse, SendEmailResult } from './types'

const SEND_PATH = '/api/projects/@current/messaging_templates/{templateId}/send/'
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

export const DEFAULT_EMAIL_REQUEST_TIMEOUT_MS = 15_000
export const DEFAULT_EMAIL_REQUEST_MAX_RETRIES = 2

export interface EmailSenderConfig {
  secretKey?: string
  /** The client's `host`. Used only when it is PostHog Cloud. */
  host: string
  appHost?: string
  requestTimeoutMs: number
  maxRetries: number
}

export interface EmailSenderHooks {
  fetch: FetchLike
  isDisabled: () => boolean
  logger: Logger
  userAgent?: string
}

interface PreparedSend {
  path: string
  body: string
  idempotencyKey: string
  maxRetries: number
}

interface Reply {
  status: number
  payload: unknown
  retryAfterMs?: number
}

/**
 * Sends one transactional email per call to the messaging template send API on the app host.
 * Owns the attempt loop, so every attempt carries the same idempotency key.
 */
export class EmailSender implements Emails {
  private readonly config: EmailSenderConfig
  private readonly hooks: EmailSenderHooks

  constructor(config: EmailSenderConfig, hooks: EmailSenderHooks) {
    this.config = config
    this.hooks = hooks
  }

  async send(options: SendEmailOptions): Promise<SendEmailResponse> {
    try {
      const prepared = prepareSend(options, this.config.maxRetries)
      if (this.hooks.isDisabled()) {
        this.hooks.logger.debug('The client is disabled, so no email was sent.')
        return { data: { id: null, replayed: false, warnings: [] }, error: null }
      }
      const appHost = resolveAppHost(this.config.host, this.config.appHost)
      if (!appHost) {
        // A custom host is often an ingestion proxy, which must not receive the secret key.
        throw new EmailError({
          code: 'app_host_required',
          message:
            "The client's host is not PostHog Cloud, so the client can't tell where to send email. Set appHost to your PostHog app host on the client.",
        })
      }
      const secretKey = this.config.secretKey?.trim()
      if (!secretKey) {
        throw new EmailError({
          code: 'missing_secret_key',
          message: 'Sending email needs secretKey, a project secret API key with the hog_flow:write scope.',
        })
      }
      return { data: await this.deliver(appHost, secretKey, prepared), error: null }
    } catch (error) {
      if (error instanceof EmailError) {
        return { data: null, error }
      }
      return {
        data: null,
        error: new EmailError({
          code: 'unexpected_error',
          message: 'Sending the email failed unexpectedly.',
          cause: error,
        }),
      }
    }
  }

  private async deliver(appHost: string, secretKey: string, prepared: PreparedSend): Promise<SendEmailResult> {
    const url = appHost + prepared.path
    const headers: Record<string, string> = {
      Authorization: `Bearer ${secretKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': prepared.idempotencyKey,
    }
    if (this.hooks.userAgent) {
      headers['User-Agent'] = this.hooks.userAgent
    }

    for (let attempt = 0; ; attempt++) {
      let error: EmailError
      try {
        const result = parseReply(await this.request(url, headers, prepared.body))
        for (const warning of result.warnings) {
          this.hooks.logger.warn(`PostHog email warning ${warning.code}: ${warning.message}`)
        }
        return result
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
      const delayMs = retryDelayMs(error, attempt, prepared.maxRetries)
      if (delayMs === undefined) {
        throw error
      }
      // A plain timer, not an unref'd one: the caller awaits the send, so the process must stay up for the retry.
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  private async request(url: string, headers: Record<string, string>, body: string): Promise<Reply> {
    const controller = new AbortController()
    const timeoutMs = this.config.requestTimeoutMs
    let timer: ReturnType<typeof safeSetTimeout>
    // `fetch` is injectable and may ignore the abort signal, so both phases race the deadline.
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = safeSetTimeout(() => {
        const timeoutError = new Error(`Email request timed out after ${timeoutMs}ms`)
        timeoutError.name = 'AbortError'
        reject(timeoutError)
        controller.abort(timeoutError)
      }, timeoutMs)
    })
    try {
      const response = await Promise.race([
        Promise.resolve().then(() =>
          this.hooks.fetch(url, { method: 'POST', headers, body, signal: controller.signal })
        ),
        deadline,
      ])
      const text = await Promise.race([response.text(), deadline])
      return { status: response.status, payload: parseJson(text), retryAfterMs: readRetryAfter(response) }
    } finally {
      clearTimeout(timer!)
    }
  }
}

function prepareSend(options: SendEmailOptions, defaultMaxRetries: number): PreparedSend {
  const fallback: Partial<SendEmailOptions> = {}
  const { to, templateId, templateData, distinctId, idempotencyKey, maxRetries } = options ?? fallback
  if (typeof to !== 'string' || !to.trim()) {
    throw invalid('invalid_recipient', 'to must be one email address as a nonempty string.', 'to')
  }
  if (typeof templateId !== 'string' || !UUID_PATTERN.test(templateId)) {
    throw invalid('invalid_template_id', "templateId must be the template's UUID.", 'templateId')
  }
  if (
    templateData !== undefined &&
    (typeof templateData !== 'object' || templateData === null || Array.isArray(templateData))
  ) {
    throw invalid('invalid_template_data', 'templateData must be an object.', 'templateData')
  }
  if (distinctId !== undefined && (typeof distinctId !== 'string' || !distinctId)) {
    throw invalid('invalid_distinct_id', 'distinctId must be a nonempty string.', 'distinctId')
  }
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
  if (maxRetries !== undefined && !(Number.isInteger(maxRetries) && maxRetries >= 0)) {
    throw invalid('invalid_max_retries', 'maxRetries must be a nonnegative integer.', 'maxRetries')
  }

  const payload: Record<string, unknown> = { to, message_data: templateData ?? {} }
  if (distinctId !== undefined) {
    payload.identifiers = { distinct_id: distinctId }
  }
  return {
    path: SEND_PATH.replace('{templateId}', templateId.toLowerCase()),
    body: safeJsonStringify(payload),
    idempotencyKey: idempotencyKey ?? globalThis.crypto.randomUUID(),
    maxRetries: maxRetries ?? defaultMaxRetries,
  }
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
    return parseRetryAfterMs(response.headers?.get('retry-after'))
  } catch {
    return undefined
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function parseReply({ status, payload, retryAfterMs }: Reply): SendEmailResult {
  const fields = (payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) as Record<
    string,
    unknown
  >
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
  throw new EmailError({
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

function isRetryable(error: EmailError): boolean {
  // Every request carries an idempotency key, so a retry can't queue a second email.
  if (error.statusCode === undefined) {
    return error.code === 'network_error'
  }
  if (error.statusCode === 409) {
    return error.code === 'idempotency_key_in_flight'
  }
  if (error.statusCode === 429) {
    // Waiting doesn't fix a monthly quota.
    return error.code !== 'quota_limited'
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
