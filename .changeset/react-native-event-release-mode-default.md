---
'posthog-react-native': minor
---

Default `releaseMode` to `event` for React Native builds. Source maps, dSYMs and R8 mappings now upload release-independent. Each event resolves its own release from the `$app_namespace` / `$app_version` / `$app_build` the SDK already sends. Two releases that ship the same bundle no longer both report whichever release uploaded it first.

The prebuild writes the resolved mode into the Xcode phases and into `android/gradle.properties`, so a build no longer depends on the installed posthog-cli default. Set `releaseMode: 'symbol-set'` in the config plugin props to opt out. `POSTHOG_RELEASE_MODE=symbol-set` also works. An Expo project must set that variable before the prebuild runs, because the prebuild bakes the resolved mode into the project. A bare React Native project reads the variable at build time.

The generated dSYM phase now exports `POSTHOG_NO_RELEASE_BIND` for both modes. A symbol-set build therefore keeps binding its dSYMs against a posthog-ios that uploads them unbound by default.

Event mode needs posthog-cli 0.16.0 or newer. An older binary fails the build and names the upgrade. A project that pins `com.posthog.android` below 1.5.0 gets a warning at prebuild: that version ignores `posthog.releaseMode`, so its R8 mapping stays bound to a release while the Hermes source maps do not.
