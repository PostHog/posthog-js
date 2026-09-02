---
'@posthog/plugin-utils': major
'@posthog/rollup-plugin': minor
'@posthog/webpack-plugin': minor
'@posthog/nextjs-config': minor
---

Change the default `sourcemaps.releaseMode` to `event`: set `sourcemaps.releaseMode: 'symbol-set'`, or `POSTHOG_RELEASE_MODE=symbol-set`, to keep binding uploaded symbol sets to a release.

A build now injects the release id into each chunk as `_posthogReleaseId`, and it uploads the symbol sets release-independent. Two releases that ship the same chunk keep one symbol set instead of colliding on the release that uploaded it first. The new default reaches the rollup plugin, the webpack plugin and `@posthog/nextjs-config`, because all three resolve their config through the same function. The `@posthog/plugin-utils` bump is major so an already-installed plugin cannot pick the new default up through its `^1.x` range.

`event` mode requires a posthog-cli with `release resolve` and `--release-mode`, and `posthog-js` 1.409.0, `posthog-node` 5.47.0, or `@posthog/core` 1.46.0 at runtime. An older CLI fails a rollup build and skips the upload on webpack and Next.js. An older SDK reports no release on exceptions.
