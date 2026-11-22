import { safeJsonStringify } from '@posthog/core'

import { EmailError } from './errors'
import { type Reply, isRecord, parseJson, replyError, replyFields, text, warningsOf } from './replies'
import type { BatchEmailRecipientResult, EmailWarning } from './types'

export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/
const BATCH_MAX_RECIPIENTS = 100
const BATCH_MAX_BODY_BYTES = 4 * 1024 * 1024
const RECIPIENT_FIELDS: ReadonlySet<string> = new Set(['to', 'distinctId', 'templateData', 'idempotencyKey'])

/**
 * One recipient of a batch, and what the client knows of their email so far. A recipient becomes `unconfirmed` once
 * PostHog may have queued their email: a request for them went unanswered, PostHog said it couldn't tell, or their key
 * was still in flight. It stays so until PostHog answers `queued`, since a later refusal doesn't prove it wasn't sent.
 */
export interface Slot {
  readonly index: number
  readonly to: string
  readonly idempotencyKey: string
  readonly wire: string
  status: BatchEmailRecipientResult['status']
  id: string | null
  replayed: boolean
  error?: EmailError
  /** Whether the next attempt sends this recipient again. */
  open: boolean
  maybeQueued: boolean
}

/** Checks every recipient before any request, and gives each the idempotency key its every attempt carries. */
export function prepareRecipients(recipients: unknown, templateForm: boolean): Slot[] {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new EmailError({
      code: 'invalid_recipients',
      message:
        'recipients must be a nonempty array of recipients, such as [{ to: "ada@example.com" }], so no email was sent.',
      field: 'recipients',
    })
  }
  const keys = new Map<string, number>()
  return recipients.map((recipient: unknown, index): Slot => {
    const at = `recipients[${index}]`
    if (!isRecord(recipient)) {
      throw invalid('invalid_recipient', `${at} must be an object with to, so no email was sent.`, at)
    }
    const unknown = Object.keys(recipient).find((name) => recipient[name] !== undefined && !RECIPIENT_FIELDS.has(name))
    if (unknown !== undefined) {
      throw new EmailError({
        code: 'invalid_form',
        message: `A batch recipient doesn't take ${unknown}, so no email was sent.`,
        field: `${at}.${unknown}`,
        fix: 'Give each recipient only to, distinctId, templateData and idempotencyKey, and set the rest on the batch.',
      })
    }
    const { to, distinctId, templateData, idempotencyKey } = recipient
    if (typeof to !== 'string' || !to.trim()) {
      throw invalid('invalid_recipient', `${at}.to must be one email address as a nonempty string.`, `${at}.to`)
    }
    if (distinctId !== undefined && (typeof distinctId !== 'string' || !distinctId)) {
      throw invalid('invalid_distinct_id', `${at}.distinctId must be a nonempty string.`, `${at}.distinctId`)
    }
    if (templateData !== undefined && !templateForm) {
      throw new EmailError({
        code: 'invalid_form',
        message: 'A batch with templateKey takes no templateData per recipient, so no email was sent.',
        field: `${at}.templateData`,
        fix: 'Remove templateData, or send a template made in PostHog with templateId.',
      })
    }
    if (templateData !== undefined && !isRecord(templateData)) {
      throw invalid('invalid_template_data', `${at}.templateData must be an object.`, `${at}.templateData`)
    }
    if (
      idempotencyKey !== undefined &&
      (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey))
    ) {
      throw invalid(
        'invalid_idempotency_key',
        `${at}.idempotencyKey must be 1 to 255 visible ASCII characters without spaces.`,
        `${at}.idempotencyKey`
      )
    }
    const key = idempotencyKey ?? globalThis.crypto.randomUUID()
    const first = keys.get(key)
    if (first !== undefined) {
      throw new EmailError({
        code: 'invalid_idempotency_key',
        message: `recipients[${first}] and ${at} have the same idempotencyKey, so no email was sent.`,
        field: `${at}.idempotencyKey`,
        why: 'PostHog queues one email per key, so the second recipient would get no email.',
        fix: 'Give each recipient its own key.',
      })
    }
    keys.set(key, index)
    const wire = safeJsonStringify({
      to,
      ...(distinctId !== undefined && { distinct_id: distinctId }),
      ...(templateData !== undefined && { message_data: templateData }),
      idempotency_key: key,
    })
    return {
      index,
      to,
      idempotencyKey: key,
      wire,
      status: 'not_attempted',
      id: null,
      replayed: false,
      open: true,
      maybeQueued: false,
    }
  })
}

/** The batch email as a request body for some recipients. */
export class BatchBody {
  private readonly head: string
  private readonly headBytes: number

  constructor(shared: Record<string, unknown>) {
    const json = safeJsonStringify(shared)
    this.head = `${json.slice(0, -1)}${json === '{}' ? '' : ','}"recipients":[`
    this.headBytes = utf8Bytes(this.head) + ']}'.length
  }

  of(slots: Slot[]): string {
    return `${this.head}${slots.map(({ wire }) => wire).join(',')}]}`
  }

