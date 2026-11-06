---
'@posthog/mcp': minor
---

Aligned with the MCP analytics spec: a call to a tool the server never registered now emits `$mcp_unknown_tool` instead of a failed `$mcp_tool_call`, `llm_model` is advertised as optional, the `get_more_tools` and `send_feedback` annotations now declare that they record data, and the injected `context` argument has a shorter description. To tell an unknown tool from a failing one, a rejected call may now look the name up. On a server that dispatches tools outside the MCP SDK's registry (such as `@rekog/mcp-nest`), each failed call runs your `tools/list` handler once. On a low-level server, `resolveOriginalTool` returning `undefined` now marks a failing call as an unknown tool, so return a tool for every name your server serves. This changes your published tool definitions; if your server is listed in the ChatGPT or Claude directories, those platforms may re-review the updated tools.
