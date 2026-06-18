---
'@posthog/core': patch
'posthog-node': patch
'posthog-js-lite': patch
'posthog-react-native': patch
'@posthog/convex': patch
'@posthog/next': patch
'@posthog/nuxt': patch
---

Stop sending deprecated no-op top-level `type`, `library`, and `library_version` fields in event batch payloads. Use `properties.$lib` and `properties.$lib_version` for SDK metadata; legacy queued `library` and `library_version` values are used as fallbacks when the official `$` properties are missing.
