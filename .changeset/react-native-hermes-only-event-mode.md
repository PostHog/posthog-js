---
'posthog-react-native': minor
---

Scope `releaseMode` to the Hermes source map upload and default it to `event`. Each JavaScript exception resolves its own release from the app metadata the SDK sends, so two releases that ship the same bundle stop reporting whichever release uploaded the maps first. iOS dSYMs and Android R8 mappings always bind to the release their build creates.

Set `releaseMode: 'symbol-set'`, or `POSTHOG_RELEASE_MODE=symbol-set` before the prebuild, to keep stamping the release onto the maps. Event mode needs posthog-cli 0.16.0: a build that configured no mode warns and keeps binding on an older CLI, while an explicitly configured `event` fails the build and names the upgrade. A prebuild also rewrites the dSYM phase an earlier plugin version generated, removing its deprecated `POSTHOG_NO_RELEASE_BIND` export.
