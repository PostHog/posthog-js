---
'posthog-react-native': minor
---

Default `releaseMode` to `event` and apply it to the Hermes source map upload only, so iOS dSYMs and Android R8 mappings always bind to the release their build creates. Set `releaseMode: 'symbol-set'` to opt out. Event mode needs posthog-cli 0.16.0 or newer, and an unconfigured build on an older CLI warns and keeps binding. The `posthog.releaseMode` gradle property becomes `posthog.hermesReleaseMode`, the old key still works with a deprecation warning, and a prebuild now pins `com.posthog.android` 1.6.0.
