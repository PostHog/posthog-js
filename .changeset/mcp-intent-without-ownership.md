---
'@posthog/mcp': patch
---

Capture `$mcp_intent` on stateless servers, where the `context` argument was previously discarded.

The SDK injects a `context` parameter into `tools/list` and records the agent's answer as `$mcp_intent`. It only did so when it could confirm the parameter was one it had injected, and that confirmation is learned while serving `tools/list` and cached on the server instance. A stateless server — `createMcpHandler`, `@rekog/mcp-nest`, any per-request topology — builds a fresh instance for every HTTP request, so the instance handling `tools/call` never served a listing, ownership read false, and the intent of every call was thrown away. This affected MCP SDK v1 as much as v2; v2 only makes per-request instances the norm.

Reading the argument and removing it are now separate decisions. Removing an argument the application declared costs the customer their tool call, so stripping still requires positive ownership and fails closed. Reading costs at worst a mislabelled property, so it now happens whenever ownership cannot be resolved — the argument only arrived because an advertised listing asked for it.

Ownership, where it *can* be resolved, is still obeyed: a tool that declares its own `context` parameter on a server we can inspect has that value left alone, exactly as before.

The trade-off, worth knowing: on a server where ownership cannot be resolved, a `context` parameter the application declared itself will now be recorded as `$mcp_intent`. It stays within that project — nothing is shared between servers — and it is capped at 2048 characters like any other intent. Set `context: false` to disable injection and capture together, or drop the property in `beforeSend`.
