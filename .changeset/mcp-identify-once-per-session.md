---
'@posthog/mcp': patch
---

fix(mcp): publish `$identify` at most once per session instead of before every tool call

On stateless / multi-pod deployments the SDK rebuilds its per-server identity cache on every request, so the dedupe check saw an empty cache each time and emitted a standalone `$identify` before every `$mcp_tool_call`. The SDK now publishes `$identify` at most once per session — at `initialize`, when a long-lived server first sees the identity, or when the identity materially changes. Every event still carries `distinct_id`/`$set`, so no person data is lost when a standalone `$identify` is suppressed.
