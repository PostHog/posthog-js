---
"posthog-js": patch
"@posthog/core": minor
"@posthog/types": minor
---

refactor: rename `__add_tracing_headers` to `addTracingHeaders`. The `__` prefix signalled an internal/experimental option, but the config is a public API (documented for linking LLM traces to session replays). `__add_tracing_headers` continues to work as a deprecated alias on the browser SDK.

Also exposes `patchFetchForTracingHeaders` from `@posthog/core` so non-browser SDKs can reuse the implementation.
