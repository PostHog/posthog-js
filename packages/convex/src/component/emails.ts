import { EmailError, type SendCodeEmailOptions } from 'posthog-node/edge'
import { ConvexError, v, type Infer } from 'convex/values'
import { action } from './_generated/server.js'
import { getEmailClient } from './lib.js'
import { version } from './version.js'

const WORKPOOL_NON_RETRYABLE = '__convexWorkpoolNonRetryable'

const sentEmail = v.object({ message_id: v.string(), replayed: v.boolean() })

export type SentEmail = Infer<typeof sentEmail>

/** The `data` of the `ConvexError` that a failed send throws. Retry only when `retryable`, with the same idempotency key. */
export type EmailSendFailure = {
  status?: number
  code: string
  detail: string
  attr?: string
  retryable: boolean
  retry_after?: number
}

export const send = action({
  args: {
    to: v.string(),
    subject: v.string(),
    templateKey: v.string(),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    from: v.optional(v.string()),
    replyTo: v.optional(v.array(v.string())),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    attachments: v.optional(
      v.array(
        v.object({
          filename: v.string(),
          content: v.string(),
          contentType: v.optional(v.string()),
          contentId: v.optional(v.string()),
        })
      )
    ),
    distinctId: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    captureEngagement: v.optional(v.boolean()),
  },
  returns: sentEmail,
  handler: async (_ctx, email) => {
    const htmlOrTextCheckedBySdk = { ...email, integration: `convex/${version}` }
    const { data, error } = await getEmailClient().emails.send(htmlOrTextCheckedBySdk as SendCodeEmailOptions)
    if (error) {
      throw sendFailure(error)
    }
    return { message_id: data.id, replayed: data.replayed }
  },
})

function sendFailure(error: EmailError): ConvexError<EmailSendFailure> {
  const failure: EmailSendFailure = {
    code: error.code,
    detail: error.message,
    retryable: isRetryable(error),
    ...(error.statusCode !== undefined && { status: error.statusCode }),
    ...(error.field !== undefined && { attr: error.field }),
    ...(error.retryAfterMs !== undefined && { retry_after: Math.ceil(error.retryAfterMs / 1000) }),
  }
  return new ConvexError(
    failure.retryable ? failure : { ...failure, [WORKPOOL_NON_RETRYABLE]: true, message: failure.detail }
  )
}

function isRetryable(error: EmailError): boolean {
  switch (error.statusCode) {
    case undefined:
      return error.code === 'network_error'
    case 409:
      return error.code === 'idempotency_key_in_flight'
    case 429:
      return error.code !== 'quota_limited'
    case 503:
      return true
    default:
      return false
  }
}
