# @posthog/react-native-plugin

## 2.1.1

### Patch Changes

- [#3931](https://github.com/PostHog/posthog-js/pull/3931) [`8b62007`](https://github.com/PostHog/posthog-js/commit/8b62007a4e41c77b26b6c5828b0f399972541856) Thanks [@ioannisj](https://github.com/ioannisj)! - Raise the native SDK floor to the releases that skip session-replay event-trigger gating for React Native: posthog-ios `~> 3.61.1` and `com.posthog:posthog-android:3.51.1`. Required for React Native event-triggered session replay to record.
  (2026-06-23)

## 2.1.0

### Minor Changes

- [#3861](https://github.com/PostHog/posthog-js/pull/3861) [`c3a38fd`](https://github.com/PostHog/posthog-js/commit/c3a38fd9680c80f5115fababd610be7c17557b96) Thanks [@ioannisj](https://github.com/ioannisj)! - Add `addExceptionStep(message, properties?)` for breadcrumb-style exception steps. Steps accumulate in a rolling, byte-bounded buffer (configurable via `errorTracking.exceptionSteps`) and are attached to every captured `$exception` as `$exception_steps`, giving the error tracking UI a timeline of recent activity before each error. When native crash capture is enabled, steps are forwarded to the embedded native SDK so native crashes carry the same timeline.
  (2026-06-19)

## 2.0.1

### Patch Changes

- [#3824](https://github.com/PostHog/posthog-js/pull/3824) [`bd80c7c`](https://github.com/PostHog/posthog-js/commit/bd80c7ce90a802c88674178799864a248dda089c) Thanks [@ioannisj](https://github.com/ioannisj)! - Drop native captures of fatal React Native JS errors that the JS layer already reports, so a fatal JS error no longer produces two `$exception` events. Works on Android (both architectures) and iOS (old architecture only). On the iOS new architecture, fatal JS exception events surface as a generic `SIGABRT` crash event with no JS-error text in any field, so they currently cannot be filtered
  (2026-06-12)

- [#3824](https://github.com/PostHog/posthog-js/pull/3824) [`bd80c7c`](https://github.com/PostHog/posthog-js/commit/bd80c7ce90a802c88674178799864a248dda089c) Thanks [@ioannisj](https://github.com/ioannisj)! - Apply the session replay configuration at native SDK setup even when replay starts disabled, so recording turned on later (e.g. `startRecording` or a linked feature flag) uses screenshot mode, the configured masking, and the configured snapshot endpoint instead of wireframe/default settings
  (2026-06-12)

## 2.0.0

### Major Changes

- [#3783](https://github.com/PostHog/posthog-js/pull/3783) [`04da1f8`](https://github.com/PostHog/posthog-js/commit/04da1f8dd142366de03c0adf305ca5bec490e27a) Thanks [@ioannisj](https://github.com/ioannisj)! - First release under the new name `@posthog/react-native-plugin`, picking up from `posthog-react-native-session-replay@1.6.0`. Alongside the existing session replay support, the plugin now enables native error tracking — iOS and Android crash autocapture via the underlying PostHog mobile SDKs. It will be consumed by future versions of `posthog-react-native`.
  (2026-06-10)
