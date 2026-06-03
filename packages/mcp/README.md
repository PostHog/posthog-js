# @posthog/mcp

PostHog SDK for instrumenting [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) servers.

One call wraps your MCP server and PostHog starts receiving structured events for every tool call, tool listing, initialize handshake, identify, and exception, with all the usual PostHog primitives (`$session_id`, `distinct_id`, `$set`, `$groups`, `$exception`) wired up automatically.

## Install

```bash
npm install @posthog/mcp posthog-node
```

`@modelcontextprotocol/sdk` ≥ 1.26 and `posthog-node` ≥ 5 are peer dependencies.

## Quick start

You bring your own [`posthog-node`](https://posthog.com/docs/libraries/node) client and pass it in (same pattern as [`@posthog/ai`](https://posthog.com/docs/libraries/ai)). You own its configuration and lifecycle — call `posthog.shutdown()` on exit so queued events flush.

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PostHog } from 'posthog-node'
import { z } from 'zod'
import { instrument } from '@posthog/mcp'

const posthog = new PostHog('phc_your_project_token', { host: 'https://us.i.posthog.com' })

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
instrument(server, { posthog })

// You own the client lifecycle — flush before the process exits.
process.on('SIGTERM', async () => {
  await posthog.shutdown()
  process.exit(0)
})
```

What you get in PostHog out of the box:

| Event | When | A few of the auto-captured properties |
|---|---|---|
| `$mcp_tool_call` | every tool invocation | `$mcp_tool_name`, `$mcp_parameters`, `$mcp_response`, `$mcp_duration_ms`, `$mcp_is_error` |
| `$mcp_tools_list` | client lists tools | `$mcp_listed_tool_names` |
| `$mcp_initialize` | client/server handshake | `$mcp_client_name`, `$mcp_client_version`, `$mcp_server_name` |
| `$exception` | a tool throws or returns `isError` | `$exception_list`, `$exception_level` (standard PostHog error-tracking shape) |
| `$identify` | first time `identify()` returns a non-null identity | `$set` populated from the identity's `properties` |
| `$mcp_missing_capability` | agent calls `get_more_tools` (when `reportMissing` is on) | `$mcp_intent` — what the agent was looking for |

Events for sessions with no resolved identity are sent with `$process_person_profile: false`, so anonymous MCP traffic doesn't mint a person profile per session.

The full event + property catalog (including `$mcp_resources_*` / `$mcp_prompts_*`) lives in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Coming from another PostHog SDK?

The surface maps onto concepts you already know — the main twist is that, because an MCP server handles many requests/sessions, the identity- and property-resolving hooks are **per-request callbacks** rather than imperative calls.

| You know | Here it's | Note |
|---|---|---|
| BYO client in `@posthog/ai` | `instrument(server, { posthog })` | Same pattern: you construct and own the `posthog-node` client. |
| `posthog.capture({ event, properties })` | `capture(server, { event, properties })` | `distinct_id` is derived from the session/identity for you. |
| `posthog.identify({ distinctId, properties })` | `identify: (req) => ({ distinctId, properties, groups })` | A per-request callback. `properties` → `$set`, `groups` → `$groups`. |
| `posthog.register(props)` (super properties) | `eventProperties: (req) => ({ … })` | Per-request instead of set-once; return constants for the "stamp on everything" case. |
| `beforeSend` | `beforeSend(event)` | Identical contract to posthog-node. |

## Common patterns

### Identify the calling user

`identify` runs on every tool call but only emits an `$identify` event when the returned identity actually changes for a session. From there on, events for that session are attributed to the user.

```ts
import jwt from 'jsonwebtoken'

instrument(server, {
  posthog,
  identify: async (request, extra) => {
    const auth = extra?.headers?.authorization
    if (!auth) return null

    const { sub, email, plan } = jwt.verify(stripBearer(auth), SECRET) as {
      sub: string
      email: string
      plan: 'free' | 'pro'
    }

    return {
      distinctId: sub, // → distinct_id for the session
      properties: { name: email, plan }, // → $set on the person
      groups: { organization: 'org_123' }, // optional → $groups on every event
    }
  },
})
```

This is the same shape as posthog-node's `identify({ distinctId, properties })`, just evaluated per request: `distinctId` becomes the `distinct_id`, `properties` are written to `$set` (so put `name`/`email`/etc there), and `groups` is stamped onto every event as `$groups` so you never hand-write the dollar-keyed properties yourself.

### Capture user intent

PostHog injects an optional `context` parameter into every tool's input schema. When the LLM passes a value, the SDK stores it as `$mcp_intent` (with `$mcp_intent_source = "context_parameter"`) so dashboards can group tool calls by *why* the agent invoked them.

If a client ignores the schema (raw cURL, in-house agents, JSON-blind crawlers), supply `intentFallback` and the SDK will derive an intent from the request:

```ts
instrument(server, {
  posthog,
  intentFallback: (request) => {
    const tool = request.params?.name
    const args = request.params?.arguments ?? {}
    if (tool === 'search_docs') return `Searching docs for "${args.query}"`
    return tool ? `Invoking ${tool}` : null
  },
})
```

### Capture a custom event

For domain-specific events that aren't auto-captured (e.g. user feedback, workflow milestones). You name the event; it's sent verbatim (it's your event, so it isn't `$`-prefixed):

```ts
import { capture } from '@posthog/mcp'

