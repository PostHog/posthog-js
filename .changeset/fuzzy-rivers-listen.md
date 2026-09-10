---
'@posthog/mcp': minor
---

Capture resource discovery and reads from instrumented MCP servers. URL credential redaction (userinfo, credential-named query and fragment parameters) now applies to every captured string, including existing `$mcp_tool_call` parameters, responses, and error messages, so URLs already flowing through tool-call data will show `%5Bredacted%5D` values after upgrading.
