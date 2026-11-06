# Getting started

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

## Capture

```tsx
import { usePostHog } from 'posthog-react-native'

const posthog = usePostHog()
posthog.capture('signed_up', { plan: 'pro' })
```

## Identify

```tsx
posthog.identify('user_123', { email: 'user@example.com' })
```
