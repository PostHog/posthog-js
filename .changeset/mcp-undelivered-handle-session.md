---
'@posthog/mcp': patch
---

A conversation handle the agent never received (the tool threw, or its result had no `content` to carry it) no longer sets `$session_id`: the call keeps the session it would have had without one, as the sdk-specs MCP analytics spec requires.
