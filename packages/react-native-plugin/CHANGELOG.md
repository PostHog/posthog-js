# @posthog/react-native-plugin

## 2.2.3

### Patch Changes

- [#4154](https://github.com/PostHog/posthog-js/pull/4154) [`7c9de2f`](https://github.com/PostHog/posthog-js/commit/7c9de2f6dd0114fd5d222dba6749fbae69e7d688) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Bump `com.posthog:posthog-android` to `3.54.0` to pick up the session replay ANR fix from 3.53.7: clearing the replay buffer on session rotation (e.g. `identify()` at login) no longer blocks the main thread waiting on the replay executor.
  (2026-07-15)

## 2.2.2

### Patch Changes

- [#4148](https://github.com/PostHog/posthog-js/pull/4148) [`f4694e9`](https://github.com/PostHog/posthog-js/commit/f4694e93eb951beb5eeb87a12cc3d74829d85949) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Require posthog-ios 3.64.7 or later, so release builds can skip conflicting dSYM uploads (the Expo plugin's `skipOnConflict` option) instead of failing when a dSYM with the same UUID but different content already exists in PostHog.
  (2026-07-14)

## 2.2.1

### Patch Changes

- [#4126](https://github.com/PostHog/posthog-js/pull/4126) [`c5477ce`](https://github.com/PostHog/posthog-js/commit/c5477ceb7b7cab752edd43bc77208c871df2fc69) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Fix fatal JS errors being double-reported on Android in minified release builds: the plugin's dedup matched serialized class-name strings, which R8/ProGuard renaming can defeat. It now registers `JavascriptException` in posthog-android's `errorTrackingConfig.ignoredExceptionTypes` (requires core 6.24.0), which matches by class across the cause chain and is unaffected by minification.
  (2026-07-10)

## 2.2.0

### Minor Changes

- [#4110](https://github.com/PostHog/posthog-js/pull/4110) [`da33d9e`](https://github.com/PostHog/posthog-js/commit/da33d9e6ae76d9f72284e2a590d0df002c2e9ce7) Thanks [@ioannisj](https://github.com/ioannisj)! - Add macOS support so the plugin builds on react-native-macos targets. The podspec now declares an `osx` platform, and all iOS-only posthog-ios APIs (session replay config, surveys, session-recording controls) are guarded with `#if os(iOS)`. Session replay remains iOS-only; macOS gets native error tracking.
  (2026-07-10)

## 2.1.2

### Patch Changes

- [#3970](https://github.com/PostHog/posthog-js/pull/3970) [`0f83f93`](https://github.com/PostHog/posthog-js/commit/0f83f93a6e78605444b2fe914e12c526ac3250d3) Thanks [@github-actions](https://github.com/apps/github-actions)! - Add a `requestHeaders` option to send custom headers (e.g. `Authorization`) with SDK requests, including session replay and native error/crash uploads via the native plugin. Useful for reverse-proxy setups that require authentication.
  (2026-07-01)

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
