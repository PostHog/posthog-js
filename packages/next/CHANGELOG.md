# @posthog/next

## 0.2.2

### Patch Changes

- Updated dependencies [[`bc30c2d`](https://github.com/PostHog/posthog-js/commit/bc30c2d988bb307e811d97711f208c125eefba3a), [`bc30c2d`](https://github.com/PostHog/posthog-js/commit/bc30c2d988bb307e811d97711f208c125eefba3a), [`bc30c2d`](https://github.com/PostHog/posthog-js/commit/bc30c2d988bb307e811d97711f208c125eefba3a), [`bc30c2d`](https://github.com/PostHog/posthog-js/commit/bc30c2d988bb307e811d97711f208c125eefba3a)]:
    - @posthog/core@1.23.4
    - posthog-js@1.360.2
    - posthog-node@5.28.2

## 0.2.1

### Patch Changes

- Updated dependencies [[`4009c15`](https://github.com/PostHog/posthog-js/commit/4009c15c85c96b5cf99fdbcda448b9893c95541e)]:
    - @posthog/core@1.23.3
    - posthog-js@1.360.1
    - posthog-node@5.28.1

## 0.2.0

### Minor Changes

- [#3215](https://github.com/PostHog/posthog-js/pull/3215) [`429b389`](https://github.com/PostHog/posthog-js/commit/429b389a1f9d7d094ed682db29ad0d20e2889764) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - feat: rename `optOutByDefault` to `seedAnonymousCookie`

    Renamed to better express what the option does: to control whether the middleware seeds a cookie containing an anonymous identifier on first page load.

    Migration: replace `optOutByDefault: true` with `seedAnonymousCookie: false`. (2026-03-10)

## 0.1.1

### Patch Changes

- Updated dependencies [[`db089fd`](https://github.com/PostHog/posthog-js/commit/db089fd81f35a9c5e825c43853a870a17c916ce0), [`c5a37cb`](https://github.com/PostHog/posthog-js/commit/c5a37cbc248515ff5333f425ffa270136169d47f)]:
    - posthog-js@1.360.0

## 0.1.0

### Minor Changes

- [#3122](https://github.com/PostHog/posthog-js/pull/3122) [`706adb8`](https://github.com/PostHog/posthog-js/commit/706adb899ebe2139e2d68317e216bc1d2ff8af87) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Initial release of @posthog/next, a PostHog integration with Next.js
  (2026-03-06)

### Patch Changes

- Updated dependencies [[`2b0cd52`](https://github.com/PostHog/posthog-js/commit/2b0cd52bac03b50322c497eb1f2fd070e54c83b4)]:
    - posthog-js@1.359.1
