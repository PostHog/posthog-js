---
'@posthog/mcp': patch
---

Capture `$mcp_intent` on servers that build a fresh instance per request, where the `context` argument was previously discarded.

The SDK records the agent's answer to its injected `context` parameter only when it can confirm the parameter is one it injected — a fact learned while serving `tools/list` and cached on the server instance. Where the next request builds a new instance, that instance never served a listing, so the intent of every call was thrown away. The trigger is instance lifetime, not statelessness: a server that is stateless at the transport but keeps one long-lived server object was never affected, and a per-request instance on MCP SDK v1 was affected just as much as on v2.

Reading the argument and removing it are now separate decisions. Stripping still requires positive ownership and fails closed, because deleting an argument the application declared costs the customer their tool call. Reading costs at worst a mislabelled property, so it now happens whenever ownership cannot be resolved.

The trade-off: on such a server, a `context` parameter the application declared itself is recorded as `$mcp_intent`. Set `context: false` to disable injection and capture together, or drop the property in `beforeSend`.
