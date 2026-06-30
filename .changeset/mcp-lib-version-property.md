---
'@posthog/mcp': minor
---

Emit `$mcp_lib` (`@posthog/mcp`) and `$mcp_lib_version` on every `$mcp_*` event (and the `$exception` sibling) so you can tell which analytics SDK release produced the data. The version was already resolved at runtime but never mapped to a property. Namespaced like `@posthog/ai`'s `$ai_lib` rather than overriding `$lib`, which stays the transport SDK (`posthog-node`).
