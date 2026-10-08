# ADR-0003: Self-encoded session tokens on `Mcp-Session-Id`

- Status: Accepted for MCP 2025-11-25 clients. Superseded by ADR-0004 for the 2026-07-28 revision, which removes the header.
- Date: 2026-08-06 (backfilled; shipped 2026-06 in PostHog/posthog-js#4123)

## Context

On stateless MCP servers (a fresh `Server` + transport per request — serverless, workers, horizontally-scaled pods) every request became its own session, and `$mcp_client_name` / `$mcp_client_version` went missing after `initialize` (they are only sent in the init body, and `getClientVersion()` is empty on any instance that didn't handle it). A real customer saw `sessions == tool_calls` and a 100% "Other" client breakdown.

Under the 2025-11-25 spec, the only value a compliant client replays on **every** request is the `Mcp-Session-Id` response header, and the spec allows any visible-ASCII string in it.

## Decision

At `initialize`, when neither the client nor the transport supplied a session id, mint the `Mcp-Session-Id` header as a self-encoded token: `base64url(JSON)` with shortened keys (`sid` = session id, `cn`/`cv` = client name/version, `pv` = protocol version). Any pod decodes the replayed header and recovers the same `$session_id` plus client metadata — no server-side store, no sticky routing, no client changes.

Supporting choices:

- **Unsigned.** The token carries only what the client already self-reports at `initialize`; there is nothing to forge that the client couldn't send directly.
- **Two-phase protocol version.** The mint runs before the handler negotiates, so it stores the client's *requested* version; after the handler returns, the token is re-minted with the *negotiated* version so pods that replay it report the version the session actually runs on.
- **Transport constraints accepted.** The auto-mint reaches the wire only when response headers are built after the handler runs (StreamableHTTP with `enableJsonResponse: true`). SSE flushes headers first, so SSE servers set the header themselves with the exported `encodeSessionId`; the SDK still decodes it either way.
- **Scope split on read.** The token's session id is per-chat; its client identity is per-connection. A request whose session is anchored elsewhere (ADR-0004) still adopts the token's client identity — on a pod that never saw `initialize`, the token is the only source of it.

## Consequences

- Clients that don't replay the header degrade to the old behavior: one generated session per request.
- `$identify` is published at most once per session, and a token session is assumed to have been announced at `initialize` by whichever pod handled it. Known gap: an identity that only resolves *after* `initialize` on a stateless deployment gets no standalone `$identify` (person properties still land via `$set` on every event). Inherent to statelessness; accepted rather than worked around.
- The 2026-07-28 revision removes the header outright (servers MUST NOT mint or echo it), so this whole mechanism is legacy-only for clients on that revision — see ADR-0004. Era detection to gate it explicitly is an open follow-up.

## References

- PostHog/posthog-js#4123 (tokens), #4210 (negotiated protocol version), #4144 ($identify once per session), PostHog/posthog#68635 (customer report)
