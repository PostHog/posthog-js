# @posthog/react-native-plugin

## 2.0.0 (deprecated)

> **Deprecated:** when native crash autocapture is enabled, this version can report a fatal React Native JS error twice — once from the JS layer and once as a rethrown native crash. Use 2.0.1 or later, which drops the duplicate native capture.

### Major Changes

- [#3783](https://github.com/PostHog/posthog-js/pull/3783) [`04da1f8`](https://github.com/PostHog/posthog-js/commit/04da1f8dd142366de03c0adf305ca5bec490e27a) Thanks [@ioannisj](https://github.com/ioannisj)! - First release under the new name `@posthog/react-native-plugin`, picking up from `posthog-react-native-session-replay@1.6.0`. Alongside the existing session replay support, the plugin now enables native error tracking — iOS and Android crash autocapture via the underlying PostHog mobile SDKs. It will be consumed by future versions of `posthog-react-native`.
  (2026-06-10)
