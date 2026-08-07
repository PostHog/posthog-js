---
'@posthog/mcp': patch
---

Support MCP TypeScript SDK v2 servers, which `instrument()` previously turned into a silent no-op. The high-level compatibility check now accepts `registerTool()` alongside v1's removed `tool()`; the `setRequestHandler` patch reads v2's string method names as well as v1's Zod schemas, so handlers bound after `instrument()` are wrapped instead of replacing the wrapper; and request headers are read from v2's `extra.http.req` as well as v1's `extra.requestInfo`, without which a stateless v2 server could not read the session token it was sent and reported fragmented sessions and anonymous events.

The patched `setRequestHandler` now forwards every argument, so v2's three-argument form for custom methods — `setRequestHandler(method, { params, result }, handler)` — keeps working on an instrumented server instead of throwing `handler is required`.

If your `identify` or `intentFallback` reads headers off `extra.requestInfo.headers`, add the v2 shape (`extra.http.req.headers.get(...)`) — the v1 shape resolves to `undefined` there, which silently sends every event anonymous. `extra.http.req.headers` is typed for this.
