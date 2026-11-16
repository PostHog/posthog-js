# Mcp

@posthog/mcp: analytics for MCP servers, tracking tool usage, intent and identity as PostHog events.

## entrances

- instrument: the MCP server's code wraps its server so tool calls are tracked
  handler: instrument in src/index.ts
  trust: host-app
- harness nest v1: a maintainer or CI starts the NestJS v1 test server
  handler: harness/nest-v1/src/main.ts
  trust: maintainer
- harness nest v2: a maintainer or CI starts the NestJS v2 test server
  handler: harness/nest-v2/src/main.ts
  trust: maintainer
- run all: a maintainer or CI runs every MCP harness
  handler: harness/run-all.mjs
  trust: maintainer

## invariants
