---
'posthog-node': minor
---

The code form of `posthog.emails.send()` takes `cc`, `bcc`, `headers`, `tags` and `attachments`. An attachment's `content` is a Buffer, a Uint8Array or a Base64 string. A Resend attachment with a `path` returns an `invalid_attachment` error, because PostHog can't fetch files.
