---
'@posthog/rollup-plugin': patch
'@posthog/webpack-plugin': patch
'@posthog/nextjs-config': patch
'@posthog/nuxt': patch
---

Bump `@posthog/cli` to 0.19.1 so builds outside a git checkout that set only a release version upload source maps with a warning instead of failing with "Release fields are incomplete".
