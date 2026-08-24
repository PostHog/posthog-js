---
'posthog-react-native': minor
---

Add experimental event release mode to React Native builds. Set `releaseMode: 'event'` on the `posthog-react-native/expo` config plugin (or export `POSTHOG_RELEASE_MODE=event`, or set `posthog.releaseMode=event` in `android/gradle.properties`) and the build uploads its Hermes source maps, iOS dSYMs and Android R8 mappings without binding them to a release. Each exception then resolves its own release from the `$app_namespace` / `$app_version` / `$app_build` the SDK already sends, instead of inheriting the release of the symbols its frames resolved against. Use it when two releases can ship identical JavaScript or identical native code: symbol ids are derived from content, so the default `symbol-set` mode makes both releases report whichever one uploaded first. An unrecognized mode fails the build rather than falling back. Needs posthog-cli 0.15.0 or newer for the Hermes upload.
