---
'@posthog/mcp': patch
---

Fix stateless servers on `@modelcontextprotocol/server` 2.0 to 2.2 that reuse one transport for every client: the session token minted at `initialize` now rides only that client's `initialize` response. Before, it stayed on the transport, so every later client's `initialize` failed with 400 "Server already initialized" and later responses handed the first client's token to other clients. Per-request and multi-pod stateless servers still get a stable session token.
