---
'@posthog/nextjs-config': patch
'@posthog/nuxt': patch
'@posthog/rollup-plugin': patch
'@posthog/webpack-plugin': patch
---

Bump `@posthog/cli` to `~0.16.2`, which fixes a race in `sourcemap process`: inject and upload used to walk the directory roots separately, so a bundler still writing into the output directory mid-run (e.g. Turbopack's background filesystem-cache flush on Next.js 16.3+) could hand upload a chunk inject never stamped and abort the build with "Chunk ID not found". The CLI now uploads exactly the pairs it injected, and `--delete-after` cleanup skips files that vanished or changed after upload instead of failing the build.
