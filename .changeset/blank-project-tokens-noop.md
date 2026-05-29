---
'posthog-js': patch
'@posthog/ai': patch
'posthog-node': patch
---

Disable/no-op initialization paths instead of throwing or sending requests when PostHog project tokens are missing or blank.
