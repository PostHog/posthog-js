---
'posthog-react-native': minor
---

feat(react-native): Expo plugin `dotenvFile` option + fix `com.posthog.android` never being applied

New `dotenvFile` prop on the Expo config plugin: path to a dotenv file with `POSTHOG_CLI_*` credentials, delivered to the upload hooks as `POSTHOG_CLI_DOTENV_FILE` (Xcode build setting on iOS, `posthog.dotenvFile` gradle property on Android). Covers the hermes sourcemap uploads and the iOS dSYM upload today; the `com.posthog.android` mapping upload picks up the same gradle property once a plugin release ships support for it. No more exporting credentials into the shell/daemon environment; process env still wins, a missing file is a warning. Requires posthog-cli >= 0.8.4.

Also fixes `uploadNativeSymbols` on Android: mod ordering made the plugin inject the `com.posthog.android` classpath but silently skip the `apply plugin` line, so mapping uploads never ran.
