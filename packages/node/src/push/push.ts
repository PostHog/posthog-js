import { safeJsonStringify } from '@posthog/core'

import type { EmailSender } from '../emails/emails'
import { PushError, asPushError } from './errors'
import type { GetPushResponse, Push, SendPushOptions, SendPushResponse } from './types'

const SEND_PATH = '/api/messaging/send/push/'
const STATUS_PATH = '/api/messaging/pushes/{messageId}/'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/
const MAX_DISTINCT_ID_LENGTH = 400
const FIELDS = new Set(['templateId', 'distinctId', 'templateData', 'idempotencyKey', 'maxRetries'])

/**
 * Sends one transactional push notification per call, and reads the status of a sent one. Goes through the
 * client's email sender, so it gets the same app host, secret key, timeout, retries and `flush()` handling.
 */
export class PushSender implements Push {
  constructor(private readonly sender: EmailSender) {}

  async send(options: SendPushOptions): Promise<SendPushResponse> {
    try {
      const { body, idempotencyKey, maxRetries } = preparePush(options)
      const { data, error } = await this.sender.call({
        method: 'POST',
        path: SEND_PATH,
        body,
        idempotencyKey,
        maxRetries,
        sends: 'push notifications',
        nothingDone: 'no push notification was sent',
        missingSecretKey:
          'Sending push notifications needs secretKey, a project secret API key with the transactional_push:write scope.',
        read: ({ message_id: id, replayed }) => (isText(id) ? { id, replayed: replayed === true } : undefined),
        unreadable: 'PostHog answered without a message ID.',
        unexpected: 'Sending the push notification failed unexpectedly.',
      })
      return error ? { data: null, error: asPushError(error) } : { data, error: null }
    } catch (error) {
      return { data: null, error: asPushError(error) }
    }
  }

  async get(id: string): Promise<GetPushResponse> {
    if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
      return {
        data: null,
        error: invalid('invalid_message_id', 'id must be the message ID that send() returned.', 'id'),
      }
    }
    const { data, error } = await this.sender.call({
      method: 'GET',
      path: STATUS_PATH.replace('{messageId}', id.toLowerCase()),
      sends: 'push notifications',
      nothingDone: 'no push notification status was read',
      missingSecretKey:
        'Reading a push notification status needs secretKey, a project secret API key with the transactional_push:read or transactional_push:write scope.',
      read: ({ id: messageId, status, created_at: createdAt, reason }) =>
        isText(messageId) && isText(status) && isText(createdAt)
          ? { id: messageId, status, createdAt, reason: isText(reason) ? reason : null }
          : undefined,
      unreadable: 'PostHog answered without a push notification status.',
      unexpected: 'Reading the push notification status failed unexpectedly.',
    })
    return error ? { data: null, error: asPushError(error) } : { data, error: null }
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

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function invalid(code: string, message: string, field: string): PushError {
  return new PushError({ code, message, field })
}
