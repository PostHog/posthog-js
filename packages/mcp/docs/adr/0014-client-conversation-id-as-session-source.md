# ADR-0014: A host client's conversation id groups stateless calls

- Status: Accepted.
- Date: 2026-11-05

## Context

On a stateless server that builds an instance per request, a call with no conversation handle and no transport session gets a fresh `$session_id`. Conversation correlation (ADR-0004, on by default since ADR-0013) fixes that by adding a `conversation_id` argument to every tool schema and a handle to tool results. Developers who submit servers to the ChatGPT or Claude plugin directories turn it off, because OpenAI's plugin guidelines ask that tool responses carry no telemetry or internal identifiers that aren't strictly required (PostHog/posthog#119784). With it off, their stateless traffic fragments to one session per call.

ChatGPT already carries a conversation id without being asked. Its Apps SDK reference documents `_meta["openai/session"]` on every `tools/call` as an "anonymized conversation id for correlating tool calls within the same ChatGPT session". The MCP spec defines no conversation key, so host-specific `_meta` keys and our own handle are the only per-request carriers the 2026-07-28 revision allows. MCP SDK v2 lifts only the four reserved `io.modelcontextprotocol/*` keys out of `params._meta`, so `openai/session` is still there when a handler runs.

## Decision

1. **A recognized client conversation id becomes a session source.** `readClientConversation` reads the first key from `CLIENT_CONVERSATION_META_KEYS` (today only `openai/session`) whose value is 1 to 256 printable ASCII characters. `$session_id` is `deterministicPrefixedId('ses', '<key>:<id>')`. The key is part of the input so two hosts' ids, or a host id and a handle, never share a hash input. ASCII only, so every SDK hashes the same characters.
2. **It ranks below the conversation handle and the transport session, and above the instance's own id.** It only groups calls that would otherwise fragment, and never regroups a session that an existing source already holds. In-flight conversations that echo a handle keep their session across the upgrade.
3. **It counts as a carried session for minting.** A call that carries it mints no handle and gets no prompt-back block. With `enableConversationId: false` as well, ChatGPT calls are grouped while tool schemas and results stay unchanged.
4. **Every event records the source that grouped it** as `$mcp_session_source`: `conversation`, `transport` (a replayed token or a transport session id), `client_metadata`, or `generated` (the instance's own id, on stdio or as the per-request fallback). This is the measurement ADR-0013 deferred: fragmentation becomes one query instead of an inference from sessions roughly equal to calls.
5. **`PostHogMCP.prepareToolCall` applies the same rule** to its `requestMeta` option, after an explicit `sessionId`. `$mcp_session_source` is set on the `instrument()` path only, because a custom dispatcher passes its own `sessionId` to capture.

Considered and rejected:

- **Rank the client id above the transport session.** It is finer-grained than a connection, but it would regroup ChatGPT sessions that a replayed token already groups. Decision 2 keeps the change additive.
- **`traceparent` as the session key.** Claude Code starts one trace per user prompt, and some hosts send a fresh one per HTTP request. A trace groups a turn at best.
- **Read `session.id` or `gen_ai.conversation.id` from `baggage`, or Codex's `x-codex-turn-metadata`.** No client is known to send the first two. Codex's metadata looks like it carries session and thread ids, but we haven't seen it on the wire. Each is one more entry in `CLIENT_CONVERSATION_META_KEYS` (or a small reader) once confirmed.

## Consequences

- `openai/session` is self-reported, like `clientInfo`. Any client could send the key, and two callers that send the same value share a session. That's the same residual ADR-0004 accepts, since `$session_id` is an analytics grouping key and not a security boundary.
- The derivation is a cross-SDK contract: posthog-python must reproduce `ses_35e4cc45ea3e5e1282c3f091de632132` for `openai/session` and `v1/aBcDeF123`.
- ChatGPT calls on servers with conversation correlation on stop receiving a handle on their first call. Their session comes from `openai/session` instead, so the number of sessions per ChatGPT conversation stays at one.
- Clients that carry nothing still fragment. A query-time inactivity window over `generated` rows is the remaining option. It would change how sessions are counted, so it is left to a product decision.

## References

- PostHog/posthog#119784
- ChatGPT Apps SDK reference: https://developers.openai.com/apps-sdk/reference
- ADR-0004 (conversation anchor), ADR-0013 (defaults and the carried-session guard)
