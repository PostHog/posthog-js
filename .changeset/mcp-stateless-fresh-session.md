---
'@posthog/mcp': patch
---

A stateless HTTP request that carries no session (no client conversation id, conversation handle, transport session or session token) now gets a fresh `$session_id` of its own, as the sdk-specs MCP analytics spec requires. Before, a shared HTTP instance with conversation anchoring off grouped every client's requests under the instance's id.
