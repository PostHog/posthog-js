---
'posthog-js': patch
---

Session replay network body redaction now matches deny-listed words case-insensitively, so keys like `Password` or `AccessToken` are redacted.
