---
'@posthog/plugin-utils': major
'@posthog/rollup-plugin': minor
'@posthog/webpack-plugin': minor
'@posthog/nextjs-config': minor
---

Change the default `sourcemaps.releaseMode` to `event`: set `sourcemaps.releaseMode: 'symbol-set'`, or `POSTHOG_RELEASE_MODE=symbol-set`, to keep binding uploaded symbol sets to a release. The `@posthog/plugin-utils` bump is major, so an installed plugin keeps the old default until the plugin itself is upgraded.

`event` mode requires a posthog-cli with `release resolve` and `--release-mode`, and `posthog-js` 1.409.0, `posthog-node` 5.47.0, or `@posthog/core` 1.46.0 at runtime. An older CLI fails a rollup build and skips the upload on webpack and Next.js. An older SDK reports no release on exceptions.
