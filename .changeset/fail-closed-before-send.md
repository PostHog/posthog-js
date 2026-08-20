---
'@posthog/core': patch
'posthog-js': patch
'@posthog/convex': patch
'posthog-node': patch
'posthog-react-native': patch
'@posthog/next': patch
'@posthog/nuxt': patch
---

Drop events when a before-send hook throws instead of sending the unmodified event.
