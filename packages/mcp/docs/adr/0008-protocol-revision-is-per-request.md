# ADR-0008: Protocol revision is a per-request property — chains, not branches

- Status: Accepted
- Date: 2026-08-07

## Context

The 2026-07-28 revision removed the `initialize` handshake, so client name, client version and protocol version no longer arrive once per connection — they travel with every request, in `params._meta` under reserved `io.modelcontextprotocol/*` keys. MCP SDK v2 then lifts those keys **out** of `_meta` while parsing and puts them on the request envelope, so by the time a handler runs `request.params._meta` is empty. Reading `_meta` alone lost client identity on exactly the traffic that carries it per request.

The tempting fix is to detect the era once and branch. It does not work:

- One v2 server serves **both** revisions, request by request — `createMcpHandler` routes legacy traffic through its own leg by default.
- v2's exported `LATEST_PROTOCOL_VERSION` reads `2025-11-25`, so no module constant describes the traffic.
- A 2025-11-25 request carries no envelope and no reserved `_meta` at all; on a per-request server instance the handshake that knew its version was handled by a different instance.

## Decision

Identity is resolved **per request**, through a fallback chain, field by field. Nothing branches on which SDK major is installed:

```
ctx.mcpReq.envelope → request.params._meta → MCP-Protocol-Version header → getClientVersion() / getNegotiatedProtocolVersion()
```

- **Field by field**, because a request may carry its protocol version while the client's name is only known from a handshake.
- The `MCP-Protocol-Version` **header** is a link because 2025-11-25 requires a client to send it on every request after `initialize` — the only per-request carrier that era has, and therefore the only one that survives a per-request instance.
- The server's own accessors are **last**. They are connection-scoped, so any request that identifies itself wins outright.
- v2-only accessors are reached through a structural probe (ADR-0005), never a version check.

Where an era-dependent *decision* is unavoidable rather than an era-dependent value, it is taken from the same per-request resolution — see ADR-0009.

## Consequences

- Adding a carrier is a link, not a branch, so the chain stays flat as revisions accumulate.
- `clientInfo` still has no per-request carrier on 2025-11-25. It depends on the replayed session token (ADR-0003), which needs a transport that builds response headers after the handler runs — so on `createMcpHandler`'s legacy leg client name and version stay absent. Documented in the README rather than worked around.
- The last link is connection-scoped, so on a server multiplexing clients through one connection it answers for whichever completed the handshake. That is the same scope `capture.ts` has always fallen back to; ordering it last is what keeps it a fallback.

## References

- PostHog/posthog-js#4463 and #4465 (this change), ADR-0003, ADR-0005, ADR-0009
