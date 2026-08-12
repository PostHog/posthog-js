# React Native full SwiftPM fixture

This iOS-only React Native 0.87 app verifies that the packed `posthog-react-native` and
`@posthog/react-native-plugin` packages build through React Native's experimental,
CocoaPods-free SwiftPM integration. CI converts the checked-in stock CocoaPods project
with `npx react-native spm add --deintegrate --yes` before building it.
