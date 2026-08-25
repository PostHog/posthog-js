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

# Web (use `persistence: 'memory'` in app/posthog.tsx):
pnpm web
```

The Expo commands install and launch the native app and start Metro. `pnpm ios` also installs CocoaPods dependencies when needed, so a separate `pod install` is not required.

To run from Xcode instead, open `ios/exampleexpo57.xcworkspace`, select an iOS simulator, and run the `exampleexpo57` scheme.

Set `EXPO_PUBLIC_POSTHOG_PROJECT_API_KEY` and `EXPO_PUBLIC_POSTHOG_API_HOST` in your environment to enable the PostHog client. The example still launches without them, but PostHog is disabled.

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
