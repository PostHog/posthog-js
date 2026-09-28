---
'@posthog/react-native-plugin': patch
---

Keep the JS layer's `$process_person_profile` and `$is_identified` on fatal JS crashes captured through the Android native SDK, so they stay correct once posthog-android stops letting event properties override them
