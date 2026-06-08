---
'@posthog/mcp': patch
---

First release of `@posthog/mcp` from the posthog-js monorepo. Instrument an MCP server with a single `instrument(server, posthog)` call to auto-capture tool calls, tool listings, initialize, identity, and exceptions to PostHog. BYO `posthog-node` client; `beforeSend` hook; `identify({ distinctId, properties, groups })`; `$mcp_missing_capability`; anonymous sessions sent with `$process_person_profile: false`.
