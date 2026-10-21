import type { ExperimentOptions } from './client'
import { copy, type WireObject } from './serialization'

export type Persistence = 'not_sent' | 'rejected' | 'unknown'
export interface EvaluationErrorFields {
  status?: number
  code?: string
  detail?: unknown
  attr?: string
  errors?: unknown
  response?: WireObject
  /** Retry-After in seconds. */
  retryAfter?: number
  persistence?: Persistence
  submission?: ExperimentOptions
}
/** An operation did not receive a valid acknowledgment. Inspect persistence before recovery. */
export class EvaluationAPIError extends Error {
  readonly status?: number
  readonly code?: string
  readonly detail?: unknown
  readonly attr?: string
  readonly response?: WireObject
  readonly retryAfter?: number
  persistence: Persistence
  readonly #errors?: unknown
  #submission?: ExperimentOptions
  constructor(fields: EvaluationErrorFields = {}) {
    super(
      `Offline evaluation request failed (${fields.status === undefined ? 'no acknowledgment' : `HTTP ${fields.status}`}).`
    )
    this.name = 'EvaluationAPIError'
    this.status = fields.status
    this.code = fields.code
    this.detail = fields.detail === undefined ? undefined : copy(fields.detail)
    this.attr = fields.attr
    this.#errors = fields.errors === undefined ? undefined : copy(fields.errors)
    this.response = fields.response === undefined ? undefined : copy(fields.response)
    this.retryAfter = fields.retryAfter
    this.persistence = fields.persistence ?? 'unknown'
    this.#submission = fields.submission === undefined ? undefined : copy(fields.submission)
    // Logging an Error should not accidentally log evaluation payloads or credentials.
    for (const key of ['detail', 'response']) Object.defineProperty(this, key, { enumerable: false })
  }
  // Node logs an Error's own `errors` property even when it is non-enumerable.
  get errors(): unknown {
    return this.#errors === undefined ? undefined : copy(this.#errors)
  }
  get submission(): ExperimentOptions | undefined {
    return this.#submission === undefined ? undefined : copy(this.#submission)
  }
}
export function parseResponse<T>(data: WireObject, parser: (value: WireObject) => T): T {
  try {
    return parser(data)
  } catch {
    throw new EvaluationAPIError({ code: 'invalid_response', response: data })
  }
}
