---
'posthog-js': patch
'@posthog/types': patch
---

Add the `__preview_replay_early_fetch_response` option, which stops Session Replay from holding back streamed fetch responses while it records their body.
