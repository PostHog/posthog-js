# PostHog MCP package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [MCP analytics docs](https://posthog.com/docs/mcp-analytics)

## Stateless & multi-pod servers

On stateless deployments the SDK mints the `Mcp-Session-Id` response header at `initialize`
as a token carrying the session id and client name/version. Clients replay the header on
every request, so any pod keeps `$session_id` and `$mcp_client_name`/`$mcp_client_version`
stable with no server-side store. Works out of the box on `StreamableHTTPServerTransport`
with `enableJsonResponse: true` and a fresh transport per request.

SSE-streaming servers flush headers before handlers run, so set the header at the HTTP layer
instead — the SDK decodes it either way:

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
