---
'posthog-react-native': patch
'@posthog/react-native-plugin': patch
---

Report fatal JS crashes that bypass the JS error handler, such as React render errors, through native crash capture instead of dropping them as duplicates. Requires both packages to be updated.
