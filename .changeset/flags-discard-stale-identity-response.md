---
'@posthog/core': patch
---

Fixed feature flags from one user being stored for the next when `reset()` or `identify()` ran while a flags request was in flight. The response was evaluated for the previous distinct id, yet it was persisted and emitted under the new one until the queued reload answered, or indefinitely if that reload failed. The SDK now discards the flags from such a response and keeps only its project-level config.
