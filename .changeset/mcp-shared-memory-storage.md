---
"@posthog/core": minor
"posthog-node": patch
---

Move `PostHogMemoryStorage` into `@posthog/core` so server-side stateless clients can share one implementation. `posthog-node` now imports it from core instead of its own copy (no behavior change); `@posthog/mcp` reuses the same class.
