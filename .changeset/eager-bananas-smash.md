---
'posthog-react-native': patch
'@posthog/core': patch
---

Don't autocapture PostHog's own `PostHogFetchNetworkError` (raised when the device is offline) as a `$exception`. These connectivity failures are expected and were flooding error tracking with internal SDK noise. Adds an `isPostHogFetchNetworkError` type guard to `@posthog/core` so SDKs can detect these errors.
