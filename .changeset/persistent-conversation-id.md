---
'@posthog/mcp': patch
---

Tell agents to keep passing the same `conversation_id` across later user messages. The previous wording let ChatGPT treat the handle as scoped to one message's tool calls, so each new message started a new session.
