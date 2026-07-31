# @posthog/browser-common

## 0.3.0

### Minor Changes

- [#4300](https://github.com/PostHog/posthog-js/pull/4300) [`6b48a59`](https://github.com/PostHog/posthog-js/commit/6b48a59ed096a52f720a608ce59cc81c54c2ef4d) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Stream replayable remote config outcomes through shared browser extension clients.
  (2026-07-31)

## 0.2.5

### Patch Changes

- [#4325](https://github.com/PostHog/posthog-js/pull/4325) [`3bd8a2d`](https://github.com/PostHog/posthog-js/commit/3bd8a2d7599c0ee089594e27be39f3af171e5371) Thanks [@marandaneto](https://github.com/marandaneto)! - Fix dead-click false positives on WebKit when the SDK uses an iframe-sourced MutationObserver fallback.
  (2026-07-30)
- Updated dependencies [[`3bd8a2d`](https://github.com/PostHog/posthog-js/commit/3bd8a2d7599c0ee089594e27be39f3af171e5371)]:
    - @posthog/core@1.45.3

## 0.2.4

### Patch Changes

- [#4284](https://github.com/PostHog/posthog-js/pull/4284) [`fbd457f`](https://github.com/PostHog/posthog-js/commit/fbd457fbba704e9b42ff02728eae42ea844c7fd7) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Reduce extension runtime and contract overhead by replacing the `CoreExtension` and capability-token registry with one host-provided `Client`. Extensions now access analytics, identity, session, events, remote config, transport, persistence, and logging directly from that client.

    Cross-extension `getExtension`/`provides` lookup and session lifecycle observation are no longer part of the shared contract. Extension cleanup is synchronous and best-effort: resources are released in reverse registration order, and Promise-returning legacy cleanup is not awaited but rejected Promises are contained. (2026-07-28)

## 0.2.3

### Patch Changes

- [#4272](https://github.com/PostHog/posthog-js/pull/4272) [`2551b08`](https://github.com/PostHog/posthog-js/commit/2551b0840a810d252e40e61eb529785a780020a2) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Replace the extension client `apiRequest` bridge with `sendRequest`, exposing the public project token and caller-directed request targets, headers, and browser transports.
  (2026-07-27)

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
