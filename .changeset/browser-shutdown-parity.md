---
"posthog-js": patch
"@posthog/types": patch
---

feat(web): add a graceful `shutdown()` to the browser client for parity with posthog-node, so isomorphic teardown code (e.g. the Nuxt module) that calls `posthog.shutdown()` on the client no longer throws `TypeError: shutdown is not a function`. It best-effort flushes the queued events and always resolves.
