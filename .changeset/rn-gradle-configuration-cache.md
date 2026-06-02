---
"posthog-react-native": patch
---

fix(react-native): make the Android Hermes sourcemap upload tasks compatible with Gradle's configuration cache by resolving the posthog-cli path and arguments at configuration time, so the task actions no longer call script-level methods or access `project` at execution time.
