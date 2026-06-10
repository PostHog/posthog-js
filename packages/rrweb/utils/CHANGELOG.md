# @rrweb/utils

## 0.0.61

### Patch Changes

- [#3510](https://github.com/PostHog/posthog-js/pull/3510) [`a5d86c9`](https://github.com/PostHog/posthog-js/commit/a5d86c9dbeda7d5f757c5d2216431b64cfcec474) Thanks [@arnaudhillen](https://github.com/arnaudhillen)! - Move posthog-rrweb sources into the posthog-js monorepo under `packages/rrweb/`.
  The seven packages we publish (`@posthog/rrweb`, `@posthog/rrweb-types`,
  `@posthog/rrweb-utils`, `@posthog/rrdom`, `@posthog/rrweb-snapshot`,
  `@posthog/rrweb-record`, `@posthog/rrweb-plugin-console-record`) now release
  from this repo via the existing changesets pipeline. No runtime behavior
  changes. (2026-05-05)

## 2.0.0-alpha.18

## 2.0.0-alpha.17

### Patch Changes

- [#1509](https://github.com/rrweb-io/rrweb/pull/1509) [`be6bf52`](https://github.com/rrweb-io/rrweb/commit/be6bf52c248c35de1b3491e3a3440ff61f876414) Thanks [@Juice10](https://github.com/Juice10)! - Reverse monkey patch built in methods to support LWC (and other frameworks like angular which monkey patch built in methods).
