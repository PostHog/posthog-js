---
'posthog-react-native': minor
---

feat(react-native): Expo plugin `dotenvFile` option to point every upload hook at a credentials file

The Expo config plugin accepts a new `dotenvFile` prop — a path to a dotenv file with `POSTHOG_CLI_*` credentials, relative to the project root (or absolute). The path reaches every upload hook as `POSTHOG_CLI_DOTENV_FILE`: on iOS as an Xcode build setting (exported to both the bundle-phase hermes upload and the dSYM upload phase), on Android as a `posthog.dotenvFile` entry in `android/gradle.properties`, read by the SDK's `posthog.gradle` hermes upload (and by the `com.posthog.android` mapping upload on gradle plugin versions that support it). Bare React Native projects can set the `posthog.dotenvFile` gradle property directly.

This removes the need to export credentials into the shell/daemon environment before release builds. Process env still wins inside the CLI, and a missing file is a warning, not a build failure. Requires posthog-cli >= 0.8.4 — older CLIs ignore the variable and fall back to their other credential sources.
