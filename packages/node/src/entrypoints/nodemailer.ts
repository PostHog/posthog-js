export type * from '../nodemailer/esm-mail-options.mjs'
export { createPostHogTransport } from '../nodemailer/transport'
export type {
  PostHogMailOptions,
  PostHogRefusal,
  PostHogSendError,
  PostHogSentMessageInfo,
  PostHogTransport,
  PostHogTransportOptions,
  PostHogUnsupportedError,
} from '../nodemailer/types'
