---
'posthog-react-native': minor
---

`captureAppLifecycleEvents` is now enabled by default. If you want to disable it, you can set `captureAppLifecycleEvents: false` in the PostHog options:

```js
const posthog = new PostHog('<ph_project_api_key>', {
  captureAppLifecycleEvents: false,
})
```

Or when using the PostHogProvider:

```jsx
<PostHogProvider apiKey="<ph_project_api_key>" options={{ captureAppLifecycleEvents: false }}>
  <MyApp />
</PostHogProvider>
```
