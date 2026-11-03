---
'posthog-js': patch
'@posthog/browser-common': patch
'@posthog/core': patch
'posthog-react-native': patch
'posthog-js-lite': patch
---

Feature flags read before the user opts in to capturing now send `$feature_flag_called` when the user opts in, without being read again. This fixes missing exposures from the React and React Native hooks, which read a flag once on mount.
