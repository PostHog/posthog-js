---
'@posthog/mcp': minor
---

Group stateless ChatGPT tool calls into sessions by ChatGPT's `_meta["openai/session"]` conversation id when a call carries no conversation handle and no transport session. Such calls mint no conversation handle, so servers with `enableConversationId: false` keep session grouping with unchanged tool schemas and results. Every event now records which source grouped it as `$mcp_session_source`.
