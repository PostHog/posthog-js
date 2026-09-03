---
'posthog-js': patch
---

Initialize the Segment enrichment integration when Segment is configured through `set_config`, so Segment events include PostHog properties such as active feature flags.
