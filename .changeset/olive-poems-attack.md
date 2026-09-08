---
'@posthog/core': patch
'@posthog/mcp': patch
'posthog-js': patch
'posthog-js-lite': patch
'posthog-node': patch
'posthog-react-native': patch
---

fix(error-tracking): collapse repeated frame cycles in parsed stack traces to reduce grouping differences caused by recursion depth, while preserving distinct throw locations
