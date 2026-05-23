# @posthog/mcp

PostHog SDK for instrumenting [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) servers.

One call wraps your MCP server and PostHog starts receiving structured events for every tool call, tool listing, initialize handshake, identify, and exception, with all the usual PostHog primitives (`$session_id`, `distinct_id`, `$set`, `$exception`, `$ai_span`) wired up automatically.

## Install

```bash
npm install @posthog/mcp
```

`@modelcontextprotocol/sdk` ≥ 1.11 is a peer dependency.

## Quick start

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { instrument } from '@posthog/mcp'

const server = new McpServer({ name: 'my-mcp-server', version: '1.0.0' })

server.tool(
  'search_docs',
  'Search PostHog documentation',
  { query: z.string() },
  async ({ query }) => ({
    content: [{ type: 'text', text: `Searching for "${query}"...` }],
  })
)

// One line. From here on every tool call, tool listing, and initialize
// handshake on this server is captured to PostHog.
instrument(server, { apiKey: 'phc_your_project_api_key' })
```

What you get in PostHog out of the box:

| Event | When | A few of the auto-captured properties |
|---|---|---|
| `$mcp_tool_call` | every tool invocation | `$mcp_tool_name`, `$mcp_parameters`, `$mcp_response`, `$mcp_duration_ms`, `$mcp_is_error` |
| `$mcp_tools_list` | client lists tools | `$mcp_listed_tool_names` |
| `$mcp_initialize` | client/server handshake | `$mcp_client_name`, `$mcp_client_version`, `$mcp_server_name` |
| `$exception` | a tool throws or returns `isError` | `$exception_message`, `$exception_type`, `$exception_stacktrace` |
| `$identify` | first time `identify()` returns a non-null identity | `$set` populated from `UserIdentity.userData` |

The full event + property catalog (including `$ai_span` for LLM analytics and `$mcp_resources_*` / `$mcp_prompts_*`) lives in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Common patterns

### Identify the calling user

`identify` runs on every tool call but only emits an `$identify` event when the returned identity actually changes for a session. From there on, events for that session are attributed to the user.

```ts
import jwt from 'jsonwebtoken'

instrument(server, {
  apiKey: 'phc_...',
  identify: async (request, extra) => {
    const auth = extra?.headers?.authorization
    if (!auth) return null

    const { sub, email, plan } = jwt.verify(stripBearer(auth), SECRET) as {
      sub: string
      email: string
      plan: 'free' | 'pro'
    }

    return {
      userId: sub,
      userName: email,
      userData: { plan }, // becomes a `$set` on subsequent events
    }
  },
})
```

### Capture user intent

PostHog injects an optional `context` parameter into every tool's input schema. When the LLM passes a value, the SDK stores it as `$mcp_intent` (with `$mcp_intent_source = "context_parameter"`) so dashboards can group tool calls by *why* the agent invoked them.

If a client ignores the schema (raw cURL, in-house agents, JSON-blind crawlers), supply `intentFallback` and the SDK will derive an intent from the request:

```ts
instrument(server, {
  apiKey: 'phc_...',
  intentFallback: (request) => {
    const tool = request.params?.name
    const args = request.params?.arguments ?? {}
    if (tool === 'search_docs') return `Searching docs for "${args.query}"`
    return tool ? `Invoking ${tool}` : null
  },
})
```

### Capture a custom event

For domain-specific events that aren't auto-captured (e.g. user feedback, workflow milestones):

```ts
import { publishCustomEvent } from '@posthog/mcp'

await publishCustomEvent(server, {
  resourceName: 'user-feedback',
  parameters: { rating: 5, comment: 'love it' },
  message: 'User submitted feedback',
})
```

Emits `$mcp_custom` with `$session_id`, `distinct_id`, server/client metadata, and your payload. Bypasses the `enableTracing` gate (custom events are explicit, not auto-captured).

### Redact sensitive strings before send

`redactSensitiveInformation` runs against every string in the event payload before sanitization. Protected fields (`sessionId`, `id`, `resourceName`, `eventType`, …) are skipped automatically.

```ts
instrument(server, {
  apiKey: 'phc_...',
  redactSensitiveInformation: async (text) => text.replace(/api_key_\w+/g, '[REDACTED]'),
})
```

### Attach extra properties to every event

```ts
instrument(server, {
  apiKey: 'phc_...',
  eventProperties: (request, extra) => ({
    deployment: process.env.NODE_ENV,
    region: 'us-east-1',
    feature_flags: ['dark_mode', 'beta_ui'],
  }),
})
```

Returned keys are spread flat onto event properties, sitting alongside `$mcp_*` keys, and can intentionally override them.

### Get more tools (`reportMissing`)

Register an extra `get_more_tools` virtual tool that lets the agent report functionality it couldn't find. Each report lands as a `$mcp_tool_call` with the agent's reasoning in `$mcp_intent`.

```ts
instrument(server, {
  apiKey: 'phc_...',
  reportMissing: true,
})
```

### Tie tool calls into a single conversation

Opt into `enableConversationId: true` and the SDK injects a `conversation_id` parameter into every tool, mints one when the agent omits it, and appends a prompt-back text block telling the agent to echo it on every subsequent call. Events get `$mcp_conversation_id` so you can group all calls in an agent conversation.

```ts
instrument(server, {
  apiKey: 'phc_...',
  enableConversationId: true,
})
```

### Surface MCP activity in PostHog LLM analytics

```ts
instrument(server, {
  apiKey: 'phc_...',
  enableAITracing: true,
})
```

Emits a parallel `$ai_span` event per tool call with `$ai_input_state`, `$ai_output_state`, `$ai_latency` so MCP traffic shows up in the LLM analytics UI.

## API

- **`instrument(server, options)`**: wraps a low-level `Server` or high-level `McpServer`. Idempotent per server instance (subsequent calls on the same server are skipped via a `WeakMap` lookup). Returns the same server, typed.
- **`publishCustomEvent(server, eventData)`**: emits one `$mcp_custom` event. The server must have been passed to `instrument()` first.
- **`flush(server)` / `shutdown(server)`**: drive the underlying `@posthog/core` queue manually before exit. Both throw if the server hasn't been instrumented.

The full options reference lives in [`src/types.ts`](./src/types.ts) (`MCPAnalyticsOptions`) and the design narrative + HogQL recipes live in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Graceful shutdown

```ts
import { instrument, shutdown } from '@posthog/mcp'

instrument(server, { apiKey: 'phc_...' })

process.on('SIGTERM', async () => {
  await shutdown(server)
  process.exit(0)
})
```

## Logging in STDIO MCP servers

MCP over STDIO uses stdout/stderr for protocol messages, so the SDK never logs to them. Pass a `logger` callback if you want to capture SDK-internal warnings:

```ts
import fs from 'node:fs'
const logStream = fs.createWriteStream('mcp.log', { flags: 'a' })

instrument(server, {
  apiKey: 'phc_...',
  logger: (msg) => logStream.write(`${new Date().toISOString()} ${msg}\n`),
})
```

## Docs

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md): wire-up, request lifecycle, event pipeline, full event + property catalog, intent resolution, file map, HogQL query recipes.
- [PostHog docs](https://posthog.com/docs): the rest.
