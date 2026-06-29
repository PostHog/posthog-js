# PostHog MCP package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [MCP analytics docs](https://posthog.com/docs/mcp-analytics)

## Developing locally

To test local changes in a consumer app (e.g. a dummy MCP server), symlink **both**
`@posthog/mcp` and its `posthog-node` peer from this monorepo into the app — run from the
app's directory:

```bash
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
