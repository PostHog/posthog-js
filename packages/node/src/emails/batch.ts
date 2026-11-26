import { safeJsonStringify } from '@posthog/core'

import { EmailError } from './errors'
import { type Reply, isRecord, parseJson, replyError, replyFields, text, warningsOf } from './replies'
import type { BatchEmailRecipientResult, EmailWarning } from './types'

export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/
const BATCH_MAX_RECIPIENTS = 100
const RECIPIENT_FIELDS: ReadonlySet<string> = new Set(['to', 'distinctId', 'templateData', 'idempotencyKey'])

export function fieldsOf(source: unknown, names: Iterable<string>): Record<string, unknown> {
  const object: Record<string, unknown> = Object(source ?? {})
  const fields: Record<string, unknown> = Object.create(null)
  for (const name of new Set([...Object.keys(object), ...names])) {
    fields[name] = object[name]
  }
  return fields
}

export interface Slot {
  readonly index: number
  readonly to: string
  readonly idempotencyKey: string
  readonly wire: string
  status: BatchEmailRecipientResult['status']
  id: string | null
  replayed: boolean
  error?: EmailError
}

export function prepareRecipients(recipients: unknown, templateForm: boolean, sendFields: ReadonlySet<string>): Slot[] {
  const count: unknown = Array.isArray(recipients) ? recipients.length : undefined
  if (!Array.isArray(recipients) || typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
    throw new EmailError({
      code: 'invalid_recipients',
      message:
        'recipients must be a nonempty array of recipients, such as [{ to: "ada@example.com" }], so no email was sent.',
      field: 'recipients',
    })
  }
  if (count > BATCH_MAX_RECIPIENTS) {
    throw new EmailError({
      code: 'invalid_recipients',
      message: `A batch takes at most ${BATCH_MAX_RECIPIENTS} recipients, and this one has ${count}, so no email was sent.`,
      field: 'recipients',
      why: 'A batch is one request to PostHog, which takes at most 100 recipients.',
      fix: `Split the recipients into batches of at most ${BATCH_MAX_RECIPIENTS}, and send each with emails.batch().`,
    })
  }
  const keys = new Map<string, number>()
  const slots: Slot[] = []
  for (let index = 0; index < count; index++) {
    const recipient: unknown = Object.hasOwn(recipients, index) ? recipients[index] : undefined
    slots.push(prepareRecipient(recipient, index, templateForm, keys, sendFields))
  }
  return slots
}

function prepareRecipient(
  recipient: unknown,
  index: number,
  templateForm: boolean,
  keys: Map<string, number>,
  sendFields: ReadonlySet<string>
): Slot {
  const at = `recipients[${index}]`
  if (!isRecord(recipient)) {
    throw invalid('invalid_recipient', `${at} must be an object with to, so no email was sent.`, at)
  }
  const fields = fieldsOf(recipient, sendFields)
  const unknown = Object.keys(fields).find((name) => fields[name] !== undefined && !RECIPIENT_FIELDS.has(name))
  if (unknown !== undefined) {
    throw new EmailError({
      code: 'invalid_form',
      message: `A batch recipient doesn't take ${unknown}, so no email was sent.`,
      field: `${at}.${unknown}`,
      fix: 'Give each recipient only to, distinctId, templateData and idempotencyKey, and set the rest on the batch.',
    })
  }
  const { to, distinctId, templateData, idempotencyKey } = fields
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
    status: 'unconfirmed',
    id: null,
    replayed: false,
  }
}

export function batchBody(shared: Record<string, unknown>, slots: Slot[]): string {
  const json = safeJsonStringify(shared)
  return `${json.slice(0, -1)}${json === '{}' ? '' : ','}"recipients":[${slots.map(({ wire }) => wire).join(',')}]}`
}

export function recordAnswer(
  sent: Slot[],
  { status, text: body, retryAfterMs }: Reply,
  mayHaveQueuedBefore: boolean,
  templateForm: boolean
): EmailWarning[] {
  const fields = replyFields(parseJson(body))
  if (status < 200 || status >= 300) {
    throw batchReplyError(fields, status, retryAfterMs, templateForm)
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
      slot.status = 'queued'
      slot.id = id
      slot.replayed = answer.replayed === true
      return
    }
    if (!error) {
      recordUnanswered(
        slot,
        new EmailError({ code: 'api_error', message: 'PostHog answered without a result.', statusCode: status })
      )
      return
    }
    const coded = text(error.code)?.trim() || undefined
    const code = coded ?? 'api_error'
    // A recipient error without a code can't say PostHog queued nothing, and a 409 is decided by its code alone:
    // only batch_unavailable says PostHog queued nothing for this recipient.
    const unconfirmed =
      coded === undefined ||
      (error.status === 409
        ? code !== 'batch_unavailable' || mayHaveQueuedBefore
        : code !== 'idempotency_key_reused' &&
          (error.retryable === true ||
            code === 'delivery_unavailable' ||
            code === 'idempotency_key_in_flight' ||
            mayHaveQueuedBefore))
    const refusal = new EmailError({
      code,
      message: text(error.detail) ?? `PostHog refused this recipient with ${code}.`,
      statusCode: typeof error.status === 'number' ? error.status : undefined,
    })
    slot.id = id ?? null
    slot.status = unconfirmed ? 'unconfirmed' : 'failed'
    slot.error = refusal
  })
  return warningsOf(fields)
}

