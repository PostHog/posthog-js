# @posthog/mcp

PostHog SDK for instrumenting [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) servers. It captures structured PostHog events for every tool call, tool listing, initialize handshake, identify, and exception, with the usual PostHog primitives (`$session_id`, `distinct_id`, `$set`, `$groups`, `$exception`) wired up for you.

## Install

```bash
npm install @posthog/mcp posthog-node
```

`@modelcontextprotocol/sdk` ≥ 1.26 and `posthog-node` ≥ 5 are peer dependencies.

## Quick start

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PostHog } from 'posthog-node'
import { instrument } from '@posthog/mcp'

const posthog = new PostHog('phc_your_project_token', { host: 'https://us.i.posthog.com' })
const server = new McpServer({ name: 'my-mcp-server', version: '1.0.0' })

// One line — every tool call, listing, and initialize on this server is now captured.
instrument(server, posthog)
```

No `Server`/`McpServer` to wrap (a custom hono/edge dispatcher)? Use `PostHogMCP` — a drop-in `posthog-node` subclass with `captureToolCall` / `captureInitialize` — see the docs.

## Documentation

Full documentation lives at **[posthog.com/docs/mcp-analytics](https://posthog.com/docs/mcp-analytics)** — installation, custom servers, capturing intent, identifying users, custom events, privacy/redaction, the event + property reference, and sample queries. The design narrative lives in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Building in public

The SDK source lives in the [`posthog-js` monorepo](https://github.com/PostHog/posthog-js/tree/main/packages/mcp). Issues, PRs, and feedback are welcome. We started from a duplicated copy of the MIT-licensed [MCPcat TypeScript SDK](https://github.com/MCPCat/mcpcat-typescript-sdk) — the event schema, identity model, and feature surface have since diverged.
