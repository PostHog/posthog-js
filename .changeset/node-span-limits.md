---
'posthog-node': minor
'@posthog/core': minor
'@posthog/types': minor
---

Cap spans at 128 user attributes, 128 events (plus a small reserve for exception events), and 8192 characters per string, configurable with `traces.maxAttributesPerSpan`, `traces.maxEventsPerSpan` and `traces.maxAttributeValueLength`.
