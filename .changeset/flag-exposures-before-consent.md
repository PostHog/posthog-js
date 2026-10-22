---
'posthog-js': patch
'@posthog/browser-common': patch
'@posthog/core': patch
'posthog-react-native': patch
'posthog-js-lite': patch
---

Feature flags read before the user opts in to capturing now send `$feature_flag_called` the next time they are read after opt in.
