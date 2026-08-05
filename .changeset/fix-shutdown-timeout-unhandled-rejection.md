---
'@posthog/core': patch
'posthog-node': patch
---

Throw a real `Error` (not a bare string) when `shutdown()` times out, and fix the `IPostHog.shutdown()` type to return `Promise<void>` instead of `void`. The bare string previously escaped `instanceof Error` checks and, combined with the incorrect `void` return type, could leave the rejection unhandled and crash the process.
