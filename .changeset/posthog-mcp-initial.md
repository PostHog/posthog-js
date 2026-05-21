---
'@posthog/mcp': minor
---

Initial release of `@posthog/mcp` inside the posthog-js monorepo. Ports the previous standalone `@posthog/mcp` SDK onto `@posthog/core`, removes the `posthog-node` runtime dependency and the bring-your-own-client option, drops the `eventTags` callback (use `eventProperties` instead), prefixes every captured PostHog event name with `$` (e.g. `mcp_tool_call` → `$mcp_tool_call`), and removes the SDK-managed `~/posthog-mcp-analytics.log` file in favor of an opt-in `logger` callback option.
