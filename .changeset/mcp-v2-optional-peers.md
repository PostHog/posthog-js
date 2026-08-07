---
'@posthog/mcp': patch
---

Install and type-check cleanly on a project that has only MCP SDK v2.

`@modelcontextprotocol/sdk` (v1) was a required peer, so installing `@posthog/mcp` into a project built on `@modelcontextprotocol/server` (v2) pulled the entire v1 SDK in as an auto-installed peer — 87 packages where 1 was wanted — and tooling that walks the dependency tree reported it as missing when it was absent. Both majors are now declared and both are optional, which is what the code has always assumed: no `@modelcontextprotocol/*` package is imported at runtime, and server shapes are detected structurally.

Making the peer optional exposed a second half of the same problem. The published type declarations still imported `CallToolResult` and `ListToolsResult` from `@modelcontextprotocol/sdk/types.js`, so a consumer without the v1 SDK hit `TS2307` on an install that otherwise worked — fine at runtime, broken under `tsc` without `skipLibCheck`. Those MCP wire shapes are now declared structurally in `types.ts` too.

The shapes we read are open-ended, so a value typed by either SDK assigns to them. What the package hands back is typed precisely and stays assignable to the SDK's own `CallToolResult`, so `getMoreToolsResult()` can still be returned straight from a tool callback.
