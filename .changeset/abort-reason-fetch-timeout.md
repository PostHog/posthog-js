---
'posthog-js': patch
---

Exception autocapture: posthog-js's own fetch timeout now aborts with an explicit, descriptive reason (`PostHog request timed out after <n>ms`) instead of a reason-less `DOMException: AbortError: signal is aborted without reason`. This keeps `name === 'AbortError'` so existing timeout handling (e.g. feature flag timeout detection) is unchanged, but makes our own timeouts identifiable and stops them being re-captured as noise by console-error exception autocapture.
