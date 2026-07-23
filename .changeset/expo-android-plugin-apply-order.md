---
'posthog-react-native': patch
---

Fix the Expo config plugin never applying `com.posthog.android` to the app build.gradle: expo evaluates mods in registration order, so the appBuildGradle mod read `classpathPresent` before the projectBuildGradle mod could set it. Native symbols plugin registration now comes first.
