---
'posthog-node': minor
---

The code form of `posthog.emails.send()` takes `cc`, `bcc` and `attachments`. `cc` and `bcc` take one address or a list. An attachment is an object whose `content` is a Buffer, a Uint8Array or a Base64 string, and anything else returns an `invalid_attachment` error. A Resend attachment with a `path` returns an `invalid_attachment` error, because PostHog can't fetch files, and so does an attachment key the SDK doesn't send. A send with `templateId` refuses these fields before it makes a request. A PostHog server that doesn't take one of these fields yet refuses the send with an `invalid_request` error on that field, instead of sending without it.
