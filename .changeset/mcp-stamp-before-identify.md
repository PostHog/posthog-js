---
'@posthog/mcp': patch
---

Attribute `$mcp_tool_call` and `$mcp_initialize` to the client that made the request. Both stamped client identity after awaiting the `identify` callback, so a handshake arriving on the same server instance meanwhile could rename the event; `$mcp_initialize` additionally read the previously handshaked client rather than the one in its own request body.
