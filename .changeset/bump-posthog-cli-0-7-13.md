---
'@posthog/nextjs-config': patch
'@posthog/webpack-plugin': patch
'@posthog/rollup-plugin': patch
'@posthog/nuxt': patch
---

Bump `@posthog/cli` to `~0.7.13`, which drops several unused runtime dependencies (`axios`, `axios-proxy-builder`, `console.table`, `rimraf`).
