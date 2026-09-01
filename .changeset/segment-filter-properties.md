---
'posthog-js': patch
'@posthog/types': patch
---

Segment integration: allow `segment` to accept an integration config with `filterProperties`, so customers can filter PostHog-generated enrichment properties before Segment sends an event to its destinations. Returning `null` or throwing leaves the original Segment event unenriched.
