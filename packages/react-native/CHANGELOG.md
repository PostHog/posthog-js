# posthog-react-native

## 4.66.0

### Minor Changes

- [#4617](https://github.com/PostHog/posthog-js/pull/4617) [`b73d15e`](https://github.com/PostHog/posthog-js/commit/b73d15e80fbbf80a078b0fa7226541dea7c1b7e2) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - Add experimental event release mode to React Native builds. Set `releaseMode: 'event'` on the `posthog-react-native/expo` config plugin (or export `POSTHOG_RELEASE_MODE=event`, or set `posthog.releaseMode=event` in `android/gradle.properties`) and the build uploads its Hermes source maps, iOS dSYMs and Android R8 mappings without binding them to a release. Each exception then resolves its own release from the `$app_namespace` / `$app_version` / `$app_build` the SDK already sends, instead of inheriting the release of the symbols its frames resolved against. Use it when two releases can ship identical JavaScript or identical native code: symbol ids are derived from content, so the default `symbol-set` mode makes both releases report whichever one uploaded first. An unrecognized mode fails the build rather than falling back. The Hermes upload needs posthog-cli 0.16.0 or newer, which carries `--release-mode` on its `hermes` commands; an older one fails the build and names the upgrade.

  The Android mapping upload needs the `com.posthog.android` gradle plugin 1.5.0 or newer, which reads `posthog.releaseMode`. A fresh prebuild now injects 1.5.1. A project whose `android/build.gradle` already has the classpath line keeps its version, so bump that line to 1.5.0 or newer by hand, or prebuild with `--clean`. On 1.4.0 the mapping stays bound to a release while the Hermes maps do not. (2026-08-27)

## 4.65.1

### Patch Changes

- [#4616](https://github.com/PostHog/posthog-js/pull/4616) [`7902e44`](https://github.com/PostHog/posthog-js/commit/7902e445d0a66b93bd4c7febce04cdf8836ea86b) Thanks [@shahidrogers](https://github.com/shahidrogers)! - Stop crashing when the environment's `Math.random()` misbehaves. The vendored UUIDv7 generator builds its random fields from a `Math.random()`-based `nextUint32()`, and a nonconformant implementation that returns a value of 1 or greater, or NaN, pushed those fields out of range, so `fromFieldsV7` threw `RangeError: invalid field value` on every event captured. On React Native this is not hypothetical: Hermes implements `Math.random` with C++ `std::uniform_real_distribution`, which is documented to occasionally return its upper bound, and affected Android devices crash-looped on startup during the SDK's internal event-queue flush — a path applications cannot wrap in a try/catch. `nextUint32()` now clamps its result to a valid unsigned 32-bit integer (`>>> 0`), so a bad random value degrades UUID entropy for that id instead of taking the app down; the timestamp bits are untouched and generated ids remain spec-valid UUIDv7.
  (2026-08-27)
- Updated dependencies [[`7902e44`](https://github.com/PostHog/posthog-js/commit/7902e445d0a66b93bd4c7febce04cdf8836ea86b), [`e899b1c`](https://github.com/PostHog/posthog-js/commit/e899b1cdc6fbe748b8adc59e3b6bebe24f3b0524)]:
  - @posthog/core@1.48.12

## 4.65.0

### Minor Changes

- [#4643](https://github.com/PostHog/posthog-js/pull/4643) [`35dcb94`](https://github.com/PostHog/posthog-js/commit/35dcb94877c086cd7a2f4a49f6d9c20a8b178ab1) Thanks [@ioannisj](https://github.com/ioannisj)! - Autocapture touches and clicks on React Native Web (including expo-router on web). Touch events there carry no `_targetInst` and every touch was silently dropped, so the element chain is now resolved by walking up from `e.target` to the nearest node carrying a React fiber. `captureTouches` also registers a capture-phase `click` listener on the document on web, emitted with `$event_type: 'click'`, since browsers fire `touchend` only for touch input (react-native-web's `Pressable` stops propagation, and `Modal` renders outside the provider's subtree). Autocapture no longer lets an exception escape into the host app's event dispatch.
  (2026-08-26)

### Patch Changes

- [#4650](https://github.com/PostHog/posthog-js/pull/4650) [`e03f5d1`](https://github.com/PostHog/posthog-js/commit/e03f5d14a2e4938164aa40afb298c774ffa24b4c) Thanks [@marandaneto](https://github.com/marandaneto)! - Accept CSS-style survey positions such as `bottom-right` and align them with their canonical `SurveyPosition` values.
  (2026-08-26)

- [#4654](https://github.com/PostHog/posthog-js/pull/4654) [`aad1494`](https://github.com/PostHog/posthog-js/commit/aad14948feff3a62698d1e4321ba367b535ba448) Thanks [@marandaneto](https://github.com/marandaneto)! - Deduplicate unknown survey position warnings after normalizing equivalent position names.
  (2026-08-26)

- [#4649](https://github.com/PostHog/posthog-js/pull/4649) [`ec78dec`](https://github.com/PostHog/posthog-js/commit/ec78decc4aa982556566b31cb5ae1342f00cb05d) Thanks [@github-actions](https://github.com/apps/github-actions)! - Respect `ph-no-capture` on any ancestor of a touched or clicked element. Previously an interaction deep inside an opted-out subtree could still send an `$autocapture` event carrying that subtree's element text and props, so apps relying on a high-level `ph-no-capture` may see fewer `$autocapture` events after upgrading. Interactions more than 1000 elements deep in the view hierarchy now produce no `$autocapture` event rather than a truncated one. A non-numeric `maxElementsCaptured` now falls back to the default of 20 instead of being treated as no cap at all.
  (2026-08-26)
- Updated dependencies [[`ab1383a`](https://github.com/PostHog/posthog-js/commit/ab1383a8471b003124161c5839c15debacbc1e28), [`0d2cf49`](https://github.com/PostHog/posthog-js/commit/0d2cf4941d0e6306f51666305fbdaa8669a631d2)]:
  - @posthog/types@1.406.2

## 4.64.3

### Patch Changes

- [#4647](https://github.com/PostHog/posthog-js/pull/4647) [`3da18f9`](https://github.com/PostHog/posthog-js/commit/3da18f9a910eef497fb8141c05e7bed8ccbeb0fc) Thanks [@marandaneto](https://github.com/marandaneto)! - Ensure the Expo native-symbol upload phase runs last and declares the main app dSYM as an Xcode input, preventing EAS archives from uploading symbols before the dSYM is ready.
  (2026-08-25)

## 4.64.2

### Patch Changes

- [#4634](https://github.com/PostHog/posthog-js/pull/4634) [`e81d375`](https://github.com/PostHog/posthog-js/commit/e81d3755c019534b7d980106b5bad10a41e5f9fa) Thanks [@marandaneto](https://github.com/marandaneto)! - Use posthog-cli 0.15.1 and newer to read iOS release metadata directly from Info.plist during Hermes source map uploads.
  (2026-08-25)

- [#4611](https://github.com/PostHog/posthog-js/pull/4611) [`d4eee8f`](https://github.com/PostHog/posthog-js/commit/d4eee8fe12de2caab4e91d6a0ada25ee6b822e12) Thanks [@marandaneto](https://github.com/marandaneto)! - Share survey property matching between the browser and React Native SDKs while preserving their existing missing-value behavior.
  (2026-08-25)
- Updated dependencies [[`930de19`](https://github.com/PostHog/posthog-js/commit/930de1960872cb73d85bbeb71d8d5159d1740c74), [`d4eee8f`](https://github.com/PostHog/posthog-js/commit/d4eee8fe12de2caab4e91d6a0ada25ee6b822e12)]:
  - @posthog/core@1.48.11

## 4.64.1

### Patch Changes

- [#4604](https://github.com/PostHog/posthog-js/pull/4604) [`42ffca6`](https://github.com/PostHog/posthog-js/commit/42ffca657f9056eaccdbaf8c6a7cbbb5af866709) Thanks [@AyobamiH](https://github.com/AyobamiH)! - Fix bare React Native Hermes sourcemap Chunk ID generation in the Metro serializer. Requires posthog-cli >= 0.14.1 to clone and upload the generated camel-case `chunkId` metadata.
  (2026-08-24)

## 4.64.0

### Minor Changes

- [#4529](https://github.com/PostHog/posthog-js/pull/4529) [`ad6d5c6`](https://github.com/PostHog/posthog-js/commit/ad6d5c6b4bbcac41c40eb9a775ae863f917740a4) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Add `sessionReplayConfig.verifyScreenshotMaskAlignment` for Android session replay. This option requires `@posthog/react-native-plugin`.
  (2026-08-24)

### Patch Changes

- Updated dependencies [[`ad6d5c6`](https://github.com/PostHog/posthog-js/commit/ad6d5c6b4bbcac41c40eb9a775ae863f917740a4)]:
  - @posthog/react-native-plugin@2.5.0

## 4.63.9

### Patch Changes

- [#4623](https://github.com/PostHog/posthog-js/pull/4623) [`be299df`](https://github.com/PostHog/posthog-js/commit/be299dff71d2cf0c955efff1ca0b9cadc3b64713) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Fix buffered logs being dropped instead of retried after HTTP 408, 429 or 5xx
  (2026-08-24)
- Updated dependencies [[`be299df`](https://github.com/PostHog/posthog-js/commit/be299dff71d2cf0c955efff1ca0b9cadc3b64713)]:
  - @posthog/core@1.48.10

## 4.63.8

### Patch Changes

- [#4631](https://github.com/PostHog/posthog-js/pull/4631) [`1167239`](https://github.com/PostHog/posthog-js/commit/116723906ab68404fb6140d298bc648c5c330075) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Fix session replay started with `startRecording()` capturing nothing on Android by requiring `@posthog/react-native-plugin` 2.4.3 or newer.
  (2026-08-24)

## 4.63.7

### Patch Changes

- [#4602](https://github.com/PostHog/posthog-js/pull/4602) [`9e53f91`](https://github.com/PostHog/posthog-js/commit/9e53f91cf3e0e4c146ca8914925d775f7752c2ea) Thanks [@marandaneto](https://github.com/marandaneto)! - Use the iOS version reported by Info.plist when uploading Hermes source maps, including custom Xcode build settings. Matching native dSYM attribution requires @posthog/react-native-plugin 2.4.2 or later (PostHog/posthog-ios#776).
  (2026-08-24)

## 4.63.6

### Patch Changes

- [#4498](https://github.com/PostHog/posthog-js/pull/4498) [`9b2a1b1`](https://github.com/PostHog/posthog-js/commit/9b2a1b18db64f9f6b331cbded543c5ead3ccf0cb) Thanks [@posthog](https://github.com/apps/posthog)! - fix(react-native): warn when a local `sessionReplayConfig.sampleRate` overrides the project setting, warn when replay starts with no cached remote config, and log the native plugin version next to the replay config
  (2026-08-24)

## 4.63.5

### Patch Changes

- [#4581](https://github.com/PostHog/posthog-js/pull/4581) [`556d235`](https://github.com/PostHog/posthog-js/commit/556d23503a0409b455b4e77334624db583effbd0) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Fix `reloadFeatureFlags` and `reloadFeatureFlagsAsync` returning flags evaluated before the caller's most recent identity or person-property change when several reloads overlap, and stop overlapping reloads from skipping the remote config refresh
  (2026-08-21)
- Updated dependencies [[`556d235`](https://github.com/PostHog/posthog-js/commit/556d23503a0409b455b4e77334624db583effbd0)]:
  - @posthog/core@1.48.8

## 4.63.4

### Patch Changes

- [#4583](https://github.com/PostHog/posthog-js/pull/4583) [`6322f09`](https://github.com/PostHog/posthog-js/commit/6322f09922270e9d1562bacf0e602e76d238d395) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Fix logs and metrics being silently dropped when an attribute holds a very large integer, a function, a symbol, a sparse array, or a truncated emoji.
  Cap log and metric attributes at 20 levels of nesting, 1,000 entries per object and 10,000 values in total, marking anything beyond as `[Truncated]`.
  Type `OtlpAnyValue.intValue` as `string | number` — code reading that field must handle both. (2026-08-21)
- Updated dependencies [[`6322f09`](https://github.com/PostHog/posthog-js/commit/6322f09922270e9d1562bacf0e602e76d238d395)]:
  - @posthog/core@1.48.7
  - @posthog/types@1.405.1

## 4.63.3

### Patch Changes

- [#4578](https://github.com/PostHog/posthog-js/pull/4578) [`bae46bf`](https://github.com/PostHog/posthog-js/commit/bae46bfd11f73d3e62a6d0733144c180df354916) Thanks [@marandaneto](https://github.com/marandaneto)! - Drop events when a before-send hook throws instead of sending the unmodified event.
  (2026-08-20)
- Updated dependencies [[`bae46bf`](https://github.com/PostHog/posthog-js/commit/bae46bfd11f73d3e62a6d0733144c180df354916), [`aef2f49`](https://github.com/PostHog/posthog-js/commit/aef2f493cc8d834780f6b670e15e909e6363c259)]:
  - @posthog/core@1.48.6

## 4.63.2

### Patch Changes

- [#4528](https://github.com/PostHog/posthog-js/pull/4528) [`42281fa`](https://github.com/PostHog/posthog-js/commit/42281facbb400fa243107551aa6f955d4fd87807) Thanks [@luke-belton](https://github.com/luke-belton)! - Avoid rereading cached feature flag results on unrelated React Native component rerenders.
  (2026-08-14)

## 4.63.1

### Patch Changes

- [#4526](https://github.com/PostHog/posthog-js/pull/4526) [`aba7d55`](https://github.com/PostHog/posthog-js/commit/aba7d55320ac13a5841af3eb2e859113f304e6f1) Thanks [@github-actions](https://github.com/apps/github-actions)! - Avoid re-reading the feature flag store when feature flag hooks rerender with unchanged inputs.
  (2026-08-14)
- Updated dependencies [[`0a0206f`](https://github.com/PostHog/posthog-js/commit/0a0206f907f4b58dc28f36aa1fc441b55c489faf), [`eb05237`](https://github.com/PostHog/posthog-js/commit/eb0523729c4f989663a38d3ce9d0e61d4f262ee1)]:
  - @posthog/core@1.48.1
  - @posthog/types@1.404.1

## 4.63.0

### Minor Changes

- [#4436](https://github.com/PostHog/posthog-js/pull/4436) [`80f15a3`](https://github.com/PostHog/posthog-js/commit/80f15a386621514c43f19e99ee4e3f702e4d369d) Thanks [@jakesciotto](https://github.com/jakesciotto)! - feat(surveys): optional intro screen shown before the first question

  Surveys can now display an intro screen before question 1, configured via the new
  `displayIntroScreen`, `introScreenHeader`, `introScreenDescription`,
  `introScreenDescriptionContentType`, and `introScreenButtonText` appearance fields.
  The intro is dismissed with a button and records no response, does not affect
  completion or partial-response metrics, does not re-fire "survey shown", and is
  skipped when a survey is resumed with answers in progress. Intro copy is
  translatable like the thank-you message. `renderSurveysPreview` accepts
  `previewPageIndex: -1` (exported as `INTRO_SCREEN_PREVIEW_INDEX`) to preview the
  intro screen. (2026-08-10)

### Patch Changes

- Updated dependencies [[`80f15a3`](https://github.com/PostHog/posthog-js/commit/80f15a386621514c43f19e99ee4e3f702e4d369d)]:
  - @posthog/core@1.47.0

## 4.62.0

### Minor Changes

- [#4415](https://github.com/PostHog/posthog-js/pull/4415) [`32434e4`](https://github.com/PostHog/posthog-js/commit/32434e403611bab48c91813cd12f542576711521) Thanks [@ioannisj](https://github.com/ioannisj)! - Add push notification support, so PostHog Workflows can target React Native apps.

  With `@posthog/react-native-plugin` installed, device tokens register automatically on iOS and Android, and notification opens are captured as `$push_notification_opened`. Both are on by default; opt out with `capturePushNotificationSubscriptions: false` or `capturePushNotificationOpened: false`.
  - `registerPushNotificationToken` and `unregisterPushNotificationToken` handle token refreshes and manual control.
  - `capturePushNotificationOpened` covers the warm-start opens that auto-detection cannot see.
  - `pushIdentityProvider` mints a signed token for projects that require identity-verified subscriptions.
  - An opted-out user registers no token, and consent changes propagate to the native SDK at runtime: `optOut()` stops native auto-registration (e.g. on an OS token refresh) and requests removal of an already-registered subscription. Known limitation: the native SDKs gate that removal on their own consent state, so deleting an existing subscription may not complete until the next opted-in launch, and `optIn()` does not refetch a token on its own yet — tracked in PostHog/posthog-android#675 and PostHog/posthog-ios#746.
  - `reset()` now propagates to the native SDK: it unregisters the logged-out user's subscription and re-registers under the new identity. The re-registration can briefly race the identity handoff on both platforms; the native SDKs converge it on the next flush. (2026-08-05)

## 4.61.5

### Patch Changes

- [#4380](https://github.com/PostHog/posthog-js/pull/4380) [`3c40b6c`](https://github.com/PostHog/posthog-js/commit/3c40b6cecd66633d16f3f94ec6614af656445f2e) Thanks [@marandaneto](https://github.com/marandaneto)! - Keep request timeouts active through response body consumption and clarify eventual event UUID deduplication semantics.
  (2026-08-05)
- Updated dependencies [[`3c40b6c`](https://github.com/PostHog/posthog-js/commit/3c40b6cecd66633d16f3f94ec6614af656445f2e)]:
  - @posthog/core@1.46.8
  - @posthog/types@1.401.1

## 4.61.4

### Patch Changes

- [#4381](https://github.com/PostHog/posthog-js/pull/4381) [`f3a71a1`](https://github.com/PostHog/posthog-js/commit/f3a71a1f462384543de5f39762c3c1ed7b532be8) Thanks [@marandaneto](https://github.com/marandaneto)! - Clear completed lifecycle timeout handles so successful shutdowns do not leave timers running.
  (2026-08-03)
- Updated dependencies [[`f3a71a1`](https://github.com/PostHog/posthog-js/commit/f3a71a1f462384543de5f39762c3c1ed7b532be8)]:
  - @posthog/core@1.46.4

## 4.61.3

### Patch Changes

- [#4347](https://github.com/PostHog/posthog-js/pull/4347) [`7c3a9af`](https://github.com/PostHog/posthog-js/commit/7c3a9af42be80051705f7fe820623dd7e1b879d5) Thanks [@marandaneto](https://github.com/marandaneto)! - Preserve events added to a full queue while an earlier batch is being flushed.
  (2026-08-03)
- Updated dependencies [[`7c3a9af`](https://github.com/PostHog/posthog-js/commit/7c3a9af42be80051705f7fe820623dd7e1b879d5), [`3d48c4b`](https://github.com/PostHog/posthog-js/commit/3d48c4bce2f44a5e9ec776b0f3ea2da19254cd27)]:
  - @posthog/core@1.46.2
  - @posthog/react-native-plugin@2.2.4

## 4.61.2

### Patch Changes

- [#4332](https://github.com/PostHog/posthog-js/pull/4332) [`b9a241e`](https://github.com/PostHog/posthog-js/commit/b9a241ec862ba5b753ef34d94c856257bdff2a2f) Thanks [@ioannisj](https://github.com/ioannisj)! - Fix `identify()` leaving a user anonymous when the supplied ID already matches the persisted distinct ID (for example after a non-identified bootstrap seeded the same ID). The user is now marked identified and a person-processed `$set` event is captured. Ports the same fix from posthog-js (browser) to the shared core used by React Native, Node, and posthog-js-lite.
  (2026-07-31)
- Updated dependencies [[`b9a241e`](https://github.com/PostHog/posthog-js/commit/b9a241ec862ba5b753ef34d94c856257bdff2a2f)]:
  - @posthog/core@1.46.1

## 4.61.1

### Patch Changes

- [#4291](https://github.com/PostHog/posthog-js/pull/4291) [`da71872`](https://github.com/PostHog/posthog-js/commit/da7187245e9624309162946f4647e5698e742281) Thanks [@marandaneto](https://github.com/marandaneto)! - Fix iOS Expo source map uploads when another config plugin wraps the React Native bundle phase. After upgrading, projects with a checked-in `ios/` directory should run `npx expo prebuild --platform ios` to migrate the existing bundle phase.
  (2026-07-28)

## 4.61.0

### Minor Changes

- [#4265](https://github.com/PostHog/posthog-js/pull/4265) [`3bd6aed`](https://github.com/PostHog/posthog-js/commit/3bd6aed9e655da1b5487a1decd60ac9d4617a46f) Thanks [@ioannisj](https://github.com/ioannisj)! - Add an `autoPresentSurveys` prop to `PostHogSurveyProvider`. Set it to `false` to defer automatic presentation of popover surveys, for example while a native-stack `formSheet` or `modal` is on top. Deferral is display-only: the survey stays armed and presents once the prop becomes `true` again, and a survey already on screen is never interrupted.
  (2026-07-27)

## 4.60.0

### Minor Changes

- [#4219](https://github.com/PostHog/posthog-js/pull/4219) [`96bd6b6`](https://github.com/PostHog/posthog-js/commit/96bd6b6333c63266023f4c439903fefaa9ca8387) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - feat(react-native): Expo plugin `dotenvFile` option + fix `com.posthog.android` never being applied

  New `dotenvFile` prop on the Expo config plugin: path to a dotenv file with `POSTHOG_CLI_*` credentials, delivered to every upload hook as `POSTHOG_CLI_DOTENV_FILE` (Xcode build setting on iOS, `posthog.dotenvFile` gradle property on Android — hermes, dSYM, and R8 mapping uploads; the injected `com.posthog.android` gradle plugin is bumped to 1.4.0, the first version that reads the property). No more exporting credentials into the shell/daemon environment; process env still wins, a missing file is a warning. Requires posthog-cli >= 0.8.4.

  Also fixes `uploadNativeSymbols` on Android: mod ordering made the plugin inject the `com.posthog.android` classpath but silently skip the `apply plugin` line, so mapping uploads never ran. (2026-07-23)

### Patch Changes

- Updated dependencies [[`6c8fde0`](https://github.com/PostHog/posthog-js/commit/6c8fde02691d7f4aae257b6d7b0753e72d946ccb)]:
  - @posthog/core@1.45.1

## 4.59.0

### Minor Changes

- [#4222](https://github.com/PostHog/posthog-js/pull/4222) [`0f2407b`](https://github.com/PostHog/posthog-js/commit/0f2407bbd98cab7d38a23f0466bbdccf3e0bdbf3) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - feat: add a default-value option to `isFeatureEnabled`

  `isFeatureEnabled(key, { defaultValue: false })` now returns the given default when the flag has no value — flags not loaded yet, or no flag with that key — and the return type narrows to `boolean`. The option name is the same in posthog-js, posthog-js-lite, and posthog-react-native. Without `defaultValue`, behavior is unchanged: `boolean | undefined`. (2026-07-22)

### Patch Changes

- Updated dependencies [[`0f2407b`](https://github.com/PostHog/posthog-js/commit/0f2407bbd98cab7d38a23f0466bbdccf3e0bdbf3)]:
  - @posthog/core@1.45.0
  - @posthog/types@1.398.0

## 4.58.0

### Minor Changes

- [#4172](https://github.com/PostHog/posthog-js/pull/4172) [`9621830`](https://github.com/PostHog/posthog-js/commit/9621830c359a9955ffec0db61164e5fc450e5443) Thanks [@haacked](https://github.com/haacked)! - send minimal `$feature_flag_called` events when the server enables it

  When the v2 `/flags` response carries `minimalFlagCalledEvents: true` (or, for posthog-node local evaluation, the flag-definitions payload carries `minimal_flag_called_events: true`) and the evaluated flag is not linked to an experiment (`$feature_flag_has_experiment === false`), `$feature_flag_called` events are rebuilt from a strict allowlist of flag-evaluation, processing-control, and SDK-identity properties. Super properties, `$set`/`$set_once`, the `$feature/<key>` enumeration, `$active_feature_flags`, and the context envelope are stripped. Any missing signal (no gate on the response, bootstrapped or locally injected flags, `has_experiment` unknown) falls back to the full event, and experiment-linked flags always send the full envelope. The gate is stored alongside the cached flags (posthog-js persistence, posthog-node poller state) and is server-controlled, with no SDK-side configuration. `before_send` runs after the filter and may re-add stripped properties. (2026-07-20)

### Patch Changes

- Updated dependencies [[`9621830`](https://github.com/PostHog/posthog-js/commit/9621830c359a9955ffec0db61164e5fc450e5443)]:
  - @posthog/core@1.44.0

## 4.57.0

### Minor Changes

- [#4159](https://github.com/PostHog/posthog-js/pull/4159) [`fad6d9a`](https://github.com/PostHog/posthog-js/commit/fad6d9adae4163cd63859766916cdcbae629a110) Thanks [@haacked](https://github.com/haacked)! - add `$feature_flag_has_experiment` to `$feature_flag_called` events

  `$feature_flag_called` events now carry a `$feature_flag_has_experiment` boolean sourced from the server's `has_experiment` flag metadata (the `/flags?v=2` response for remote evaluation, the `/api/feature_flag/local_evaluation` definitions for posthog-node local evaluation). The property is only sent when the server explicitly reports `has_experiment`; it is omitted entirely when the value is unknown (older servers, missing metadata, bootstrapped or locally injected flags). (2026-07-16)

### Patch Changes

- Updated dependencies [[`fad6d9a`](https://github.com/PostHog/posthog-js/commit/fad6d9adae4163cd63859766916cdcbae629a110)]:
  - @posthog/core@1.43.0
  - @posthog/types@1.396.0

## 4.56.3

### Patch Changes

- [#4117](https://github.com/PostHog/posthog-js/pull/4117) [`1eddff7`](https://github.com/PostHog/posthog-js/commit/1eddff74e63ff539eb3144f075b14ab5ffec84cc) Thanks [@DanielVisca](https://github.com/DanielVisca)! - add the posthog.metrics API (count, gauge, histogram) to posthog-node — alpha

  Backend services can now record metrics through the same statsd-style pre-aggregating client the browser SDK ships, with no OpenTelemetry setup:

  ```ts
  const client = new PostHog('phc_...', { metrics: { serviceName: 'billing-worker' } })
  client.metrics.count('invoices.processed', 1, { attributes: { plan: 'pro' } })
  client.metrics.gauge('queue.depth', 42)
  client.metrics.histogram('job.duration', 187, { unit: 'ms' })
  ```

  Samples aggregate in memory and flush as OTLP/JSON to `/i/v1/metrics` (one data point per series per window). Pending metrics are flushed on `shutdown()`. Core gains `_sendMetricsBatch` on `PostHogCoreStateless` (same outcome contract as `_sendLogsBatch`) and a shared `resolveMetricsConfig`, so any core-based SDK can host `PostHogMetrics`. (2026-07-15)

- Updated dependencies [[`1eddff7`](https://github.com/PostHog/posthog-js/commit/1eddff74e63ff539eb3144f075b14ab5ffec84cc)]:
  - @posthog/core@1.42.0

## 4.56.2

### Patch Changes

- [#4148](https://github.com/PostHog/posthog-js/pull/4148) [`f4694e9`](https://github.com/PostHog/posthog-js/commit/f4694e93eb951beb5eeb87a12cc3d74829d85949) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Expo plugin: `skipOnConflict` now also applies to native iOS dSYM uploads. With `uploadNativeSymbols` enabled, a release build whose dSYM already exists in PostHog with different content no longer fails — the upload is skipped and the existing symbols are kept. Requires posthog-ios >= 3.64.7 and posthog-cli >= 0.7.12; with older posthog-ios versions the option has no effect on dSYM uploads. Changes to `skipOnConflict` or `uploadNativeSymbols.includeSource` now take effect on the next `expo prebuild` without `--clean`; build phases you have customized by hand are never modified.
  (2026-07-14)
- Updated dependencies [[`f4694e9`](https://github.com/PostHog/posthog-js/commit/f4694e93eb951beb5eeb87a12cc3d74829d85949)]:
  - @posthog/react-native-plugin@2.2.2

## 4.56.1

### Patch Changes

- [#4090](https://github.com/PostHog/posthog-js/pull/4090) [`6dd8827`](https://github.com/PostHog/posthog-js/commit/6dd88274193e07a5f9f4bcb816dfca49cfe072d7) Thanks [@lucasheriques](https://github.com/lucasheriques)! - fix: repeating surveys now show again when a new iteration starts. The local seen state is keyed by survey iteration (matching the web SDK), so a survey scheduled to repeat no longer stays hidden on a device after the first response.
  (2026-07-14)
- Updated dependencies [[`6dd8827`](https://github.com/PostHog/posthog-js/commit/6dd88274193e07a5f9f4bcb816dfca49cfe072d7)]:
  - @posthog/core@1.41.1

## 4.56.0

### Minor Changes

- [#4111](https://github.com/PostHog/posthog-js/pull/4111) [`9bfaa8f`](https://github.com/PostHog/posthog-js/commit/9bfaa8fce1358c04e05ee42283afe47408aadc96) Thanks [@ioannisj](https://github.com/ioannisj)! - Enable native crash autocapture (`errorTracking.autocapture.nativeCrashes`) on macOS. The native plugin now loads on macOS (previously iOS/Android only); the legacy session-replay-only fallback stays iOS/Android. Requires `@posthog/react-native-plugin` >= 2.2.0.
  (2026-07-13)

## 4.55.0

### Minor Changes

- [#4119](https://github.com/PostHog/posthog-js/pull/4119) [`7b86b46`](https://github.com/PostHog/posthog-js/commit/7b86b467bc93bc54a73c69446d2a1613f373771b) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - add a dimmed backdrop behind the survey modal, matching the scrim posthog-ios and posthog-android already render
  (2026-07-09)

## 4.54.5

### Patch Changes

- [#4121](https://github.com/PostHog/posthog-js/pull/4121) [`e6b5ab2`](https://github.com/PostHog/posthog-js/commit/e6b5ab21acb5c14f903af6fcd84118fb474a7563) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Prevent shutdown from looping forever when a flush makes no queue progress.
  (2026-07-09)

- [#4120](https://github.com/PostHog/posthog-js/pull/4120) [`d0e531a`](https://github.com/PostHog/posthog-js/commit/d0e531af583fd47c6a9f1d11de421398db55f0c8) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - Coalesce concurrent flush requests to avoid chaining redundant flushes while offline.
  (2026-07-09)
- Updated dependencies [[`e6b5ab2`](https://github.com/PostHog/posthog-js/commit/e6b5ab21acb5c14f903af6fcd84118fb474a7563), [`d0e531a`](https://github.com/PostHog/posthog-js/commit/d0e531af583fd47c6a9f1d11de421398db55f0c8)]:
  - @posthog/core@1.40.1

## 4.54.4

### Patch Changes

- [#4031](https://github.com/PostHog/posthog-js/pull/4031) [`94a0530`](https://github.com/PostHog/posthog-js/commit/94a053043847293a4427e315e67c798b58894107) Thanks [@posthog](https://github.com/apps/posthog)! - Improve survey display reliability:
  - **posthog-js**: refresh the cached `$surveys` definitions after a short TTL (stale-while-revalidate) so server-side changes such as switching a survey from popover to API propagate to long-lived tabs without a page reload.
  - **posthog-js**: add `posthog.surveys.markSurveyAsSeen(surveyId, { iteration })` so custom integrators that render surveys through their own backend can honour the "already seen" and wait-period checks.
  - **posthog-react-native**: guarantee the survey `Modal` notifies its parent on close even when iOS `Modal.onDismiss` fails to fire, so the transparent full-screen modal can no longer stay mounted intercepting touches and freezing the app. (2026-07-03)

- Updated dependencies [[`45d1b36`](https://github.com/PostHog/posthog-js/commit/45d1b36e517d9eeb3d68b0398d80599b88293386)]:
  - @posthog/types@1.392.1

## 4.54.3

### Patch Changes

- [#4059](https://github.com/PostHog/posthog-js/pull/4059) [`532f2c3`](https://github.com/PostHog/posthog-js/commit/532f2c3b07f6cd44a10c40790616256d24f2e5a1) Thanks [@jiuyige](https://github.com/jiuyige)! - Add per-call sendEvent option support to React Native feature flag helpers.
  (2026-07-02)
- Updated dependencies [[`532f2c3`](https://github.com/PostHog/posthog-js/commit/532f2c3b07f6cd44a10c40790616256d24f2e5a1)]:
  - @posthog/core@1.39.6

## 4.54.2

### Patch Changes

- [#4048](https://github.com/PostHog/posthog-js/pull/4048) [`5e7e132`](https://github.com/PostHog/posthog-js/commit/5e7e132757682e4f91d40601506b635f346c7b67) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - fix: feature-flag properties (`$feature/*` and `$active_feature_flags`) passed explicitly to `capture()` now take precedence over the SDK's cached flag values, matching posthog-js (web) and posthog-android
  (2026-07-02)
- Updated dependencies [[`5e7e132`](https://github.com/PostHog/posthog-js/commit/5e7e132757682e4f91d40601506b635f346c7b67)]:
  - @posthog/core@1.39.5

## 4.54.1

### Patch Changes

- [#4055](https://github.com/PostHog/posthog-js/pull/4055) [`64e04ba`](https://github.com/PostHog/posthog-js/commit/64e04ba043b25d1f88435c5885132000d3117bb0) Thanks [@marandaneto](https://github.com/marandaneto)! - Retry `/flags` requests that receive HTTP 502 or 504 responses across SDKs that use the shared core flags client.
  (2026-07-02)
- Updated dependencies [[`64e04ba`](https://github.com/PostHog/posthog-js/commit/64e04ba043b25d1f88435c5885132000d3117bb0)]:
  - @posthog/core@1.39.4

## 4.54.0

### Minor Changes

- [#3970](https://github.com/PostHog/posthog-js/pull/3970) [`0f83f93`](https://github.com/PostHog/posthog-js/commit/0f83f93a6e78605444b2fe914e12c526ac3250d3) Thanks [@github-actions](https://github.com/apps/github-actions)! - Add a `requestHeaders` option to send custom headers (e.g. `Authorization`) with SDK requests, including session replay and native error/crash uploads via the native plugin. Useful for reverse-proxy setups that require authentication.
  (2026-07-01)

### Patch Changes

- Updated dependencies [[`0f83f93`](https://github.com/PostHog/posthog-js/commit/0f83f93a6e78605444b2fe914e12c526ac3250d3)]:
  - @posthog/react-native-plugin@2.1.2

## 4.53.3

### Patch Changes

- [#4019](https://github.com/PostHog/posthog-js/pull/4019) [`6b80631`](https://github.com/PostHog/posthog-js/commit/6b80631fd259345afd25195fdd9cba09e32a51be) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Survey question content now scrolls only when it overflows the modal. Short surveys that fit no longer scroll or bounce, while longer surveys remain fully scrollable.
  (2026-06-30)

## 4.53.2

### Patch Changes

- [#3971](https://github.com/PostHog/posthog-js/pull/3971) [`b660af2`](https://github.com/PostHog/posthog-js/commit/b660af2d737f6f1b5d256cb3a9f3be685f5938ed) Thanks [@github-actions](https://github.com/apps/github-actions)! - Support capturing additional event properties from `data-ph-capture-attribute-*` props in autocapture, matching the browser SDK.
  (2026-06-29)

## 4.53.1

### Patch Changes

- [#3961](https://github.com/PostHog/posthog-js/pull/3961) [`619a25c`](https://github.com/PostHog/posthog-js/commit/619a25ce5d4aa5a5f82724863facff4e0029e44b) Thanks [@marandaneto](https://github.com/marandaneto)! - Retry feature flag requests after transient network errors only. The feature flag request retry count defaults to 1 and can be set to 0 to disable retries.
  (2026-06-29)
- Updated dependencies [[`619a25c`](https://github.com/PostHog/posthog-js/commit/619a25ce5d4aa5a5f82724863facff4e0029e44b)]:
  - @posthog/core@1.38.1

## 4.53.0

### Minor Changes

- [#3977](https://github.com/PostHog/posthog-js/pull/3977) [`6200888`](https://github.com/PostHog/posthog-js/commit/6200888e5741dea2e6e11a5da1c98b6c79e62a3f) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Add `getAllFeatureFlags()`, which returns all currently loaded feature flags as structured `FeatureFlagResult`s (`key`, `enabled`, `variant`, `payload`). It is a synchronous read of the cached flags and does not send a `$feature_flag_called` event.
  (2026-06-26)

### Patch Changes

- Updated dependencies [[`6200888`](https://github.com/PostHog/posthog-js/commit/6200888e5741dea2e6e11a5da1c98b6c79e62a3f)]:
  - @posthog/core@1.38.0

## 4.52.0

### Minor Changes

- [#3932](https://github.com/PostHog/posthog-js/pull/3932) [`bf6947d`](https://github.com/PostHog/posthog-js/commit/bf6947d3e12ac512c99185be9b8b134c04eb563a) Thanks [@ioannisj](https://github.com/ioannisj)! - Support session replay event triggers in React Native. Recording stays paused until the client captures an event whose name matches a server-configured `sessionRecording.eventTriggers` entry, then records for the rest of that session; it re-arms on session rotation and AND-combines with the linked-flag gate. Requires `@posthog/react-native-plugin` >= 2.1.1 (which pins the native SDKs that defer event-trigger gating to the JS layer).
  (2026-06-23)

### Patch Changes

- Updated dependencies [[`bf6947d`](https://github.com/PostHog/posthog-js/commit/bf6947d3e12ac512c99185be9b8b134c04eb563a)]:
  - @posthog/core@1.37.1

## 4.51.0

### Minor Changes

- [#3879](https://github.com/PostHog/posthog-js/pull/3879) [`440e370`](https://github.com/PostHog/posthog-js/commit/440e370fda48d629352f3280471a228ee973dcb0) Thanks [@ioannisj](https://github.com/ioannisj)! - Deprecate `disableRemoteConfig`. Remote config is now always loaded and the option is a no-op. It will be removed in a future version. Also promote the previously experimental `disableSurveys` and `maskAllSandboxedViews` options to GA.
  (2026-06-23)

### Patch Changes

- Updated dependencies [[`440e370`](https://github.com/PostHog/posthog-js/commit/440e370fda48d629352f3280471a228ee973dcb0)]:
  - @posthog/core@1.37.0

## 4.50.0

### Minor Changes

- [#3861](https://github.com/PostHog/posthog-js/pull/3861) [`c3a38fd`](https://github.com/PostHog/posthog-js/commit/c3a38fd9680c80f5115fababd610be7c17557b96) Thanks [@ioannisj](https://github.com/ioannisj)! - Add `addExceptionStep(message, properties?)` for breadcrumb-style exception steps. Steps accumulate in a rolling, byte-bounded buffer (configurable via `errorTracking.exceptionSteps`) and are attached to every captured `$exception` as `$exception_steps`, giving the error tracking UI a timeline of recent activity before each error. When native crash capture is enabled, steps are forwarded to the embedded native SDK so native crashes carry the same timeline.
  (2026-06-19)

### Patch Changes

- Updated dependencies [[`c3a38fd`](https://github.com/PostHog/posthog-js/commit/c3a38fd9680c80f5115fababd610be7c17557b96)]:
  - @posthog/react-native-plugin@2.1.0

## 4.49.3

### Patch Changes

- [#3886](https://github.com/PostHog/posthog-js/pull/3886) [`e6d7fe2`](https://github.com/PostHog/posthog-js/commit/e6d7fe2a5f10d29b3df69392f584970e7a7a4561) Thanks [@marandaneto](https://github.com/marandaneto)! - Stop sending deprecated no-op top-level `type`, `library`, and `library_version` fields in event batch payloads. Use `properties.$lib` and `properties.$lib_version` for SDK metadata; legacy queued `library` and `library_version` values are used as fallbacks when the official `$` properties are missing.
  (2026-06-18)
- Updated dependencies [[`e6d7fe2`](https://github.com/PostHog/posthog-js/commit/e6d7fe2a5f10d29b3df69392f584970e7a7a4561)]:
  - @posthog/core@1.35.2

## 4.49.2

### Patch Changes

- [#3876](https://github.com/PostHog/posthog-js/pull/3876) [`d7b1a03`](https://github.com/PostHog/posthog-js/commit/d7b1a031761cdd6aa8cf6b28f828a2fa29ac0765) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Deprecate `getFeatureFlagPayload` in favor of `getFeatureFlagResult`, which returns the flag value and payload from a single evaluation. `getFeatureFlagPayload` continues to work.
  (2026-06-17)
- Updated dependencies [[`d7b1a03`](https://github.com/PostHog/posthog-js/commit/d7b1a031761cdd6aa8cf6b28f828a2fa29ac0765)]:
  - @posthog/core@1.35.1

## 4.49.1

### Patch Changes

- [#3874](https://github.com/PostHog/posthog-js/pull/3874) [`ee7137f`](https://github.com/PostHog/posthog-js/commit/ee7137f5fc9eedf32fc99afcd8082384aa357581) Thanks [@marandaneto](https://github.com/marandaneto)! - Add Expo config plugin support for skipping duplicate sourcemap uploads.
  (2026-06-17)

## 4.49.0

### Minor Changes

- [#3848](https://github.com/PostHog/posthog-js/pull/3848) [`bd07ec4`](https://github.com/PostHog/posthog-js/commit/bd07ec42968ada9099a31cf7d61b106af22267ca) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Add a `disableRemoteFeatureFlags` option and a public `updateFlags(flags, payloads?, { merge })` method, for apps that evaluate feature flags outside the SDK (for example on their own backend) and want to supply the results at runtime instead of having the SDK fetch them.

  With `disableRemoteFeatureFlags: true`, the SDK no longer fetches or evaluates feature flags from PostHog — `identify()`, `group()`, and `reset()` stop triggering `/flags` requests — while `getFeatureFlag()` and `getFeatureFlagPayload()` keep working against the values you supply. Provide those values (with optional payloads) at runtime via `updateFlags(flags, payloads?, { merge })`; they persist across restarts. This mirrors the web SDK's `advanced_disable_feature_flags` and `updateFlags`. (2026-06-17)

### Patch Changes

- Updated dependencies [[`bd07ec4`](https://github.com/PostHog/posthog-js/commit/bd07ec42968ada9099a31cf7d61b106af22267ca)]:
  - @posthog/core@1.34.0

## 4.48.0

### Minor Changes

- [#3709](https://github.com/PostHog/posthog-js/pull/3709) [`c6c163a`](https://github.com/PostHog/posthog-js/commit/c6c163aefb093d5609977ae243b056f96a2d3b4e) Thanks [@posthog](https://github.com/apps/posthog)! - Add `unsetPersonProperties()` to remove person properties, the counterpart to `setPersonProperties()`. Previously the only way to unset a person property was to hand-pass a `$unset` array inside a `capture()` call.
  (2026-06-16)

### Patch Changes

- Updated dependencies [[`b3ec845`](https://github.com/PostHog/posthog-js/commit/b3ec8453d3678bd7ab6737b25bae003e61117ef9), [`c9c7df1`](https://github.com/PostHog/posthog-js/commit/c9c7df1e7f3ae6152aa80f98b49be206fdff1b23), [`c6c163a`](https://github.com/PostHog/posthog-js/commit/c6c163aefb093d5609977ae243b056f96a2d3b4e)]:
  - @posthog/core@1.33.0
  - @posthog/types@1.387.0

## 4.47.2

### Patch Changes

- [#3828](https://github.com/PostHog/posthog-js/pull/3828) [`8464c92`](https://github.com/PostHog/posthog-js/commit/8464c9296d73376701b72075b48ea69e09bc1d9a) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - fix: keep session replay active across `identify()`/`reset()`. The project-level remote config (session replay, error tracking, capture performance) and survey definitions are now preserved across `reset()` instead of being cleared, and replay is re-evaluated whenever feature flags load/reload. A linked flag that becomes active for the identified user now starts (or resumes) recording without an app restart, and a linked flag that turns off pauses recording instead of leaving a gated-off user recorded until restart. Previously replay activation was only evaluated once at startup and the cached config was wiped on `reset()`. The user-specific survey state (which surveys were seen, last-seen date) is still cleared on `reset()`. This now mirrors the native iOS SDK, which keeps the project-level config across an identity change and gates replay on the linked flag once flags have loaded.
  (2026-06-15)
- Updated dependencies [[`8464c92`](https://github.com/PostHog/posthog-js/commit/8464c9296d73376701b72075b48ea69e09bc1d9a)]:
  - @posthog/core@1.32.5

## 4.47.1

### Patch Changes

- [#3837](https://github.com/PostHog/posthog-js/pull/3837) [`29bf8e3`](https://github.com/PostHog/posthog-js/commit/29bf8e386a4050531e9cfd906c33b75945fcb6ad) Thanks [@marandaneto](https://github.com/marandaneto)! - Add missing bugs metadata to package manifests.
  (2026-06-15)
- Updated dependencies [[`29bf8e3`](https://github.com/PostHog/posthog-js/commit/29bf8e386a4050531e9cfd906c33b75945fcb6ad)]:
  - @posthog/core@1.32.4
  - @posthog/types@1.386.4

## 4.47.0

### Minor Changes

- [#3677](https://github.com/PostHog/posthog-js/pull/3677) [`b061628`](https://github.com/PostHog/posthog-js/commit/b06162885401658a8d5a56f1b91497d0d57c5864) Thanks [@ioannisj](https://github.com/ioannisj)! - Add opt-in native iOS and Android crash capture through the optional native plugin:
  - Runtime: `errorTracking.autocapture.nativeCrashes` enables native crash autocapture.
  - Build tooling: the Expo config plugin option `uploadNativeSymbols` wires native debug-symbol upload so crashes are symbolicated — iOS dSYMs via posthog-ios's `upload-symbols.sh`, and Android ProGuard/R8 mappings via the `com.posthog.android` Gradle plugin. Pass `uploadNativeSymbols: { includeSource: true }` to also upload native source for crash context (iOS only). (2026-06-12)

## 4.46.32

### Patch Changes

- Updated dependencies [[`dbf2377`](https://github.com/PostHog/posthog-js/commit/dbf23777e1c14a811c67697684d56145518ebe16)]:
  - @posthog/types@1.386.3
  - @posthog/core@1.32.3

## 4.46.31

### Patch Changes

- Updated dependencies [[`25822ac`](https://github.com/PostHog/posthog-js/commit/25822acc0d16f9f1d6fbbd65da57b3e060c6c558)]:
  - @posthog/core@1.32.2
  - @posthog/types@1.386.2

## 4.46.30

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.386.1
  - @posthog/core@1.32.1

## 4.46.29

### Patch Changes

- Updated dependencies [[`612f97a`](https://github.com/PostHog/posthog-js/commit/612f97adebd3d863602533180ac4bee3f3ed731d)]:
  - @posthog/core@1.32.0
  - @posthog/types@1.386.0

## 4.46.28

### Patch Changes

- Updated dependencies [[`c11794d`](https://github.com/PostHog/posthog-js/commit/c11794dd5fbb73d99bb88600ae487f8f08f625be), [`f601c49`](https://github.com/PostHog/posthog-js/commit/f601c496338ed0be8853f94160ee3edca542ac7d)]:
  - @posthog/types@1.385.0
  - @posthog/core@1.31.4

## 4.46.27

### Patch Changes

- Updated dependencies [[`2d21ada`](https://github.com/PostHog/posthog-js/commit/2d21ada24479c0d4f561dd3b6f5922ce3f8e4afd)]:
  - @posthog/types@1.384.3
  - @posthog/core@1.31.3

## 4.46.26

### Patch Changes

- Updated dependencies [[`d9462b3`](https://github.com/PostHog/posthog-js/commit/d9462b3567a0b7c9b755552c303814b6fcbe3a97)]:
  - @posthog/types@1.384.2
  - @posthog/core@1.31.2

## 4.46.25

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.384.1
  - @posthog/core@1.31.1

## 4.46.24

### Patch Changes

- Updated dependencies [[`0c2acb9`](https://github.com/PostHog/posthog-js/commit/0c2acb9f30d545bb89d1f950ba8f840c76e47dc2)]:
  - @posthog/core@1.31.0
  - @posthog/types@1.384.0

## 4.46.23

### Patch Changes

- Updated dependencies [[`783ba46`](https://github.com/PostHog/posthog-js/commit/783ba461b0916c3f379c227d08470687d38d0768)]:
  - @posthog/types@1.383.3
  - @posthog/core@1.30.14

## 4.46.22

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.383.2
  - @posthog/core@1.30.13

## 4.46.21

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.383.1
  - @posthog/core@1.30.12

## 4.46.20

### Patch Changes

- Updated dependencies [[`227c9b0`](https://github.com/PostHog/posthog-js/commit/227c9b03c19dcb93d9a15abb1ee6b9523d366767), [`393f9e2`](https://github.com/PostHog/posthog-js/commit/393f9e2a4697c6ffe52402cad6fb8550b48b5e00)]:
  - @posthog/types@1.383.0
  - @posthog/core@1.30.11

## 4.46.19

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.382.0
  - @posthog/core@1.30.10

## 4.46.18

### Patch Changes

- Updated dependencies [[`a7bd828`](https://github.com/PostHog/posthog-js/commit/a7bd828050d070e1b88eb69c3f9db71c5d08f446)]:
  - @posthog/types@1.381.0
  - @posthog/core@1.30.9

## 4.46.17

### Patch Changes

- [#3747](https://github.com/PostHog/posthog-js/pull/3747) [`70c976e`](https://github.com/PostHog/posthog-js/commit/70c976e36eb80e55725b349c7a082043660ac504) Thanks [@cat-ph](https://github.com/cat-ph)! - Improve Xcode sourcemap upload failure logs so every captured `posthog-cli` line is reported as an Xcode error with the failing Hermes command and exit code.
  (2026-06-05)

## 4.46.16

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.380.1
  - @posthog/core@1.30.8

## 4.46.15

### Patch Changes

- [#3745](https://github.com/PostHog/posthog-js/pull/3745) [`33388d5`](https://github.com/PostHog/posthog-js/commit/33388d522b9db50077f82f823676315392c2fc3d) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Fix `posthog-react-native` throwing `Cannot read properties of undefined (reading 'create')` at import time in analytics-only setups and Jest `testEnvironment: node` runs without the React Native preset. The surveys UI is reachable from the package entrypoint and no longer evaluates native `StyleSheet` APIs while loading. (#3740)
  (2026-06-04)

## 4.46.14

### Patch Changes

- Updated dependencies [[`2387084`](https://github.com/PostHog/posthog-js/commit/2387084d4d7e28c606a0b0ab23ac0762dcf904d7)]:
  - @posthog/types@1.380.0
  - @posthog/core@1.30.7

## 4.46.13

### Patch Changes

- [#3729](https://github.com/PostHog/posthog-js/pull/3729) [`3959c03`](https://github.com/PostHog/posthog-js/commit/3959c038505c2b1365fe1c09183cc4038e707962) Thanks [@cat-ph](https://github.com/cat-ph)! - fix(react-native): make the Android Hermes sourcemap upload tasks compatible with Gradle's configuration cache.
  (2026-06-04)

## 4.46.12

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.379.3
  - @posthog/core@1.30.6

## 4.46.11

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.379.2
  - @posthog/core@1.30.5

## 4.46.10

### Patch Changes

- [#3734](https://github.com/PostHog/posthog-js/pull/3734) [`42b720f`](https://github.com/PostHog/posthog-js/commit/42b720f205f111c62de9435ac7315437d1e6d737) Thanks [@cat-ph](https://github.com/cat-ph)! - Fix the Expo iOS source map upload config plugin so backtick-wrapped `react-native-xcode.sh` commands are preserved when wrapping the bundle phase with `posthog-xcode.sh`.
  (2026-06-03)

## 4.46.9

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.379.1
  - @posthog/core@1.30.4

## 4.46.8

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.379.0
  - @posthog/core@1.30.3

## 4.46.7

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.378.1
  - @posthog/core@1.30.2

## 4.46.6

### Patch Changes

- Updated dependencies [[`8181354`](https://github.com/PostHog/posthog-js/commit/8181354cae602f3f2b5e8c5b5bcd2e090e25edcc)]:
  - @posthog/types@1.378.0
  - @posthog/core@1.30.1

## 4.46.5

### Patch Changes

- Updated dependencies [[`3d4a76f`](https://github.com/PostHog/posthog-js/commit/3d4a76f323ac789df91448fdb05d356dc91bb87f)]:
  - @posthog/core@1.30.0
  - @posthog/types@1.377.0

## 4.46.4

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.376.6
  - @posthog/core@1.29.15

## 4.46.3

### Patch Changes

- [#3701](https://github.com/PostHog/posthog-js/pull/3701) [`6f0caf4`](https://github.com/PostHog/posthog-js/commit/6f0caf45b169ebc33a0f6386950c75539070ad9c) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Coalesce React Native storage writes into a short window so a burst of captures no longer re-serializes and rewrites the whole storage blob on every event. Login, logout, opt-in/opt-out, event flush, app background, shutdown, and fatal exceptions still persist synchronously.
  (2026-05-31)

- [#3689](https://github.com/PostHog/posthog-js/pull/3689) [`501ade6`](https://github.com/PostHog/posthog-js/commit/501ade6df6cba0f6556830244a1b708338a3c85f) Thanks [@ioannisj](https://github.com/ioannisj)! - fix(ios): iOS Release builds with Expo config plugin fail when bundle phase uses a /bin/sh prefix, causing posthog-xcode.sh to receive /bin/sh as $1 instead of the react-native-xcode.sh path. The PACKAGER_SOURCEMAP_FILE preservation patch was silently skipped, leading to posthog-cli failing with "Failed to load minified map". Fixes #3682.
  (2026-05-31)

- [#3694](https://github.com/PostHog/posthog-js/pull/3694) [`d9ad199`](https://github.com/PostHog/posthog-js/commit/d9ad1993d320ffc899dd57ce2f1cf1787e9c6635) Thanks [@gustavohstrassburger](https://github.com/gustavohstrassburger)! - fix(react-native): preserve non-string property types (booleans, arrays, numbers, objects) when caching person and group properties for feature flag evaluation. Previously these were force-coerced to strings via `String(value)`, causing flag conditions using boolean equality or array `contains` to fail on device while the PostHog UI still evaluated correctly.
  (2026-05-31)
- Updated dependencies [[`d9ad199`](https://github.com/PostHog/posthog-js/commit/d9ad1993d320ffc899dd57ce2f1cf1787e9c6635)]:
  - @posthog/core@1.29.14
  - @posthog/types@1.376.5

## 4.46.2

### Patch Changes

- [#3681](https://github.com/PostHog/posthog-js/pull/3681) [`7b84b75`](https://github.com/PostHog/posthog-js/commit/7b84b7599d076c9c3c86f923f7d56cf937ad9874) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - unify captureException in posthog core
  (2026-05-28)
- Updated dependencies [[`7b84b75`](https://github.com/PostHog/posthog-js/commit/7b84b7599d076c9c3c86f923f7d56cf937ad9874)]:
  - @posthog/core@1.29.13
  - @posthog/types@1.376.4

## 4.46.1

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.376.3
  - @posthog/core@1.29.12

## 4.46.0

### Minor Changes

- [#3673](https://github.com/PostHog/posthog-js/pull/3673) [`778205f`](https://github.com/PostHog/posthog-js/commit/778205f0bddbe02ce0aae21225d93cd119d9c19e) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Bump optional peer dependency `posthog-react-native-session-replay` floor to `>= 1.6.0`. The new minor adds an opt-in path that resolves `posthog-ios` through Swift Package Manager when consumers set `"posthog.useSpm": "true"` in their app's `ios/Podfile.properties.json` (with `use_frameworks! :linkage => :dynamic`). Default behavior is unchanged: without the property, `posthog-ios` continues to resolve through CocoaPods. See the [session-replay README](https://github.com/PostHog/posthog-react-native-session-replay#ios-dependency-resolution) for the opt-in details.
  (2026-05-27)

## 4.45.16

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.376.2
  - @posthog/core@1.29.11

## 4.45.15

### Patch Changes

- [#3665](https://github.com/PostHog/posthog-js/pull/3665) [`5568f12`](https://github.com/PostHog/posthog-js/commit/5568f12f46b4ebb7539f261edddda2f695ba03a2) Thanks [@ioannisj](https://github.com/ioannisj)! - Don't autocapture PostHog's own `PostHogFetchNetworkError` (raised when the device is offline) as a `$exception`. These connectivity failures are expected and were flooding error tracking with internal SDK noise. Adds an `isPostHogFetchNetworkError` type guard to `@posthog/core` so SDKs can detect these errors.
  (2026-05-26)
- Updated dependencies [[`5568f12`](https://github.com/PostHog/posthog-js/commit/5568f12f46b4ebb7539f261edddda2f695ba03a2)]:
  - @posthog/core@1.29.10
  - @posthog/types@1.376.1

## 4.45.14

### Patch Changes

- Updated dependencies [[`c806cca`](https://github.com/PostHog/posthog-js/commit/c806ccafdcc39b38e9554f8a17a8c2fbd3361dda)]:
  - @posthog/core@1.29.9
  - @posthog/types@1.376.0

## 4.45.13

### Patch Changes

- Updated dependencies [[`2e1d5f4`](https://github.com/PostHog/posthog-js/commit/2e1d5f4081c98a04e6a16f57e42491911453994d)]:
  - @posthog/types@1.375.0
  - @posthog/core@1.29.8

## 4.45.12

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.374.4
  - @posthog/core@1.29.7

## 4.45.11

### Patch Changes

- Updated dependencies [[`557b893`](https://github.com/PostHog/posthog-js/commit/557b8934aa0b990184e0376fb1fc28433ad336c6), [`a880dbc`](https://github.com/PostHog/posthog-js/commit/a880dbcbbfd01bbef939c627f3b541744e3c3587)]:
  - @posthog/types@1.374.3
  - @posthog/core@1.29.6

## 4.45.10

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.374.2
  - @posthog/core@1.29.5

## 4.45.9

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.374.1
  - @posthog/core@1.29.4

## 4.45.8

### Patch Changes

- [#3629](https://github.com/PostHog/posthog-js/pull/3629) [`9920e8b`](https://github.com/PostHog/posthog-js/commit/9920e8be5323ceaab60a097dab82656d9f1b6076) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - React Native surveys: closing a survey from Q2+ or the Thank You screen no longer flashes the first question during the fade-out. Opening another survey shortly after closing one no longer flashes the previous survey's content for the first frame on iOS — survey content unmounts one frame before the Modal dismisses so the UIKit snapshot the OS recycles is blank.
  (2026-05-18)

## 4.45.7

### Patch Changes

- Updated dependencies [[`594ea11`](https://github.com/PostHog/posthog-js/commit/594ea1146045d49080f6dfd951b037c13278e975)]:
  - @posthog/types@1.374.0
  - @posthog/core@1.29.3

## 4.45.6

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.373.5
  - @posthog/core@1.29.2

## 4.45.5

### Patch Changes

- Updated dependencies [[`4b895bf`](https://github.com/PostHog/posthog-js/commit/4b895bf0151f24c0b72e8ce4cae47906795b29b8)]:
  - @posthog/core@1.29.1
  - @posthog/types@1.373.4

## 4.45.4

### Patch Changes

- Updated dependencies [[`ad60818`](https://github.com/PostHog/posthog-js/commit/ad60818222252f1b65bb8778b12862c287168422)]:
  - @posthog/core@1.29.0
  - @posthog/types@1.373.3

## 4.45.3

### Patch Changes

- Updated dependencies [[`223d925`](https://github.com/PostHog/posthog-js/commit/223d9255e3dfb02af099b7529292cb56854daa77)]:
  - @posthog/core@1.28.7
  - @posthog/types@1.373.2

## 4.45.2

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.373.1
  - @posthog/core@1.28.6

## 4.45.1

### Patch Changes

- Updated dependencies [[`4c0c7d9`](https://github.com/PostHog/posthog-js/commit/4c0c7d9f48e6f4f5301f8208285191f62dc8407a), [`0a835fa`](https://github.com/PostHog/posthog-js/commit/0a835fa1d5db988d508aa023240ab5b4b50f0969)]:
  - @posthog/types@1.373.0
  - @posthog/core@1.28.5

## 4.45.0

### Minor Changes

- [#3552](https://github.com/PostHog/posthog-js/pull/3552) [`387ca37`](https://github.com/PostHog/posthog-js/commit/387ca37b25dca3927678643125f2cba25778989d) Thanks [@ioannisj](https://github.com/ioannisj)! - Add support for the experimental iOS session replay option `sessionReplayConfig.screenshotModeBackgroundCapture`
  (2026-05-09)

## 4.44.4

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.372.10
  - @posthog/core@1.28.4

## 4.44.3

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.372.9
  - @posthog/core@1.28.3

## 4.44.2

### Patch Changes

- [#3515](https://github.com/PostHog/posthog-js/pull/3515) [`255b273`](https://github.com/PostHog/posthog-js/commit/255b27380658b450d1427d4a478e4d7a4bf773f1) Thanks [@marandaneto](https://github.com/marandaneto)! - Gate survey translation logs behind SDK debug logging to avoid production console spam.
  (2026-05-04)
- Updated dependencies [[`220cd61`](https://github.com/PostHog/posthog-js/commit/220cd61e332ca4982c7bc3b6f740d797ef9e4e7f), [`255b273`](https://github.com/PostHog/posthog-js/commit/255b27380658b450d1427d4a478e4d7a4bf773f1)]:
  - @posthog/core@1.28.2
  - @posthog/types@1.372.8

## 4.44.1

### Patch Changes

- [#3512](https://github.com/PostHog/posthog-js/pull/3512) [`8aee3d5`](https://github.com/PostHog/posthog-js/commit/8aee3d55f8e2bf7a14a534c940327d8e08ba64f6) Thanks [@marandaneto](https://github.com/marandaneto)! - Do not crash when the React Native SDK is initialized without an API key; initialize as disabled and log an error instead. Disabled clients now also skip manual reload/flush/survey/log network calls.
  (2026-05-04)
- Updated dependencies [[`8aee3d5`](https://github.com/PostHog/posthog-js/commit/8aee3d55f8e2bf7a14a534c940327d8e08ba64f6)]:
  - @posthog/core@1.28.1
  - @posthog/types@1.372.7

## 4.44.0

### Minor Changes

- [#3492](https://github.com/PostHog/posthog-js/pull/3492) [`cf56753`](https://github.com/PostHog/posthog-js/commit/cf56753d775225df2751dee2de7987d4a47fef8c) Thanks [@lucasheriques](https://github.com/lucasheriques)! - Add translated survey rendering support in React Native and share survey translation logic through `@posthog/core`.
  (2026-05-01)

- [#3480](https://github.com/PostHog/posthog-js/pull/3480) [`04db756`](https://github.com/PostHog/posthog-js/commit/04db75663208251d1b09c80b09e5d00188e897fd) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Add manual log capture API for React Native: `posthog.captureLog()`, `posthog.logger.{trace,debug,info,warn,error,fatal}()`, `posthog.flushLogs()`, and a `logs` config option on the constructor. Records ship to PostHog's logs product (`/i/v1/logs`) in OTLP format, batched on a timer / AppState change / buffer fill, and persisted to a dedicated logs-storage file.

  Manual capture is unconditional — calling the API ships records, matching the events pipeline's manual `capture()` shape. Only blockers: `optedOut`, missing/empty `body`, and missing API key. The wire field `response.logs.captureConsoleLogs` is browser-only (it gates the JS SDK's `console.*` autocapture extension) and is not read by RN. When console autocapture lands on RN as a follow-up, that PR will introduce a local opt-in for the autocapture path specifically; manual capture will remain unconditional. (2026-05-01)

### Patch Changes

- Updated dependencies [[`cf56753`](https://github.com/PostHog/posthog-js/commit/cf56753d775225df2751dee2de7987d4a47fef8c), [`04db756`](https://github.com/PostHog/posthog-js/commit/04db75663208251d1b09c80b09e5d00188e897fd)]:
  - @posthog/core@1.28.0
  - @posthog/types@1.372.6

## 4.43.13

### Patch Changes

- [#3498](https://github.com/PostHog/posthog-js/pull/3498) [`135d0ef`](https://github.com/PostHog/posthog-js/commit/135d0ef8264cd421ec7cc627c9d080d7e5a4c20b) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Fix `SurveyModal` ignoring `appearance.position`. The modal previously hard-coded a bottom-center layout regardless of the configured position. It now honors all 9 `SurveyPosition` values, mirroring the web SDK semantics: `top_*` anchors to the top edge, `middle_*` to the vertical middle, and `left` / `center` / `right` (no prefix) to the bottom edge. The default remains bottom `center`.
  (2026-04-29)

## 4.43.12

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.372.5
  - @posthog/core@1.27.9

## 4.43.11

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.372.4
  - @posthog/core@1.27.8

## 4.43.10

### Patch Changes

- [`eae9407`](https://github.com/PostHog/posthog-js/commit/eae94077cd577323b4ccd5fc3f4238f98194b3f6) Thanks [@lucasheriques](https://github.com/lucasheriques)! - Include survey response properties and partial completion state on survey dismissal events.
  (2026-04-27)

## 4.43.9

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.372.3
  - @posthog/core@1.27.7

## 4.43.8

### Patch Changes

- [#3486](https://github.com/PostHog/posthog-js/pull/3486) [`c95999a`](https://github.com/PostHog/posthog-js/commit/c95999a149d06d38f355b90fd213f111d262b5db) Thanks [@ioannisj](https://github.com/ioannisj)! - chore: bump posthog-react-native-session-replay dependency to 1.5.6
  (2026-04-27)

## 4.43.7

### Patch Changes

- [#3485](https://github.com/PostHog/posthog-js/pull/3485) [`e65331c`](https://github.com/PostHog/posthog-js/commit/e65331cf6eb0843d7e6edc980d1ee44a29d6adc3) Thanks [@marandaneto](https://github.com/marandaneto)! - Fix Metro resolution for optional react-native-svg survey icons.
  (2026-04-27)
- Updated dependencies []:
  - @posthog/types@1.372.2
  - @posthog/core@1.27.6

## 4.43.6

### Patch Changes

- [#3482](https://github.com/PostHog/posthog-js/pull/3482) [`da1acaf`](https://github.com/PostHog/posthog-js/commit/da1acaf8af62ecdf19836347bd0029e9ca8af318) Thanks [@marandaneto](https://github.com/marandaneto)! - Fall back to text survey icons when react-native-svg is unavailable.
  (2026-04-27)

## 4.43.5

### Patch Changes

- Updated dependencies [[`70508df`](https://github.com/PostHog/posthog-js/commit/70508dfd7dd1201dd9c61c126a3c27ad39311c6a)]:
  - @posthog/core@1.27.5
  - @posthog/types@1.372.1

## 4.43.4

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.372.0
  - @posthog/core@1.27.4

## 4.43.3

### Patch Changes

- Updated dependencies []:
  - @posthog/types@1.371.4
  - @posthog/core@1.27.3

## 4.43.2

### Patch Changes

- Updated dependencies [[`daf028d`](https://github.com/PostHog/posthog-js/commit/daf028d553f756b9f58c01b848ad2d431239458b)]:
  - @posthog/core@1.27.2
  - @posthog/types@1.371.3

## 4.43.1

### Patch Changes

- Updated dependencies [[`96f19b7`](https://github.com/PostHog/posthog-js/commit/96f19b79d563937ed8f98e12796eee541a2dae7f)]:
  - @posthog/types@1.371.2
  - @posthog/core@1.27.1

## 4.43.0

### Minor Changes

- [#3432](https://github.com/PostHog/posthog-js/pull/3432) [`1a8b727`](https://github.com/PostHog/posthog-js/commit/1a8b7277c50a42bbb3f736afd530ff1c3389a7de) Thanks [@richardsolomou](https://github.com/richardsolomou)! - feat(react-native): add `addTracingHeaders` option to inject `X-POSTHOG-DISTINCT-ID` and `X-POSTHOG-SESSION-ID` headers on outgoing `fetch` requests for linking LLM traces and session replays to PostHog sessions.
  (2026-04-23)

### Patch Changes

- Updated dependencies [[`1a8b727`](https://github.com/PostHog/posthog-js/commit/1a8b7277c50a42bbb3f736afd530ff1c3389a7de)]:
  - @posthog/core@1.27.0

## 4.42.4

### Patch Changes

- Updated dependencies [[`922a1c1`](https://github.com/PostHog/posthog-js/commit/922a1c1838a5ed2ad37f59dade5fc3cc81bb4246)]:
  - @posthog/core@1.26.0

## 4.42.3

### Patch Changes

- Updated dependencies [[`1a0b58d`](https://github.com/PostHog/posthog-js/commit/1a0b58d1d07c61662169d3bc56eed8cfd8855d65)]:
  - @posthog/core@1.25.3

## 4.42.2

### Patch Changes

- [#3429](https://github.com/PostHog/posthog-js/pull/3429) [`2f1390a`](https://github.com/PostHog/posthog-js/commit/2f1390a7fd949b5634b4e6886f61825df782b7a7) Thanks [@ioannisj](https://github.com/ioannisj)! - fix: `PostHogMaskView` not being detected on iOS
  (2026-04-21)

## 4.42.1

### Patch Changes

- [#3402](https://github.com/PostHog/posthog-js/pull/3402) [`f2758ef`](https://github.com/PostHog/posthog-js/commit/f2758ef4dae345d131c25281a75c3da764c1a109) Thanks [@ioannisj](https://github.com/ioannisj)! - chore: bump plugin dependency to 1.5.4
  (2026-04-17)

## 4.42.0

### Minor Changes

- [#3399](https://github.com/PostHog/posthog-js/pull/3399) [`1d7e298`](https://github.com/PostHog/posthog-js/commit/1d7e298648a6c47880e2130f6d68d755342cbdd1) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - Add version and project to expo react native symbols
  (2026-04-16)

## 4.41.2

### Patch Changes

- [#3388](https://github.com/PostHog/posthog-js/pull/3388) [`6d0aae3`](https://github.com/PostHog/posthog-js/commit/6d0aae3795da50ba803ab99c65cc8e843254ed64) Thanks [@turnipdabeets](https://github.com/turnipdabeets)! - "exp" flag is no longer needed in tooling to upload or clone with hermes when using posthog-cli >= 0.7.4
  (2026-04-14)

## 4.41.1

### Patch Changes

- Updated dependencies [[`c735b08`](https://github.com/PostHog/posthog-js/commit/c735b08577f8fa85935dcec5bc5814870ac4ed56)]:
  - @posthog/core@1.25.2

## 4.41.0

### Minor Changes

- [#3340](https://github.com/PostHog/posthog-js/pull/3340) [`57ee5b2`](https://github.com/PostHog/posthog-js/commit/57ee5b25fd2c97f334f52b4eba28ea925033d6ed) Thanks [@dmarticus](https://github.com/dmarticus)! - Add device bucketing support to the React Native SDK for stable feature flag assignment across identity changes
  (2026-04-07)

### Patch Changes

- Updated dependencies [[`57ee5b2`](https://github.com/PostHog/posthog-js/commit/57ee5b25fd2c97f334f52b4eba28ea925033d6ed)]:
  - @posthog/core@1.25.1

## 4.40.2

### Patch Changes

- [#3348](https://github.com/PostHog/posthog-js/pull/3348) [`e246d07`](https://github.com/PostHog/posthog-js/commit/e246d076360bd07c0f4b754d31efc5e96b01f2d4) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: preserve app lifecycle properties on reset() to prevent duplicate Application Installed events
  (2026-04-07)

## 4.40.1

### Patch Changes

- [#3291](https://github.com/PostHog/posthog-js/pull/3291) [`95ad66d`](https://github.com/PostHog/posthog-js/commit/95ad66d8cb406b253453a0c5dd01c9a5e46551a9) Thanks [@ioannisj](https://github.com/ioannisj)! - chore: bump minimum version of posthog-react-native-session-replay dependency to 1.5.2
  (2026-04-07)

## 4.40.0

### Minor Changes

- [#3302](https://github.com/PostHog/posthog-js/pull/3302) [`fc5589f`](https://github.com/PostHog/posthog-js/commit/fc5589fcc51bd53ba818822831867d3c00d83a11) Thanks [@dmarticus](https://github.com/dmarticus)! - preserve $set_once semantics in local flag evaluation cache
  (2026-04-07)

### Patch Changes

- Updated dependencies [[`fc5589f`](https://github.com/PostHog/posthog-js/commit/fc5589fcc51bd53ba818822831867d3c00d83a11)]:
  - @posthog/core@1.25.0

## 4.39.4

### Patch Changes

- [#3332](https://github.com/PostHog/posthog-js/pull/3332) [`3727051`](https://github.com/PostHog/posthog-js/commit/372705140150a46fd5641dbc55c27b246452ab72) Thanks [@ioannisj](https://github.com/ioannisj)! - chore: update posthog-react-native-session-replay min version to 1.5.2
  (2026-04-03)

## 4.39.3

### Patch Changes

- Updated dependencies [[`a01a3d5`](https://github.com/PostHog/posthog-js/commit/a01a3d55dc134b1b269be58c7922ce3780c57fc5)]:
  - @posthog/core@1.24.6

## 4.39.2

### Patch Changes

- [#3309](https://github.com/PostHog/posthog-js/pull/3309) [`197eeda`](https://github.com/PostHog/posthog-js/commit/197eeda0b09fd2671a8a40f1bfd48a7b940f7371) Thanks [@marandaneto](https://github.com/marandaneto)! - Extract CLI and sourcemap utilities from @posthog/core into @posthog/plugin-utils to remove cross-spawn from React Native dependencies
  (2026-04-01)
- Updated dependencies [[`197eeda`](https://github.com/PostHog/posthog-js/commit/197eeda0b09fd2671a8a40f1bfd48a7b940f7371)]:
  - @posthog/core@1.24.5

## 4.39.1

### Patch Changes

- [#3296](https://github.com/PostHog/posthog-js/pull/3296) [`a863914`](https://github.com/PostHog/posthog-js/commit/a863914bca09643f2aef7ca029b96de9cbfbc24c) Thanks [@marandaneto](https://github.com/marandaneto)! - Fix `captureException` crashing with `ReferenceError: Property 'Event' doesn't exist`
  (2026-03-30)
- Updated dependencies [[`a863914`](https://github.com/PostHog/posthog-js/commit/a863914bca09643f2aef7ca029b96de9cbfbc24c)]:
  - @posthog/core@1.24.4

## 4.39.0

### Minor Changes

- [#3292](https://github.com/PostHog/posthog-js/pull/3292) [`4bdfdbc`](https://github.com/PostHog/posthog-js/commit/4bdfdbcfe6a5600664a609a6b17c7d7cb72cd20f) Thanks [@marandaneto](https://github.com/marandaneto)! - `captureAppLifecycleEvents` is now enabled by default. If you want to disable it, you can set `captureAppLifecycleEvents: false` in the PostHog options:

  ```js
  const posthog = new PostHog('<ph_project_api_key>', {
    captureAppLifecycleEvents: false,
  })
  ```

  Or when using the PostHogProvider:

  ````jsx
  <PostHogProvider apiKey="<ph_project_api_key>" options={{ captureAppLifecycleEvents: false }}>
    <MyApp />
  </PostHogProvider>
  ``` (2026-03-27)
  ````

### Patch Changes

- Updated dependencies [[`4bdfdbc`](https://github.com/PostHog/posthog-js/commit/4bdfdbcfe6a5600664a609a6b17c7d7cb72cd20f)]:
  - @posthog/core@1.24.3

## 4.38.0

### Minor Changes

- [#3287](https://github.com/PostHog/posthog-js/pull/3287) [`470907d`](https://github.com/PostHog/posthog-js/commit/470907dcbcf0a0bd73819fa7610716b9a1f65536) Thanks [@marandaneto](https://github.com/marandaneto)! - Add $is_emulator property to detect emulator/simulator environments
  (2026-03-27)

### Patch Changes

- Updated dependencies [[`8d34289`](https://github.com/PostHog/posthog-js/commit/8d34289f7cf91945223eed4366b11fb187a63a40)]:
  - @posthog/core@1.24.2

## 4.37.6

### Patch Changes

- [#3270](https://github.com/PostHog/posthog-js/pull/3270) [`693cc0d`](https://github.com/PostHog/posthog-js/commit/693cc0d6c9a8ba795baa53ff66b0bc9cd4d46296) Thanks [@cat-ph](https://github.com/cat-ph)! - prevent xcode build abort when npm is not in PATH
  (2026-03-23)

## 4.37.5

### Patch Changes

- Updated dependencies [[`314120a`](https://github.com/PostHog/posthog-js/commit/314120aa2377b3c8031dd774833fe9082ecdbd39)]:
  - @posthog/core@1.24.1

## 4.37.4

### Patch Changes

- Updated dependencies [[`9cd2313`](https://github.com/PostHog/posthog-js/commit/9cd23138343e1020811f85853d6016cc985bb24f)]:
  - @posthog/core@1.24.0

## 4.37.3

### Patch Changes

- Updated dependencies [[`bc30c2d`](https://github.com/PostHog/posthog-js/commit/bc30c2d988bb307e811d97711f208c125eefba3a), [`bc30c2d`](https://github.com/PostHog/posthog-js/commit/bc30c2d988bb307e811d97711f208c125eefba3a)]:
  - @posthog/core@1.23.4

## 4.37.2

### Patch Changes

- Updated dependencies [[`4009c15`](https://github.com/PostHog/posthog-js/commit/4009c15c85c96b5cf99fdbcda448b9893c95541e)]:
  - @posthog/core@1.23.3

## 4.37.1

### Patch Changes

- [#3185](https://github.com/PostHog/posthog-js/pull/3185) [`5e8d5fc`](https://github.com/PostHog/posthog-js/commit/5e8d5fc9c12e5545e015c9c5556167b9fb279347) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: export getRemoteConfigBool, getRemoteConfigNumber, and isValidSampleRate from @posthog/core
  (2026-03-02)
- Updated dependencies [[`5e8d5fc`](https://github.com/PostHog/posthog-js/commit/5e8d5fc9c12e5545e015c9c5556167b9fb279347)]:
  - @posthog/core@1.23.2

## 4.37.0

### Minor Changes

- [#3134](https://github.com/PostHog/posthog-js/pull/3134) [`eb12d0c`](https://github.com/PostHog/posthog-js/commit/eb12d0cd0a36cdb053f08ce4dfbcecdc62ece2bd) Thanks [@marandaneto](https://github.com/marandaneto)! - feat: support session replay sampleRate config
  (2026-03-02)

## 4.36.1

### Patch Changes

- [#3156](https://github.com/PostHog/posthog-js/pull/3156) [`6fb72c3`](https://github.com/PostHog/posthog-js/commit/6fb72c361e4c8092979843aa7ad47aa6c2216ef4) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: expo-file-system detection broken on Expo SDK 54 stable
  (2026-02-26)

## 4.36.0

### Minor Changes

- [#3010](https://github.com/PostHog/posthog-js/pull/3010) [`da31ef8`](https://github.com/PostHog/posthog-js/commit/da31ef8bebc85e1e85425c7b4ec8abe425052dde) Thanks [@ioannisj](https://github.com/ioannisj)! - feat: add manual session replay control

  New methods for programmatic control of session recording:
  - `startSessionRecording(resumeCurrent?: boolean)` - Start or resume session recording. Pass `false` to start a new session.
  - `stopSessionRecording()` - Stop the current session recording.
  - `isSessionReplayActive()` - Check if session replay is currently active.

  **Note:** Requires `posthog-react-native-session-replay` version 1.3.0 or higher. Users with older plugin versions will see a warning when calling these methods. (2026-02-20)

## 4.35.1

### Patch Changes

- Updated dependencies [[`9dbc05e`](https://github.com/PostHog/posthog-js/commit/9dbc05ed65ddc8c37c9262b9aebfc51d0c748971)]:
  - @posthog/core@1.23.1

## 4.35.0

### Minor Changes

- [#3086](https://github.com/PostHog/posthog-js/pull/3086) [`e962f01`](https://github.com/PostHog/posthog-js/commit/e962f01c80476b9325f0bbb4ca591820cfb9f338) Thanks [@marandaneto](https://github.com/marandaneto)! - feat: support remote config for error tracking, session replay capture performance and capture logs
  (2026-02-17)

### Patch Changes

- Updated dependencies [[`e962f01`](https://github.com/PostHog/posthog-js/commit/e962f01c80476b9325f0bbb4ca591820cfb9f338)]:
  - @posthog/core@1.23.0

## 4.34.0

### Minor Changes

- [#3084](https://github.com/PostHog/posthog-js/pull/3084) [`e2ac0e8`](https://github.com/PostHog/posthog-js/commit/e2ac0e856821a0b7e2e25c1142c602c4c138cbdd) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - add error boundary
  (2026-02-12)

## 4.33.0

### Minor Changes

- [#3065](https://github.com/PostHog/posthog-js/pull/3065) [`34ee954`](https://github.com/PostHog/posthog-js/commit/34ee95404fdae8c97f3263a600392caac5b982a8) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - feat: Add `useFeatureFlagResult` hook
  (2026-02-12)

### Patch Changes

- [#3071](https://github.com/PostHog/posthog-js/pull/3071) [`d1d62d4`](https://github.com/PostHog/posthog-js/commit/d1d62d4e4a3653f0b93abcbd9f33567ed60e3547) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - fix: `PostHogContext` is correctly typed
  (2026-02-12)

## 4.32.0

### Minor Changes

- [#3045](https://github.com/PostHog/posthog-js/pull/3045) [`0acf16f`](https://github.com/PostHog/posthog-js/commit/0acf16fcbf8c32d5f28b86b6fa200271ad0b647e) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - feat: Add `getFeatureFlagResult` to PostHogCore
  (2026-02-10)

### Patch Changes

- Updated dependencies [[`0acf16f`](https://github.com/PostHog/posthog-js/commit/0acf16fcbf8c32d5f28b86b6fa200271ad0b647e)]:
  - @posthog/core@1.22.0

## 4.31.1

### Patch Changes

- [#3070](https://github.com/PostHog/posthog-js/pull/3070) [`eca98ac`](https://github.com/PostHog/posthog-js/commit/eca98ac8da99210b69f67474189ca8720c76062b) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: export PostHogMaskView
  (2026-02-10)

## 4.31.0

### Minor Changes

- [#2820](https://github.com/PostHog/posthog-js/pull/2820) [`d578824`](https://github.com/PostHog/posthog-js/commit/d578824395ceba3b854970c2a7723e97466d9e9d) Thanks [@ordehi](https://github.com/ordehi)! - Add survey response validation for message length (min and max length). Fixes whitespace-only bypass for required questions. Existing surveys work unchanged but now properly reject blank responses.
  (2026-02-09)

### Patch Changes

- Updated dependencies [[`d578824`](https://github.com/PostHog/posthog-js/commit/d578824395ceba3b854970c2a7723e97466d9e9d)]:
  - @posthog/core@1.21.0

## 4.30.3

### Patch Changes

- [#3028](https://github.com/PostHog/posthog-js/pull/3028) [`e055f9a`](https://github.com/PostHog/posthog-js/commit/e055f9a344d7c11309c56444383f79df335a5c51) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: Queue pending feature flags reload instead of dropping requests when a reload is already in flight
  (2026-02-09)
- Updated dependencies [[`e055f9a`](https://github.com/PostHog/posthog-js/commit/e055f9a344d7c11309c56444383f79df335a5c51)]:
  - @posthog/core@1.20.2

## 4.30.2

### Patch Changes

- Updated dependencies [[`8f75dae`](https://github.com/PostHog/posthog-js/commit/8f75dae39ae2938624ca49e778915a92f2491556)]:
  - @posthog/core@1.20.1

## 4.30.1

### Patch Changes

- [#3031](https://github.com/PostHog/posthog-js/pull/3031) [`26775e2`](https://github.com/PostHog/posthog-js/commit/26775e2ac54b0b6e2356336a68daed35cb7cd6fc) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: prevent duplicate events with transactional storage (async) updates
  (2026-02-05)

## 4.30.0

### Minor Changes

- [#3023](https://github.com/PostHog/posthog-js/pull/3023) [`bb62809`](https://github.com/PostHog/posthog-js/commit/bb62809917845685ae7e2e6d5adad6be5528356e) Thanks [@marandaneto](https://github.com/marandaneto)! - feat: only capture $set events if the user properties have changed
  (2026-02-04)

### Patch Changes

- Updated dependencies [[`bb62809`](https://github.com/PostHog/posthog-js/commit/bb62809917845685ae7e2e6d5adad6be5528356e)]:
  - @posthog/core@1.20.0

## 4.29.0

### Minor Changes

- [#3009](https://github.com/PostHog/posthog-js/pull/3009) [`c99e5fe`](https://github.com/PostHog/posthog-js/commit/c99e5feb043870357c8f722eb52542327c3f472b) Thanks [@marandaneto](https://github.com/marandaneto)! - feat: add setPersonProperties method
  (2026-02-03)

### Patch Changes

- Updated dependencies [[`c99e5fe`](https://github.com/PostHog/posthog-js/commit/c99e5feb043870357c8f722eb52542327c3f472b)]:
  - @posthog/core@1.19.0

## 4.28.0

### Minor Changes

- [#2944](https://github.com/PostHog/posthog-js/pull/2944) [`578fc2a`](https://github.com/PostHog/posthog-js/commit/578fc2a83392a64028cde4187bfc0dcaf6f110c4) Thanks [@RayKay91](https://github.com/RayKay91)! - Allow for properties to be excluded from reset
  (2026-02-03)

### Patch Changes

- Updated dependencies [[`7768010`](https://github.com/PostHog/posthog-js/commit/77680105f1e8baf5ed1934d423494793d11ff01a)]:
  - @posthog/core@1.18.0

## 4.27.0

### Minor Changes

- [#2966](https://github.com/PostHog/posthog-js/pull/2966) [`727536c`](https://github.com/PostHog/posthog-js/commit/727536cf5f1ab5a8d21fa9d4e2e6b13efc851fca) Thanks [@adboio](https://github.com/adboio)! - support "always" survey schedule
  (2026-01-29)

### Patch Changes

- Updated dependencies [[`727536c`](https://github.com/PostHog/posthog-js/commit/727536cf5f1ab5a8d21fa9d4e2e6b13efc851fca)]:
  - @posthog/core@1.17.0

## 4.26.0

### Minor Changes

- [#2967](https://github.com/PostHog/posthog-js/pull/2967) [`cbe84c1`](https://github.com/PostHog/posthog-js/commit/cbe84c1ea8b6dd398569ed401139e9698e08fd64) Thanks [@adboio](https://github.com/adboio)! - support auto-submit on selection for survey rating questions
  (2026-01-29)

### Patch Changes

- Updated dependencies [[`cbe84c1`](https://github.com/PostHog/posthog-js/commit/cbe84c1ea8b6dd398569ed401139e9698e08fd64)]:
  - @posthog/core@1.16.0

## 4.25.0

### Minor Changes

- [#2983](https://github.com/PostHog/posthog-js/pull/2983) [`e925210`](https://github.com/PostHog/posthog-js/commit/e925210182f295f17f93ed0e1c3936ac010960d5) Thanks [@marandaneto](https://github.com/marandaneto)! - feat: allow recording masking with a view wrapper and without accessibilitylabel
  (2026-01-29)

## 4.24.2

### Patch Changes

- Updated dependencies [[`8c0c495`](https://github.com/PostHog/posthog-js/commit/8c0c495caaf4cd7f950cbc77fdfc1df499772008)]:
  - @posthog/core@1.15.0

## 4.24.1

### Patch Changes

- [#2971](https://github.com/PostHog/posthog-js/pull/2971) [`f51560c`](https://github.com/PostHog/posthog-js/commit/f51560caf78386cef5278f7cf0e9f253b2ec0e50) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: groups and groupidentify is a no-op if person profiles is set to never
  (2026-01-27)
- Updated dependencies [[`f51560c`](https://github.com/PostHog/posthog-js/commit/f51560caf78386cef5278f7cf0e9f253b2ec0e50)]:
  - @posthog/core@1.14.1

## 4.24.0

### Minor Changes

- [#2917](https://github.com/PostHog/posthog-js/pull/2917) [`933c763`](https://github.com/PostHog/posthog-js/commit/933c7639ae30390ca562a0891d59649711b53522) Thanks [@marandaneto](https://github.com/marandaneto)! - feat: add support for person_profiles react native, core and web-lite
  (2026-01-23)

### Patch Changes

- Updated dependencies [[`933c763`](https://github.com/PostHog/posthog-js/commit/933c7639ae30390ca562a0891d59649711b53522)]:
  - @posthog/core@1.14.0

## 4.23.0

### Minor Changes

- [#2882](https://github.com/PostHog/posthog-js/pull/2882) [`8a5a3d5`](https://github.com/PostHog/posthog-js/commit/8a5a3d5693facda62b90b66dead338f7dca19705) Thanks [@adboio](https://github.com/adboio)! - add support for question prefill in popover surveys, add useThumbSurvey hook
  (2026-01-20)

### Patch Changes

- Updated dependencies [[`8a5a3d5`](https://github.com/PostHog/posthog-js/commit/8a5a3d5693facda62b90b66dead338f7dca19705)]:
  - @posthog/core@1.13.0

## 4.22.0

### Minor Changes

- [#2897](https://github.com/PostHog/posthog-js/pull/2897) [`b7fa003`](https://github.com/PostHog/posthog-js/commit/b7fa003ef6ef74bdf4666be0748d89a5a6169054) Thanks [@matheus-vb](https://github.com/matheus-vb)! - Add $feature_flag_error to $feature_flag_called events to track flag evaluation failures
  (2026-01-20)

- [#2931](https://github.com/PostHog/posthog-js/pull/2931) [`f0cbc0d`](https://github.com/PostHog/posthog-js/commit/f0cbc0d8e4e5efc27d9595676e886d6d3d3892f4) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: before_send support for web lite and react native
  (2026-01-20)

### Patch Changes

- Updated dependencies [[`b7fa003`](https://github.com/PostHog/posthog-js/commit/b7fa003ef6ef74bdf4666be0748d89a5a6169054), [`f0cbc0d`](https://github.com/PostHog/posthog-js/commit/f0cbc0d8e4e5efc27d9595676e886d6d3d3892f4)]:
  - @posthog/core@1.12.0

## 4.21.0

### Minor Changes

- [#2900](https://github.com/PostHog/posthog-js/pull/2900) [`23770e9`](https://github.com/PostHog/posthog-js/commit/23770e9e2eed1aca5c2bc7a34a6d64dc115b0d11) Thanks [@dmarticus](https://github.com/dmarticus)! - Renamed `evaluationEnvironments` to `evaluationContexts` for clearer semantics. The term "contexts" better reflects that this feature is for specifying evaluation contexts (e.g., "web", "mobile", "checkout") rather than deployment environments (e.g., "staging", "production").

  ### Deprecated
  - `posthog.init` option `evaluationEnvironments` is now deprecated in favor of `evaluationContexts`. The old property will continue to work and will log a deprecation warning. It will be removed in a future major version.

  ### Migration Guide

  ````javascript
  // Before
  posthog.init('<ph_project_api_key>', {
      evaluationEnvironments: ['production', 'web', 'checkout'],
  })

  // After
  posthog.init('<ph_project_api_key>', {
      evaluationContexts: ['production', 'web', 'checkout'],
  })
  ``` (2026-01-19)
  ````

### Patch Changes

- Updated dependencies [[`23770e9`](https://github.com/PostHog/posthog-js/commit/23770e9e2eed1aca5c2bc7a34a6d64dc115b0d11)]:
  - @posthog/core@1.11.0

## 4.20.0

### Minor Changes

- [#2924](https://github.com/PostHog/posthog-js/pull/2924) [`298ac60`](https://github.com/PostHog/posthog-js/commit/298ac609d233e04a7a7423445b780ec8b7450245) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - allow disabling the plugin programmatically
  (2026-01-19)

## 4.19.0

### Minor Changes

- [#2881](https://github.com/PostHog/posthog-js/pull/2881) [`d37e570`](https://github.com/PostHog/posthog-js/commit/d37e5709863e869825df57d0854588140c4294b2) Thanks [@adboio](https://github.com/adboio)! - add support for thumbs up/down survey rating scale
  (2026-01-16)

### Patch Changes

- Updated dependencies [[`d37e570`](https://github.com/PostHog/posthog-js/commit/d37e5709863e869825df57d0854588140c4294b2)]:
  - @posthog/core@1.10.0

## 4.18.0

### Minor Changes

- [#2884](https://github.com/PostHog/posthog-js/pull/2884) [`66670ad`](https://github.com/PostHog/posthog-js/commit/66670adf56f5d909befd0aafb19419c650973eb5) Thanks [@ablaszkiewicz](https://github.com/ablaszkiewicz)! - disable injection for react native web platform
  (2026-01-13)

## 4.17.3

### Patch Changes

- Updated dependencies [[`fba9fb2`](https://github.com/PostHog/posthog-js/commit/fba9fb2ea4be2ea396730741b4718b4a2c80d026), [`c1ed63b`](https://github.com/PostHog/posthog-js/commit/c1ed63b0f03380a5e4bb2463491b3f767f64a514)]:
  - @posthog/core@1.9.1

## 4.17.2

### Patch Changes

- [#2833](https://github.com/PostHog/posthog-js/pull/2833) [`c7c3140`](https://github.com/PostHog/posthog-js/commit/c7c3140a20957d71072f355be4744a6cdb315360) Thanks [@ioannisj](https://github.com/ioannisj)! - fix expo web export build error
  (2025-12-31)

## 4.17.1

### Patch Changes

- [#2809](https://github.com/PostHog/posthog-js/pull/2809) [`8fd7c76`](https://github.com/PostHog/posthog-js/commit/8fd7c766efbc4c9445c4ce72cfb6b761520e7f1f) Thanks [@adboio](https://github.com/adboio)! - add control for keyboard avoiding behavior on android
  (2025-12-29)

## 4.17.0

### Minor Changes

- [#2787](https://github.com/PostHog/posthog-js/pull/2787) [`b676b4d`](https://github.com/PostHog/posthog-js/commit/b676b4d7342c8c3b64960aa55630b2810366014e) Thanks [@lucasheriques](https://github.com/lucasheriques)! - feat: allow customizing text colors on web and react native
  (2025-12-22)

### Patch Changes

- [#2791](https://github.com/PostHog/posthog-js/pull/2791) [`3e533de`](https://github.com/PostHog/posthog-js/commit/3e533de1e8b52f64fa28762114f4e279d2c55406) Thanks [@adboio](https://github.com/adboio)! - surveys fix: do not dismiss keyboard on submit button tap
  (2025-12-22)
- Updated dependencies [[`b676b4d`](https://github.com/PostHog/posthog-js/commit/b676b4d7342c8c3b64960aa55630b2810366014e)]:
  - @posthog/core@1.9.0

## 4.16.2

### Patch Changes

- [#2769](https://github.com/PostHog/posthog-js/pull/2769) [`6b0aabf`](https://github.com/PostHog/posthog-js/commit/6b0aabff893e44d1710b7d122a68bf023f4e0bd5) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: React Native on web should report hardware type as Desktop or Mobile, not Web
  (2025-12-17)
- Updated dependencies [[`6b0aabf`](https://github.com/PostHog/posthog-js/commit/6b0aabff893e44d1710b7d122a68bf023f4e0bd5)]:
  - @posthog/core@1.8.1

## 4.16.1

### Patch Changes

- [#2763](https://github.com/PostHog/posthog-js/pull/2763) [`c9c0e4d`](https://github.com/PostHog/posthog-js/commit/c9c0e4d658f73a022151a273f258df0201738219) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: captureTouches errors with reanimated styles
  (2025-12-17)

## 4.16.0

### Minor Changes

- [#2776](https://github.com/PostHog/posthog-js/pull/2776) [`32db4b3`](https://github.com/PostHog/posthog-js/commit/32db4b378c5d40747454085de135174c2c176849) Thanks [@adboio](https://github.com/adboio)! - support event property filters on surveys
  (2025-12-17)

## 4.15.0

### Minor Changes

- [#2774](https://github.com/PostHog/posthog-js/pull/2774) [`2603a8d`](https://github.com/PostHog/posthog-js/commit/2603a8d6e1021cd8f84e8b61be77ce268435ebde) Thanks [@adboio](https://github.com/adboio)! - fix survey text color on react native
  (2025-12-16)

### Patch Changes

- Updated dependencies [[`2603a8d`](https://github.com/PostHog/posthog-js/commit/2603a8d6e1021cd8f84e8b61be77ce268435ebde)]:
  - @posthog/core@1.8.0

## 4.14.4

### Patch Changes

- [#2764](https://github.com/PostHog/posthog-js/pull/2764) [`8368cbc`](https://github.com/PostHog/posthog-js/commit/8368cbcc3c29e362f2658e580f4956e0037469f7) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: posthog-cli finds the correct path on android gradle plugin
  (2025-12-16)

## 4.14.3

### Patch Changes

- [#2697](https://github.com/PostHog/posthog-js/pull/2697) [`0c3bd5e`](https://github.com/PostHog/posthog-js/commit/0c3bd5eb1fe7fa94bb78ed1282922d613cc37e95) Thanks [@robbie-c](https://github.com/robbie-c)! - Support getting locale and timezone from expo-localization >= 14
  (2025-12-05)

## 4.14.2

### Patch Changes

- [#2690](https://github.com/PostHog/posthog-js/pull/2690) [`e9c00fd`](https://github.com/PostHog/posthog-js/commit/e9c00fd451f6ee648ff40dcad538d38bfd5f3ff4) Thanks [@robbie-c](https://github.com/robbie-c)! - Related to https://www.wiz.io/blog/critical-vulnerability-in-react-cve-2025-55182

  We didn't include any of the vulnerable deps in any of our packages, however we did have them as dev / test / example project dependencies.

  There was no way that any of these vulnerable packages were included in any of our published packages.

  We've now patched out those dependencies.

  Out of an abundance of caution, let's create a new release of all of our packages. (2025-12-04)

- Updated dependencies [[`e9c00fd`](https://github.com/PostHog/posthog-js/commit/e9c00fd451f6ee648ff40dcad538d38bfd5f3ff4)]:
  - @posthog/core@1.7.1

## 4.14.1

### Patch Changes

- Updated dependencies [[`e1617d9`](https://github.com/PostHog/posthog-js/commit/e1617d91255b23dc39b1dcb15b05ae64c735d9d0)]:
  - @posthog/core@1.7.0

## 4.14.0

### Minor Changes

- [#2613](https://github.com/PostHog/posthog-js/pull/2613) [`81781ba`](https://github.com/PostHog/posthog-js/commit/81781ba593be58fcd9c0f31c8fa8ef2693fd765c) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: expo plugin for react native error tracking.
  (2025-11-24)

## 4.13.0

### Minor Changes

- [#2619](https://github.com/PostHog/posthog-js/pull/2619) [`86dab38`](https://github.com/PostHog/posthog-js/commit/86dab38e49eeac9819b1ab5f7f0c8b5df88d9f86) Thanks [@hpouillot](https://github.com/hpouillot)! - package deprecation
  (2025-11-24)

### Patch Changes

- Updated dependencies [[`86dab38`](https://github.com/PostHog/posthog-js/commit/86dab38e49eeac9819b1ab5f7f0c8b5df88d9f86)]:
  - @posthog/core@1.6.0

## 4.12.5

### Patch Changes

- [#2618](https://github.com/PostHog/posthog-js/pull/2618) [`3eed1a4`](https://github.com/PostHog/posthog-js/commit/3eed1a42a50bff310fde3a91308a0f091b39e3fe) Thanks [@marandaneto](https://github.com/marandaneto)! - last version was compromised
  (2025-11-24)
- Updated dependencies [[`3eed1a4`](https://github.com/PostHog/posthog-js/commit/3eed1a42a50bff310fde3a91308a0f091b39e3fe)]:
  - @posthog/core@1.5.6

## 4.12.4

### Patch Changes

- [#2608](https://github.com/PostHog/posthog-js/pull/2608) [`bef494e`](https://github.com/PostHog/posthog-js/commit/bef494e55a711bc66e13cf94fe8e39a1f8bf72d1) Thanks [@ioannisj](https://github.com/ioannisj)! - fix: latest release on posthog-cli lookup when installed via npm for iOS source map uploads
  (2025-11-20)

## 4.12.3

### Patch Changes

- Updated dependencies [[`83f5d07`](https://github.com/PostHog/posthog-js/commit/83f5d07e4ae8c2ae5c6926858b6095ebbfaf319f)]:
  - @posthog/core@1.5.5

## 4.12.2

### Patch Changes

- Updated dependencies [[`c242702`](https://github.com/PostHog/posthog-js/commit/c2427029d75cba71b78e9822f18f5e73f7442288)]:
  - @posthog/core@1.5.4

## 4.12.1

### Patch Changes

- [#2575](https://github.com/PostHog/posthog-js/pull/2575) [`8acd88f`](https://github.com/PostHog/posthog-js/commit/8acd88f1b71d2c7e1222c43dd121abce78ef2bab) Thanks [@hpouillot](https://github.com/hpouillot)! - fix frame platform property for $exception events
  (2025-11-19)
- Updated dependencies [[`8acd88f`](https://github.com/PostHog/posthog-js/commit/8acd88f1b71d2c7e1222c43dd121abce78ef2bab)]:
  - @posthog/core@1.5.3

## 4.12.0

### Minor Changes

- [#2484](https://github.com/PostHog/posthog-js/pull/2484) [`d143cc4`](https://github.com/PostHog/posthog-js/commit/d143cc4606079ced995f41594e770addf87d0a7f) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: add hermes symbolication support for react native and error tracking

## 4.11.0

### Minor Changes

- [#2564](https://github.com/PostHog/posthog-js/pull/2564) [`ee01b17`](https://github.com/PostHog/posthog-js/commit/ee01b1727c5d4fb5cf2e2c8bb57062907e498445) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - feat: Properties sent via `identify` and `group` are cached for flags calls

- [#2564](https://github.com/PostHog/posthog-js/pull/2564) [`ee01b17`](https://github.com/PostHog/posthog-js/commit/ee01b1727c5d4fb5cf2e2c8bb57062907e498445) Thanks [@dustinbyrne](https://github.com/dustinbyrne)! - feat: `setDefaultPersonProperties` config option (default true) automatically includes common device and app properties in feature flag evaluation.

## 4.10.8

### Patch Changes

- Updated dependencies [[`87f9604`](https://github.com/PostHog/posthog-js/commit/87f96047739e67b847fe22137b97fc57f405b8d9)]:
  - @posthog/core@1.5.2

## 4.10.7

### Patch Changes

- [#2541](https://github.com/PostHog/posthog-js/pull/2541) [`b3a62d0`](https://github.com/PostHog/posthog-js/commit/b3a62d01aa62cc96cd4270adf1168a219f620ee7) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: deprecate navigationRef autocapture

- Updated dependencies [[`d8d98c9`](https://github.com/PostHog/posthog-js/commit/d8d98c95f24b612110dbf52d228c0c3bd248cd58)]:
  - @posthog/core@1.5.1

## 4.10.6

### Patch Changes

- Updated dependencies [[`068d55e`](https://github.com/PostHog/posthog-js/commit/068d55ed4193e82729cd34b42d9e433f85b6e606)]:
  - @posthog/core@1.5.0

## 4.10.5

### Patch Changes

- Updated dependencies [[`751b440`](https://github.com/PostHog/posthog-js/commit/751b44040c4c0c55a19df2ad0e5f215943620e51)]:
  - @posthog/core@1.4.0

## 4.10.4

### Patch Changes

- [#2493](https://github.com/PostHog/posthog-js/pull/2493) [`7ec7be5`](https://github.com/PostHog/posthog-js/commit/7ec7be5917090ae00f988035ff1e0f6f727e6660) Thanks [@ordehi](https://github.com/ordehi)! - **Bug Fixes:**
  - Fixed surveys with URL or CSS selector targeting incorrectly showing in React Native
    - **Breaking behavior change**: Surveys configured with URL or CSS selector targeting will no longer appear in React Native apps (this was always the intended behavior)
    - **Action required**: If you have surveys that should show in React Native, remove URL/selector conditions and use feature flags or device type targeting instead

## 4.10.3

### Patch Changes

- Updated dependencies [[`e0a6fe0`](https://github.com/PostHog/posthog-js/commit/e0a6fe013b5a1e92a6e7685f35f715199b716b34)]:
  - @posthog/core@1.3.1

## 4.10.2

### Patch Changes

- [#2457](https://github.com/PostHog/posthog-js/pull/2457) [`7f5e94b`](https://github.com/PostHog/posthog-js/commit/7f5e94b3839e9c6ef8363b9296993ca11e3319ad) Thanks [@daibhin](https://github.com/daibhin)! - correctly export error tracking files

## 4.10.1

### Patch Changes

- [#2415](https://github.com/PostHog/posthog-js/pull/2415) [`ab30675`](https://github.com/PostHog/posthog-js/commit/ab30675f9fcb9323dfbc8447fd5b244a0a631983) Thanks [@ioannisj](https://github.com/ioannisj)! - fix surveys only appear on subsequent app launches after being loaded and cached

## 4.10.0

### Minor Changes

- [#2417](https://github.com/PostHog/posthog-js/pull/2417) [`daf919b`](https://github.com/PostHog/posthog-js/commit/daf919be225527ee4ad026d806dec195b75e44aa) Thanks [@dmarticus](https://github.com/dmarticus)! - feat: Add evaluation environments support for feature flags

  This PR implements support for evaluation environments in the posthog-react-native SDK, allowing users to specify which environment tags their SDK instance should use when evaluating feature flags.

  Users can now configure the SDK with an `evaluationEnvironments` option:

  ```typescript
  const posthog = new PostHog('api-key', {
    host: 'https://app.posthog.com',
    evaluationEnvironments: ['production', 'mobile', 'react-native'],
  })
  ```

  When set, only feature flags that have at least one matching evaluation tag will be evaluated for this SDK instance. Feature flags with no evaluation tags will always be evaluated.

### Patch Changes

- [#2431](https://github.com/PostHog/posthog-js/pull/2431) [`7d45a7a`](https://github.com/PostHog/posthog-js/commit/7d45a7a52c44ba768913d66a4c4363d107042682) Thanks [@marandaneto](https://github.com/marandaneto)! - fix: remove deprecated attribute $exception_personURL from exception events

- Updated dependencies [[`daf919b`](https://github.com/PostHog/posthog-js/commit/daf919be225527ee4ad026d806dec195b75e44aa), [`7d45a7a`](https://github.com/PostHog/posthog-js/commit/7d45a7a52c44ba768913d66a4c4363d107042682)]:
  - @posthog/core@1.3.0

## 4.9.1

### Patch Changes

- Updated dependencies [[`10da2ee`](https://github.com/PostHog/posthog-js/commit/10da2ee0b8862ad0e32b68e452fae1bc77620bbf)]:
  - @posthog/core@1.2.4

## 4.9.0

### Minor Changes

- [#2410](https://github.com/PostHog/posthog-js/pull/2410) [`1f294ec`](https://github.com/PostHog/posthog-js/commit/1f294ecb3c816b283f04c0dacc01739d79a5805c) Thanks [@hpouillot](https://github.com/hpouillot)! - add error tracking autocapture

## 4.8.1

### Patch Changes

- [#2414](https://github.com/PostHog/posthog-js/pull/2414) [`e19a384`](https://github.com/PostHog/posthog-js/commit/e19a384468d722c12f4ef21feb684da31f9dcd3b) Thanks [@hpouillot](https://github.com/hpouillot)! - create a common logger for node and react-native

- Updated dependencies [[`e19a384`](https://github.com/PostHog/posthog-js/commit/e19a384468d722c12f4ef21feb684da31f9dcd3b)]:
  - @posthog/core@1.2.3

## 4.8.0

### Minor Changes

- [#2360](https://github.com/PostHog/posthog-js/pull/2360) [`8ea1ce8`](https://github.com/PostHog/posthog-js/commit/8ea1ce8a9d02de35e2c1bea3f49518455fb53ffe) Thanks [@hpouillot](https://github.com/hpouillot)! - add stacktrace to exceptions

## 4.7.1

### Patch Changes

- Updated dependencies [[`5820942`](https://github.com/PostHog/posthog-js/commit/582094255fa87009b02a4e193c3e63ef4621d9d0)]:
  - @posthog/core@1.2.2

## 4.7.0

### Minor Changes

- [#2352](https://github.com/PostHog/posthog-js/pull/2352) [`c01c728`](https://github.com/PostHog/posthog-js/commit/c01c728616673e20cd4b91a6050c0e194908c4b3) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: rn surveys use the new response question id format

## 4.6.3

### Patch Changes

- Updated dependencies [[`caecb94`](https://github.com/PostHog/posthog-js/commit/caecb94493f6b85003ecbd6750a81e27139b1fa5)]:
  - @posthog/core@1.2.1

## 4.6.2

### Patch Changes

- Updated dependencies [[`ac48d8f`](https://github.com/PostHog/posthog-js/commit/ac48d8fda3a4543f300ced705bce314a206cce6f)]:
  - @posthog/core@1.2.0

## 4.6.1

### Patch Changes

- Updated dependencies [[`da07e41`](https://github.com/PostHog/posthog-js/commit/da07e41ac2307803c302557a12b459491657a75f)]:
  - @posthog/core@1.1.0

## 4.6.0

### Minor Changes

- [#2328](https://github.com/PostHog/posthog-js/pull/2328) [`83196aa`](https://github.com/PostHog/posthog-js/commit/83196aa4bb7f7a1642b722cbfa19af1bb13379ae) Thanks [@marandaneto](https://github.com/marandaneto)! - chore: add support for throttleDelayMs

## 4.5.1

### Patch Changes

- [#2325](https://github.com/PostHog/posthog-js/pull/2325) [`a9121df`](https://github.com/PostHog/posthog-js/commit/a9121dfbbe4c549e786124b1a8905c598fada757) Thanks [@marandaneto](https://github.com/marandaneto)! - surveys on react native web renders and get focused correctly

## 4.5.0

### Minor Changes

- [#2239](https://github.com/PostHog/posthog-js/pull/2239) [`637f6fd`](https://github.com/PostHog/posthog-js/commit/637f6fd3817eac5c9c91cd55ee3e24a252ed5669) Thanks [@ioannisj](https://github.com/ioannisj)! - add support for conditional survey questions

## 4.4.3

### Patch Changes

- Updated dependencies [[`1981815`](https://github.com/PostHog/posthog-js/commit/19818159b7074098150bc79cfa2962761a14cb46)]:
  - @posthog/core@1.0.2

## 4.4.2

### Patch Changes

- [#2219](https://github.com/PostHog/posthog-js/pull/2219) [`44d10c4`](https://github.com/PostHog/posthog-js/commit/44d10c46c5378fa046320b7c50bd046eb1e75994) Thanks [@daibhin](https://github.com/daibhin)! - update @posthog/core

- Updated dependencies [[`44d10c4`](https://github.com/PostHog/posthog-js/commit/44d10c46c5378fa046320b7c50bd046eb1e75994)]:
  - @posthog/core@1.0.1

## 4.4.1

### Patch Changes

- [#2234](https://github.com/PostHog/posthog-js/pull/2234) [`9ef2193`](https://github.com/PostHog/posthog-js/commit/9ef21939209a822a2f974dfb6604368ec2e44c49) Thanks [@marandaneto](https://github.com/marandaneto)! - expo-43 and new expo-file-system APIs with back compatibility support

## 4.4.0

### Minor Changes

- [#2192](https://github.com/PostHog/posthog-js/pull/2192) [`dec3f44`](https://github.com/PostHog/posthog-js/commit/dec3f443465787216ee3015aa254c5312659ad3f) Thanks [@marandaneto](https://github.com/marandaneto)! - survey support for feature flag variants

## 4.3.1

### Patch Changes

- [#2180](https://github.com/PostHog/posthog-js/pull/2180) [`7c849d5`](https://github.com/PostHog/posthog-js/commit/7c849d5482e537c17b6fa2a1eb8e5d70e8c830bb) Thanks [@ioannisj](https://github.com/ioannisj)! - fix emoji rating row wrap

## 4.3.0

### Minor Changes

- [#2129](https://github.com/PostHog/posthog-js/pull/2129) [`a3d1267`](https://github.com/PostHog/posthog-js/commit/a3d1267b7904171ee132ce8d0d2a59a0936e1a4e) Thanks [@marandaneto](https://github.com/marandaneto)! - Remove legacy migration code, left over from the V1 to V2 migration

## 4.2.2 - 2025-07-23

### Fixed

1. Fix issue with expo-file-system on web and macos

## 4.2.1 - 2025-07-21

### Fixed

1. Solve outdated JSX transform warning

## 4.2.0 - 2025-07-15

### Changed

1. Add more documentation for the `captureScreens` option and its usage with expo-router, @react-navigation/native and react-native-navigation

## 4.1.5 - 2025-07-14

### Fixed

1. read the navigation ref from the current property if it exists for expo-router and @react-navigation/native

## 4.1.4 - 2025-07-01

### Fixed

1. avoid navigation tracking crash when using the new navigation version

## 4.1.3 - 2025-06-26

### Fixed

1. Multiple choice question response
2. Survey button disabled style

## 4.1.2 - 2025-06-24

### Fixed

1. Force session replay to use string values for sessionId, distinctId and anonymousId

## 4.1.1 - 2025-06-23

### Fixed

1. Add missing survey position types

## 4.1.0 - 2025-06-12

1. chore: use `/flags?v=2&config=true` instead of `/decide?v=4` for the flag evaluation backend

## 4.0.0 - 2025-06-10

### Removed

1. Remove `captureMode` in favor of `json` capture mode only
2. Remove deprecated `personProperties` and `groupProperties` in favor of `setPersonPropertiesForFlags` and `setGroupPropertiesForFlags`
3. Rename `captureNativeAppLifecycleEvents` option to `captureAppLifecycleEvents`
   1. `captureAppLifecycleEvents` from `autocapture` is removed and replaced by `captureAppLifecycleEvents` from options
4. Remove `version` and `build` from Lifecycle events in favor of `$app_version` and `$app_build`
5. Remove maskPhotoLibraryImages from the SDK config

## 3.16.1 – 2025-05-28

### Fixed

1. rotate session id if expired when the app is back from background

## 3.16.0 – 2025-05-27

### Fixed

1. rotate session id if expired after 24 hours

## 3.15.4 – 2025-05-20

### Fixed

1. session recording respects linked flags

## 3.15.3 – 2025-05-14

### Fixed

1. chore: improve event prop types
2. use custom allSettled implementation to avoid issues with patching Promise

## 3.15.2 – 2025-05-07

### Fixed

1. survey modal closes when clicking inside the modal

## 3.15.1 – 2025-04-28

### Fixed

1. revert migration to rollup

## 3.15.0 – 2025-04-23

1. chore: migrate to bundle using rollup

Do not use this version, please use [3.15.1](https://github.com/PostHog/posthog-js-lite/releases/tag/posthog-react-native-v3.15.1) instead.

## 3.14.0 – 2025-04-17

1. chore: roll out new feature flag evaluation backend to majority of customers

## 3.13.2 - 2025-04-16

### Fixed

1. react native navigation missing navigationRef

## 3.13.1 - 2025-04-15

### Fixed

1. broken relative imports for surveys

## 3.13.0 - 2025-04-08

## Added

1. `$feature_flag_called` event now includes additional properties such as `feature_flag_id`, `feature_flag_version`, `feature_flag_reason`, and `feature_flag_request_id`.

### Fixed

1. apiKey cannot be empty.
2. Survey modal now moves up when the keyboard is open.

## 3.12.0 - 2025-03-13

## Added

1. Adds support for [surveys on react native](https://github.com/PostHog/posthog.com/pull/10843/)
   1. Thanks @ian-craig for initial PR.

## 3.11.2 - 2025-02-27

### Fixed

1. Supports gracefully handling quotaLimited responses from the PostHog API for feature flags.

## 3.11.1 - 2025-02-21

### Fixed

1. fix: handle cases when non Error is passed to `captureException`

## 3.11.0 - 2025-02-21

1. fix: Autocapture native app lifecycle events
   1. the `captureNativeAppLifecycleEvents` client option now takes priority over the `captureLifecycleEvents` autocapture option.
   2. the `captureLifecycleEvents` autocapture option now captures Application Installed and Application Updated events.
   3. If you don't want to capture these events, set the `captureLifecycleEvents` autocapture option to `false` and capture the events manually, example below.

```js
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    posthog.capture('Application Became Active')
  } else if (state === 'background') {
    posthog.capture('Application Backgrounded')
  }
})
```

## 3.10.0 - 2025-02-20

## Added

1. Adds the ability to capture user feedback in LLM Observability using the `captureTraceFeedback` and `captureTraceMetric` methods.

## 3.9.1 - 2025-02-13

1. fix: ensure feature flags are reloaded after reset() to prevent undefined values

## 3.9.0 - 2025-02-07

1. chore: Session Replay - GA

## 3.8.0 - 2025-02-06

## Added

1. Adds `captureException` function to allow basic manual capture of JavaScript exceptions

## 3.7.0 - 2025-02-05

1. chore: set locale and timezone using the react-native-localize library

## 3.6.4 - 2025-02-03

1. fix: improve session replay linked flag type handling

## 3.6.3 - 2025-01-16

1. fix: session replay respect linked feature flags

## 3.6.2 - 2025-01-13

1. fix: Set initial currentSessionId, log only with debug flag on

## 3.6.1 - 2024-12-17

1. fix: os_name was not being set correctly for some devices using expo-device

## 3.6.0 - 2024-12-12

1. Add new debugging property `$feature_flag_bootstrapped_response`, `$feature_flag_bootstrapped_payload` and `$used_bootstrap_value` to `$feature_flag_called` event

## 3.5.0 - 2024-12-03

1. fix: deprecate maskPhotoLibraryImages due to unintended masking issues

## 3.4.0 - 2024-11-26

1. feat: automatically mask out user photos and sandboxed views like photo picker (iOS Only)
   1. To disable masking set `maskAllSandboxedViews` and `maskPhotoLibraryImages` to false

```js
export const posthog = new PostHog(
  'apiKey...',
  sessionReplayConfig: {
      maskAllSandboxedViews: false,
      maskPhotoLibraryImages: false,
);
```

## 3.3.14 - 2024-11-21

1. fix: identify method allows passing a $set_once object

## 3.3.13 - 2024-11-19

1. fix: session replay respects the flushAt flag

## 3.3.12 - 2024-11-18

1. fix: session replay forces the session id if the SDK is already enabled

## 3.3.11 - 2024-11-13

1. fix: respect the given propsToCapture autocapture option

## 3.3.10 - 2024-11-04

1. fix: capture customLabelProp if set

## 3.3.9 - 2024-10-26

1. fix: rollback module to ESNext

## 3.3.8 - 2024-10-25

1. chore: change androidDebouncerDelayMs default from 500ms to 1000ms (1s)

## 3.3.7 - 2024-10-25

1. fix: session replay respects the `disabled` flag

## 3.3.6 - 2024-10-19

1. fix: all sdkReplayConfig should have a default value

## 3.3.5 - 2024-10-15

1. fix: only tries to read device context from react-native-device-info if expo libs are not available

## 3.3.4 - 2024-10-14

1. fix: only log messages if debug is enabled

## 3.3.3 - 2024-10-11

1. fix: bootstrap flags do not overwrite the current values

## 3.3.2 - 2024-10-11

### Changed

1. fix: clear flagCallReported if there are new flags

## 3.3.1 - 2024-09-30

### Changed

1. fix: set the right sdk name and version for recordings

## 3.3.0 - 2024-09-24

### Changed

1. chore: session id will be rotate on app restart.
   1. To keep the session id across restarts, set the `enablePersistSessionIdAcrossRestart` option to `true` when initializing the PostHog client.

```js
export const posthog = new PostHog('apiKey...', {
  // ...
  enablePersistSessionIdAcrossRestart: true,
})
```

## 3.2.1 - 2024-09-24

### Changed

1. recording: session replay plugin isn't properly identifying users already identified

## 3.2.0 - 2024-09-19

### Changed

1. chore: default `captureMode` changed to `json`.
   1. To keep using the `form` mode, just set the `captureMode` option to `form` when initializing the PostHog client.
2. chore: Session Replay for React-Native - Experimental support

Install Session Replay for React-Native:

```bash
yarn add posthog-react-native-session-replay
## or npm
npm i -s posthog-react-native-session-replay
```

Enable Session Replay for React-Native:

```js
export const posthog = new PostHog('apiKey...', {
  // ...
  enableSessionReplay: true,
})
```

Or using the `PostHogProvider`

```js
<PostHogProvider
        apiKey="apiKey..."
        options={{
          enableSessionReplay: true,
        }}
      >
```

## 3.1.2 - 2024-08-14

### Changed

1. chore: change host to new address.

## 3.1.1 - 2024-04-25

1. Prevent double JSON parsing of feature flag payloads, which would convert the payload [1] into 1.

## 3.1.0 - 2024-03-27

### Changed

1. If `captureNativeAppLifecycleEvents` is enabled, the event `Application Opened` with the property `from_background: true` is moved to its own event called `Application Became Active`. This event is triggered when the app is opened from the background. The `Application Opened` event is now only triggered when the app is opened from a cold start, aligning with the other integrations such as the `PostHogProvider` with the `captureLifecycleEvents` option and `initReactNativeNavigation` with the `captureLifecycleEvents` option.

## 3.0.0 - 2024-03-18

## Added

1. Adds a `disabled` option and the ability to change it later via `posthog.disabled = true`. Useful for disabling PostHog tracking for example in a testing environment without having complex conditional checking
2. `shutdown` takes a `shutdownTimeoutMs` param with a default of 30000 (30s). This is the time to wait for flushing events before shutting down the client. If the timeout is reached, the client will be shut down regardless of pending events.
3. Adds a new `featureFlagsRequestTimeoutMs` timeout parameter for feature flags which defaults to 10 seconds.
4. Flushes will now try to flush up to `maxBatchSize` (default 100) in one go
5. Sets `User-Agent` headers with SDK name and version for RN
6. Queued events are limited up to `maxQueueSize` (default 1000) and the oldest events are dropped when the limit is reached

### Removed

1. `flushAsync` and `shutdownAsync` are removed with `flush` and `shutdown` now being the async methods.
2. Removes the `enable` option. You can now specify `defaultOptIn: false` to start the SDK opted out of tracking
3. `PostHog.initAsync` is no more! You can now initialize PostHog as you would any other class `const posthog = new PostHog(...)`

### Changed

1. PostHogProvider now requires either an `apiKey` or `client` property and `usePostHog` now always returns a `PostHog` instance instead of `PostHog | undefined`. The `disabled` option can be used when initializing the `PostHogProvider` if desired and all subsequent calls to `posthog` will work but without actually doing anything.
2. `flush` and `shutdown` now being async methods.
3. Replaces the option `customAsyncStorage` with `customStorage` to allow for custom synchronous or asynchronous storage implementations.

### Fixed

1. Many methods such as `capture` and `identify` no longer return the `this` object instead returning nothing
2. Fixed an issue where `shutdown` would potentially exit early if a flush was already in progress
3. Fixes some typos in types

## 3.0.0-beta.3 - 2024-03-13

1. Sets `User-Agent` headers with SDK name and version for RN
2. fix: PostHogProvider initialization that requires client `or` apiKey and not `and`.

## 3.0.0-beta.2 - 2024-03-12

1. `flushAsync` and `shutdownAsync` are removed with `flush` and `shutdown` now being the async methods.
2. Fixed an issue where `shutdownAsync` would potentially exit early if a flush was already in progress
3. Flushes will now try to flush up to `maxBatchSize` (default 100) in one go

## 3.0.0-beta.1 - 2024-03-04

1. `PostHog.initAsync` is no more! You can now initialize PostHog as you would any other class `const posthog = new PostHog(...)`
2. PostHogProvider now requires either an `apiKey` or `client` property and `usePostHog` now always returns a `PostHog` instance instead of `PostHog | undefined`. The `disabled` option can be used when initializing the `PostHogProvider` if desired and all subsequent calls to `posthog` will work but without actually doing anything.
3. Removes the `enable` option. You can now specify `defaultOptIn: false` to start the SDK opted out of tracking
4. Adds a `disabled` option and the ability to change it later via `posthog.disabled = true`. Useful for disabling PostHog tracking for example in a testing environment without having complex conditional checking
5. Many methods such as `capture` and `identify` no longer return the `this` object instead returning nothing
6. Fixes some typos in types
7. `shutdown` and `shutdownAsync` takes a `shutdownTimeoutMs` param with a default of 30000 (30s). This is the time to wait for flushing events before shutting down the client. If the timeout is reached, the client will be shut down regardless of pending events.
8. Adds a new `featureFlagsRequestTimeoutMs` timeout parameter for feature flags which defaults to 10 seconds.
9. Replaces the option `customAsyncStorage` with `customStorage` to allow for custom synchronous or asynchronous storage implementations.

## 2.11.6 - 2024-02-22

1. `$device_name` was set to the device's user name (eg Max's iPhone) for all events wrongly, it's now set to the device's name (eg iPhone 12), this happened only if using `react-native-device-info` library.
2. Fixes an issue related to other dependencies patching the global Promise object that could lead to crashes

## 2.11.5 - 2024-02-20

1. fix: undefined posthog in hooks

## 2.11.4 - 2024-02-15

1. fix: using `captureMode=form` won't throw an error and retry unnecessarily
2. `$app_build` was returning the OS internal build number instead of the app's build number.
3. This flag was used to track app versions, you might experience a sudden increase of `Application Updated` events, but only if you're using the `react-native-device-info` library.

## 2.11.3 - 2024-02-08

1. Vendor `uuidv7` instead of using peer dependency to avoid the missing crypto issue

## 2.11.2 - 2024-02-06

1. Swapped to `uuidv7` for unique ID generation

## 2.11.1 - 2024-01-25

1. Do not try to load packages on the macOS target that are not supported.
2. Use `Platform.select` instead `Platform.OS` for conditional imports which avoids issues such as `Unable to resolve module`.

## 2.11.0 - 2024-01-23

1. Adds support for overriding the event `uuid` via capture options

## 2.10.2 - 2024-01-22

1. Do not try to load the `expo-file-system` package on the Web target since it's not supported.
2. if `react-native-device-info` is available for the Web target, do not set `unknown` for all properties.

## 2.10.1 - 2024-01-15

1. The `tag_name` property of auto-captured events now uses the nearest `ph-label` from parent elements, if present.

## 2.10.0 - 2024-01-08

1. `$device_type` is now set to `Mobile`, `Desktop`, or `Web` for all events

## 2.9.2 - 2023-12-21

1. If `async-storage` or `expo-file-system` is not installed, the SDK will fallback to `persistence: memory` and log a warning

## 2.9.1 - 2023-12-14

1. `getPersistedProperty` uses Nullish Coalescing operator to fallback to `undefined` only if the property is not found

## 2.9.0 - 2023-12-04

1. Renamed `personProperties` to `setPersonPropertiesForFlags` to match `posthog-js` and more clearly indicated what it does
2. Renamed `groupProperties` to `setGroupPropertiesForFlags` to match `posthog-js` and more clearly indicated what it does

## 2.8.1 - 2023-10-09

1. Fixes a type generation issue

## 2.8.0 - 2023-10-06

1. Added new `const [flag, payload] = useFeatureFlagWithPayload('my-flag-name')` hook that returns the flag result and it's payload if it has one.

## 2.7.1 - 2023-05-25

1. The `$screen_name` property will be registered for all events whenever `screen` is called

## 2.7.0 - 2023-04-21

1. Fixes a race condition that could occur when initialising PostHog
2. Fixes an issue where feature flags would not be reloaded after a reset
3. PostHog should always be initialized via .initAsync and will now warn if this is not the case

## 2.6.0 - 2023-04-19

1. Some small fixes to incorrect types
2. Fixed fetch compatibility by aligning error handling
3. Added two errors: PostHogFetchHttpError (non-2xx status) and PostHogFetchNetworkError (fetch network error)
4. Added .on('error', (err) => void)
5. shutdownAsync now ignores fetch errors. They should be handled with .on('error', ...) from now on.

## 2.5.2 - 2023-02-13

1. Fixes an issue where background network errors would trigger unhandled promise warnings

## 2.5.1 - 2023-02-03

1. Added support for customising the default app properties by passing a function to `options.customAppProperties`

## 2.5.0 - 2023-02-02

1. Adds support for overriding timestamp of capture events

## 2.4.0 - 2023-01-27

1. Adds support for https://github.com/wix/react-native-navigation
2. Allows passing of promise based `PostHog.initAsync` to `<PostHogProvider client={...} />`
3. Captures text content in autocapture (configurable via autocapture option `propsToCapture`)

## 2.3.0 - 2022-1-26

1. uses v3 decide endpoint
2. JSON payloads will be returned with feature flags
3. Feature flags will gracefully fail and optimistically save evaluated flags if server is down

## 2.2.3 - 2023-01-25

1. Ensures the distinctId used in `.groupIdentify` is the same as the currently identified user

## 2.2.2 - 2023-01-05

1. Fixes an issue with PostHogProvider where autocapture={false} would still capture lifecycle and navigation events.

## 2.2.1 - 2022-11-21

1. Fixes an issue with async storage selection while installing PostHog React Native
2. Fixes an issue where React Hooks for feature flags were conditionally loaded

## 2.2.0 - 2022-11-11

1. Expo modules are no longer required. Expo apps work as before and standalone React Native apps can use the more common native dependencies or roll their own implementation of the necessary functions. See the [official docs](https://posthog.com/docs/integrate/client/react-native) for more information.
2. PostHog should now be initialised via the async helper `PostHog.initAsync` to ensure persisted data is loaded before any tracking takes place

## 2.1.4 - 2022-10-28

Also include the fix in the compiled `lib` folder.

## 2.1.3 - 2022-10-27

Actually include the fix.

## 2.1.2 - 2022-10-27

Fix bug where all values set while stored data was being loaded would get overwritten once the data was done loading.

## 2.1.1 - 2022-09-09

Support for bootstrapping feature flags and distinctIDs. This allows you to initialise the library with a set of feature flags and distinctID that are immediately available.

## 2.1.0 - 2022-09-02

PostHogProvider `autocapture` can be configured with `captureLifecycleEvents: false` and `captureScreens: false` if you want do disable these autocapture elements. Both of these default to `true`
