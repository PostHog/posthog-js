---
'@posthog/mcp': patch
---

Register the synthetic `tools/call` fallback by writing into the server's handler map instead of calling `setRequestHandler`. Instrumenting a low-level `Server` that never declared a `tools` capability no longer fails with `Server does not support tools` and leaves instrumentation half-applied — it now instruments cleanly, and answers a call for a tool no dispatcher claims with `Unknown tool: <name>`. This also removes the last runtime `@modelcontextprotocol/sdk` import from the published bundle; the SDK is now referenced only as a type.
