---
'@posthog/mcp': patch
---

Support MCP TypeScript SDK v2 servers, which `instrument()` previously turned into a silent no-op. The high-level compat check now accepts `registerTool()` alongside v1's removed `tool()`; the `setRequestHandler` patch reads v2's string method names as well as v1's Zod schemas, so handlers bound after `instrument()` are wrapped instead of replacing the wrapper; and request headers are read from v2's `extra.http.req` as well as v1's `extra.requestInfo`, without which every stateless v2 server lost its session token and reported fragmented sessions and anonymous events.

Tool argument ownership is now cached per server identity for the process rather than per server instance, so a per-request server — where `tools/list` lands on one instance and `tools/call` on another — records the injected `context` argument as `$mcp_intent` and strips it before the tool, instead of passing it to a tool that never declared it.

If your `identify` or `intentFallback` reads headers off `extra.requestInfo.headers`, add the v2 shape (`extra.http.req.headers.get(...)`) — the v1 shape silently yields `undefined` there.
