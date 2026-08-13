---
'@posthog/mcp': patch
---

Preserve the `tools/list` response envelope, so instrumenting a paginated tool catalogue no longer hides its later pages.

The listing wrapper rebuilt the response as `{ tools }`, discarding every other field the application's handler had set — on both SDK majors. Most visibly `nextCursor`: a client stops enumerating when the cursor is absent, so tools on later pages became undiscoverable the moment `instrument()` was applied, with no error on either side. The wrapper now spreads the response and replaces only `tools`, which also preserves the 2026-07-28 caching directives `ttlMs` / `cacheScope` and result `_meta`. `$mcp_tools_list` captures the response as sent, envelope included.
