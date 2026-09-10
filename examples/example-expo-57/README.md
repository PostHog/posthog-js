# Expo 57 example

This example uses Expo SDK 57 and React Native 0.86.

## Run the example

First, build and package the SDKs from the repository root:

```bash
nvm use
pnpm install
pnpm build
pnpm package
```

Then install the example dependencies and run a platform build:

```bash
cd examples/example-expo-57
pnpm install

# Start an Android emulator, then run:
pnpm android

# Or start an iOS simulator, then run:
pnpm ios

# Web (use `persistence: 'memory'` in posthog.ts):
pnpm web
```

The Expo commands install and launch the native app and start Metro. `pnpm ios` also installs CocoaPods dependencies when needed, so a separate `pod install` is not required.

To run from Xcode instead, open `ios/exampleexpo57.xcworkspace`, select an iOS simulator, and run the `exampleexpo57` scheme.

Set `EXPO_PUBLIC_POSTHOG_PROJECT_API_KEY` and `EXPO_PUBLIC_POSTHOG_API_HOST` in your environment to enable the PostHog client. The example still launches without them, but PostHog is disabled.

## Screen names on errors

`app/_layout.tsx` disables automatic screen capture and calls `posthog.screen()` when the Expo Router segments change. It uses route templates (for example, `users/[id]`), not resolved pathnames, query strings, or route parameters. The existing pathname check only controls survey presentation.

`screen()` records `$screen_name` for subsequent events, including `captureException()` and `PostHogErrorBoundary` errors. Once the client is initialized, recording a screen updates the context immediately without awaiting the screen event. During initialization, screen registration and event capture retain their call order. Each client keeps its own last recorded screen; explicit exception properties and `before_send` can override or remove it. Screen properties other than the name are not automatically added to errors.

Attribution means **last recorded screen**, not necessarily a destination whose render failed before the tracking effect ran. A root error boundary can catch an error before any route has been recorded. Supply an explicit safe `$screen_name` through the boundary's `additionalProperties` or `captureException()` when that context is known. Skipping a manual screen call leaves the previously recorded name in place.

For React Navigation manual tracking, use the container's `getCurrentRoute()` in **both** `onReady` and `onStateChange`, call `posthog.screen()` with a safe route name, and keep `captureScreens: false` on `PostHogProvider` to avoid duplicates. `getCurrentRoute()` resolves the focused nested route. Do not send route params or resolved URLs as screen names. When using supported automatic tracking, `navigation.routeToName` can return a nonempty safe replacement name; returning an empty string is not a supported suppression mechanism. Disabling automatic screens does not disable explicitly requested manual `screen()` calls.

## Test local SDK changes

Run the package watcher from the repository root:

```bash
pnpm package:watch
```

After a tarball changes, reinstall dependencies in this example and restart the app:

```bash
pnpm install
pnpm android # or pnpm ios
```

If changes are still not picked up, remove `node_modules` before reinstalling.

## Build release mode locally

```bash
# Android
pnpm android -- --variant release

# iOS simulator
pnpm ios -- --configuration Release

# Web
pnpm exec expo export --clear --source-maps --platform web

# Regenerate the checked-in native projects and test config plugins
pnpm exec expo prebuild --clean
```
