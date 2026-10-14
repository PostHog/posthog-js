---
'posthog-node': patch
'@posthog/ai': patch
---

`privacyMode: true` set on a `PostHog` client now redacts AI input and output content, instead of only working when passed per call.
