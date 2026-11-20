---
'@posthog/browser': minor
'@posthog/browser-common': minor
'posthog-js': patch
---

Add local flag property overrides, flag read controls, early-access features and `onActiveMatchingSurveysChanged` to `@posthog/browser`, load its feature flags while capture is opted out as `posthog-js` does, and stop reloads requested from reloading listeners from recursing.
