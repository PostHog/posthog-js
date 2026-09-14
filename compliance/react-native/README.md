# React Native Android compliance profile

This profile builds a real Android app with RN **0.79.6**, Hermes, AsyncStorage **2.1.2** and react-native-device-info **10.14.0**. It imports the built public `posthog-react-native` package, with tarballs for the exact workspace core/types dependencies. No Node-hosted RN import or native API mock is used.

`controller.js` bridges harness commands to the installed app over HTTP long polling. Only the app invokes SDK APIs. Its fetch observer delegates unchanged to RN's native fetch; it never creates SDK requests or retries.

**Runtime gate: incomplete.** The Android APK has been built locally, but no installed-app harness run has been validated yet. The normal CI emulator workflow is provided to collect that evidence. A successful SDK or APK build alone is not RN capture/flags coverage.

## Inventory and mappings

CI selects all **47 server-wire cases** with harness **1.0.0**: 30 V0 capture and 17 flags. The RN SDK uses `/batch/` with root distinct ID despite being a mobile client. No tests are filtered to mask lifecycle/API disagreements. Reports and native diagnostics are uploaded as `react-native-android-sdk-compliance-report`; assertions are advisory, while absent/incomplete inventories fail.

- Startup lifecycle capture, remote config, flag preload, default person properties and surveys are explicitly disabled. Native persistent storage and fetch remain active.
- Public `identify` maps identity before capture/evaluation. Its real `$identify` events and automatic flag reloads remain visible, and may conflict with server-style count/first-event assumptions.
- Public `capture(event, properties, { timestamp: Date })` handles timestamp overrides. UUIDs are observed through public capture notifications.
- Public `flush` waits for SDK completion. Its init call also waits for native storage initialization without adding startup events.
- Flags map groups via `register({ $groups })` and person/group properties via their public flag setters. A remote action awaits `reloadFeatureFlagsAsync`, then reads `getFeatureFlag`; the SDK parses results and emits called-events. Ordinary cached getters are not claimed to fetch remotely.
- Reset restarts only the test app (`com.posthog.compliance.rn`). The app clears its own AsyncStorage on boot; no private queue mutation is used for teardown.

Expected disagreements include the ungated gzip test on Hermes runtimes without the required Web APIs, GeoIP fields and singleton flag scope unavailable on the stateful reload path, and server assumptions about identity/reload side effects. They must be classified from actual reports rather than suppressed. Native default preload, other mobile platforms and persistence across restarts are not certified by this isolated profile.

## Build and run

From the repository root:

```sh
pnpm --filter @posthog/types build
pnpm --filter @posthog/core build
pnpm --filter @posthog/react-native-plugin build
pnpm --filter posthog-react-native build
mkdir -p "$TARBALLS"
pnpm --filter @posthog/core pack --out "$TARBALLS/core.tgz"
pnpm --filter @posthog/types pack --out "$TARBALLS/types.tgz"
pnpm --filter posthog-react-native pack --out "$TARBALLS/react-native.tgz"
bash compliance/react-native/prepare-app.sh "$FRESH_APP_DIRECTORY" "$TARBALLS"
```

The script uses the maintained Android template in `examples/example-rn-native-plugin`, generates a separate application ID, and bundles JS into the debug APK. It does not need a Metro server at runtime. Set `JAVA_HOME` to JDK 17 and `ANDROID_HOME` to an installed SDK. `RN_ARCH` defaults to `arm64-v8a`; CI builds `x86_64` and runs Android API 29.

With a dedicated booted emulator selected by `ANDROID_SERIAL`:

```sh
adb -s "$ANDROID_SERIAL" install "$FRESH_APP_DIRECTORY/android/app/build/outputs/apk/debug/app-debug.apk"
adb -s "$ANDROID_SERIAL" reverse tcp:18213 tcp:18213
adb -s "$ANDROID_SERIAL" reverse tcp:19213 tcp:19213
# Express 5.2.1 must be available via NODE_PATH.
PORT=18213 node compliance/react-native/controller.js
```

Run the pinned harness with adapter URL `http://127.0.0.1:18213`, mock port/URL 19213, `--sdk-type server`, and `--concurrency 1`. `/health` remains unavailable until the native app reports ready. Preserve the exact APK, package lock generated in the app directory, health response, report and Android logcat when validating a profile.
