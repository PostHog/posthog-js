---
'posthog-node': minor
---

Added an optional `category` option to `posthog.emails.send()` code sends (`templateKey`), along with the exported `MessageCategory` type and `TRANSACTIONAL_EMAIL_CATEGORY` (`'transactional'`) constant.

- Pass a `MessageCategory` (`{ key, type, name, description? }`) to send marketing or categorized transactional emails from code, honoring recipient opt-outs and unsubscribe requirements for marketing sends.
- Pass `TRANSACTIONAL_EMAIL_CATEGORY` for uncategorized transactional sends, or omit `category` to keep today's default behavior (following any matching PostHog template's category when code-send categories are enabled).
