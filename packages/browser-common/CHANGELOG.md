# @posthog/browser-common

## 0.2.2

### Patch Changes

- [#4240](https://github.com/PostHog/posthog-js/pull/4240) [`7210789`](https://github.com/PostHog/posthog-js/commit/7210789efa46a6e2a1aa51b2faba4f67187f6cf6) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Add the shared extension runtime and `CoreExtension` capability contract, expose core observer and configuration payloads as deeply readonly views, allow key-value stores to return values synchronously or asynchronously, and expose host API response details. Nullish values passed to `set` follow host-native storage semantics; use `remove` to delete a key.
  (2026-07-27)

## 0.2.1

### Patch Changes

- [#4225](https://github.com/PostHog/posthog-js/pull/4225) [`4bf533a`](https://github.com/PostHog/posthog-js/commit/4bf533a629fafd0c525e6259ed27250ce1367964) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Represent extension capability tokens as branded runtime strings so independently compiled bundles resolve the same providers.
  (2026-07-23)

## 0.2.0

### Minor Changes

- [#4194](https://github.com/PostHog/posthog-js/pull/4194) [`d39b903`](https://github.com/PostHog/posthog-js/commit/d39b903f8f77e32f729703156fa5a9430d778104) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Move shared browser utility implementations into `@posthog/browser-common` and consume them directly from `posthog-js`.
  (2026-07-21)

## 0.1.0

### Minor Changes

- [#4190](https://github.com/PostHog/posthog-js/pull/4190) [`7b8a11c`](https://github.com/PostHog/posthog-js/commit/7b8a11cdefdede6614ea1f1812e48fd49a8a3671) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Initial publish
  (2026-07-17)
