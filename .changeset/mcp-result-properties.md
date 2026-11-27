---
'@posthog/mcp': minor
---

Add a `resultProperties` option: a callback that receives a context object with the tool name, result, and original request and returns custom properties (reserved `$mcp_*` keys are ignored) to merge into that `$mcp_tool_call` event before `beforeSend`, so hosts can record facts such as a status code or item count without keeping `$mcp_response`
