# Migrating `@posthog/react-native-plugin` from 2.x to 3.0

If you only use the plugin through `posthog-react-native`, you don't need any JavaScript changes, but the build requirements below still apply. The API sections matter only if your code imports the plugin directly.

## Requirements

|                                                     | 2.x                                                             | 3.0                   |
| --------------------------------------------------- | --------------------------------------------------------------- | --------------------- |
| React Native (`react-native`, `react-native-macos`) | Any on Android, 0.69 on iOS                                     | 0.75 or later         |
| iOS deployment target                               | 13.0                                                            | 15.0                  |
| macOS deployment target                             | 10.15                                                           | 11.0                  |
| How `posthog-ios` is installed                      | CocoaPods trunk, or Swift Package Manager with `posthog.useSpm` | Swift Package Manager |

Android `minSdk` stays at 23, and the plugin now requires `posthog-android` 4.0. `posthog-react-native` still accepts this plugin through its optional `>= 2.12.7` peer range, and 4.47.0 is the first version that loads the plugin.

Expo SDK 52 is the first Expo SDK that meets the React Native and iOS requirements. The Expo config plugin needs no changes.

## Build changes

### React Native 0.75

`posthog-ios` now installs through React Native's `spm_dependency` helper, which first ships in 0.75.

**If ignored:** `pod install` fails with `requires React Native 0.75 or later`. Android builds fail below 0.71 with `Could not find com.facebook.react:react-android`. Android apps on 0.71 to 0.74 still build, but they are outside the supported range and get a peer dependency warning.

### iOS 15 and macOS 11

```ruby
# ios/Podfile: before
platform :ios, min_ios_version_supported

# ios/Podfile: after
platform :ios, '15.0'
```

On React Native 0.75, `min_ios_version_supported` is 13.4, so those apps must raise the target. React Native 0.76 and later already default to 15.1.

**If ignored:** `pod install` fails because the plugin needs a higher deployment target.

### `posthog-ios` installs through Swift Package Manager

The plugin is still a CocoaPod, but it no longer depends on the `PostHog` pod. Remove the old opt-in, which is now ignored:

```diff
 // ios/Podfile.properties.json
 {
-  "posthog.useSpm": "true"
 }
```

`use_frameworks! :linkage => :dynamic` is no longer needed for this path, so keep it only if another dependency needs it. With static linkage, `pod install` prints React Native's generic "might cause linker errors" warning for Swift packages.

**Podfile options that now fail `pod install`.** React Native's helper can't add a package to these setups, so the plugin stops with an error that names the problem:

- `install! 'cocoapods', :generate_multiple_pod_projects => true`
- `install! 'cocoapods', :deduplicate_targets => false`
- Several targets that use the plugin with different `platform` or `use_frameworks!` settings

**Changes with no install error:**

- **Builds fetch `posthog-ios` from GitHub.** Xcode resolves it from `https://github.com/PostHog/posthog-ios.git`, so build machines need access to it. `Podfile.lock` no longer records its version.
- **Your own native code may stop compiling.** React Native's helper adds the package only to the plugin's pod target, not your app target. We haven't tested this case, but if your app target has `import PostHog` and it no longer resolves, add `posthog-ios` to that target as a Swift package with a compatible version.
- **Custom dSYM upload scripts can stop working.** `${PODS_ROOT}/PostHog/build-tools/upload-symbols.sh` no longer exists. Use `${BUILD_DIR%/Build/*}/SourcePackages/checkouts/posthog-ios/build-tools/upload-symbols.sh`. The `uploadNativeSymbols` build phase from the Expo config plugin already checks both paths.
- **Remove `posthog-react-native-session-replay` if you still have it.** Its pod brings in `posthog-ios` from CocoaPods alongside the plugin's Swift package, and that combination is untested.

### `posthog-android` 4.0

If native code in your app calls `posthog-android` directly, it must handle the 4.0 API removals listed in the `posthog-android` changelog.

## API changes

These apply only if your code calls the plugin directly.

### `start()` is removed

Call `setup()`, which takes the replay settings under `sessionReplay`. Set `enabled: true`, because `start()` always started replay and `setup()` doesn't by default.

```ts
// Before
await start(sessionId, sdkOptions, sdkReplayConfig, decideReplayConfig)

// After
await setup(sessionId, sdkOptions, {
  sessionReplay: { enabled: true, sdkReplayConfig, decideReplayConfig },
})
```

**If ignored:** TypeScript reports a compile error. Untyped code fails at runtime because `start` is undefined.

## Behavior changes with no build error

### `iOSdebouncerDelayMs` and `androidDebouncerDelayMs` are ignored

The plugin's `setup()` now reads only `throttleDelayMs`. `posthog-react-native` still maps its deprecated options to `throttleDelayMs`, so this affects only direct calls.

```ts
// Before
sdkReplayConfig: { iOSdebouncerDelayMs: 500, androidDebouncerDelayMs: 500 }

// After
sdkReplayConfig: { throttleDelayMs: 500 }
```

**If ignored:** replay silently uses the 1000 ms default.

### `screenshotModeBackgroundCapture` is ignored on iOS

This experimental option no longer has any effect, and screenshots are captured on the main thread. `posthog-react-native` ## Native SDK 4.0: not merged yet

<!-- Before release: finish #5237, move what shipped into the sections above, and delete this heading. -->

3.0.0 isn't meant to ship until it requires `posthog-ios` 4.0 ([#5237](https://github.com/PostHog/posthog-js/pull/5237)). That PR is open and could change, and this branch still pins `posthog-ios` 3.92.7. If it lands as written:

- iOS builds need Xcode 26 or later.
- iOS native uploads, such as session replay and native crash reports, pause while cellular data is turned off for the app.
- Apps on React Native's full Swift Package Manager integration leave out native surveys. The plugin doesn't use them, because surveys render in JavaScript.
- Native code in your app that calls `posthog-ios` directly must handle its 4.0 API removals. See the [posthog-ios migration guide](https://github.com/PostHog/posthog-ios/blob/main/MIGRATION.md).

ipt.

- Native code in your app that calls PostHog's iOS or Android SDK directly must handle their 4.0 API removals. See the [posthog-ios migration guide](https://github.com/PostHog/posthog-ios/blob/main/MIGRATION.md).

## Checklist

- [ ] React Native is 0.75 or later, or Expo SDK is 52 or later.
- [ ] The iOS deployment target is 15.0 or later, and macOS is 11.0 or later if you ship it.
- [ ] `posthog.useSpm` is gone from `ios/Podfile.properties.json`.
- [ ] Your Podfile doesn't use `generate_multiple_pod_projects`, `deduplicate_targets => false`, or plugin targets with mixed platform or linkage settings.
- [ ] Build machines can reach `github.com/PostHog/posthog-ios`.
- [ ] Native `import PostHog` code still compiles, and custom dSYM upload scripts are updated.
- [ ] `posthog-react-native-session-replay` is removed.
- [ ] Direct `start()` calls now use `setup()`, and direct `setup()` calls pass `throttleDelayMs`.
- [ ] `screenshotModeBackgroundCapture` is removed.
