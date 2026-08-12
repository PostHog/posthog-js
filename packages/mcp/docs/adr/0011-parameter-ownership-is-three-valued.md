# ADR-0011: Analytics parameter ownership is three-valued

- Status: Accepted. Closes and corrects the process-scoped ownership cache follow-up left open by ADR-0004.
- Date: 2026-08-12

## Context

The SDK injects a `context` property into every advertised tool's `inputSchema` while serving
`tools/list`, so the agent supplies it on each `tools/call`. At call time one question has to be
answered: **is this `context` argument ours, or one the host's own tool declares?**

The answer was learned in the `tools/list` wrapper and cached on the server instance. A stateless
server — `createMcpHandler`, `@rekog/mcp-nest` with `statefulMode: false`, any per-request topology —
builds a fresh instance per HTTP request, so the instance serving a `tools/call` never served a
listing. Ownership read `false`, and `$mcp_intent` was discarded on every call. This affected MCP SDK
v1 as much as v2; v2 only makes per-request instances the norm.

The defect is in the type, not the lookup. `AnalyticsParameterOwnership.context` was a boolean, so it
collapsed two states that call for opposite handling:

| Real state | Old value | Strip it? | Capture it? |
|---|---|---|---|
| We injected it | `true` | yes | yes |
| The host's tool declares it | `false` | no | no |
| We cannot tell | `false` | no | **yes — this was the bug** |

"No idea" and "the host owns it" were indistinguishable, so the answer that is correct for stripping
was also applied to capture, where it is wrong and where being wrong is cheap.

## Decision

**Ownership is three-valued, and the two questions it answers are decided separately.**

- **Reading the argument fails open.** Capture `$mcp_intent` when ownership is *ours* or *unknown*;
  skip only when we positively know the host declared it. The argument arrived because an advertised
  listing asked for it.
- **Removing the argument fails closed.** Strip only on positive ownership. Deleting an argument the
  host declared costs the customer their tool call.

The asymmetry is the decision. Reading a value we should not have costs a mislabelled property inside
the customer's own project, bounded by the existing 2048-character truncation. Deleting a value we
should have kept costs them the call. These are not comparable, so they do not share a gate.

`outputInstructions` keeps failing closed and is **not** resolved this way: writing an undeclared key
into `structuredContent` fails the host's entire tool result under client-side ajv validation
(ADR-0004), which is the breaking direction.

## Correction to ADR-0004

ADR-0004's Consequences closed with *"Open follow-up: a process-scoped ownership cache."*
**Do not build that.** It was measured against SDK v2 to corrupt data: keyed on `_serverInfo`
name/version, two servers sharing a name answer each other's ownership questions. In the reproduction,
one tenant's tool that *declares* `context` as required received `{}` while another tenant's user text
was shipped as `$mcp_intent` — silent argument deletion plus user data crossing tenants, strictly worse
than the missing telemetry it fixes.

A sticky-`host` merge (once any instance observes a tool declaring its own `context`, that verdict is
permanent) narrows the window but does not close it: a process that has never served the declaring
variant's listing still applies the other tenant's verdict and strips. Failing closed on unknown
protects that case unconditionally, which is why ownership resolution — not a shared cache — is the
answer here.

Re-deriving ownership by replaying the host's `tools/list` handler on the call path is also rejected.
On a stateless server "once per instance" means once per *call*, so a listing backed by a database or a
permissions filter is re-run on every tool call; a time-box converts a deadlock into a stall on every
call rather than avoiding it; and a replay that passes no cursor rebuilds only the first page, silently
mis-owning every tool beyond it.

## Consequences

- `$mcp_intent` is captured on stateless servers, on both SDK majors.
- On a server where ownership cannot be resolved, a `context` parameter the **host** declared is
  recorded as `$mcp_intent`. It stays within that project and is truncated like any other intent. Two
  one-line escapes: `context: false` disables injection and capture together, or drop the property in
  `beforeSend`.
- Stripping behaviour is unchanged in every state, so no host tool starts losing an argument.
- Unchanged and pre-existing: on a stateless server the injected `context` is not stripped, so a tool
  registered with a `.strict()` Zod object rejects the call with `-32602`. Measured — the raw-shape and
  plain `z.object()` forms drop unknown keys silently and are unaffected, and all three advertise
  `additionalProperties: false`, so the advertised schema cannot distinguish them. Detection would have
  to read `_def.unknownKeys` off the registered schema, which is reachable only on the high-level path;
  left as a separate follow-up.

## References

- PostHog/posthog-js#4449 (the field report: ownership only learned in the `tools/list` wrapper)
- ADR-0004 (the follow-up this closes), ADR-0002 (`tools/list` analytics affordances)
