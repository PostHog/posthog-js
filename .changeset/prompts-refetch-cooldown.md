---
'@posthog/ai': patch
---

Hold a stale prompt in the cache for a cooldown after a failed refetch, instead of going back to the network on every `prompts.get()` call. A rate-limited client now stays on cache until the limit clears. On a 429 the cooldown follows the server's `Retry-After` header.
