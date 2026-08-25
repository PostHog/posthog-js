---
'posthog-react-native': patch
---

Ensure the Expo native-symbol upload phase runs last and declares the main app dSYM as an Xcode input, preventing EAS archives from uploading symbols before the dSYM is ready.
