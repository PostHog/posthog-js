import { isRetryable } from '../emails/emails'
import type { EmailError } from '../emails/errors'
import type { SendCodeEmailOptions } from '../emails/types'
import { version } from '../version'
import { mapMail, refuseBeforeNormalize } from './mapper'
import type {
  NodemailerMail,
  NormalizedMail,
  PostHogSendError,
  PostHogSentMessageInfo,
  PostHogTransport,
  PostHogTransportOptions,
} from './types'

const INTEGRATION = `nodemailer/${version}`

/**
 * A Nodemailer transport that sends each message through PostHog:
 * `nodemailer.createTransport(createPostHogTransport({ client }))`. Every `sendMail` call stays as it is.
 *
 * A message PostHog can't carry fails with `code: 'EPOSTHOGUNSUPPORTED'` and sends nothing.
 */
export function createPostHogTransport({ client, defaultTemplateKey }: PostHogTransportOptions): PostHogTransport {
  const sendThroughPostHog = async (mail: NodemailerMail): Promise<PostHogSentMessageInfo> => {
    refuseBeforeNormalize(mail.data)
    const mapped = mapMail(await normalize(mail), defaultTemplateKey)
    const { data, error } = await client.emails.send({ ...(mapped as SendCodeEmailOptions), integration: INTEGRATION })
    if (error) {
      throw sendError(error)
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
  return new Promise((resolve, reject) =>
    mail.normalize((error, data) => (error ? reject(error) : resolve(data as NormalizedMail)))
  )
}

function sendError(error: EmailError): PostHogSendError {
  return Object.assign(new Error(error.message, { cause: error }), {
    code: error.code,
    detail: error.message,
    retryable: isRetryable(error),
    ...(error.statusCode !== undefined && { status: error.statusCode }),
    ...(error.field !== undefined && { attr: error.field }),
    ...(error.retryAfterMs !== undefined && { retry_after: Math.ceil(error.retryAfterMs / 1000) }),
  })
}
