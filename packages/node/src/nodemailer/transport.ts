import { isRetryable } from '../emails/emails'
import type { EmailError } from '../emails/errors'
import type { SendCodeEmailOptions } from '../emails/types'
import { version } from '../version'
import { mapMail, refuseMimeChanges, refuseWhatNormalizeDrops } from './mapper'
import type {
  NodemailerMail,
  NormalizedMail,
  PostHogSendError,
  PostHogSentMessageInfo,
  PostHogTransport,
  PostHogTransportOptions,
} from './types'

const INTEGRATION = `nodemailer/${version}`
const NORMALIZE_TIMEOUT_MS = 60_000

/**
 * A Nodemailer transport that sends each message through PostHog:
 * `nodemailer.createTransport(createPostHogTransport({ client }))`. Every `sendMail` call stays as it is.
 *
 * A message PostHog can't carry fails with `code: 'EPOSTHOGUNSUPPORTED'` and sends nothing. A message whose content
 * Nodemailer can't read within 60 seconds, such as a stalled attachment stream, fails with `code: 'ETIMEDOUT'`.
 */
export function createPostHogTransport({ client, defaultTemplateKey }: PostHogTransportOptions): PostHogTransport {
  const sendThroughPostHog = async (mail: NodemailerMail): Promise<PostHogSentMessageInfo> => {
    refuseWhatNormalizeDrops(mail.data)
    refuseMimeChanges(mail)
    const mapped = mapMail(await normalize(mail), defaultTemplateKey)
    const { data, error } = await client.emails.send({ ...(mapped as SendCodeEmailOptions), integration: INTEGRATION })
    if (error) {
      throw sendError(error, mapped.idempotencyKey !== undefined)
    }
    return { messageId: data.id }
  }

  return {
    name: 'PostHog',
    version,
    send(mail, done) {
      void sendThroughPostHog(mail).then(
        (info) => done(null, info),
        (error: Error) => done(error)
      )
    },
  }
}

function normalize(mail: NodemailerMail): Promise<NormalizedMail> {
  return new Promise((resolve, reject) => {
    const hasOwnEnvelope = Boolean(mail.data?.envelope)
    const deadline = setTimeout(() => reject(normalizeTimeout()), NORMALIZE_TIMEOUT_MS)
    mail.normalize((error, data) => {
      clearTimeout(deadline)
      return error ? reject(error) : resolve(withEnvelopeIf(hasOwnEnvelope, data as NormalizedMail))
    })
  })
}

function normalizeTimeout(): Error {
  return Object.assign(
    new Error(
      `Nodemailer didn't finish reading the message within ${NORMALIZE_TIMEOUT_MS / 1000} seconds, so no email was sent.`
    ),
    { code: 'ETIMEDOUT' }
  )
}

function withEnvelopeIf(hasOwnEnvelope: boolean, normalized: NormalizedMail): NormalizedMail {
  return hasOwnEnvelope ? normalized : { ...normalized, envelope: undefined }
}

function sendError(error: EmailError, hasIdempotencyKey: boolean): PostHogSendError {
  return Object.assign(new Error(error.message, { cause: error }), {
    code: error.code,
    detail: error.message,
    retryable: hasIdempotencyKey && isRetryable(error),
    ...(error.statusCode !== undefined && { status: error.statusCode }),
    ...(error.field !== undefined && { attr: error.field }),
    ...(error.retryAfterMs !== undefined && { retry_after: Math.ceil(error.retryAfterMs / 1000) }),
  })
}
