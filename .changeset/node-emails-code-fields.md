---
'posthog-node': minor
---

Send cc, bcc and attachments with email from code. The SDK uploads each file PostHog doesn't have yet, then sends the email with the files' hashes. An email carries at most 10 files and 40 MB after Base64 encoding, about 29 MB of files.
