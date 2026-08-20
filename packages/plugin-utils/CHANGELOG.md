# @posthog/plugin-utils

## 1.2.0

### Minor Changes

- [#4541](https://github.com/PostHog/posthog-js/pull/4541) [`74d8f5a`](https://github.com/PostHog/posthog-js/commit/74d8f5abd567fa3ec4a746b1c9c3f7c0a64d726c) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - Add experimental `sourcemaps.releaseMode: 'event'` to the rollup plugin. In event mode the plugin resolves the release with `posthog-cli release resolve` and injects its id into every chunk, so exceptions report their release directly instead of it being bound to the uploaded symbol sets, and chunk ids are derived from chunk content so a rebuild of unchanged code reuses the symbol set already uploaded. The option defaults to the `POSTHOG_RELEASE_MODE` environment variable and then to `symbol-set`, which behaves exactly as before. Event mode needs a posthog-cli with the `release resolve` command.
  (2026-08-19)

## 1.1.3

### Patch Changes

- [#4512](https://github.com/PostHog/posthog-js/pull/4512) [`1030636`](https://github.com/PostHog/posthog-js/commit/10306368b32ae7b016d993cf14ffc474fad240e9) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - Inject chunk ids (a fresh random id per build) into chunks in-memory during `renderChunk` instead of letting posthog-cli rewrite the emitted files on disk in `writeBundle`. The written bundle already contains the chunk-id snippet, so Subresource Integrity plugins (e.g. vite-plugin-sri3, which hashes chunks in `generateBundle`) now compute hashes over the final content and the browser no longer blocks the scripts. `writeBundle` runs the non-mutating `sourcemap upload` instead of `sourcemap process`, and with `deleteAfterUpload` the plugin deletes the `.map` files itself rather than passing `--delete-after` (which also rewrites the `.js` files).
  (2026-08-13)

## 1.1.2

### Patch Changes

- [#3837](https://github.com/PostHog/posthog-js/pull/3837) [`29bf8e3`](https://github.com/PostHog/posthog-js/commit/29bf8e386a4050531e9cfd906c33b75945fcb6ad) Thanks [@marandaneto](https://github.com/marandaneto)! - Add missing bugs metadata to package manifests.
  (2026-06-15)

## 1.1.1

### Patch Changes

- [#3426](https://github.com/PostHog/posthog-js/pull/3426) [`1a0b58d`](https://github.com/PostHog/posthog-js/commit/1a0b58d1d07c61662169d3bc56eed8cfd8855d65) Thanks [@marandaneto](https://github.com/marandaneto)! - Trim surrounding whitespace from user-provided API keys, personal API keys, and host config values before using them.
  (2026-04-21)

## 1.1.0

### Minor Changes

- [#3418](https://github.com/PostHog/posthog-js/pull/3418) [`04d276c`](https://github.com/PostHog/posthog-js/commit/04d276c340d97ee557d62d5df3ad1335fefda652) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Add `build` to sourcemaps config, forwarded to posthog-cli as `--build`. Lets consumers of the bundler plugins (webpack, rollup, nextjs-config, nuxt) attach a build number as release metadata. Requires posthog-cli >= 0.7.8.
  (2026-04-19)

## 1.0.1

### Patch Changes

- [#3309](https://github.com/PostHog/posthog-js/pull/3309) [`197eeda`](https://github.com/PostHog/posthog-js/commit/197eeda0b09fd2671a8a40f1bfd48a7b940f7371) Thanks [@marandaneto](https://github.com/marandaneto)! - Extract CLI and sourcemap utilities from @posthog/core into @posthog/plugin-utils to remove cross-spawn from React Native dependencies
  (2026-04-01)
