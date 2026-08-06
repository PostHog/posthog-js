---
'@posthog/mcp': patch
---

Deliver the `conversation_id` session handle on errored tool results, and inject it into
the virtual `get_more_tools` tool. A first call that fails no longer sends the agent's
retry into a different conversation, and a reported capability gap now groups with the
work that hit it.
