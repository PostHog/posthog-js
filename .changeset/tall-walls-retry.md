---
'@posthog/core': patch
'posthog-node': patch
'posthog-js-lite': patch
'posthog-react-native': patch
'@posthog/next': patch
'@posthog/nuxt': patch
---

Retry `/flags` requests that receive HTTP 502 or 504 responses across SDKs that use the shared core flags client.
