---
'posthog-node': minor
---

`posthog.emails.send()` can now send email content your code rendered, such as HTML from React Email. Give the email a `templateKey` and a `subject`, and pass `html`, `text` or both.

```ts
const posthog = new PostHog('phc_...', { secretKey: 'phs_...' })

const { data, error } = await posthog.emails.send({
    to: 'user@example.com',
    distinctId: 'user_123',
    templateKey: 'password-reset',
    subject: 'Reset your password',
    html: renderedHtml,
})
if (error) throw error

// 'delivered', 'bounced', ...
const { data: status } = await posthog.emails.get(data.id)
```

You need a project secret API key, the kind that starts with `phs_`. Create one under **Project secret API keys** in your project settings. Set its **Transactional email** scope to Write to send emails, or to Read for a key that only reads statuses. Pass it to the client as `secretKey`. Set `appHost` to your PostHog app URL when you self-host PostHog or send through a reverse proxy.

PostHog records each email's delivery, opens and clicks on the person with that `distinctId`. It groups every email with the same `templateKey`, so you see their metrics and logs in one place. The SDK retries a request that hits a network error, a rate limit or an outage twice by default. Every send carries an idempotency key, so a retry never sends the email twice. Pass your own `idempotencyKey`, such as `welcome:user_123`, and your job runner's retries are safe too.

A send with your own content also takes `from`, `replyTo` and `captureEngagement: false`. Set `migratedFrom` on the client to tell PostHog which email provider you moved from. A failed call returns an `EmailError` with PostHog's `code` and the HTTP `statusCode`.

Docs: [Send transactional emails with Node.js](https://posthog.com/docs/workflows/transactional-emails/node) and the [transactional email overview](https://posthog.com/docs/workflows/transactional-emails).