export function recordFailure(
  sent: Slot[],
  error: EmailError,
  mayHaveQueuedBefore: boolean,
  earlierMayHaveQueued: boolean
): EmailError {
  const unconfirmed = mayHaveQueuedBefore || mayHaveQueued(error)
  // After an earlier attempt PostHog may have queued, PostHog's own words on a refusal (any 4xx, a 409 conflict
  // included) speak only of the retry, so they are replaced; a retry that went unanswered too keeps its own message.
  const refusedRetry =
    !mayHaveQueued(error) || (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500)
  const answer = earlierMayHaveQueued && refusedRetry ? afterUnconfirmedAttempt(error) : error
  for (const slot of sent) {
    slot.status = unconfirmed ? 'unconfirmed' : 'failed'
    slot.error = answer
  }
  return unconfirmed ? copyError(answer, { fix: BATCH_RESEND_FIX }) : answer
}

function afterUnconfirmedAttempt(error: EmailError): EmailError {
  if (error.statusCode === undefined) {
    return copyError(error, { message: `${error.message} ${EARLIER_ATTEMPT_MAY_HAVE_QUEUED}` })
  }
  return copyError(error, {
    message: `PostHog refused the retry of this batch with ${error.code}, but an earlier attempt of this batch wasn't confirmed, so some of its emails may have gone out. Send the batch again with each recipient's idempotencyKey from error.results, then read each recipient's result.`,
    why: undefined,
  })
}

export function mayHaveQueued(error: EmailError): boolean {
  if (error.code === 'client_closed') {
    return false
  }
  return (
    error.statusCode === undefined ||
    error.statusCode >= 500 ||
    error.statusCode < 300 ||
    error.code === 'idempotency_key_in_flight' ||
    (error.statusCode === 409 && error.code !== 'batch_unavailable')
  )
}

export function resultOf(slot: Slot): BatchEmailRecipientResult {
  const { index, to, idempotencyKey } = slot
  switch (slot.status) {
    case 'queued':
      return { index, to, idempotencyKey, status: 'queued', id: slot.id ?? '', replayed: slot.replayed }
    case 'failed':
      return { index, to, idempotencyKey, status: 'failed', id: slot.id, error: slot.error! }
    case 'unconfirmed':
      return { index, to, idempotencyKey, status: 'unconfirmed', id: slot.id, error: unconfirmedError(slot.error!) }
  }
}

const BATCH_RESEND_FIX =
  "PostHog may have queued these emails. Call emails.batch() again with the same email and recipients, unchanged, giving each recipient the idempotencyKey of its entry in error.results (matched by index), within 24 hours of the first request with those keys: PostHog queues no second email for a key it has. Then read each recipient's result."

const UNCONFIRMED_MESSAGE = "PostHog didn't confirm this email, and it may still go out."

const EARLIER_ATTEMPT_MAY_HAVE_QUEUED =
  "An earlier attempt of this batch wasn't confirmed, so PostHog may have queued its emails."

const RESEND_FIX =
  'PostHog may have queued this email. Send this recipient again, unchanged and with the same idempotencyKey, within 24 hours of the first request with that key: PostHog queues no second email for a key it has.'

function unconfirmedError(error: EmailError): EmailError {
  return copyError(error, { message: UNCONFIRMED_MESSAGE, why: undefined, fix: RESEND_FIX })
}

function copyError(error: EmailError, changes: { message?: string; why?: string; fix?: string }): EmailError {
  return new EmailError({
    code: error.code,
    message: changes.message ?? error.message,
    statusCode: error.statusCode,
    why: 'why' in changes ? changes.why : error.why,
    fix: changes.fix ?? error.fix,
    docsUrl: error.docsUrl,
    field: error.field,
    retryAfterMs: error.retryAfterMs,
    messageId: error.messageId,
    cause: error.cause,
  })
}

function recordUnanswered(slot: Slot, error: EmailError): void {
  slot.status = 'unconfirmed'
  slot.error = error
}

function batchReplyError(
  fields: Record<string, unknown>,
  status: number,
  retryAfterMs: number | undefined,
  templateForm: boolean
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
  const code = error.code.trim()
  if (status === 413 && (code === '' || code === 'api_error')) {
    return new EmailError({
      code: 'content_too_large',
      statusCode: status,
      message:
        'PostHog answered 413: the batch is larger than PostHog can take at once, so it sent no email of this request.',
      fix: 'Split the recipients into smaller batches.',
      retryAfterMs,
    })
  }
  if (status === 404 && error.field === undefined && (code === '' || code === 'not_found' || code === 'api_error')) {
    return templateForm
      ? new EmailError({
          code: 'not_found',
          statusCode: status,
          message:
            "PostHog found no template with this ID, or batch sends aren't available for this project, so it sent no email of this request.",
          fix: 'Check the templateId. If it is right, send each recipient on its own with emails.send() until batch sends are available for the project.',
        })
      : new EmailError({
          code: 'not_found',
          statusCode: status,
          message: "Batch sends from code aren't available for this project, so PostHog sent no email of this request.",
          fix: 'Send each recipient on its own with emails.send() until batch sends are available for the project.',
        })
  }
  return error
}

function invalid(code: string, message: string, field: string): EmailError {
  return new EmailError({ code, message, field })
}
