---
'posthog-js': patch
'@posthog/types': patch
---

Add the private `__preview_replay_early_fetch_response` option, which stops Session Replay from holding back streamed fetch responses while it records their body. In WebKit, a request aborted while its body is being read then rejects with a `TypeError` instead of an `AbortError`.
