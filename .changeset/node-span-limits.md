---
'posthog-node': minor
'@posthog/core': minor
'@posthog/types': minor
---

Cap spans at 128 user attributes, 128 events, and 8192 characters per string attribute value, configurable with `traces.maxAttributesPerSpan`, `traces.maxEventsPerSpan` and `traces.maxAttributeValueLength`. The character bound applies to every string a value contains, including the ones nested inside arrays and objects, and to status messages and resource attributes as well. Once a span has spent its event cap, a small reserve stays available to `exception` events, so a span that fills its events and then throws still carries the exception.
