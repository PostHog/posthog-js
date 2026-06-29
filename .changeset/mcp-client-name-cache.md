---
'@posthog/mcp': patch
---

Fix `$mcp_client_name` being dropped from every other captured event. `getSessionInfo` cached the client identity but then overwrote the cache with `undefined` on the next event, so consecutive tool calls alternated between carrying and lacking the client name (showing up as a large "other" slice in MCP analytics). The cached client name/version are now reused instead of refetched.
