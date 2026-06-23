---
'posthog-react-native': minor
'@posthog/core': minor
---

Deprecate `disableRemoteConfig`. Remote config is now always loaded and the option is a no-op. It will be removed in a future version. Also promote the previously experimental `disableSurveys` and `maskAllSandboxedViews` options to GA.
