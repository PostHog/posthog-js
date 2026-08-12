# PostHog React Native package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [React Native library docs](https://posthog.com/docs/libraries/react-native)

## Swift Package Manager

`posthog-react-native` is JavaScript-only and does not need a Swift package manifest. Native session replay,
error tracking, and push notification support comes from the optional `@posthog/react-native-plugin` package.
Install `@posthog/react-native-plugin` 2.4.0 or later before using React Native 0.87's experimental full SwiftPM flow:

```sh
pnpm add @posthog/react-native-plugin
cd ios
npx react-native spm add --deintegrate
```

No `posthog.useSpm` Podfile property is needed for the full SwiftPM flow.

## Questions??

### [Check out our community page.](https://posthog.com/posts)
