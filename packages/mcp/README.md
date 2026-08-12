# PostHog MCP package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [MCP analytics docs](https://posthog.com/docs/mcp-analytics)

## Stateless & multi-pod servers

On stateless deployments the SDK mints the `Mcp-Session-Id` response header at `initialize`
as a token carrying the session id and client name/version. Clients replay the header on
every request, so any pod keeps `$session_id` and `$mcp_client_name`/`$mcp_client_version`
stable with no server-side store.

A standalone `$identify` event fires **at most once per session** — at `initialize` (or, on a
long-lived server, when the identity first appears or materially changes). Tool calls on other
pods reuse the identity to stamp `distinct_id`/`$set` on every event **without** re-publishing
`$identify`, so person **properties** are never lost. (Edge case: if identity isn't resolvable
until _after_ `initialize`, the first `$identify` is suppressed too, so pre-identify anonymous
events aren't aliased onto the user — see `docs/ARCHITECTURE.md` §4.) To drop `$identify`
entirely, return `null` from `beforeSend` when `event === '$identify'`.

### Streamable HTTP: set `enableJsonResponse: true`

The token is minted onto the `Mcp-Session-Id` **response** header from inside the `initialize`
handler, so it only reaches the client when the transport builds the response **after** the
handler runs — i.e. **JSON mode**. In **SSE (streaming) mode** `StreamableHTTPServerTransport`
flushes the response headers **before** the handler runs, so the minted header never lands and
behavior silently falls back to a session-per-request. This is a property of the transport, so
it applies to **every** Streamable-HTTP host — set `enableJsonResponse: true` (and use a fresh
transport per request):

```ts
// @modelcontextprotocol/sdk
new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })

// Cloudflare agents / createMcpHandler (SSE is the default)
createMcpHandler(server, { enableJsonResponse: true })

// @rekog/mcp-nest
McpModule.forRoot({ streamableHttp: { enableJsonResponse: true } })
```

### If you must stream (SSE)

Set the header yourself at the HTTP layer with the exported `encodeSessionId` (read `clientInfo`
from the `initialize` body) — the SDK decodes it either way:

```ts
import { MCP_SESSION_HEADER, encodeSessionId, newSessionId } from '@posthog/mcp'

// after parsing the POST body, before flushing headers:
if (body?.method === 'initialize' && !req.headers[MCP_SESSION_HEADER]) {
  res.setHeader(
    MCP_SESSION_HEADER,
    encodeSessionId({
      sessionId: newSessionId(),
      clientName: body.params?.clientInfo?.name,
      clientVersion: body.params?.clientInfo?.version,
    })
  )
}
```

Details: [docs/ARCHITECTURE.md §4](./docs/ARCHITECTURE.md).

## MCP TypeScript SDK v2

`instrument()` works on both SDK majors — `@modelcontextprotocol/sdk` v1 and
`@modelcontextprotocol/{core,server,client}` v2 — and on both the high-level `McpServer` and the
low-level `Server`. Shapes are detected at runtime, so neither major is a dependency here.

### Sessions and client identity on a v2 server

Protocol revision is a property of each **request**, not of the server: a v2 server serves both
`2025-11-25` and `2026-07-28` traffic, and the SDK is instrumented once for both.

- **On `2026-07-28`** there is no `initialize` and no session header — the revision removed
  protocol-level sessions, and this SDK will not mint one. Session correlation therefore comes from
  `enableConversationId`, which is **opt-in**. Without it every request is its own `$session_id`.
- **On `2025-11-25`**, the session id and the client's name and version are exchanged once at
  `initialize`. If your server builds a fresh `McpServer` per HTTP request — which
  `createMcpHandler` does by default — the instance serving a later `tools/call` never saw that
  handshake. The SDK bridges it by minting the `Mcp-Session-Id` token described above, which the
  client replays on every request.

  **That token only reaches the client if the transport builds response headers _after_ the handler
  runs.** `@rekog/mcp-nest` with `enableJsonResponse: true` does; `createMcpHandler`'s legacy leg
  does not, and there is no setting we can reach from inside the server. On that leg, expect
  `$mcp_client_name` and `$mcp_client_version` to be absent for `2025-11-25` traffic — the protocol
  version still arrives, because clients send it on the `MCP-Protocol-Version` header of every
  request.

### Reading request headers in a callback

If your `identify`, `intentFallback`, `eventProperties` or `beforeSend` reads HTTP headers, it has
to change. The two majors put the request in different places and in different shapes: v1 attaches
a plain object at `extra.requestInfo.headers`, v2 attaches the WHATWG `Request` at `extra.http.req`,
whose `headers` only answers to `.get()`. A v1-shaped read returns `undefined` on v2 — an
`identify()` written that way returns `null` and every event goes anonymous.

The SDK hands your callback whatever the MCP SDK handed it, unchanged; it does **not** fake a v1
shape on v2, because a partially synthesised `requestInfo` is a more convincing lie than an absent
one. Read headers through the exported helper instead, which handles both majors, lowercases keys,
and duck-types `Headers` so it also works on edge runtimes:

```ts
import { getRequestHeaders } from '@posthog/mcp'

identify: async (request, extra) => {
  const auth = getRequestHeaders(extra)?.['authorization'] // v1 and v2
  // ...
}
```

### What `$mcp_intent` records, and how to turn it off

`context` defaults to **on**: the SDK adds a `context` parameter to every tool it advertises, asks
the agent to say why it is calling, and records the answer as `$mcp_intent`. It is stripped before
your tool runs wherever the SDK can confirm the parameter is its own.

On a server that builds a fresh instance per HTTP request — `createMcpHandler`, `@rekog/mcp-nest`,
any stateless topology — that confirmation is not available: ownership is learned while serving
`tools/list`, and the instance handling a `tools/call` never served one. There the SDK records the
argument but does **not** strip it, because deleting an argument your tool declared would cost you
the call, while an extra key usually costs nothing.

The consequence worth knowing: if **your own** tool declares a parameter named `context` and the SDK
cannot tell that it is yours, its value is recorded as `$mcp_intent`. It never leaves your project,
and it is capped at 2048 characters. Two ways out, both one line:

```ts
instrument(server, posthog, { context: false })                   // no injection, no capture

instrument(server, posthog, {                                     // keep it, drop the property
  beforeSend: (event) => {
    delete event.properties.$mcp_intent
    return event
  },
})
```

`intentFallback` is the third option: supply the intent yourself when the agent did not send one.

### If you switched to `instrument(server.server)`

Before v2 support landed, the compatibility gate rejected high-level v2 servers, and the usual
workaround was to instrument the underlying low-level server. `instrument(server)` now works, so
you can go back to the documented call.

Whether the workaround costs you anything depends on your stack: instrumenting the low-level server
skips the high-level tool registry, so tool descriptions and callback-level wrapping come only from
what is advertised over `tools/list`. If your framework never calls `registerTool()` — `@rekog/mcp-nest`
does not — the registry is empty and the two calls behave the same.

## Developing locally

To test local changes in a consumer app (e.g. a dummy MCP server), symlink **both**
`@posthog/mcp` and its `posthog-node` peer from this monorepo into the app — run from the
app's directory:

```bash
mkdir -p node_modules/@posthog   # in case the app has no other @posthog/-scoped deps yet
ln -s /absolute/path/to/posthog-js/packages/mcp  node_modules/@posthog/mcp
ln -s /absolute/path/to/posthog-js/packages/node node_modules/posthog-node
```

Then keep a watch build running and restart the app after each change:

```bash
cd /absolute/path/to/posthog-js/packages/mcp && pnpm dev   # rebuilds dist/ on save

# in the app (e.g. dummy mcp), after each rebuild:
npm start                                                  # Node caches dist/ at startup, so restart to pick it up
```

- **`npm install` in the app replaces both symlinks with published copies** — re-create them if you run it.

## Run tests

```bash
cd packages/mcp && pnpm test:unit
```
