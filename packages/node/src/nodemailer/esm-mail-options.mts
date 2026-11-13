import type { PostHogMailOptions } from './types.js'

declare module 'nodemailer/lib/mailer' {
  interface Options {
    /** PostHog's options for this message, read by the transport from `posthog-node/nodemailer`. */
    posthog?: PostHogMailOptions
  }
}
