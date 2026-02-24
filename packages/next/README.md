# @posthog/next

The official PostHog integration for Next.js. Provides analytics, feature flags, and event capture across the App Router (React Server Components), Pages Router, and middleware — with a single unified package.

## Features

- **App Router support** with a server-component `PostHogProvider` that bootstraps feature flags via SSR
- **Pages Router support** via `withPostHogApp` and `withPostHogServerProps` higher-order functions
- **Middleware** for identity cookie seeding and optional API proxying
- **Server-side feature flags** via `getPostHog()` in server components and route handlers
- **Automatic pageview tracking** with the `PostHogPageView` component
- **Consent-aware** — all server-side code respects the user's opt-in/opt-out preference
- **Static-safe by default** — the provider does not call dynamic APIs unless you enable `bootstrapFlags`

## Install

```bash
npm install @posthog/next
# or
pnpm add @posthog/next
# or
yarn add @posthog/next
```

**Peer dependencies**: `next` >= 13.0.0, `react` >= 18.0.0, `react-dom` >= 18.0.0

## Quick Start (App Router)

### 1. Set environment variables

```env
NEXT_PUBLIC_POSTHOG_KEY=phc_your_key_here
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com  # optional
```

### 2. Add middleware

```ts
// middleware.ts
import { postHogMiddleware } from '@posthog/next/middleware'

export default postHogMiddleware({ proxy: true })

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

### 3. Wrap your layout

```tsx
// app/layout.tsx
import { PostHogProvider, PostHogPageView } from '@posthog/next'

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body>
                <PostHogProvider options={{ api_host: '/ingest' }} bootstrapFlags>
                    <PostHogPageView />
                    {children}
                </PostHogProvider>
            </body>
        </html>
    )
}
```

### 4. Use PostHog

```tsx
// In a client component
'use client'
import { usePostHog, useFeatureFlag } from '@posthog/next'

export function MyComponent() {
    const posthog = usePostHog()
    const showNewUI = useFeatureFlag('new-ui')

    return <button onClick={() => posthog.capture('clicked')}>Click me</button>
}
```

```tsx
// In a server component
import { getPostHog } from '@posthog/next/server'

export default async function Page() {
    const posthog = await getPostHog()
    const flags = await posthog.getAllFlags()
    posthog.capture({ event: 'page_viewed' })
    // ...
}
```

For detailed usage including Pages Router, consent management, middleware composition, and all API options, see [USAGE.md](./USAGE.md).

## Entry Points

| Import path                | Environment     | Purpose                                                         |
| -------------------------- | --------------- | --------------------------------------------------------------- |
| `@posthog/next`            | Client + Server | `PostHogProvider`, `PostHogPageView`, hooks                     |
| `@posthog/next/server`     | Server only     | `getPostHog()` for server components / route handlers           |
| `@posthog/next/middleware` | Edge / Server   | `postHogMiddleware()` for identity seeding and proxying         |
| `@posthog/next/pages`      | Client + Server | `withPostHogApp()`, `withPostHogServerProps()` for Pages Router |

## Environment Variables

| Variable                   | Required                    | Description                                                  |
| -------------------------- | --------------------------- | ------------------------------------------------------------ |
| `NEXT_PUBLIC_POSTHOG_KEY`  | Yes (unless passed as prop) | Your PostHog project API key (`phc_...`)                     |
| `NEXT_PUBLIC_POSTHOG_HOST` | No                          | Custom PostHog host (defaults to `https://us.i.posthog.com`) |

## How It Works

1. **Middleware** runs on every request and seeds an identity cookie (`ph_<key>_posthog`) with a UUIDv7 anonymous ID if none exists. It optionally proxies SDK API calls through your domain.

2. **PostHogProvider** (a React Server Component) reads that cookie. When `bootstrapFlags` is enabled, it evaluates feature flags server-side via `posthog-node` and passes the results to the client as bootstrap data — so hooks return real values immediately without a network round-trip.

3. **Client components** use `posthog-js` under the hood. The SDK is initialized eagerly during render (not in a `useEffect`) so that child components and hooks can access a fully configured instance immediately.

4. **Server utilities** (`getPostHog()`) read the same identity cookie and scope the `posthog-node` client per request via `enterContext()`, so events and flag evaluations are attributed to the correct user.

5. **Consent** is checked at every layer. If the user has opted out (via the consent cookie), the middleware skips cookie seeding, the provider skips flag evaluation, and `getPostHog()` skips context setup.
