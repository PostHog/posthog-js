---
'posthog-js': patch
'posthog-node': patch
'@posthog/core': patch
---

Logs and metrics now always send `service.name` and `telemetry.sdk.*`, even when a `resourceAttributes` value is too large to encode in full. Previously that value could crowd them out, and the records reached PostHog with no service attribution.
