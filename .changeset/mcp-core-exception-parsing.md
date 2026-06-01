---
"@posthog/mcp": minor
---

Reuse `@posthog/core`'s shared error-tracking parser for `$exception` events instead of a bespoke V8 stack parser (removes ~850 lines). `$exception` events now carry the standard `$exception_list` / `$exception_level` properties (the same contract every other PostHog SDK emits) rather than the flat `$exception_message` / `$exception_type` / `$exception_stacktrace` fields, so MCP tool failures group and symbolicate like any other PostHog error.
