---
'posthog-react-native': patch
---

Fix the Expo iOS source map upload config plugin so backtick-wrapped `react-native-xcode.sh` commands are preserved when wrapping the bundle phase with `posthog-xcode.sh`.
