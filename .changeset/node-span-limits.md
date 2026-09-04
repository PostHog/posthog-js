---
'posthog-node': minor
'@posthog/core': minor
'@posthog/types': minor
---

Cap spans at 128 user attributes, 128 events, 128 attributes per event and 8192 characters per string, configurable with `traces.maxAttributesPerSpan`, `traces.maxEventsPerSpan`, `traces.maxAttributesPerEvent` and `traces.maxAttributeValueLength`. The earliest entries are kept, and a span that lost any reports how many as `droppedAttributesCount` and `droppedEventsCount`, as does an event that lost attributes. The event cap is absolute, so an `exception` event the SDK records for you spends an ordinary slot.
