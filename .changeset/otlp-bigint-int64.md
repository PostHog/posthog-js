---
'@posthog/core': patch
'posthog-js': patch
'posthog-react-native': patch
'posthog-node': patch
---

Change `bigint` attributes on logs, metrics and spans to send as an int64 rather than as a string.
