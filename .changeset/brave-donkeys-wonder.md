---
'posthog-react-native': patch
---

Require `@posthog/react-native-plugin` 2.4.2 or later, which raises the posthog-ios floor to `3.69.9`. That release masks React Native New Architecture (Fabric) text and image component views and `react-native-svg` root views during session replay; on older plugin versions Fabric apps recorded those views unmasked.
