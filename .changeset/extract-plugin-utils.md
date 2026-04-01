---
'@posthog/ai': patch
'@posthog/convex': patch
'@posthog/core': patch
'@posthog/next': patch
'@posthog/nextjs-config': patch
'@posthog/nuxt': patch
'@posthog/plugin-utils': patch
'@posthog/react': patch
'@posthog/rollup-plugin': patch
'@posthog/webpack-plugin': patch
'posthog-js': patch
'posthog-js-lite': patch
'posthog-node': patch
'posthog-react-native': patch
---

Extract CLI and sourcemap utilities from @posthog/core into @posthog/plugin-utils to remove cross-spawn from React Native dependencies
