---
'@posthog/mcp': patch
---

Use an agent-supplied `conversation_id` as the session anchor, so tool calls in one
conversation share a `$session_id` across reconnects, restarts, and per-request server
instances.
