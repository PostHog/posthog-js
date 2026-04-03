---
'@posthog/core': patch
---

fix: use typeof check in isEvent to avoid ReferenceError in non-browser runtimes (React Native/Hermes)
