---
'posthog-js': patch
---

Segment integration: stop leaking PostHog's internal `$sdk_debug_*` telemetry onto enriched Segment events. Because the integration runs as a Segment enrichment plugin, these properties were fanned out to every destination, not just PostHog. They now stay in PostHog's own capture pipeline.
