---
"posthog-react-native": minor
"posthog-js": patch
"@posthog/types": minor
---

feat: rename `__add_tracing_headers` to `addTracingHeaders` (the `__` prefix was a legacy naming convention for internal/experimental options — the option is now public). `__add_tracing_headers` continues to work as a deprecated alias.

feat(react-native): support `addTracingHeaders` (and the deprecated `__add_tracing_headers`) to inject `X-POSTHOG-DISTINCT-ID` and `X-POSTHOG-SESSION-ID` headers on outgoing `fetch` requests for linking LLM traces and session replays.
