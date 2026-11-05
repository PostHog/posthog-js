---
'posthog-node': minor
---

Send Nodemailer mail through PostHog with the new `posthog-node/nodemailer` entry point: `nodemailer.createTransport(createPostHogTransport({ client }))`. Every `sendMail` call stays as it is, and `sendMail({ posthog: { ... } })` takes PostHog's options. A message PostHog can't carry fails with `code: 'EPOSTHOGUNSUPPORTED'` and sends nothing.
