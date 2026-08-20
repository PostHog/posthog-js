---
'posthog-js': patch
---

Warn with an actionable message when a custom `api_host` proxy does not return the remote config from `/array/{token}/config`, so users learn to add the missing `/array` proxy rule instead of silently losing session recordings.
