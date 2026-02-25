---
'@posthog/ai': patch
---

Add `$ai_tokens_source` property ("sdk" or "passthrough") to all `$ai_generation` events to detect when token values are externally overridden via `posthogProperties`
