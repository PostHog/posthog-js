/**
 * A coarse category of the failure, for code that branches on the kind of failure rather than the exact `code`.
 */
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

export interface EmailErrorParams {
  code: string
  message: string
  statusCode?: number
  why?: string
  fix?: string
  docsUrl?: string
  field?: string
  retryAfterMs?: number
  cause?: unknown
}

/**
 * PostHog did not queue the email, or the client could not tell whether it did.
 *
 * Branch on `code`, PostHog's stable error code, or on `name`, a coarse category of the
 * failure. The message never contains the secret key or the request body.
 */
export class EmailError extends Error {
  override name: EmailErrorName
  /** PostHog's error code, such as `quota_limited`, or an SDK code such as `network_error`. */
  readonly code: string
  /** The HTTP status, when PostHog answered. */
  readonly statusCode?: number
  readonly why?: string
  readonly fix?: string
  readonly docsUrl?: string
  /** The request field the error is about, when PostHog named one. */
  readonly field?: string
  /** How long PostHog asked the client to wait before it sends again, in milliseconds. */
  readonly retryAfterMs?: number

  constructor(params: EmailErrorParams) {
    super(params.message, params.cause === undefined ? undefined : { cause: params.cause })
    this.name = emailErrorName(params.statusCode, params.code)
    this.code = params.code
    this.statusCode = params.statusCode
    this.why = params.why
    this.fix = params.fix
    this.docsUrl = params.docsUrl
    this.field = params.field
    this.retryAfterMs = params.retryAfterMs
  }
}

const TEMPLATE_CONFLICTS = new Set(['template_outdated', 'template_edited_in_posthog'])

function emailErrorName(status: number | undefined, code: string): EmailErrorName {
  if (code === 'missing_secret_key' || status === 401) {
    return 'missing_api_key'
  }
  if (status === undefined) {
    if (code === 'network_error') {
      return 'service_unavailable'
    }
    return code.startsWith('invalid_') ? 'validation_error' : 'application_error'
  }
  switch (status) {
    case 400:
      return 'validation_error'
    case 403:
      return 'invalid_permission'
    case 404:
      return 'not_found'
    case 409:
      return TEMPLATE_CONFLICTS.has(code) ? 'validation_error' : 'concurrent_idempotent_requests'
    case 422:
      // The template send route also answers 422 for send checks such as recipient_suppressed.
      return code === 'idempotency_key_reused' ? 'invalid_idempotent_request' : 'validation_error'
    case 429:
      return code === 'quota_limited' ? 'monthly_quota_exceeded' : 'rate_limit_exceeded'
    case 503:
      return 'service_unavailable'
    default:
      return 'application_error'
  }
}
