---
'@posthog/mcp': patch
---

Use an agent-supplied `conversation_id` as the session anchor, so tool calls in one
conversation share a `$session_id` across reconnects, restarts, and per-request server
instances. Only a handle the SDK could have minted is accepted; a value the agent invented
is replaced with a fresh one, so two callers cannot land in the same session by sending the
same string.
