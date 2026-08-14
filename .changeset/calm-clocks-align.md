---
'posthog-js': patch
'@posthog/browser-common': patch
'@posthog/convex': patch
'@posthog/core': patch
'@posthog/mcp': patch
'posthog-node': patch
'posthog-react-native': patch
'@posthog/types': patch
---

Normalize capture timestamp overrides to equivalent UTC ISO strings across the browser, Node.js, and React Native SDKs.
