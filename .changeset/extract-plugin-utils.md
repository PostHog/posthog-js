---
'@posthog/core': patch
'@posthog/plugin-utils': patch
'@posthog/nextjs-config': patch
'@posthog/nuxt': patch
'@posthog/rollup-plugin': patch
'@posthog/webpack-plugin': patch
---

Extract CLI and sourcemap utilities from @posthog/core into @posthog/plugin-utils to remove cross-spawn from React Native dependencies
