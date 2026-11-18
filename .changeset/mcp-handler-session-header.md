---
'@posthog/mcp': minor
---

Support Vercel's `mcp-handler`. Call `instrument(server, posthog)` inside the `createMcpHandler` callback, and wrap the exported route in the new `withMcpSessionHeader` to keep one `$session_id` and the client's name per conversation on the `2025-11-25` protocol. mcp-handler streams the `initialize` response, so the session token is minted at the fetch layer instead of inside the server. A new `mcp-handler` harness lane covers both protocol eras.
