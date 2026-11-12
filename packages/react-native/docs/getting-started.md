# Getting started

The React Native SDK runs in iOS and Android apps, including Expo apps.

To send your first event, install `posthog-react-native` and the peer dependencies that the [install guide](https://posthog.com/docs/product-analytics/installation/react-native) lists for Expo or the React Native CLI.

Then wrap your app in `PostHogProvider` with your project token and host from your [project settings](https://app.posthog.com/project/settings), and call `capture` on the client that `usePostHog` returns.

## Install

```bash
npm install posthog-react-native
```

## Initialize

Wrap your app in `PostHogProvider`.

```tsx
import { PostHogProvider } from 'posthog-react-native'

export default function App() {
  return (
    <PostHogProvider apiKey="<ph_project_api_key>" options={{ host: 'https://us.i.posthog.com' }}>
      <YourApp />
    </PostHogProvider>
  )
}
```

## Capture an event

```tsx
import { usePostHog } from 'posthog-react-native'

const posthog = usePostHog()
posthog.capture('signed_up', { plan: 'pro' })
```

## Identify a user

```tsx
posthog.identify('user_123', { email: 'user@example.com' })
```

## Choose an iOS dependency path for the native plugin

The optional `@posthog/react-native-plugin` package needs `posthog-ios`. Choose one path to resolve it.

| Path                                                       | Requirements                                                                                                 | Setup                                                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| CocoaPods                                                  | A project that uses CocoaPods                                                                                | Run `pod install` in `ios`. The plugin podspec adds `posthog-ios` for you. This is the default.                                                       |
| CocoaPods with `posthog-ios` through Swift Package Manager | React Native 0.75 or later and dynamic frameworks                                                            | Set `"posthog.useSpm": "true"` in `ios/Podfile.properties.json`. Add `use_frameworks! :linkage => :dynamic` to `ios/Podfile`. Then run `pod install`. |
| Full Swift Package Manager                                 | `@posthog/react-native-plugin` 2.4.0 or later, Xcode 16 or later, and an iOS 15.1 or later deployment target | Run `npx react-native spm add --deintegrate --yes` in `ios`. Don't run `pod install`.                                                                 |

The hybrid path changes only how the plugin resolves `posthog-ios`. The plugin and your other dependencies still use CocoaPods.

The full path uses React Native's experimental integration without CocoaPods. Every native dependency in your app must support it. `--deintegrate` removes CocoaPods from the iOS project, so commit or back up the project first. PostHog verifies this path with an iOS-only React Native 0.87.1 app and React Native Community CLI 20.2.0. It is not verified with Expo.

The CocoaPods and hybrid paths keep the plugin's iOS 13 minimum.

## Offline behavior

The SDK keeps capturing events when the device is offline. With `persistence: 'file'`, the queue is stored on the device and survives an app restart. The SDK flushes the queue only when the device is online. When the queue reaches `maxQueueSize`, the SDK deletes the oldest event first.

## Tracing header hostnames

`addTracingHeaders` matches hostnames exactly. Pass hostnames only, without a protocol or path.

## Error boundaries and console capture

React logs render errors to the console. If you use `PostHogErrorBoundary` with console capture enabled, each render error is captured twice. Set `errorTracking: { autocapture: { console: [] } }` to avoid this.

## Survey targeting

Surveys in React Native don't support URL or CSS selector targeting. Surveys that rely on these conditions don't appear.

## Minimum versions

- `captureAppLifecycleEvents` is on by default from 4.39.0.
- `disableRemoteFeatureFlags` needs 4.49.0 or later.
- `androidNdkCrashes` needs `posthog-react-native` 4.78.0 or later.

## Upgrade from an older major

| From  | Change                                                                                                                                                                                                                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.x.x | Replace `PostHog.setup(...)` with `new PostHog(token, options)` or `PostHogProvider`. `PostHogProvider` replaces `captureApplicationLifecycleEvents` and `recordScreenViews`. Remove `captureDeepLinks`, `android`, and `iOS`.                                                                             |
| 2.x.x | Replace `await PostHog.initAsync(...)` with `new PostHog(token, options)`.                                                                                                                                                                                                                                 |
| 3.x.x | Rename `captureNativeAppLifecycleEvents` and `autocapture={{ captureLifecycleEvents: true }}` to `captureAppLifecycleEvents`. Remove `captureMode` and `maskPhotoLibraryImages`. Call `setPersonPropertiesForFlags` and `setGroupPropertiesForFlags` in place of `personProperties` and `groupProperties`. |

1.x.x wrapped the native iOS and Android SDKs. Later majors are written in JavaScript. On iOS, the SDK migrates the persisted distinct ID and anonymous ID. On Android, it can't load them, so call `identify` when the app loads. Anonymous Android users appear as new users.

The SDK can't detect a real install. It stores a marker the first time it loads and sends `Application Installed` then. Expect more `Application Installed` events after you upgrade from 1.x.x.
