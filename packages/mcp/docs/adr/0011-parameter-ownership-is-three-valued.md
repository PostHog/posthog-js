# ADR-0011: Analytics parameter ownership is three-valued

- Status: Accepted. Closes and corrects the process-scoped ownership cache follow-up left open by ADR-0004.
- Date: 2026-08-12

## Context

The SDK injects a `context` property into every advertised tool's `inputSchema` while serving
`tools/list`, so the agent supplies it on each `tools/call`. At call time one question has to be
answered: **is this `context` argument ours, or one the host's own tool declares?**

The answer was learned in the `tools/list` wrapper and cached on the server instance. Where the next
request builds a *new* instance — `createMcpHandler`, or `@rekog/mcp-nest` in its stateless mode
(`statelessMode: true` on 1.x, `statefulMode: false` on 2.x) — the instance serving a `tools/call`
never served a listing. Ownership read `false`, and `$mcp_intent` was discarded on every call.

The trigger is **instance lifetime, not statelessness**: a server that is stateless at the transport
(`sessionIdGenerator: undefined`) but keeps one long-lived server object caches ownership fine and was
never affected. Nor is it specific to the 2026-07-28 revision — a per-request instance on MCP SDK v1
was affected identically; v2 only makes that topology the norm, being the only one that can serve the
new revision.

The defect is in what the answer could express, not in the lookup.
`AnalyticsParameterOwnership.context` was a boolean, so it collapsed two states that call for
opposite handling:

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

**How it is represented.** `AnalyticsParameterOwnership.context` stays a boolean and keeps meaning
exactly what it did — *we injected this, so it is safe to strip*. The third state is carried
alongside it, as `contextOwnershipKnown` on the request-scoped `ActiveAnalyticsParameterOwnership`.
Deliberately additive rather than a `ParameterOwner` union: every existing strip site reads the
boolean and needed no edit, so the change cannot alter stripping by accident, and the diff shows that
on its face. Only intent resolution reads the new flag.

## Correction to ADR-0004

ADR-0004's Consequences closed with *"Open follow-up: a process-scoped ownership cache."*
**Do not build that.** It corrupts data by construction: keyed on `_serverInfo` name/version, two
servers sharing a name answer each other's ownership questions. A host tool that declares `context`
as required then has that argument stripped and receives `{}`, while the user's text is shipped as
the other server's `$mcp_intent` — silent argument deletion plus user data crossing tenants, strictly
worse than the missing telemetry it fixes.

A sticky-`host` merge (once any instance observes a tool declaring its own `context`, that verdict is
permanent) narrows the window but does not close it: a process that has never served the declaring
variant's listing still applies the other tenant's verdict and strips. Failing closed on unknown
protects that case unconditionally, which is why ownership resolution — not a shared cache — is the
answer here.

Re-deriving ownership by replaying the host's `tools/list` handler on the call path is also rejected.
Where instances are per-request, "once per instance" means once per *call*, so a listing backed by a database or a
permissions filter is re-run on every tool call; a time-box converts a deadlock into a stall on every
call rather than avoiding it; and a replay that passes no cursor rebuilds only the first page, silently
mis-owning every tool beyond it.

## Consequences

- `$mcp_intent` is captured on per-request instances, on both SDK majors.
- On a server where ownership cannot be resolved, a `context` parameter the **host** declared is
  recorded as `$mcp_intent`. It stays within that project and is truncated like any other intent. Two
  one-line escapes: `context: false` disables injection and capture together, or drop the property in
  `beforeSend`.
- Stripping behaviour is unchanged in every state, so no host tool starts losing an argument.
- Unchanged and pre-existing: where ownership is unresolved the injected `context` is not stripped, so a tool
  registered with a `.strict()` Zod object rejects the call with `-32602`. The raw-shape and plain
  `z.object()` forms drop unknown keys silently and are unaffected. All three advertise
  `additionalProperties: false`, so the advertised schema cannot tell them apart; detection would have
  to read `_def.unknownKeys` off the registered schema, which is reachable only on the high-level path.
  Left as a separate follow-up.

## References

- PostHog/posthog-js#4449 (the field report: ownership only learned in the `tools/list` wrapper)
- PostHog/posthog-js#4502 (this change)
- ADR-0004 (the follow-up this closes), ADR-0002 (`tools/list` analytics affordances)
