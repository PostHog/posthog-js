---
'@posthog/mcp': minor
---

feat(mcp): capture the negotiated MCP protocol version as `$mcp_protocol_version`

The SDK now stamps `$mcp_protocol_version` — the MCP spec version negotiated at `initialize` (read off the server's initialize response) — on the `$mcp_initialize` event and on **every** subsequent event for the session (tool calls, listings, and the `$exception` sibling). It's persisted in per-server session info and, on stateless / multi-pod deployments, recovered on other pods from the session token, which now carries the client's requested version in a new `pv` field. Use it to track MCP spec-revision adoption and to break event metrics (error rate, latency) down by spec version.

`SessionTokenPayload` gains an optional `protocolVersion`, and `PostHogMCP.captureInitialize` accepts an optional `protocolVersion`. (2026-07-21)
