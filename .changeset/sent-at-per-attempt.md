---
'@posthog/core': patch
'posthog-node': patch
'posthog-react-native': patch
'posthog-js-lite': patch
---

Stamp `sent_at` on every send attempt, so a retried batch is no longer stored later by the retry wait.
