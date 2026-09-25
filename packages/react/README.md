# PostHog React package

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [React library docs](https://posthog.com/docs/libraries/react)

## Using PostHog outside React

Use `usePostHog()` in React components so they use the client from the nearest `PostHogProvider`. This matters when the provider receives a custom client, including in nested providers.

Outside React, it is safe to import the default client from `posthog-js` when the provider initializes that default client or receives that same client through its `client` prop. Initialize and share one client as shown below; if the provider receives a different client, reuse that client outside React rather than importing the default client.

```tsx
// posthog-client.ts — load from a browser client entry point
import posthog from 'posthog-js'

posthog.init('<ph_project_api_key>', { api_host: 'https://us.i.posthog.com' })

export default posthog

// app.tsx
import { PostHogProvider } from '@posthog/react'
import posthog from './posthog-client'

export function App() {
    return <PostHogProvider client={posthog}>{/* your app */}</PostHogProvider>
}

// analytics.ts — this module is not a React component
import posthog from './posthog-client'

posthog.capture('event_captured_outside_react')
```

## Questions?

### [Check out our community page.](https://posthog.com/posts)
