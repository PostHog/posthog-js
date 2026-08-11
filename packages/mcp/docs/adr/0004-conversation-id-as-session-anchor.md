# ADR-0004: `conversation_id` is the session anchor for the stateless MCP revision

- Status: Accepted
- Date: 2026-08-06 (backfilled; shipped 2026-07/08 in PostHog/posthog-js#4428 and companions)

## Context

The MCP **2026-07-28** revision removes protocol-level sessions: no `initialize` handshake, no `Mcp-Session-Id` header (SEP-2575 / SEP-2567). Every session id the SDK could previously produce comes from the transport, and all of them die on reconnect, restart, or a per-request server instance. The spec's own guidance for state across calls is an explicit handle: *"returning an explicit handle from a creation tool and accepting that handle as an argument on subsequent calls."*

The SDK already had that handle built but inert: `enableConversationId` injects a `conversation_id` parameter and prompts the agent to echo it. Only the agent survives the whole conversation, so only the agent can carry the session.

## Decision

When the agent supplies a `conversation_id`, `$session_id` is derived from it — outranking the session token (ADR-0003) and the transport id.

The load-bearing details:

- **Deterministic, unsalted hash.** Two pods that never met must agree on the session, and this revision leaves them no shared state to agree through. The derivation (`deterministicPrefixedId('ses', conversationId)`) is therefore the **cross-SDK contract**: posthog-python must reproduce it byte for byte or a conversation splits by serving SDK.
- **Hashed, not verbatim.** A bare uuidv7 as `$session_id` would land in the Session Replay namespace and render a "View recording" button that resolves to nothing. `$mcp_conversation_id` still carries the raw handle for joins.
- **Only echoes of our own mint are trusted.** A supplied handle is accepted only if shaped like a uuidv7 (lowercased — some hosts uppercase uuids, and the hash is case-sensitive); anything else is treated as absent: mint fresh, prompt back. Deterministic derivation means two callers sending the same string share a session, and agents that ignore instructions invent colliding strings (`conv-1`, `1`), not conforming uuidv7s. Residual risk — two callers echoing the *same* well-formed uuidv7 — is accepted: closing it needs a signed handle (a shared secret on every pod), and `$session_id` is an analytics grouping key, not security-bearing.
- **Never persisted.** The handle belongs to one request; the resolution path returns before the shared-state writes, because persisting it would leak one chat's session onto a concurrent chat's `tools/list`.
- **Prompt-back rides two channels.** A text block on the minting response only (repeating it would put a `[SERVER]:` line in front of the user on every result), and — for tools that declare an `outputSchema` — an `_mcp_instructions` key mirrored into `structuredContent` on *every* response. The second channel exists because clients that read `structuredContent` drop `content` entirely: measured against Claude Code, echo rate was 100% for schema-less tools and 0% for schema-declaring ones before the mirror. Declaring the key on the advertised schema is what makes the write safe — clients ajv-validate against `additionalProperties: false`. Errored results also carry the prompt-back: a failure on the first call is exactly when the retry must stay in the same session.
- **Undelivered handles are cleared.** If neither channel could carry a minted handle, the agent never received it, so it is stripped off the event rather than showing analytics an id nobody holds.

Companion decision (same revision): client name/version and protocol version now travel in every request's `params._meta` under reverse-DNS keys. They are stamped onto the per-request event, never onto server-wide state, so concurrent requests from different clients can't cross-attribute (#4237).

## Consequences

- `enableConversationId` stays opt-in; without a handle, behavior is exactly ADR-0003's.
- `$mcp_initialize` / `$mcp_tools_list` still get the transport-derived id — the handle only rides `tools/call` arguments. `$mcp_initialize` is no longer a universal session anchor; anchor analysis on the first `$mcp_tool_call`.
- Tool-argument "ownership" (which advertised schemas declared `_mcp_instructions`) is cached per instance from `tools/list`. A per-request instance that never served a listing fails closed and skips the `structuredContent` mirror — guessing would fail the customer's entire tool result under `additionalProperties: false`. Open follow-up: a process-scoped ownership cache.
- Era detection (gating the ADR-0003 token machinery off for 2026-07-28 clients, which must not see the header) is an open follow-up.

## References

- PostHog/posthog-js#4428 (anchor), #4430 (`_mcp_instructions` declaration), #4431 (structuredContent mirror), #4433 (handle on errors and capability gaps), #4237 (`_meta` client identity)
- MCP 2026-07-28 spec, Stateful Tools: https://modelcontextprotocol.io/specification/2026-07-28/server/tools#stateful-tools
