# @rrweb/utils

## 0.0.63

### Patch Changes

- [#4128](https://github.com/PostHog/posthog-js/pull/4128) [`9bd3ef0`](https://github.com/PostHog/posthog-js/commit/9bd3ef06283c8f6a869df6880e7fc2b2d04f69cc) Thanks [@pauldambra](https://github.com/pauldambra)! - fix: keep the untainted-prototype fallback iframe attached on Safari so MutationObserver callbacks are not silently dropped (port of upstream rrweb #1854)
  (2026-07-15)

## 0.0.62

### Patch Changes

- [#4118](https://github.com/PostHog/posthog-js/pull/4118) [`f630394`](https://github.com/PostHog/posthog-js/commit/f6303946729b2882e495a06d75b8458433a74646) Thanks [@posthog](https://github.com/apps/posthog)! - Fix a `RangeError: Maximum call stack size exceeded` originating from the shared rrweb `patch()` helper. It patches shared globals such as `Element.prototype.attachShadow` (shadow-dom-manager) and the DOM/canvas observers, so multiple recorder instances or repeated start/stop cycles wrap the same global more than once. Previously an out-of-order restore silently no-op'd, leaving the wrapper in the call path; repeated cycles grew the wrapper chain without bound until a real call walked a chain deep enough to overflow the stack. Wrappers now delegate through a mutable per-layer link so any layer can be torn down even when newer wrappers sit on top of it, keeping the chain bounded. Recording behavior is unchanged. This applies the same fix as #4063 (fetch/XHR) to the shared helper so every rrweb-record caller inherits the bounded-chain behavior.
  (2026-07-10)

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
