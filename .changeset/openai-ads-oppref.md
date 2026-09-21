---
'@posthog/browser-common': patch
'@posthog/core': patch
---

Capture the OpenAI Ads click identifier (`oppref`) as a campaign parameter, so it is set on events and as `$initial_oppref` like every other ad click ID.
