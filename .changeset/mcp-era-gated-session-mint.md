---
'@posthog/mcp': patch
---

Gate `Mcp-Session-Id` minting on the protocol revision the request declares.

The 2026-07-28 revision removed protocol-level sessions: a server must not mint or echo `Mcp-Session-Id` under it. Until now that held only by accident — the mint hangs off the `initialize` handler and 2026-07-28 has no handshake — so compliance depended on an SDK routing detail rather than on anything the SDK checks.

The era is now resolved per request, from the version an `initialize` body declares or, failing that, from the same fallback chain that resolves client identity. Nothing branches on which SDK major is installed: one v2 server serves both revisions, request by request. An unknown version counts as legacy, so a v1 client that declares nothing keeps the session header it has always had.
