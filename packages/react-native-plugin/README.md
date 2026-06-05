# posthog-react-native-plugin

PostHog React Native plugin for iOS and Android integrations

This package is currently unpublished. During development, link it locally from `posthog-react-native` instead of installing it from npm:

```json
{
  "devDependencies": {
    "posthog-react-native-plugin": "link:../../../posthog-react-native-plugin"
  }
}
```

The plugin bridges React Native to the native PostHog SDKs for session replay and native error tracking. Native error tracking is controlled by the React Native SDK option:

```ts
new PostHog('<ph_project_api_key>', {
  errorTracking: {
    nativeAutocapture: true,
  },
})
```
