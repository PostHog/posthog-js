# @posthog/browser-common

## 0.6.2

### Patch Changes

- [#4669](https://github.com/PostHog/posthog-js/pull/4669) [`d0279e5`](https://github.com/PostHog/posthog-js/commit/d0279e5bc8758d12825927f4565d981f21085288) Thanks [@posthog](https://github.com/apps/posthog)! - Autocapture no longer throws a `RangeError` into the host page when it sorts element attributes. It now sorts attribute keys with a plain lexical comparator instead of `localeCompare`, which can throw on browsers with faulty ICU data.
  (2026-08-28)

## 0.6.1

### Patch Changes

- [#4636](https://github.com/PostHog/posthog-js/pull/4636) [`74ff567`](https://github.com/PostHog/posthog-js/commit/74ff567fa5c065f3e30c007c7a5155d2c7f1cee7) Thanks [@yfwmaniish](https://github.com/yfwmaniish)! - Narrow the `pinterest` entry in the bot-detection blocklist to `pinterestbot`, so real users on Pinterest's in-app browser (whose UA also contains the substring `pinterest`) are no longer misclassified as bots and silently excluded from analytics. The crawler's other UA variant remains covered by the existing generic `bot.htm` entry, so no bot-detection coverage is lost.
  (2026-08-27)
- Updated dependencies [[`74ff567`](https://github.com/PostHog/posthog-js/commit/74ff567fa5c065f3e30c007c7a5155d2c7f1cee7)]:
    - @posthog/core@1.49.1

## 0.6.0

### Minor Changes

- [#4592](https://github.com/PostHog/posthog-js/pull/4592) [`ca540f9`](https://github.com/PostHog/posthog-js/commit/ca540f94f2c301f4ea8f5273a250ac2516292613) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Add typed stable-name lookup for installed browser extensions and use it when independently loaded survey code resolves feature flags.
  (2026-08-25)

### Patch Changes

- [#4533](https://github.com/PostHog/posthog-js/pull/4533) [`53fcb2d`](https://github.com/PostHog/posthog-js/commit/53fcb2d34eac1e83afbfa810ab7b9e9f691d6ce6) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Expose host capture permission to browser extensions.
  (2026-08-25)
- Updated dependencies [[`ed4dd97`](https://github.com/PostHog/posthog-js/commit/ed4dd97d461f9dd871507c8b929ab38cae376181)]:
    - @posthog/types@1.406.1

## 0.5.2

### Patch Changes

- [#4611](https://github.com/PostHog/posthog-js/pull/4611) [`d4eee8f`](https://github.com/PostHog/posthog-js/commit/d4eee8fe12de2caab4e91d6a0ada25ee6b822e12) Thanks [@marandaneto](https://github.com/marandaneto)! - Share survey property matching between the browser and React Native SDKs while preserving their existing missing-value behavior.
  (2026-08-25)
- Updated dependencies [[`930de19`](https://github.com/PostHog/posthog-js/commit/930de1960872cb73d85bbeb71d8d5159d1740c74), [`d4eee8f`](https://github.com/PostHog/posthog-js/commit/d4eee8fe12de2caab4e91d6a0ada25ee6b822e12)]:
    - @posthog/core@1.48.11

## 0.5.1

### Patch Changes

- [#4532](https://github.com/PostHog/posthog-js/pull/4532) [`60ee0ac`](https://github.com/PostHog/posthog-js/commit/60ee0ac04c3c08a467717464b4936d74e7d1532e) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Migrate surveys to the shared browser extension lifecycle.
  (2026-08-24)

## 0.5.0

### Minor Changes

- [#4316](https://github.com/PostHog/posthog-js/pull/4316) [`f999394`](https://github.com/PostHog/posthog-js/commit/f9993947c7436672f5daf2a2a284fa1c9771f602) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Add richer client request and identity context alongside initialized, synchronously buffered batch key-value persistence operations.
  (2026-08-11)

## 0.4.0

### Minor Changes

- [#4376](https://github.com/PostHog/posthog-js/pull/4376) [`2da12b8`](https://github.com/PostHog/posthog-js/commit/2da12b8cbe7c3fa2354bfc157a4db927ef5a3ac1) Thanks [@posthog](https://github.com/apps/posthog)! - Add attribute-level masking to session replay: `maskAttributeFn` provides per-attribute control over the final serialized value, while `maskAllElementAttributes` masks all source DOM string attributes (including rendering attributes and synthesized form values) at the cost of replay fidelity.
  (2026-08-05)

### Patch Changes

- Updated dependencies [[`2da12b8`](https://github.com/PostHog/posthog-js/commit/2da12b8cbe7c3fa2354bfc157a4db927ef5a3ac1)]:
    - @posthog/types@1.402.0

## 0.3.1

### Patch Changes

- [#4340](https://github.com/PostHog/posthog-js/pull/4340) [`4b8867c`](https://github.com/PostHog/posthog-js/commit/4b8867c1e3f752b29ae17339870bd7175d5117c5) Thanks [@marandaneto](https://github.com/marandaneto)! - Avoid redacting session replay network bodies when timestamps or UUID fragments resemble social security or credit card numbers.
  (2026-07-31)

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
