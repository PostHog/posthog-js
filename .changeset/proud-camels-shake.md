---
'@posthog/next': patch
---

Fix `@posthog/next/pages` resolving to the client barrel in Pages Router server bundles. Server code resolves the `node` export condition (not `react-server`), which previously fell through to `default` — leaving the server API undefined inside `getServerSideProps`. The `node` condition now routes to the server barrel, and the modules it reaches no longer import `server-only` (whose non-react-server build throws at import time).
