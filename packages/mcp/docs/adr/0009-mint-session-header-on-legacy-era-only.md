# ADR-0009: Mint `Mcp-Session-Id` on 2025-11-25 requests, never on 2026-07-28

- Status: Accepted. Closes the era-gating follow-up left open by ADR-0003.
- Date: 2026-08-07

## Context

ADR-0003 mints the `Mcp-Session-Id` response header at `initialize` as a self-encoded token, so a stateless deployment keeps one session and its client identity across pods. The 2026-07-28 revision removes protocol-level sessions outright: a server **MUST NOT** mint or echo that header under it.

We complied, but only by accident. The mint hangs off the `initialize` handler and 2026-07-28 has no handshake, so the code was never reached — spec compliance rested on an SDK routing detail rather than on anything we check, and a host routing an initialize-shaped request over a modern connection would have been answered with a header the revision forbids. The testbed's "no `Mcp-Session-Id` on a 2026-era response" assertion passed for that wrong reason.

Dropping the mechanism entirely was considered. It was rejected because it is the only session story a v2 operator gets by default: `enableConversationId` (ADR-0004) stays opt-in, so removing the mint too would leave every v2 deployment with fragmented sessions on **both** revisions out of the box.

## Decision

Minting is gated on the revision **the request declares**, resolved through the same per-request chain as identity (ADR-0008): the version an `initialize` body asks for, else envelope → `_meta` → `MCP-Protocol-Version` header.

- Any revision **at or after** `2026-07-28` is treated as sessionless. Revisions sort as ISO dates, so a future one is modern by default — sessions were removed, not re-added.
- An **unknown** version counts as legacy. A client that declares nothing is on a transport that has always carried a session header, and taking it away would be the regression this guard exists to prevent.
- The gate lives in the session layer, not in the handler, so the policy is stated once.

## Consequences

- We knowingly carry a mechanism the newer revision deleted, for as long as clients keep taking the legacy leg. It retires itself: as they migrate, fewer requests reach it and it goes quiet with no deprecation project.
- Compliance is now a property we assert rather than one we inherit from where the call happens to sit. It is also testable in isolation, which the previous arrangement was not.
- No testbed cell moves. The assertion it protects already passed — the change is *why* it passes, which is the kind of fix that has to be argued rather than measured.

## References

- PostHog/posthog-js#4466 (this change), ADR-0003, ADR-0004, ADR-0008
