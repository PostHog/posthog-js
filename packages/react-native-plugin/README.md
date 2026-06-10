# @posthog/react-native-plugin

PostHog React Native plugin for iOS and Android integrations.

This package bridges React Native to the native PostHog SDKs, enabling session replay and native error tracking. It is consumed automatically by [`posthog-react-native`](https://github.com/PostHog/posthog-js/tree/main/packages/react-native) when installed — you do not call it directly.

## Installation

```sh
npm install posthog-react-native @posthog/react-native-plugin
# or
yarn add posthog-react-native @posthog/react-native-plugin
```

iOS requires a pod install:

```sh
cd ios && pod install
```

## Native error tracking

Native error tracking is controlled by the React Native SDK option:

```ts
new PostHog('<ph_project_api_key>', {
  errorTracking: {
    nativeAutocapture: true,
  },
})
```
