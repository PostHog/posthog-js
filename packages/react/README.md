# @posthog/react

React components and hooks for PostHog analytics integration.

[SEE FULL DOCS](https://posthog.com/docs/libraries/react)

## Installation

```bash
npm install @posthog/react posthog-js
```

## Usage

### Setting up the Provider

Wrap your application with `PostHogProvider` to make the PostHog client available throughout your app:

```tsx
import { PostHogProvider } from '@posthog/react'

function App() {
    return (
        <PostHogProvider apiKey="<YOUR_PROJECT_API_KEY>" options={{ api_host: 'https://us.i.posthog.com' }}>
            <YourApp />
        </PostHogProvider>
    )
}
```

Or pass an existing PostHog client instance:

```tsx
import posthog from 'posthog-js'
import { PostHogProvider } from '@posthog/react'

// Initialize your client
posthog.init('<YOUR_PROJECT_API_KEY>', { api_host: 'https://us.i.posthog.com' })

function App() {
    return (
        <PostHogProvider client={posthog}>
            <YourApp />
        </PostHogProvider>
    )
}
```

### Hooks

#### usePostHog

Access the PostHog client instance to capture events, identify users, etc.

```tsx
import { usePostHog } from '@posthog/react'

function MyComponent() {
    const posthog = usePostHog()

    const handleClick = () => {
        posthog.capture('button_clicked', { button_name: 'signup' })
    }

    return <button onClick={handleClick}>Sign Up</button>
}
```

#### useFeatureFlagEnabled

Check if a feature flag is enabled for the current user.

```tsx
import { useFeatureFlagEnabled } from '@posthog/react'

function MyComponent() {
    const isEnabled = useFeatureFlagEnabled('new-feature')

    if (isEnabled) {
        return <NewFeature />
    }
    return <OldFeature />
}
```

#### useFeatureFlagVariantKey

Get the variant key for a multivariate feature flag.

```tsx
import { useFeatureFlagVariantKey } from '@posthog/react'

function MyComponent() {
    const variant = useFeatureFlagVariantKey('experiment-flag')

    if (variant === 'control') {
        return <ControlVariant />
    }
    if (variant === 'test') {
        return <TestVariant />
    }
    return null
}
```

#### useFeatureFlagPayload

Get the payload associated with a feature flag.

```tsx
import { useFeatureFlagPayload } from '@posthog/react'

function MyComponent() {
    const payload = useFeatureFlagPayload('feature-with-payload')

    return <div>Config: {JSON.stringify(payload)}</div>
}
```

#### useActiveFeatureFlags

Get all active feature flags for the current user.

```tsx
import { useActiveFeatureFlags } from '@posthog/react'

function MyComponent() {
    const activeFlags = useActiveFeatureFlags()

    return (
        <ul>
            {activeFlags?.map((flag) => (
                <li key={flag}>{flag}</li>
            ))}
        </ul>
    )
}
```

### Components

#### PostHogFeature

A component that renders content based on a feature flag's value. Automatically tracks feature views and interactions.

```tsx
import { PostHogFeature } from '@posthog/react'

function MyComponent() {
    return (
        <PostHogFeature flag="new-cta" fallback={<OldButton />}>
            <NewButton />
        </PostHogFeature>
    )
}

// With variant matching
function MyComponent() {
    return (
        <PostHogFeature flag="experiment" match="test" fallback={<ControlVersion />}>
            <TestVersion />
        </PostHogFeature>
    )
}

// With payload as render function
function MyComponent() {
    return (
        <PostHogFeature flag="banner-config">
            {(payload) => <Banner title={payload.title} color={payload.color} />}
        </PostHogFeature>
    )
}
```

#### PostHogErrorBoundary

An error boundary that captures React errors and reports them to PostHog.

```tsx
import { PostHogErrorBoundary } from '@posthog/react'

function App() {
    return (
        <PostHogProvider apiKey="<YOUR_PROJECT_API_KEY>">
            <PostHogErrorBoundary>
                <YourApp />
            </PostHogErrorBoundary>
        </PostHogProvider>
    )
}
```

Please see the main [PostHog docs](https://www.posthog.com/docs).

## Questions?

### [Check out our community page.](https://posthog.com/posts)
