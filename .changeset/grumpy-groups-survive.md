---
'posthog-node': patch
'@posthog/mcp': patch
---

Stop dropping `$groups` on events that pass groups via `properties.$groups`
(fixes #3888): posthog-node no longer overwrites a set `$groups` with the
top-level `groups` when none is provided, and the MCP analytics sink forwards
groups as a first-class `groups` field.
