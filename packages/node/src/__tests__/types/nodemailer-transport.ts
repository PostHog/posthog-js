import nodemailer from 'nodemailer'

import { PostHog } from '../../entrypoints/index.node'
import {
  createPostHogTransport,
  type PostHogMailOptions,
  type PostHogSentMessageInfo,
} from '../../entrypoints/nodemailer'

const client = new PostHog('phc_test', { secretKey: 'phs_test' })
const transporter = nodemailer.createTransport(createPostHogTransport({ client, defaultTemplateKey: 'transactional' }))

const posthog: PostHogMailOptions = { distinct_id: 'user_42', idempotency_key: 'order-981-shipped' }

export const sent: Promise<string> = transporter
  .sendMail({ to: 'ana@example.com', subject: 'Hi', text: 'Hi', posthog })
  .then((info) => info.messageId)

// createTransport takes the PostHog transport, not SMTP options, so a send resolves to PostHog's info only
export const info: Promise<PostHogSentMessageInfo> = transporter.sendMail({ to: 'ana@example.com', text: 'Hi' })
export const smtpOnly = transporter.sendMail({ to: 'ana@example.com', text: 'Hi' }).then((sentInfo) =>
  // @ts-expect-error a PostHog send has no SMTP fields
  sentInfo.accepted.map(String)
)

export const wrongOptions: PostHogMailOptions[] = [
  // @ts-expect-error the PostHog options keep the API's names
  { distinctId: 'user_42' },
  // @ts-expect-error capture_engagement is a boolean
  { capture_engagement: 'yes' },
]
