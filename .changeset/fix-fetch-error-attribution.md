---
'posthog-js': patch
---

fix(tracing-headers): keep the patched `fetch` wrapper off the stack on rejection so end-user network failures (offline, CORS, DNS) are attributed to the caller instead of unrelated minified SDK frames
