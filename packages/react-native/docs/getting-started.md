# Getting started

The React Native SDK runs in iOS and Android apps, including Expo apps.

To send your first event, install `posthog-react-native` and the peer dependencies that the [install guide](https://posthog.com/docs/libraries/react-native#installation) lists for Expo or the React Native CLI.

Then wrap your app in `PostHogProvider` with your project token and host from your [project settings](https://app.posthog.com/project/settings), and call `capture` on the client that `usePostHog` returns.

## Install

```bash
npm install posthog-react-native
```

## Initialize

Wrap your app in `PostHogProvider`.

```tsx
import { PostHogProvider } from 'posthog-react-native'

export default function App() {
  return (
    <PostHogProvider apiKey="<ph_project_api_key>" options={{ host: 'https://us.i.posthog.com' }}>
      <YourApp />
    </PostHogProvider>
  )
}
```

## Capture an event

```tsx
import { usePostHog } from 'posthog-react-native'

const posthog = usePostHog()
posthog.capture('signed_up', { plan: 'pro' })
```

## Identify a user

```tsx
posthog.identify('user_123', { email: 'user@example.com' })
```