await capture(server, {
  event: 'feedback_submitted',
  properties: { rating: 5, comment: 'love it' },
})
```

The event is enriched with `$session_id`, `distinct_id`, and server/client metadata before being sent. `capture()` resolves once the event has been processed, so you can `await` it.

### Inspect, modify, or drop events before send (`beforeSend`)

`beforeSend` runs on each fully-built payload right before it reaches `posthog.capture()` (same contract as posthog-node). Return the event to send it, mutate its `properties`, or return `null` to drop it. It runs once per emitted event, including the `$exception` sibling of a failed call.

```ts
instrument(server, {
  posthog,
  beforeSend: (event) => {
    // Redact a property
    if (typeof event.properties.$mcp_parameters === 'string') {
      event.properties.$mcp_parameters = event.properties.$mcp_parameters.replace(/api_key_\w+/g, '[REDACTED]')
    }
    // Drop a whole class of events
    if (event.event === '$exception') return null
    return event
  },
})
```

### Attach extra properties to every event

```ts
instrument(server, {
  posthog,
  eventProperties: (request, extra) => ({
    deployment: process.env.NODE_ENV,
    region: 'us-east-1',
    feature_flags: ['dark_mode', 'beta_ui'],
  }),
})
```

Returned keys are spread flat onto event properties, sitting alongside `$mcp_*` keys, and can intentionally override them.

### Get more tools (`reportMissing`)

Register an extra `get_more_tools` virtual tool that lets the agent report functionality it couldn't find. Each report lands as its own `$mcp_missing_capability` event (a capability gap, not a tool invocation) with the agent's reasoning in `$mcp_intent`.

```ts
instrument(server, {
  posthog,
  reportMissing: true,
})
```

### Tie tool calls into a single conversation

Opt into `enableConversationId: true` and the SDK injects a `conversation_id` parameter into every tool, mints one when the agent omits it, and appends a prompt-back text block telling the agent to echo it on every subsequent call. Events get `$mcp_conversation_id` so you can group all calls in an agent conversation.

```ts
instrument(server, {
  posthog,
  enableConversationId: true,
})
```

### Turn off exception autocapture

A failed tool call emits an `$exception` sibling alongside the `$mcp_tool_call` by default. Set `enableExceptionAutocapture: false` if you track errors elsewhere and don't want MCP failures fanning into PostHog error tracking:

```ts
instrument(server, {
  posthog,
  enableExceptionAutocapture: false,
})
```

## API

- **`instrument(server, options)`**: wraps a low-level `Server` or high-level `McpServer`. Idempotent per server instance (subsequent calls on the same server are skipped via a `WeakMap` lookup). Returns the same server, typed. Pass your `posthog-node` client via `options.posthog`.
- **`capture(server, { event, properties })`**: emits one custom event. `event` is required and sent verbatim (not `$`-prefixed). The server must have been passed to `instrument()` first. Returns a promise you can `await`.

The full options reference lives in [`src/types.ts`](./src/types.ts) (`MCPAnalyticsOptions`) and the design narrative + HogQL recipes live in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Graceful shutdown

The SDK doesn't own the client, so flushing is just `posthog.shutdown()` on your `posthog-node` instance — see the Quick start above. Nothing MCP-specific to tear down.

### Serverless / short-lived processes

In a serverless function (Lambda, Cloudflare Workers, Vercel) the process can freeze or exit before `posthog-node` flushes its queue. Flush explicitly at the end of the invocation rather than relying on a `SIGTERM` handler:

```ts
// at the end of the request/invocation
await posthog.flush()
// or keep the runtime alive until the flush completes
ctx.waitUntil(posthog.flush())
```

## Logging in STDIO MCP servers

MCP over STDIO uses stdout/stderr for protocol messages, so the SDK never logs to them. Pass a `logger` callback if you want to capture SDK-internal warnings:

```ts
import fs from 'node:fs'
const logStream = fs.createWriteStream('mcp.log', { flags: 'a' })

instrument(server, {
  posthog,
  logger: (msg) => logStream.write(`${new Date().toISOString()} ${msg}\n`),
})
```

## Docs

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md): wire-up, request lifecycle, event pipeline, full event + property catalog, intent resolution, file map, HogQL query recipes.
- [PostHog docs](https://posthog.com/docs): the rest.
