---
'@posthog/plugin-utils': minor
'@posthog/rollup-plugin': minor
'@posthog/webpack-plugin': minor
'@posthog/nextjs-config': minor
---

Default `sourcemaps.releaseMode` to `event`. A build now injects the release id into each chunk as `_posthogReleaseId`, and it uploads the symbol sets release-independent. Two releases that ship the same chunk keep one symbol set instead of colliding on the release that uploaded it first. The new default reaches the rollup plugin, the webpack plugin and `@posthog/nextjs-config`, because all three resolve their config through the same function.

Set `sourcemaps.releaseMode: 'symbol-set'`, or `POSTHOG_RELEASE_MODE=symbol-set`, to keep binding the uploaded symbol sets to a release.

Event mode needs a posthog-cli that supports `release resolve` and `--release-mode`. An older binary stops a rollup build, because the plugin resolves the release while it renders each chunk. A webpack or Next.js build prints the error from the CLI and then completes without uploading source maps, because those uploads run after the build and do not fail it.
