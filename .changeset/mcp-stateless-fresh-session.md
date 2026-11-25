---
'@posthog/mcp': patch
---

A stateless HTTP request that carries no session (no client conversation id, conversation handle, transport session or session token) now gets a fresh `$session_id` of its own, as the sdk-specs MCP analytics spec requires. Before, a shared HTTP instance with conversation anchoring off grouped every client's requests under the instance's id.

A custom event from `analytics.capture()` now carries the session and identity of the request it was captured in (a tool call, a tool listing or a resource request), even when requests overlap. This uses `AsyncLocalStorage`. On a runtime without it, such as Cloudflare Workers without the `nodejs_compat` or `nodejs_als` flag, custom events are sent with a session of their own and no identity, and the SDK logs one warning. Before, they could take another caller's.
