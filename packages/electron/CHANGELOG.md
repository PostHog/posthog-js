# @posthog/electron

## 0.1.2

### Patch Changes

- Updated dependencies [[`6715a04`](https://github.com/PostHog/posthog-js/commit/6715a04401ec840ac78cc1998a1dfcce4bf0d906), [`c17ad19`](https://github.com/PostHog/posthog-js/commit/c17ad19fa3977385ac5c277769ab14e1dc8719e1)]:
  - @posthog/browser-common@0.14.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`54220f6`](https://github.com/PostHog/posthog-js/commit/54220f673c69fd4ff1b40cb7df61eea713a0032b)]:
  - @posthog/browser-common@0.13.0

## 0.1.0

Initial release of the Electron SDK for analytics, feature flags, and JavaScript error tracking.

### Minor Changes

- [#5821](https://github.com/PostHog/posthog-js/pull/5821) [`975b551`](https://github.com/PostHog/posthog-js/commit/975b55139eb5e5985462a1b4b2f2783aab61bace) Thanks [@marandaneto](https://github.com/marandaneto)! - Add opt-in `captureUnhandledRejections` for main-process unhandled promise rejections, and make `capture`, `screen` and `captureException` fire-and-forget.
  (2026-11-20)
