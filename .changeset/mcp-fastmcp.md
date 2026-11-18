---
'@posthog/mcp': minor
---

Support FastMCP with `instrumentFastMCP(fastmcp, posthog, options)`. FastMCP builds a server per session (per request when stateless) behind a private factory, so this hooks the module's session class and instruments each one before it connects. FastMCP's HTTP layer drops request headers, so the adapter puts them back on `extra.requestInfo.headers` for `identify` and other callbacks.