  /**
   * Splits the recipients into requests of at most 100 recipients and 4 MiB, in order. A recipient too large for any
   * request fails here and joins no request.
   */
  chunks(slots: Slot[]): Slot[][] {
    const chunks: Slot[][] = []
    let chunk: Slot[] = []
    let bytes = this.headBytes
    for (const slot of slots) {
      const slotBytes = utf8Bytes(slot.wire)
      if (this.headBytes + slotBytes > BATCH_MAX_BODY_BYTES) {
        settle(slot, {
          status: 'failed',
          error: new EmailError({
            code: 'content_too_large',
            message: `The email for recipients[${slot.index}] is over the 4 MiB a batch request takes, so it was not sent.`,
            field: `recipients[${slot.index}]`,
            fix: 'Send less templateData or content, or send this email with emails.send().',
          }),
        })
        continue
      }
      const separator = chunk.length === 0 ? 0 : 1
      if (chunk.length === BATCH_MAX_RECIPIENTS || bytes + separator + slotBytes > BATCH_MAX_BODY_BYTES) {
        chunks.push(chunk)
        chunk = []
        bytes = this.headBytes
      }
      bytes += (chunk.length === 0 ? 0 : 1) + slotBytes
      chunk.push(slot)
    }
    if (chunk.length > 0) {
      chunks.push(chunk)
    }
    return chunks
  }
}

/**
 * Records PostHog's answer to a request for `sent`, and returns its warnings. Throws the request's error when PostHog
 * refused the whole request or its answer can't be read.
 */
export function recordAnswer(sent: Slot[], { status, text: body, retryAfterMs }: Reply): EmailWarning[] {
  const fields = replyFields(parseJson(body))
  if (status < 200 || status >= 300) {
    throw batchReplyError(fields, status, retryAfterMs)
  }
  const answers = Array.isArray(fields.results) ? fields.results : []
  if (answers.length !== sent.length) {
    throw new EmailError({
      code: 'api_error',
      message: 'PostHog answered the batch without a result for each recipient.',
      statusCode: status,
    })
  }
  sent.forEach((slot, position) => {
    const answer = replyFields(answers[position])
    const id = text(answer.message_id)
    const error = isRecord(answer.error) ? answer.error : undefined
    if (answer.status === 'queued' && id) {
      settle(slot, { status: 'queued', id, replayed: answer.replayed === true })
      return
    }
    if (!error) {
      recordUnanswered(
        slot,
        new EmailError({ code: 'api_error', message: 'PostHog answered without a result.', statusCode: status })
      )
      return
    }
    const code = text(error.code) ?? 'api_error'
    const retryable = error.retryable === true || code === 'delivery_unavailable'
    const refusal = new EmailError({
      code,
      message: text(error.detail) ?? `PostHog refused this recipient with ${code}.`,
      statusCode: typeof error.status === 'number' ? error.status : undefined,
    })
    slot.id = id ?? slot.id
    slot.maybeQueued ||= retryable
    slot.status = slot.maybeQueued ? 'unconfirmed' : 'failed'
    slot.error = refusal
    slot.open = retryable
  })
  return warningsOf(fields)
}

/** Records a request for `sent` that failed as a whole, and whether PostHog may have queued its emails. */
export function recordFailure(sent: Slot[], error: EmailError): void {
  const maybeQueued =
    error.statusCode === undefined ||
    error.statusCode >= 500 ||
    error.statusCode < 300 ||
    error.code === 'idempotency_key_in_flight'
  for (const slot of sent) {
    if (maybeQueued) {
      recordUnanswered(slot, error)
    } else {
      slot.status = slot.maybeQueued ? 'unconfirmed' : 'failed'
      slot.error = error
    }
  }
}

export function resultOf(slot: Slot): BatchEmailRecipientResult {
  const { index, to, idempotencyKey } = slot
  switch (slot.status) {
    case 'queued':
      return { index, to, idempotencyKey, status: 'queued', id: slot.id ?? '', replayed: slot.replayed }
    case 'failed':
    case 'unconfirmed':
      return { index, to, idempotencyKey, status: slot.status, id: slot.id, error: slot.error! }
    default:
      return { index, to, idempotencyKey, status: 'not_attempted' }
  }
}

function recordUnanswered(slot: Slot, error: EmailError): void {
  slot.status = 'unconfirmed'
  slot.error = error
  slot.maybeQueued = true
}

function settle(
  slot: Slot,
  outcome: { status: 'queued'; id: string; replayed: boolean } | { status: 'failed'; error: EmailError }
): void {
  slot.status = outcome.status
  slot.open = false
  if (outcome.status === 'queued') {
    slot.id = outcome.id
    slot.replayed = outcome.replayed
    slot.error = undefined
  } else {
    slot.error = outcome.error
  }
}

function batchReplyError(
  fields: Record<string, unknown>,
  status: number,
  retryAfterMs: number | undefined
): EmailError {
  const error = replyError(fields, status, retryAfterMs)
  if (error.code === 'batch_unavailable') {
    return new EmailError({
      code: error.code,
      statusCode: status,
      message: 'Batch sends are not on for this project yet, so PostHog sent no email of this request.',
      fix: 'Send each email with emails.send() until batch sends are on for the project.',
    })
  }
  // A 404 that names no field and no other code, JSON or a proxy's page, means the route is missing.
  if (status === 404 && error.field === undefined && (error.code === 'not_found' || error.code === 'api_error')) {
    return new EmailError({
      code: 'not_found',
      statusCode: status,
      message: 'Batch sends are unavailable on this server, so PostHog sent no email of this request.',
      fix: 'Send each email with emails.send(), or update your PostHog.',
    })
  }
  return error
}

function invalid(code: string, message: string, field: string): EmailError {
  return new EmailError({ code, message, field })
}

const encoder = new TextEncoder()

function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength
}
