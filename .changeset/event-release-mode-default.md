---
'@posthog/plugin-utils': minor
'@posthog/rollup-plugin': minor
'@posthog/webpack-plugin': minor
---

Default `sourcemaps.releaseMode` to `event`. A build now injects the release id into each chunk as `_posthogReleaseId` and uploads its symbol sets release-independent, so two releases that ship the same chunk keep one symbol set instead of colliding on the release that uploaded it first. Set `sourcemaps.releaseMode: 'symbol-set'`, or `POSTHOG_RELEASE_MODE=symbol-set`, to keep binding the uploaded symbol sets to a release. Event mode needs a posthog-cli that supports `release resolve` and `--release-mode`; an older binary now fails the build with that message instead of falling back.
