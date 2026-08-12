---
'@posthog/mcp': patch
---

Capture `$mcp_intent` on stateless servers, where the `context` argument was previously discarded.

The SDK records the agent's answer to its injected `context` parameter only when it can confirm the parameter is one it injected — a fact learned while serving `tools/list` and cached on the server instance. A stateless server builds a fresh instance per HTTP request, so the instance handling `tools/call` never served a listing, and the intent of every call was thrown away. This affected MCP SDK v1 as much as v2.

Reading the argument and removing it are now separate decisions. Stripping still requires positive ownership and fails closed, because deleting an argument the application declared costs the customer their tool call. Reading costs at worst a mislabelled property, so it now happens whenever ownership cannot be resolved.

The trade-off: on such a server, a `context` parameter the application declared itself is recorded as `$mcp_intent`. Set `context: false` to disable injection and capture together, or drop the property in `beforeSend`.
