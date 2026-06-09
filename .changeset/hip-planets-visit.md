---
'@posthog/core': patch
'posthog-node': patch
---

Add an internal event-channel mechanism so `$ai_*` events can be routed to a dedicated capture endpoint in their own batch, independent of analytics events. Gated behind the unstable, internal-only `_internal_dedicatedAiEndpoint` option on `posthog-node` — not ready for general use.
