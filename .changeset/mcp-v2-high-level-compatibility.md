---
'@posthog/mcp': patch
---

Instrument high-level `McpServer` instances from MCP TypeScript SDK v2, and read request headers from either SDK major.

The compatibility gate required `typeof server.tool === 'function'`. SDK v2 dropped the deprecated `tool()` in favour of `registerTool()`, so every v2 high-level server failed the check — and since `instrument()` catches compatibility failures and returns a working-looking handle, it failed silently: no throw, no warning at the call site, and no `$mcp_*` events at all. The gate now accepts either registration method, and every shape question it asks is answered by a structural probe in the new `detect.ts` rather than by a version or protocol constant.

Opening the gate is also what first sends v2-shaped request context to header reads, so both halves ship together. The SDK's own reads go through a new `getRequestHeaders(extra)`, which takes headers from v2's `ctx.http.req` (a WHATWG `Request`, whose headers only answer to `.get()`) as well as v1's `extra.requestInfo.headers`, and returns a plain lowercase-keyed object either way. It is duck-typed on `.entries` rather than `instanceof Headers`, so a `Headers` from another realm — workerd and other edge runtimes — is read correctly.

`getRequestHeaders` is exported, because `identify`, `intentFallback`, `eventProperties` and `beforeSend` still receive the SDK's `extra` unchanged — we deliberately do not synthesise a v1 `requestInfo` on v2, as a partially faked shape is worse than an absent one. Hosts reading headers in a callback migrate in one line:

```ts
import { getRequestHeaders } from '@posthog/mcp'

identify: async (request, extra) => {
  const auth = getRequestHeaders(extra)?.['authorization']
  // ...
}
```
