---
'@posthog/mcp': patch
---

Stop the injected `conversation_id` description from telling agents to hold parallel tool calls until they receive an id. A request that already carries a session never receives one, so agents that followed the old text could make every call one at a time. Agents now wait only for their first call's response.
