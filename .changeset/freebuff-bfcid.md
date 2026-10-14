---
'@posthog/browser-common': patch
'@posthog/core': patch
'posthog-js': patch
---

Capture the Freebuff click identifier (`bfcid`) as a campaign parameter, so it is set on events and as `$initial_bfcid` like every other ad click ID.
