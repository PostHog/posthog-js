---
'posthog-react-native': minor
---

Scope `releaseMode` to the Hermes source map upload and default it to `event`; iOS dSYMs and Android R8 mappings always bind to the release their build creates. Set `releaseMode: 'symbol-set'`, or `POSTHOG_RELEASE_MODE=symbol-set` before the prebuild, to keep stamping the release onto the maps.

Rename the `posthog.releaseMode` gradle property to `posthog.hermesReleaseMode`. The old key still works, with a deprecation warning.

`event` mode needs posthog-cli 0.16.0: an unconfigured build warns and keeps binding on an older CLI, an explicitly configured `event` fails the build and names the upgrade. A prebuild also rewrites the dSYM phase an earlier plugin version generated, removing its deprecated `POSTHOG_NO_RELEASE_BIND` export.
