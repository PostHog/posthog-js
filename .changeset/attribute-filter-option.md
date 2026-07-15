---
'@posthog/rrweb': minor
'@posthog/types': minor
'posthog-js': minor
---

feat: add `session_recording.attributeFilter` option that passes an attribute allowlist through to the native MutationObserver, so mutations to unlisted attributes (e.g. animation-driven inline `style` churn) never cost recording CPU (port of upstream rrweb #1873)
