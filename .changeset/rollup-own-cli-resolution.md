---
'@posthog/rollup-plugin': patch
---

Use the package's own PostHog CLI, so that sourcemap upload finds it under isolated installs (for example Bun workspaces) when the project does not depend directly on `@posthog/cli`.
