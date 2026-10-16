---
'posthog-react-native': patch
---

Fix events missing `$os_name` and `$os_version` in apps that use neither `expo-device` nor `react-native-device-info`.
