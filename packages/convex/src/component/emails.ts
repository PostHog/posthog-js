import { EmailError, type EmailErrorName, type SendCodeEmailOptions, type SendEmailResponse } from 'posthog-node/edge'
import { ConvexError, v, type Infer, type ObjectType } from 'convex/values'
import { emailArgs } from '../shared/emailArgs.js'
import { action } from './_generated/server.js'
import { getEmailClient } from './lib.js'
import { version } from './version.js'

const WORKPOOL_NON_RETRYABLE = '__convexWorkpoolNonRetryable'
const COOLDOWN_BUDGET_MS = 5 * 60_000
const INTEGRATION = `convex/${version}`

const queuedEmailArgs = { ...emailArgs, idempotencyKey: v.string() }

type EmailArgs = ObjectType<typeof emailArgs>

const sentEmail = v.object({ message_id: v.string(), replayed: v.boolean() })

export type SentEmail = Infer<typeof sentEmail>

/** The `data` of the `ConvexError` that a failed send throws. Retry only when `retryable`, with the same idempotency key. */
export type EmailSendFailure = {
  status?: number
  code: string
  /** A coarse category of the failure, for code that branches on the kind of failure rather than the exact `code`. */
  name: EmailErrorName
  detail: string
  attr?: string
  why?: string
  fix?: string
  docs_url?: string
  retryable: boolean
  retry_after?: number
}

/** Sends the email once. A failure throws at once, with `retry_after` when PostHog asked to wait. */
export const send = action({
  args: emailArgs,
  returns: sentEmail,
  handler: async (_ctx, email) => sentOrThrown(await sendToPostHog(email)),
})

/**
 * Sends the email for a retrying queue, with the key the queue made, so every attempt sends at most once. When
 * PostHog asks to wait, waits it out and sends again, so the queue's own short backoff doesn't spend its attempts
 * during the wait. A wait that ends past five minutes stops the queue at once, without sending before it ends.
 */
export const sendQueued = action({
  args: queuedEmailArgs,
  returns: sentEmail,
  handler: async (_ctx, email) => {
    const deadline = Date.now() + COOLDOWN_BUDGET_MS
    for (;;) {
      const reply = await sendToPostHog(email)
      const { error } = reply
      const wait = error ? cooldown(error) : undefined
      if (!error || wait === undefined) {
        return sentOrThrown(reply)
      }
      if (Date.now() + wait > deadline) {
        throw sendFailure(error, { queueStopsFor: email.idempotencyKey })
      }
      await sleep(wait)
    }
  },
})

function sendToPostHog(email: EmailArgs): Promise<SendEmailResponse> {
  const htmlOrTextCheckedBySdk = { ...email, integration: INTEGRATION }
  return getEmailClient().emails.send(htmlOrTextCheckedBySdk as SendCodeEmailOptions)
}

function sentOrThrown({ data, error }: SendEmailResponse): SentEmail {
  if (error) {
    throw sendFailure(error)
  }
  return { message_id: data.id, replayed: data.replayed }
}

function cooldown(error: EmailError): number | undefined {
  return isRetryableLikePostHogNode(error) && error.retryAfterMs ? error.retryAfterMs : undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sendFailure(
  error: EmailError,
  { queueStopsFor }: { queueStopsFor?: string } = {}
): ConvexError<EmailSendFailure> {
  const failure: EmailSendFailure = {
    code: error.code,
    name: error.name,
    detail: error.message,
    retryable: isRetryableLikePostHogNode(error),
    ...(error.statusCode !== undefined && { status: error.statusCode }),
    ...(error.field !== undefined && { attr: error.field }),
    ...(error.why !== undefined && { why: error.why }),
    ...(error.fix !== undefined && { fix: error.fix }),
    ...(error.docsUrl !== undefined && { docs_url: error.docsUrl }),
    ...(error.retryAfterMs !== undefined && { retry_after: Math.ceil(error.retryAfterMs / 1000) }),
  }
  if (failure.retryable && queueStopsFor === undefined) {
    return new ConvexError(failure)
  }
  const message =
    queueStopsFor === undefined
      ? failure.detail
      : `${failure.detail} PostHog asked to wait ${failure.retry_after}s, which ends more than five minutes after ` +
        `this attempt began, so the queue stopped. Send the email again after that, with idempotencyKey ${queueStopsFor}.`
  return new ConvexError({ ...failure, [WORKPOOL_NON_RETRYABLE]: true, message })
}

function isRetryableLikePostHogNode(error: EmailError): boolean {
  if (error.statusCode === undefined) {
    return error.code === 'network_error'
  }
  if (error.code === 'attachment_upload_failed') {
    return error.statusCode === 429 || error.statusCode >= 500
  }
  if (error.statusCode === 409) {
    return error.code === 'idempotency_key_in_flight'
  }
  if (error.statusCode === 429) {
    return error.code !== 'quota_limited' && error.code !== 'upload_quota_exceeded'
  }
  return error.statusCode === 503
}
