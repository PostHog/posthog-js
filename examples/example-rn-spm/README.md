# React Native full SwiftPM fixture

This iOS-only React Native 0.87 app verifies that the packed `posthog-react-native` and
`@posthog/react-native-plugin` packages build through React Native's experimental,
CocoaPods-free SwiftPM integration. CI converts the checked-in stock CocoaPods project
with `npx react-native spm add --deintegrate --yes` before building it.

The fixture temporarily pins `hermes-compiler` because React Native 0.87's SwiftPM tooling downloads a Hermes runtime
that expects bytecode version 99 but selects React Native's nested compiler, which emits version 98. Remove the pin and
the CI `HERMES_CLI_PATH` override once React Native ships matching SwiftPM runtime and compiler versions.
