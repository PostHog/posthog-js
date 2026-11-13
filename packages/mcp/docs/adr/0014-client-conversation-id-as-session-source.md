# ADR-0014: Client conversation ids set the session

- Status: Accepted.
- Date: 2026-11-05

## Context

On a stateless server that builds an instance per request, a call with no conversation handle and no transport session gets a fresh `$session_id`. Conversation correlation (ADR-0004, on by default since ADR-0013) fixes that by adding a `conversation_id` argument to every tool schema and a handle to tool results. Developers who submit servers to the ChatGPT or Claude plugin directories turn it off, because the directory guidelines ask that tool responses carry no identifiers that aren't strictly required (PostHog/posthog#119784). With it off, their stateless traffic fragments to one session per call.

Some clients already name the conversation in `params._meta`: ChatGPT's `openai/session`, Codex's `sessionId`, and VS Code's `vscode.conversationId`. The sdk-specs "Session identity" requirement defines which keys are read, from which clients, and in what order (PostHog/sdk-specs `2026-11-04-mcp-client-conversation-ids` and `2026-11-04-mcp-codex-vscode-conversation-ids`). This ADR records how this package implements it. MCP SDK v2 lifts only the four reserved `io.modelcontextprotocol/*` keys out of `params._meta`, so these keys are still there when a handler runs.

## Decision

1. **One table, `CLIENT_CONVERSATION_ROWS`** in `src/extensions/client-conversation.ts`, mirrors the spec's table row for row: key, value shape, recognition rule, and whether the client is handle-free. Rows are checked in order, and a key is read only from a request its row recognizes, so a generic key such as `sessionId` is never read from another client.
2. **Recognition uses the `User-Agent` header and the client name.** The client name comes from the request's own `_meta`, then a replayed session token, then the `initialize` handshake, as "Client and server identity" orders them. Stdio has no `User-Agent`, so the client name is what recognizes Codex and VS Code there.
3. **The client's id is the first session source**, ahead of the handle and the transport session, on tool calls only. `resolveSession` derives `deterministicPrefixedId('ses', '<key>:<id>')` and returns before writing shared state. A handle echoed alongside it is still stripped from the arguments, but sets neither `$session_id` nor `$mcp_conversation_id`.
4. **A handle-free client (ChatGPT) gets no `conversation_id`** in its `tools/list`, no `_mcp_instructions` mirroring, and no minted handle, even when its call carries no valid id. Codex and VS Code keep the handle as a fallback.
5. **Every event records the source that grouped it** as `$mcp_session_source`: `client_metadata`, `conversation`, `transport` (a replayed token or a transport session id), or `generated` (the instance's own id, on stdio or as the per-request fallback). ADR-0013 deferred this property. It makes fragmentation one query instead of an inference from sessions roughly equal to calls.
6. **`PostHogMCP` takes the same inputs.** `prepareToolList` and `prepareToolCall` accept `headers`, and `prepareToolCall` also accepts `clientInfo`. `captureToolCall` accepts `requestMeta` and applies a client conversation id when `clientUserAgent` or the `_meta` client name recognizes the client.

## Consequences

- The ids are self-reported, like `clientInfo`. A client that fakes another's `User-Agent` and key shares its sessions. `$session_id` is an analytics grouping key, not a security boundary, so that is the residual ADR-0004 already accepts.
- Ranking the client's id above the transport session regroups clients that also replay a token, such as ChatGPT on a legacy-era server. Their session moves from the connection to the conversation, which is finer.
- The derivation is a cross-SDK contract: every SDK reproduces the spec's vectors, such as `ses_2f5d35b7108d17c807766f2f769a1e8c` for `openai/session` and `v1/conv-example-0001`.
- `tools/list` and resource events from a recognized client still use the transport session or a fresh one, because the spec reads client ids from tool calls only.

## References

- PostHog/posthog#119784
- sdk-specs `openspec/specs/mcp-analytics/spec.md`, "Session identity" and "Arguments the SDK injects"
- ADR-0004 (conversation anchor), ADR-0013 (defaults and the carried-session guard)
