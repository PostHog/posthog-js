---
'@posthog/react-native-plugin': patch
---

Stop setting posthog-ios's deprecated `screenshotMode` option, so iOS builds no longer show its deprecation warning. Session replay still records screenshots.
