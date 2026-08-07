---
'@posthog/mcp': patch
---

Wrap request handlers registered with a method string, and stop breaking three-argument registrations. MCP TypeScript SDK v2 calls `setRequestHandler('tools/call', handler)` where v1 passed a Zod schema, so `instrument()` could not name those registrations and left them unwrapped — a handler bound after `instrument()` silently replaced the analytics wrapper, and no `$mcp_tool_call` or `$mcp_tools_list` was captured. Frameworks that attach handlers post-construction, such as `@rekog/mcp-nest`, do exactly this on every request.

The patched `setRequestHandler` now also forwards every argument it is given. v2's three-argument form for custom methods — `setRequestHandler(method, { params, result }, handler)` — previously lost its handler and threw `setRequestHandler: handler is required`, taking down the host server rather than just instrumentation.
