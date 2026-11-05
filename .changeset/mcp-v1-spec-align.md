---
'@posthog/mcp': minor
---

Aligned with the MCP analytics spec: a call to a tool the server never registered now emits `$mcp_unknown_tool` instead of a failed `$mcp_tool_call`, `llm_model` is advertised as optional, the `get_more_tools` and `send_feedback` annotations now declare that they record data, and the injected `context` argument has a shorter description. This changes your published tool definitions; if your server is listed in the ChatGPT or Claude directories, those platforms may re-review the updated tools.
