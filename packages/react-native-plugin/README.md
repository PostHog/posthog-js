# PostHog React Native example

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [React Native library docs](https://posthog.com/docs/libraries/react-native)

## Swift Package Manager

React Native 0.87 introduced experimental, iOS-only Swift Package Manager support. This package ships a native
`Package.swift`, so React Native's SwiftPM autolinker can include it without CocoaPods or `spm scaffold`:

```sh
cd ios
npx react-native spm add --deintegrate
```

Install `@posthog/react-native-plugin` normally before running the command. CocoaPods remains supported and is
still React Native's recommended production integration while full SwiftPM support is experimental.

The older `posthog.useSpm` Podfile property is a separate hybrid mode: the React Native plugin remains a CocoaPod
while only its `posthog-ios` dependency is resolved with SwiftPM.
