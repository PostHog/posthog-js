# @posthog/react-native-plugin

## 2.12.0

### Minor Changes

- [#5111](https://github.com/PostHog/posthog-js/pull/5111) [`f8d7db4`](https://github.com/PostHog/posthog-js/commit/f8d7db4f4bf990e24ef46aeb33fcd0871c9aabab) Thanks [@ioannisj](https://github.com/ioannisj)! - Add `getSessionReplayDebugProperties()` to read the native SDK's session replay debug map
  (2026-09-25)

- [#5062](https://github.com/PostHog/posthog-js/pull/5062) [`63b38ad`](https://github.com/PostHog/posthog-js/commit/63b38ad01c1cd2a89e56c924242013b594138af0) Thanks [@github-actions](https://github.com/apps/github-actions)! - Add `errorTracking.autocapture.androidNdkCrashes` to capture native C/C++ (NDK) crashes on Android 12+ (requires `@posthog/react-native-plugin` 2.12.0). Update `posthog-android` to 3.71.1 so these crashes are stamped at the right time when the device clock disagrees with network time.
  (2026-09-25)

## 2.11.0

### Minor Changes

- [#5100](https://github.com/PostHog/posthog-js/pull/5100) [`17fb79b`](https://github.com/PostHog/posthog-js/commit/17fb79b4b5cb5c06460b7d4ac6c693547e9ecf1f) Thanks [@ioannisj](https://github.com/ioannisj)! - Attach the native session replay debug properties to native crash `$exception` events; requires posthog-ios 3.83.0 and posthog-android 3.70.0.
  (2026-09-25)

## 2.10.0

### Minor Changes

- [#5040](https://github.com/PostHog/posthog-js/pull/5040) [`ecdce70`](https://github.com/PostHog/posthog-js/commit/ecdce7043ffde8d3f7fbac50a5a86dd833798cce) Thanks [@hpouillot](https://github.com/hpouillot)! - Capture fatal React Native JavaScript exceptions through the embedded native SDK, which persists them to its own disk queue synchronously, so a crash is not lost when the process terminates before AsyncStorage finishes writing. The JS queue copy is dropped when native takes the event, so each crash is still sent once.

  Enabling `errorTracking.autocapture.uncaughtExceptions` now initializes the native PostHog SDK on its own, since that queue is what makes the fatal path durable. Apps that previously enabled neither session replay, native crash autocapture nor push will see one additional `/config` request per launch as a result: the native SDKs fetch remote config at setup regardless of `preloadFeatureFlags`. (2026-09-23)

## 2.9.4

### Patch Changes

- [#4973](https://github.com/PostHog/posthog-js/pull/4973) [`d59ac46`](https://github.com/PostHog/posthog-js/commit/d59ac4625a9c80487d96ff483f27cd921b5aa7a2) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Stop the native SDKs keeping their own opt-out state, so the consent the JS client resolves is the one they use at setup. Requires `posthog-android` 3.66.0 and `posthog-ios` 3.76.0.
  (2026-09-16)

## 2.9.3

### Patch Changes

- [#4929](https://github.com/PostHog/posthog-js/pull/4929) [`87aadf7`](https://github.com/PostHog/posthog-js/commit/87aadf706a77bfa9d886728b1083bbb3a55d557c) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Android: a notification tap that launched the app is no longer captured as `$push_notification_opened` while the JS client is opted out, even if an earlier launch had opted the native SDK in.
  (2026-09-15)

## 2.9.2

### Patch Changes

- [#4921](https://github.com/PostHog/posthog-js/pull/4921) [`197a212`](https://github.com/PostHog/posthog-js/commit/197a21252befe38dcd652c3fc49c5b30710adf35) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - iOS: a notification tap that launched the app is no longer captured as `$push_notification_opened` while the JS client is opted out, even if an earlier launch had opted the native SDK in.
  (2026-09-15)

- [#4921](https://github.com/PostHog/posthog-js/pull/4921) [`197a212`](https://github.com/PostHog/posthog-js/commit/197a21252befe38dcd652c3fc49c5b30710adf35) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Capture `$push_notification_opened` on iOS when a notification tap cold-launches the app, or set `com.posthog.posthog.CAPTURE_PUSH_NOTIFICATION_OPENED` to `false` in `Info.plist` to opt out before any PostHog code runs, as in posthog-flutter.
  (2026-09-15)

## 2.9.1

### Patch Changes

- [#4919](https://github.com/PostHog/posthog-js/pull/4919) [`61ef6a6`](https://github.com/PostHog/posthog-js/commit/61ef6a6f2d7e8387d7c316fbd88fdf447fd7de8d) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Count a PostHog notification tap once when both `capturePushNotificationOpened` and automatic capture report it, using the dedupe added in `posthog-android` 3.65.0 and `posthog-ios` 3.75.0. Update the native SDKs to `posthog-android` 3.65.2 and `posthog-ios` 3.75.2.
  (2026-09-15)

## 2.9.0

### Minor Changes

- [#4928](https://github.com/PostHog/posthog-js/pull/4928) [`c7e592f`](https://github.com/PostHog/posthog-js/commit/c7e592fdedd1dc0f6378a3cf80d5f9801e72f591) Thanks [@marandaneto](https://github.com/marandaneto)! - Add initialization-only `sessionReplayConfig.captureTouches` to disable replay touch coordinates without stopping screenshots on Android and iOS.
  (2026-09-14)

## 2.8.1

### Patch Changes

- [#4925](https://github.com/PostHog/posthog-js/pull/4925) [`ffea9f7`](https://github.com/PostHog/posthog-js/commit/ffea9f76ac434ce0c335d92c83f8110c19ccc5ba) Thanks [@aramslegit](https://github.com/aramslegit)! - Require posthog-ios 3.73.3 so React Native apps get the session replay masking fixes shipped in posthog-ios 3.73.2 and 3.73.3.
  (2026-09-12)

## 2.8.0

### Minor Changes

- [#4907](https://github.com/PostHog/posthog-js/pull/4907) [`fa6381b`](https://github.com/PostHog/posthog-js/commit/fa6381b072f2411460ff305aa7b9b230f351efa4) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Add experimental Android-only `screenshotScale`, `screenshotCompressionQuality`, and `screenshotColorMode` options to `sessionReplayConfig`, and bump `com.posthog:posthog-android` to 3.63.1.
  (2026-09-11)

## 2.7.0

### Minor Changes

- [#4886](https://github.com/PostHog/posthog-js/pull/4886) [`652a5bc`](https://github.com/PostHog/posthog-js/commit/652a5bc2b7a5c4c66d82ed886482f854c41be87d) Thanks [@itsalysialynn](https://github.com/itsalysialynn)! - Expose rageClickConfig for tuning or disabling native iOS rage click detection from React Native.
  (2026-09-11)

## 2.6.0

### Minor Changes

- [#4858](https://github.com/PostHog/posthog-js/pull/4858) [`233f501`](https://github.com/PostHog/posthog-js/commit/233f501c039ca254dee1112596cff9c1026dde62) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Capture `$push_notification_opened` on Android when a notification is tapped while the app is already running, not just on a cold start. Remove any manual `capturePushNotificationOpened` call you wired to `messaging().onNotificationOpenedApp` for Android: that tap is now captured automatically, so the manual call counts it a second time.
  (2026-09-10)

## 2.5.2

### Patch Changes

- [#4789](https://github.com/PostHog/posthog-js/pull/4789) [`f8013ed`](https://github.com/PostHog/posthog-js/commit/f8013ed497fdf37765358df23152b328c339e586) Thanks [@gabrieldonadel](https://github.com/gabrieldonadel)! - Skip the explicit Kotlin plugin when AGP provides built-in Kotlin

  Android Gradle Plugin 9 registers the `kotlin` extension itself, so applying
  `kotlin-android` on top of it fails configuration with "Cannot add extension with
  name 'kotlin'". The plugin is now applied only when nothing has registered that
  extension yet, which keeps AGP 8 working unchanged and covers AGP 10, where the
  `android.builtInKotlin` opt-out is removed. (2026-09-07)

## 2.5.1

### Patch Changes

- [#4677](https://github.com/PostHog/posthog-js/pull/4677) [`c984623`](https://github.com/PostHog/posthog-js/commit/c9846233872234a32050df3657836bf633ee82b6) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Update the native SDKs to `posthog-ios` 3.70.1 and `posthog-android` 3.61.0, fixing session replay masks drifting off their content during scroll, a crash when replay console-log capture tears down on iOS, and web-scoped surveys showing on native Android.
  (2026-08-28)

## 2.5.0

### Minor Changes

- [#4529](https://github.com/PostHog/posthog-js/pull/4529) [`ad6d5c6`](https://github.com/PostHog/posthog-js/commit/ad6d5c6b4bbcac41c40eb9a775ae863f917740a4) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Add `sessionReplayConfig.verifyScreenshotMaskAlignment` for Android session replay. This option requires `@posthog/react-native-plugin`.
  (2026-08-24)

## 2.4.3

### Patch Changes

- [#4630](https://github.com/PostHog/posthog-js/pull/4630) [`97e1cf8`](https://github.com/PostHog/posthog-js/commit/97e1cf813e11fefc71b396e5cd816116d74f708c) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Fix session replay started with `startRecording()` capturing nothing on Android by bumping `com.posthog:posthog-android` to `3.60.7`.
  (2026-08-24)

## 2.4.2

### Patch Changes

- [#4624](https://github.com/PostHog/posthog-js/pull/4624) [`41f276d`](https://github.com/PostHog/posthog-js/commit/41f276dbd987d776259bcbadc6a8fefcfa6a038d) Thanks [@marandaneto](https://github.com/marandaneto)! - Require posthog-ios 3.69.10 so native dSYMs are uploaded after they are ready.
  (2026-08-24)

## 2.4.1

### Patch Changes

- [#4585](https://github.com/PostHog/posthog-js/pull/4585) [`6a35dc7`](https://github.com/PostHog/posthog-js/commit/6a35dc7e38e944b779c6f6e47a666575fc2f5a09) Thanks [@marandaneto](https://github.com/marandaneto)! - Export the package metadata so consumers can resolve the installed plugin version.
  (2026-08-21)

## 2.4.0

### Minor Changes

- [#4505](https://github.com/PostHog/posthog-js/pull/4505) [`ace454d`](https://github.com/PostHog/posthog-js/commit/ace454d792e1f279114ee18984cc601616d5f448) Thanks [@marandaneto](https://github.com/marandaneto)! - Add native Swift Package Manager support for React Native 0.87's experimental CocoaPods-free iOS integration.
  (2026-08-13)

## 2.3.1

### Patch Changes

- [#4457](https://github.com/PostHog/posthog-js/pull/4457) [`bfdab20`](https://github.com/PostHog/posthog-js/commit/bfdab20be329b9f08fb70812db6d7f3578444db9) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Fix Android compilation with React Native 0.86.
  (2026-08-07)

## 2.3.0

### Minor Changes

- [#4429](https://github.com/PostHog/posthog-js/pull/4429) [`1b6ed5a`](https://github.com/PostHog/posthog-js/commit/1b6ed5ad44147774db4818c1dd8150625183d5a6) Thanks [@ioannisj](https://github.com/ioannisj)! - Add the native push notification bridge, so `posthog-react-native` can register device tokens and capture notification opens through the native PostHog SDKs.
  - Forwards the push config (`capturePushNotificationSubscriptions`, `capturePushNotificationOpened`) to posthog-ios and posthog-android at setup.
  - Bridges `registerPushNotificationToken`, `unregisterPushNotificationToken`, `capturePushNotificationOpened`, `setOptOut`, and `reset` for runtime control from JS.
  - Supports a JS `pushIdentityProvider` for projects that require identity-verified subscriptions.
  - Captures cold-start notification opens on Android by inspecting the launch Activity's intent at setup, which posthog-android's own lifecycle integration cannot observe in React Native apps. (2026-08-05)

## 2.2.4

### Patch Changes

- [#4392](https://github.com/PostHog/posthog-js/pull/4392) [`3d48c4b`](https://github.com/PostHog/posthog-js/commit/3d48c4bce2f44a5e9ec776b0f3ea2da19254cd27) Thanks [@github-actions](https://github.com/apps/github-actions)! - Raise the minimum posthog-ios dependency to 3.69.0 to include the rage-click sheet dismissal fix.
  (2026-08-03)

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
