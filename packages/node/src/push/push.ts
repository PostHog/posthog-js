import { safeJsonStringify } from '@posthog/core'

import type { EmailSender } from '../emails/emails'
import { PushError, asPushError } from './errors'
import type { Push, SendPushOptions, SendPushResponse } from './types'

const SEND_PATH = '/api/projects/@current/messaging/send/push/'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/
const MAX_DISTINCT_ID_LENGTH = 400
const FIELDS = new Set(['templateId', 'distinctId', 'templateData', 'idempotencyKey', 'maxRetries'])

/**
 * Sends one transactional push notification per call. Goes through the client's email sender, so a push
 * send gets the same app host, secret key, timeout, retries and `flush()` handling as an email send.
 */
export class PushSender implements Push {
  constructor(private readonly sender: EmailSender) {}

  async send(options: SendPushOptions): Promise<SendPushResponse> {
    try {
      const { body, idempotencyKey, maxRetries } = preparePush(options)
      const { id, replayed } = await this.sender.queue({
        path: SEND_PATH,
        body,
        idempotencyKey,
        maxRetries,
        nothingDone: 'no push notification was sent',
        missingSecretKey:
          'Sending push notifications needs secretKey, a project secret API key with the transactional_push:write scope.',
      })
      return { data: { id, replayed }, error: null }
    } catch (error) {
      return { data: null, error: asPushError(error) }
    }
  }
}

function preparePush(options: SendPushOptions): {
  body: string
  idempotencyKey: string
  maxRetries: number | undefined
} {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw invalid('invalid_form', 'send takes one options object.', 'options')
  }
  const unknownFields = Object.keys(options).filter((field) => !FIELDS.has(field))
  if (unknownFields.length > 0) {
    throw invalid(
      'invalid_form',
      `send doesn't take ${unknownFields.join(', ')}, so no push notification was sent.`,
      unknownFields[0]
    )
  }
  const { templateId, distinctId, templateData, idempotencyKey, maxRetries } = options
  if (typeof templateId !== 'string' || !UUID_PATTERN.test(templateId)) {
    throw invalid('invalid_template_id', "templateId must be the push template's UUID.", 'templateId')
  }
  if (typeof distinctId !== 'string' || !distinctId || distinctId.length > MAX_DISTINCT_ID_LENGTH) {
    throw invalid(
      'invalid_distinct_id',
      `distinctId must be the person's distinct ID, a nonempty string of at most ${MAX_DISTINCT_ID_LENGTH} characters.`,
      'distinctId'
    )
  }
  if (
    templateData !== undefined &&
    (typeof templateData !== 'object' || templateData === null || Array.isArray(templateData))
  ) {
    throw invalid('invalid_template_data', 'templateData must be an object.', 'templateData')
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
  return {
    body: safeJsonStringify({
      template_id: templateId.toLowerCase(),
      distinct_id: distinctId,
      message_data: templateData ?? {},
    }),
    idempotencyKey: idempotencyKey ?? globalThis.crypto.randomUUID(),
    maxRetries,
  }
}

function invalid(code: string, message: string, field: string): PushError {
  return new PushError({ code, message, field })
}
