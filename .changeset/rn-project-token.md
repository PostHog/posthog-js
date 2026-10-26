---
'@posthog/core': minor
'posthog-react-native': minor
---

Add the `projectToken` prop to `PostHogProvider` and the `projectToken` property to the client, and deprecate the `apiKey` prop and property in favor of them. `apiKey` keeps working, and `projectToken` wins when both are set.
