---
'@posthog/mcp': minor
---

Allow both instrumented MCP servers and custom `PostHogMCP` dispatchers to disable captured arguments, results, and error messages independently without changing existing defaults. Shared sink enforcement also omits failed responses when error-message capture is disabled, preventing messages from leaking through result content; safe error category and status metadata remain available.
