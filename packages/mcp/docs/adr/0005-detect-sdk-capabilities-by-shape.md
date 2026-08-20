# ADR-0005: Detect SDK capabilities by object shape, never by version

- Status: Accepted
- Date: 2026-08-07

## Context

There are now two MCP TypeScript SDK majors in the wild under different package names — `@modelcontextprotocol/sdk` v1 and `@modelcontextprotocol/{core,server,client}` v2 — and a consumer installs whichever one they use. They disagree about the API surface this package depends on: v2's `McpServer` dropped the deprecated `tool()` and kept only `registerTool()`, `setRequestHandler` takes a method string rather than a Zod schema, and the per-request `extra` became a `ctx` carrying a WHATWG `Request`.

The compatibility gate asserted `typeof server.tool === 'function'`, so every v2 high-level server failed it. Because `instrument()` catches compatibility failures and returns a working-looking handle, it failed *silently*: no throw, no console warning, and no `$mcp_*` events at all. It was reported from the field as "the integration looks healthy while `$mcp_*` events stop entirely" (PostHog/posthog-js#4449).

Version-based branching was considered and rejected. It answers the wrong question twice over: the same capability appears under different *names* rather than at different versions, and protocol revision is a property of each **request**, not of the installed package — v2's exported `LATEST_PROTOCOL_VERSION` still reads `2025-11-25` while the same server serves `2026-07-28` traffic (see ADR-0008).

## Decision

Every question about what a server object can do is answered by a structural probe over that object, in `src/extensions/detect.ts`. `compatibility.ts` delegates to those probes instead of testing properties inline.

- A capability check accepts **any** shape that provides it: `canRegisterTools()` is satisfied by `registerTool()` or `tool()`.
- Probes take `unknown` and duck-type. Nothing imports an SDK type to describe an SDK object.
- No shipped code references any `@modelcontextprotocol/*` package, at runtime or as a type — pinned by `sdk-import-boundary.test.ts` (see ADR-0007).

## Consequences

- Supporting a third shape is a probe, not a branch: the gate stays flat as the SDKs diverge.
- A capability we probe for but never use is a lie that will eventually reject a valid server. Probes are added when something reads the thing they describe, not defensively.
- The probes assert less than the SDK's own types would. That is deliberate — they describe what this package actually touches, so an SDK changing anything else cannot reject a server that still works.
- `instrument()` still swallows compatibility failures. This ADR removes today's trigger, not the silence; making a rejection loud is a separate, deliberate behaviour change.

## References

- PostHog/posthog-js#4449 (field report), #4462 (this change), #4450 and #4461 (the dispatch prerequisites)
