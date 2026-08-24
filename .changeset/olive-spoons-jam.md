---
'@posthog/react-native-plugin': patch
---

Raise the posthog-ios floor to `3.69.9`, which masks React Native New Architecture (Fabric) text and image component views (`RCTParagraphComponentView`, `RCTImageComponentView`) and `react-native-svg` root views (`RNSVGSvgView`) during session replay. Without it, Fabric apps recorded those views unmasked.
