import { type EmailErrorName, type EmailErrorParams, EmailError, emailErrorName } from '../emails/errors'

/**
 * A coarse category of the failure, for code that branches on the kind of failure rather than the exact `code`.
 */
export type PushErrorName = EmailErrorName

/**
 * PostHog did not queue the push notification, or the client could not tell whether it did.
 *
 * Branch on `code`, PostHog's stable error code, or on `name`, a coarse category of the
 * failure. The message never contains the secret key or the request body.
 */
export class PushError extends Error {
  override name: PushErrorName
  /** PostHog's error code, such as `transactional_push_paused`, or an SDK code such as `network_error`. */
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

export function asPushError(error: unknown): PushError {
  if (error instanceof PushError) {
    return error
  }
  if (error instanceof EmailError) {
    return new PushError({
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      why: error.why,
      fix: error.fix,
      docsUrl: error.docsUrl,
      field: error.field,
      retryAfterMs: error.retryAfterMs,
      cause: error.cause,
    })
  }
  return new PushError({
    code: 'unexpected_error',
    message: 'Sending the push notification failed unexpectedly.',
    cause: error,
  })
}
