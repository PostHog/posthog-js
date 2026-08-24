---
'@posthog/nextjs-config': patch
'@posthog/nuxt': patch
'@posthog/rollup-plugin': patch
'@posthog/webpack-plugin': patch
---

Bump `@posthog/cli` to `~0.14.1`, which makes `sourcemap inject --release-mode=event` adopt a bundler-emitted ECMA-426 debug id as the chunk id instead of deriving its own, so the ids webpack stamps into each chunk are the ones the CLI uploads against.
