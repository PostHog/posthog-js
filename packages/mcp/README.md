# @posthog/mcp

PostHog SDK for instrumenting Model Context Protocol (MCP) servers. Tracks tool calls, tool listing, initialization, user intent, identity, and errors — without changing your tool handler logic.

## Install

```bash
npm install @posthog/mcp
```

## Usage

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { track } from '@posthog/mcp'

const server = new McpServer({ name: 'my-mcp-server', version: '1.0.0' })

track(server, {
  apiKey: 'phc_your_project_api_key',
})

// Register your tools as usual — `track()` instruments them automatically.
```

See the documentation in [`docs/`](./docs) for the full configuration reference, including `identify`, `intentFallback`, `redactSensitiveInformation`, `eventProperties`, `enableConversationId`, and `reportMissing`.
