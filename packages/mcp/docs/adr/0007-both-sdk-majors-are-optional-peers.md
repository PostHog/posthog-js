# ADR-0007: Both SDK majors are optional peers, and no SDK types ship in our declarations

- Status: Accepted
- Date: 2026-08-07

## Context

`@modelcontextprotocol/sdk` (v1) was a **required** peer dependency. Once v2 shipped under different package names, a project built on `@modelcontextprotocol/server` that installed `@posthog/mcp` had npm auto-install the entire v1 SDK it will never load — measured at 87 packages where 1 was wanted — and any tooling that walks the dependency tree reported the peer as missing whenever it was absent.

Neither major is required at runtime: server shapes are detected structurally (ADR-0005) and no `@modelcontextprotocol/*` package is imported in shipped code.

Making the peer optional exposed a second half of the same problem. The published declarations still imported `CallToolResult` and `ListToolsResult` from `@modelcontextprotocol/sdk/types.js`, so a consumer that legitimately had no v1 SDK hit `TS2307` under `tsc` without `skipLibCheck` — an install that runs fine and will not compile. Reproduced against a project with only `@modelcontextprotocol/server@2.0.0` installed: two errors, from `dist/types.d.ts` and `dist/extensions/tools.d.ts`.

## Decision

Both majors are declared as peers and both are marked `optional` in `peerDependenciesMeta`. v2 also joins `devDependencies`, pinned `~2.0.0` to match the existing `~1.29.0` on v1 — patch-only for both, because this package duck-types SDK internals (`_requestHandlers`, `_registeredTools`, `_serverInfo`) that carry no semver guarantee, so adopting a new minor should be a reviewed commit rather than install-time drift.

The MCP wire shapes are declared structurally in `src/types.ts` rather than imported:

- Shapes we **read** are open-ended and fully optional, so a value typed by either major assigns to them.
- What we **return** is typed precisely, because that is the direction that breaks callers silently — `getMoreToolsResult()` must stay assignable to the SDK's own `CallToolResult`, which `report-missing.test.ts` asserts at compile time.

`sdk-import-boundary.test.ts` is widened from "no runtime reference" to "no reference at all, not even type-only", since a type-only import survives into the published `.d.ts`.

## Consequences

- A v1 consumer is unaffected: they already install the SDK explicitly, because they construct the server with it.
- Our types assert less than the SDK's. A change in an SDK field we do not model cannot break a consumer's build through us — and cannot warn them either.
- Verifying this needs a consumer-shaped check (install a tarball into a project with only the other major, type-check without `skipLibCheck`); the workspace's own build cannot see it, because both majors are present here.

## References

- PostHog/posthog-js#4464 (this change), ADR-0005
