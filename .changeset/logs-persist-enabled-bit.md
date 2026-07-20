---
'posthog-js': patch
---

Console log capture now persists its remote-enabled state, so on repeat visits it starts loading at init instead of waiting for remote config, capturing more early startup logs.
