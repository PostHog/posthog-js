---
'posthog-js': patch
---

Declare `react` and `@types/react` as **optional** peer dependencies so the `posthog-js/react` entry point can resolve React on strict `node_modules` layouts — pnpm and bun isolated linkers backed by a global store, where the package is installed outside the project tree and Node's directory walk never reaches the app's React.

Projects that do not import `posthog-js/react` are unaffected: the peers are optional, so npm, pnpm, yarn, and bun install them only when React is already present and emit no unmet-peer warnings.
