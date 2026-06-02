---
"@posthog/mcp": minor
---

Use a caller-supplied `posthog-node` client instead of an SDK-managed `@posthog/core` client, matching the `@posthog/ai` pattern. `instrument(server, { posthog })` now takes a `PostHog` instance you construct and own (configure host/token/batching there, and call `posthog.shutdown()` on exit). Removes the `projectToken`, `host`, and `clientOptions` options and the `flush(server)` / `shutdown(server)` helpers. `posthog-node` (>=5) is now a peer dependency.
