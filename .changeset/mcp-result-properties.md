---
'@posthog/mcp': minor
---

Add a `resultProperties` option: a callback that receives each tool's name and result and returns properties to merge into that `$mcp_tool_call` event before `beforeSend`, so hosts can record facts such as a status code or item count without keeping `$mcp_response`
