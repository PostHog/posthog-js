---
'@posthog/mcp': patch
---

Declare both MCP TypeScript SDK majors as optional peers, so a v2-only project installs cleanly.

`@modelcontextprotocol/sdk` (v1) was a required peer, so installing `@posthog/mcp` into a project built on `@modelcontextprotocol/server` (v2) pulled the entire v1 SDK in as an auto-installed peer — 87 packages where 1 was wanted — and any tooling that walks the dependency tree reported it as missing when it was absent.

Neither major is required at runtime: no `@modelcontextprotocol/*` package is imported in shipped code, and server shapes are detected structurally. Both are now declared and both are marked optional, so the manifest states what is supported without forcing either into the tree.
