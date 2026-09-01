---
'posthog-react-native': minor
---

Scope `releaseMode` to the Hermes source map upload, and default it to `event`. A build that configures nothing now uploads its Hermes maps release-independent, and each JavaScript exception resolves its own release from the `$app_namespace` / `$app_version` / `$app_build` the SDK already sends. Two releases that ship the same JavaScript no longer both report whichever release uploaded the maps first.

iOS dSYMs and Android R8 mappings now always bind to the release their build creates. The prebuild writes the Hermes mode under `posthog.hermesReleaseMode`, a key `com.posthog.android` does not read, and it removes any `posthog.releaseMode` entry an earlier version left behind. The generated dSYM phase no longer exports `POSTHOG_NO_RELEASE_BIND`.

Set `releaseMode: 'symbol-set'` in the config plugin props to keep stamping the release onto the Hermes maps. `POSTHOG_RELEASE_MODE=symbol-set` also works, and an Expo project must set it before the prebuild runs. Event mode needs posthog-cli 0.16.0 or newer, and an older binary fails the build and names the upgrade.
