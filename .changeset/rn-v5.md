---
'posthog-react-native': major
---

- **Breaking:** stop loading `posthog-react-native-session-replay` when `@posthog/react-native-plugin` isn't installed — install `@posthog/react-native-plugin` 3.0 or later for session replay and native features
- **Breaking:** require `@posthog/react-native-plugin` 3.0 or later
- **Breaking:** remove the `PostHogProvider` `apiKey` prop — pass `projectToken` instead
- **Breaking:** remove `evaluationEnvironments` from the `PostHogOptions` type — pass `evaluationContexts` instead
- **Breaking:** remove `disableRemoteConfig`, which had no effect, from the `PostHogOptions` type
- **Breaking:** remove `sessionReplayConfig.iOSdebouncerDelayMs` and `androidDebouncerDelayMs` — pass `throttleDelayMs` instead
- **Breaking:** remove `sessionReplayConfig.screenshotModeBackgroundCapture` — pass `iOSCaptureMethod: 'background'` instead
- Add `sessionReplayConfig.iOSCaptureMethod` to choose how iOS captures replay screenshots: `'standard'` (default), `'background'` or experimental `'gpu'`
- **Breaking:** remove the `autocapture.navigationRef` option and the `PostHogNavigationRef` type, and drop the `navigationRef` argument from `useNavigationTracker(options, client)`
