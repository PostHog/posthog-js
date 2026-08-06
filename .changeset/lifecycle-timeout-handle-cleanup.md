---
'@posthog/core': patch
'posthog-node': patch
'posthog-react-native': patch
---

Clear completed lifecycle timeout handles so successful shutdowns do not leave timers running.
