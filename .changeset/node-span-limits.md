---
'posthog-node': minor
'@posthog/core': minor
'@posthog/types': minor
---

Cap how much a single span can carry: at most 128 user attributes and 128 events by default, configurable with `traces.maxAttributesPerSpan` and `traces.maxEventsPerSpan`. Earlier entries are kept and later ones dropped, with the number dropped reported on the exported span, so one runaway span no longer grows until the ingestion endpoint rejects it and the whole span is lost. Attributes the SDK attaches itself — including `posthogDistinctId` and `sessionId` — are exempt and never evicted, so a span at the cap still links back to its person and session.
