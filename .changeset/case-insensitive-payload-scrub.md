---
'posthog-js': patch
---

Session replay network body redaction now matches deny-listed words case-insensitively as whole identifier words, so keys like `Password`, `refreshToken` and `authorization` are redacted while `author`, `isAuthenticated` and `nextPageToken` are recorded.
