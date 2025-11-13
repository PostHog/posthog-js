# PostHog Remix Playground

This is a basic Remix application demonstrating PostHog integration following the [official PostHog Remix documentation](https://posthog.com/docs/libraries/remix).

## Features

- Automatic pageview tracking with `capture_pageview: 'history_change'`
- Custom event capture using PostHog React hooks
- PostHog React Provider integration
- Proper Vite configuration for SSR support
- Navigation header for multi-page testing
- Media page with base64 images for replay testing

## Setup

### Quick Start

Run the automated setup script:

```bash
./bin/localdev.sh
```

This will:

1. Build the PostHog packages from the repo root
2. Create tarballs in the target directory
3. Set up symlinks
4. Install dependencies
5. Start the dev server

### Manual Setup

1. Build and package PostHog libraries from the repo root:

```bash
cd ../..
pnpm build
pnpm package
```

2. Return to the Remix playground and install dependencies:

```bash
cd playground/remix
pnpm install
```

3. Start the development server:

```bash
pnpm dev
```

4. Open http://localhost:5173 in your browser

## Example Pages

- **Home (`/`)** - Main page with custom event capture button
- **Media (`/media`)** - Base64 image generation and testing for session replay

## Key Integration Points

### Vite Configuration (vite.config.ts)

PostHog packages are configured for proper SSR handling:

```typescript
export default defineConfig({
    plugins: [remix()],
    resolve: {
        dedupe: ['react', 'react-dom'],
    },
    ssr: {
        noExternal: ['posthog-js', '@posthog/react'],
    },
})
```

**Important:** The `dedupe` configuration prevents multiple React instances, which can cause "Invalid hook call" errors.

### Provider Setup (app/providers.tsx)

PostHog is initialized on the client side only:

```typescript
if (typeof window !== 'undefined') {
    posthog.init('phc_test_key_for_playground', {
        api_host: 'https://us.i.posthog.com',
        person_profiles: 'identified_only',
        capture_pageview: 'history_change',
        capture_pageleave: true,
    })
}
```

### Root Layout (app/root.tsx)

The PostHog provider wraps the app:

```typescript
export default function App() {
    return (
        <PHProvider>
            <Outlet />
        </PHProvider>
    )
}
```

### Using PostHog Hooks

In any component:

```typescript
import { usePostHog } from '@posthog/react'

export default function MyComponent() {
    const posthog = usePostHog()

    const handleEvent = () => {
        posthog?.capture('custom_event', { property: 'value' })
    }

    return <button onClick={handleEvent}>Track Event</button>
}
```

## Additional Resources

- [PostHog Remix Documentation](https://posthog.com/docs/libraries/remix)
- [Remix Analytics Tutorial](https://posthog.com/tutorials/remix-analytics)
- [Remix A/B Testing](https://posthog.com/tutorials/remix-ab-tests)
- [Remix Surveys](https://posthog.com/tutorials/remix-surveys)

## Known Issues

### The "$" Character Issue (REPRODUCING)

This playground currently implements the pattern from PostHog's official documentation that causes a `$` character to appear on pages (see [Issue #2090](https://github.com/PostHog/posthog-js/issues/2090)).

**Current Implementation (from docs):**

```typescript
export function PHProvider({ children }: { children: React.ReactNode }) {
    const [hydrated, setHydrated] = useState(false)

    useEffect(() => {
        posthog.init('...', { /* config */ })
        setHydrated(true)
    }, [])

    if (!hydrated) return <>{children}</>

    return (
        <PostHogProvider client={posthog}>
            {children}
        </PostHogProvider>
    )
}
```

**The Problem:**

The `if (!hydrated) return <>{children}</>` pattern causes a hydration mismatch between server and client, which can result in a visible `$` character or other rendering artifacts.

**TODO:** Fix this issue either in the package or update the documentation with the correct pattern.
