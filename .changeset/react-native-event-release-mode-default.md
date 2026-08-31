---
'posthog-react-native': minor
---

Default `releaseMode` to `event` for React Native builds. Source maps, dSYMs and R8 mappings now upload release-independent, and each event resolves its own release from the `$app_namespace` / `$app_version` / `$app_build` the SDK already sends, so two releases that ship the same bundle no longer both report whichever release uploaded it first. The resolved mode is written into the generated Xcode phases and gradle property, so a build no longer depends on which posthog-cli default happens to be installed. Set `releaseMode: 'symbol-set'` in the config plugin props, `posthog.releaseMode=symbol-set` in gradle.properties, or `POSTHOG_RELEASE_MODE=symbol-set`, to keep stamping the release onto what you upload. Event mode needs posthog-cli >= 0.16.0: an older binary now fails the build with an upgrade instruction instead of quietly uploading in symbol-set mode.
