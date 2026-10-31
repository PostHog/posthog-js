---
'@posthog/mcp': minor
---

`PostHogMCP` and `instrument()` no longer relabel the posthog-node client as `posthog-node-mcp`. The relabel changed `$lib`, `$lib_version`, the `User-Agent` and, on posthog-node 6, the `PostHog-Sdk-Info` header for every event and request the client sent, including the app's own events. All events now report `posthog-node` and its version. Insights or filters on `$lib = 'posthog-node-mcp'` stop matching new events; filter MCP traffic on the `$mcp_*` events and properties instead. On posthog-node 6 this also lets `@posthog/ai` send AI events from an instrumented client to the AI endpoint.
