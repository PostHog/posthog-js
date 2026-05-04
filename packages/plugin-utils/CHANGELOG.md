# @posthog/plugin-utils

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
