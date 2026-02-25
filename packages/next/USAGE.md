# @posthog/next Usage Guide

Comprehensive reference for every feature in the `@posthog/next` package.

## Table of Contents

- [App Router Setup](#app-router-setup)
    - [Environment Variables](#environment-variables)
    - [Middleware](#middleware)
    - [PostHogProvider](#posthogprovider)
    - [Pageview Tracking](#pageview-tracking)
    - [Client Hooks](#client-hooks)
    - [Server-Side Usage](#server-side-usage)
- [Pages Router Setup](#pages-router-setup)
    - [PostHogProvider (Pages)](#posthogprovider-pages)
    - [Pageview Tracking (Pages)](#pageview-tracking-pages)
    - [Server-Side Props](#server-side-props)
    - [Bootstrapping Flags (Pages)](#bootstrapping-flags-pages)

- [Feature Flag Bootstrap](#feature-flag-bootstrap)
- [Consent Management](#consent-management)
- [Middleware Reference](#middleware-reference)
    - [API Proxy](#api-proxy)
    - [Composing with Other Middleware](#composing-with-other-middleware)
    - [Consent Options](#middleware-consent-options)
- [API Reference](#api-reference)

---

## App Router Setup

### Environment Variables

```env
# Required (or pass apiKey as a prop)
NEXT_PUBLIC_POSTHOG_KEY=phc_your_key_here

# Optional — custom PostHog host
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

### Middleware

The middleware serves two purposes: seeding the PostHog identity cookie on first visit, and optionally proxying API requests through your domain.

```ts
// middleware.ts
import { postHogMiddleware } from '@posthog/next/middleware'

export default postHogMiddleware({ proxy: true })

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

The middleware generates a UUIDv7 anonymous ID and sets the `ph_<key>_posthog` cookie on the first request. This ensures both client and server share the same identity from the very first render.

### PostHogProvider

`PostHogProvider` is a React Server Component that wraps your app with the PostHog context.

```tsx
// app/layout.tsx
import { Suspense } from 'react'
import { PostHogProvider, PostHogPageView } from '@posthog/next'

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body>
                <PostHogProvider
                    apiKey={process.env.NEXT_PUBLIC_POSTHOG_KEY!}
                    options={{ api_host: '/ingest' }}
                    bootstrapFlags
                >
                    <Suspense fallback={null}>
                        <PostHogPageView />
                    </Suspense>
                    {children}
                </PostHogProvider>
            </body>
        </html>
    )
}
```

**Props:**

| Prop             | Type                              | Default                   | Description                                                                                        |
| ---------------- | --------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------- |
| `apiKey`         | `string`                          | `NEXT_PUBLIC_POSTHOG_KEY` | PostHog project API key. Read from env var if omitted.                                             |
| `options`        | `Partial<PostHogConfig>`          | See below                 | `posthog-js` configuration overrides.                                                              |
| `bootstrapFlags` | `boolean \| BootstrapFlagsConfig` | `undefined`               | Enable server-side feature flag evaluation. See [Feature Flag Bootstrap](#feature-flag-bootstrap). |
| `children`       | `React.ReactNode`                 | —                         | Your app content.                                                                                  |

**Default options applied automatically:**

```ts
{
    capture_pageview: false,
    persistence: 'localStorage+cookie',
    opt_out_capturing_persistence_type: 'cookie',
    opt_out_persistence_by_default: true,
}
```

These defaults disable automatic pageviews (so `PostHogPageView` doesn't cause duplicates) and ensure the server can read identity and consent state from cookies. You can override any of them via the `options` prop.

**Static vs Dynamic rendering:**

By default (without `bootstrapFlags`), `PostHogProvider` does not call any dynamic Next.js APIs (`cookies()`, `headers()`). This makes it compatible with static generation, ISR, and Partial Prerendering (PPR).

When `bootstrapFlags` is enabled, the provider calls `cookies()` and evaluates flags server-side, which opts the route into dynamic rendering.

### Pageview Tracking

`PostHogPageView` is a client component that automatically captures `$pageview` events on route changes. This is needed because Next.js App Router navigations are soft (client-side) — the browser doesn't fire a full page load, so `posthog-js`'s built-in pageview tracking doesn't trigger.

```tsx
import { PostHogPageView } from '@posthog/next'

// Inside your PostHogProvider:
;<PostHogPageView />
```

### Client Hooks

All hooks are re-exported from `posthog-js/react` and must be used in client components (`'use client'`).

```tsx
'use client'
import { usePostHog, useFeatureFlag, useActiveFeatureFlags, PostHogFeature } from '@posthog/next'
```

| Export                    | Type                             | Description                                                     |
| ------------------------- | -------------------------------- | --------------------------------------------------------------- |
| `usePostHog()`            | `PostHog`                        | Returns the `posthog-js` client instance.                       |
| `useFeatureFlag(key)`     | `FeatureFlagResult \| undefined` | Returns the flag result (`{ key, enabled, variant, payload }`). |
| `useActiveFeatureFlags()` | `string[]`                       | Returns all active (truthy) feature flag keys.                  |
| `PostHogFeature`          | Component                        | Conditionally renders children based on a flag.                 |

**Example: Event capture**

```tsx
'use client'
import { usePostHog } from '@posthog/next'

export function TrackButton() {
    const posthog = usePostHog()
    return <button onClick={() => posthog.capture('button_clicked')}>Track</button>
}
```

**Example: Feature flag component**

```tsx
'use client'
import { PostHogFeature } from '@posthog/next'

export function NewBanner() {
    return (
        <PostHogFeature flag="show-banner" match={true}>
            <div>New feature available!</div>
        </PostHogFeature>
    )
}
```

### Server-Side Usage

Use `getPostHog()` in server components, route handlers, and server actions to evaluate flags and capture events server-side. The returned client is preconfigured with the current user's context (distinct ID, session ID, and device ID) read from the PostHog cookie, so all flag evaluations and captured events are automatically attributed to the correct user.

```tsx
import { getPostHog } from '@posthog/next/server'

export default async function DashboardPage() {
    const posthog = await getPostHog()

    // Evaluate feature flags
    const flags = await posthog.getAllFlags()
    const result = await posthog.getFeatureFlagResult('new-dashboard')
    const showNewDashboard = result?.enabled

    // Capture server-side events
    posthog.capture({ event: 'dashboard_viewed' })

    return <div>{showNewDashboard ? <NewDashboard /> : <OldDashboard />}</div>
}
```

**Note:** `getPostHog()` calls `cookies()` internally, which automatically opts the route into dynamic rendering. Pages using it cannot be statically generated.

`getPostHog()` accepts optional parameters:

```ts
const posthog = await getPostHog(apiKey?, options?)
```

| Parameter | Type                      | Description                                                   |
| --------- | ------------------------- | ------------------------------------------------------------- |
| `apiKey`  | `string`                  | Override the API key (defaults to `NEXT_PUBLIC_POSTHOG_KEY`). |
| `options` | `Partial<PostHogOptions>` | `posthog-node` options (e.g., `{ host: '...' }`).             |

The returned client is scoped to the current user via `enterContext()`. The user's identity, session ID, and device ID are automatically read from the PostHog cookie. Server clients are cached and reused across requests.

---

## Pages Router Setup

### PostHogProvider (Pages)

Wrap your `_app` with `PostHogProvider` to initialize PostHog for all pages:

```tsx
// pages/_app.tsx
import type { AppProps } from 'next/app'
import { PostHogProvider, PostHogPageView } from '@posthog/next/pages'

export default function App({ Component, pageProps }: AppProps) {
    return (
        <PostHogProvider apiKey={process.env.NEXT_PUBLIC_POSTHOG_KEY!} options={{ api_host: '/ingest' }}>
            <PostHogPageView />
            <Component {...pageProps} />
        </PostHogProvider>
    )
}
```

**Props:**

| Prop        | Type                     | Default     | Description                                                  |
| ----------- | ------------------------ | ----------- | ------------------------------------------------------------ |
| `apiKey`    | `string`                 | `NEXT_PUBLIC_POSTHOG_KEY` | PostHog project API key. Read from env var if omitted.       |
| `options`   | `Partial<PostHogConfig>` | See below   | `posthog-js` configuration overrides.                        |
| `bootstrap` | `BootstrapConfig`        | `undefined` | Server-evaluated bootstrap data from `getServerSidePostHog`. |
| `children`  | `React.ReactNode`        | —           | Your app content.                                            |

The same [default options](#posthogprovider) are applied automatically. The `api_host` can also be set via the `NEXT_PUBLIC_POSTHOG_HOST` environment variable.

### Pageview Tracking (Pages)

`PostHogPageView` (from `@posthog/next/pages`) tracks route changes using `next/router`. Place it inside your `PostHogProvider`:

```tsx
import { PostHogPageView } from '@posthog/next/pages'

// Inside your PostHogProvider in _app.tsx:
;<PostHogPageView />
```

It captures a `$pageview` event on every `router.asPath` change, including query parameters.

### Server-Side Props

Use `getServerSidePostHog` inside your existing `getServerSideProps` to access a PostHog server client scoped to the current user:

```tsx
// pages/dashboard.tsx
import type { GetServerSideProps } from 'next'
import { getServerSidePostHog } from '@posthog/next/pages'

export const getServerSideProps: GetServerSideProps = async (ctx) => {
    const posthog = getServerSidePostHog(ctx)

    // Evaluate flags for the current user
    const result = await posthog.getFeatureFlagResult('new-ui')

    // Capture a server-side event
    posthog.capture({ event: 'dashboard_viewed' })

    return { props: { showNewUI: result?.enabled ?? false } }
}

export default function Dashboard({ showNewUI }: { showNewUI: boolean }) {
    return <div>{showNewUI ? 'New UI' : 'Classic UI'}</div>
}
```

`getServerSidePostHog` returns a `posthog-node` client preconfigured with the current user's context (distinct ID, session ID, device ID) read from the PostHog cookie. Methods like `getAllFlags()`, `getFeatureFlagResult()`, and `capture()` automatically use this identity.

The API key defaults to `NEXT_PUBLIC_POSTHOG_KEY`. You can override it with an optional second argument: `getServerSidePostHog(ctx, 'phc_custom_key')`.

### Bootstrapping Flags (Pages)

To eliminate flag flicker on page load, evaluate flags server-side and pass them as bootstrap data to the provider:

```tsx
// pages/dashboard.tsx
import type { GetServerSideProps } from 'next'
import { getServerSidePostHog } from '@posthog/next/pages'

export const getServerSideProps: GetServerSideProps = async (ctx) => {
    const posthog = getServerSidePostHog(ctx)
    const flags = await posthog.getAllFlagsAndPayloads()
    return { props: { posthogBootstrap: flags } }
}
```

Then wire the bootstrap data into the provider via `pageProps`:

```tsx
// pages/_app.tsx
import type { AppProps } from 'next/app'
import { PostHogProvider, PostHogPageView } from '@posthog/next/pages'

export default function App({ Component, pageProps }: AppProps) {
    return (
        <PostHogProvider
            apiKey={process.env.NEXT_PUBLIC_POSTHOG_KEY!}
            options={{ api_host: '/ingest' }}
            bootstrap={pageProps.posthogBootstrap}
        >
            <PostHogPageView />
            <Component {...pageProps} />
        </PostHogProvider>
    )
}
```

---

## Feature Flag Bootstrap

Bootstrap lets the server evaluate feature flags and pass the results to the client SDK, eliminating the round-trip to PostHog's API on page load. Hooks like `useFeatureFlag()` return real values immediately.

### Basic usage

Pass `bootstrapFlags` as `true` to evaluate all flags:

```tsx
<PostHogProvider bootstrapFlags>{children}</PostHogProvider>
```

### Advanced usage

Pass an object to control evaluation:

```tsx
<PostHogProvider
    bootstrapFlags={{
        flags: ['new-ui', 'pricing-v2'], // only evaluate these flags
        groups: { company: 'posthog' }, // evaluate for a group
        personProperties: { plan: 'enterprise' }, // known person properties
        groupProperties: {
            // known group properties
            company: { industry: 'tech' },
        },
    }}
>
    {children}
</PostHogProvider>
```

**`BootstrapFlagsConfig` options:**

| Property           | Type                                     | Description                                               |
| ------------------ | ---------------------------------------- | --------------------------------------------------------- |
| `flags`            | `string[]`                               | Specific flag keys to evaluate. Evaluates all if omitted. |
| `groups`           | `Record<string, string>`                 | Groups to evaluate flags for.                             |
| `personProperties` | `Record<string, string>`                 | Known person properties for local evaluation.             |
| `groupProperties`  | `Record<string, Record<string, string>>` | Known group properties for local evaluation.              |

### How it works

1. The provider reads the identity cookie via `cookies()`
2. It calls `posthog-node`'s `getAllFlagsAndPayloads()` with the user's `distinctId`
3. Results are passed as `bootstrap` data to `posthog-js`
4. `advanced_disable_feature_flags_on_first_load` is set to `true` so the client doesn't re-fetch flags
5. The evaluation is deduplicated within a render pass via `React.cache()`

### Trade-offs

- Enabling `bootstrapFlags` opts the route into **dynamic rendering** (incompatible with static generation / ISR)
- Adds a server-side call to PostHog on each request (deduplicated per render)
- If the user has opted out of tracking, flag evaluation is skipped and no bootstrap data is passed

---

## Consent Management

The SDK is consent-aware at every layer. Here's how to implement a consent banner:

### Client-side consent

See the [ConsentBanner example](./examples/app-router/app/components/ConsentBanner.tsx) for a working implementation using `opt_in_capturing()`, `opt_out_capturing()`, and `get_explicit_consent_status()`.

### How consent flows through the stack

1. **posthog-js** writes a consent cookie (`__ph_opt_in_out_<apiKey>`) with value `1` (opted in) or `0` (opted out)
2. **Middleware** reads the consent cookie. If opted out, it skips identity cookie seeding and deletes any existing identity cookie
3. **PostHogProvider** checks consent before evaluating bootstrap flags. If opted out, no flags are evaluated
4. **getPostHog()** checks consent before setting up user context. If opted out, the client is returned without identity scoping

### Consent defaults

The package applies these defaults to ensure the server can read consent:

```ts
{
    opt_out_capturing_persistence_type: 'cookie',   // write consent to a cookie (not localStorage)
    opt_out_persistence_by_default: true,           // clear identity cookie on opt-out
}
```

### Opt-out by default

If your app requires consent before any tracking (common in GDPR regions), configure the middleware:

```ts
export default postHogMiddleware({
    proxy: true,
    optOutByDefault: true,
})
```

And on the client:

```tsx
<PostHogProvider options={{ opt_out_capturing_by_default: true }}>
```

When opt-out is the default, no identity cookie is seeded and no flags are evaluated until the user explicitly opts in.

---

## Middleware Reference

### API Proxy

Proxying routes PostHog API calls through your domain, which can help avoid ad blockers.

```ts
// Simplest — defaults to path prefix '/ingest' and host 'https://us.i.posthog.com'
export default postHogMiddleware({ proxy: true })
```

```ts
// Custom path and host
export default postHogMiddleware({
    proxy: {
        pathPrefix: '/analytics',
        host: 'https://eu.i.posthog.com',
    },
})
```

When using the proxy, set `api_host` to the path prefix in your provider options:

```tsx
<PostHogProvider options={{ api_host: '/ingest' }}>
```

**How it works:** Requests matching the path prefix (e.g., `/ingest/e`, `/ingest/decide`) are rewritten to the PostHog ingest host via `NextResponse.rewrite()`. The path prefix is stripped and the remaining path and query string are forwarded.

### Composing with Other Middleware

Pass an existing `NextResponse` to compose PostHog middleware with your own:

```ts
// middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { postHogMiddleware } from '@posthog/next/middleware'

export default async function middleware(request: NextRequest) {
    // Your custom middleware logic
    const response = NextResponse.next()
    response.headers.set('x-custom-header', 'value')

    // PostHog seeds cookies on the existing response
    return postHogMiddleware({ proxy: true, response })(request)
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

### Middleware Consent Options

| Option                | Type      | Default                    | Description                                                              |
| --------------------- | --------- | -------------------------- | ------------------------------------------------------------------------ |
| `optOutByDefault`     | `boolean` | `false`                    | Skip cookie seeding when no consent cookie exists.                       |
| `consentCookieName`   | `string`  | `__ph_opt_in_out_<apiKey>` | Custom consent cookie name. Mirrors `consent_persistence_name`.          |
| `consentCookiePrefix` | `string`  | `__ph_opt_in_out_`         | Custom consent cookie prefix. Mirrors `opt_out_capturing_cookie_prefix`. |

### Full Middleware Options

```ts
interface PostHogMiddlewareOptions {
    apiKey?: string // defaults to NEXT_PUBLIC_POSTHOG_KEY
    cookieMaxAgeSeconds?: number // default: 365 days (31,536,000 seconds)
    response?: NextResponse // compose with existing middleware
    optOutByDefault?: boolean // default: false
    consentCookieName?: string // custom consent cookie name
    consentCookiePrefix?: string // custom consent cookie prefix
    proxy?: boolean | PostHogProxyOptions // enable API proxying
}

interface PostHogProxyOptions {
    pathPrefix?: string // default: '/ingest'
    host?: string // default: 'https://us.i.posthog.com'
}
```

---

## API Reference

### `@posthog/next` (main entry point)

**Server context** (React Server Components):

| Export                  | Description                                                      |
| ----------------------- | ---------------------------------------------------------------- |
| `PostHogProvider`       | Async server component that wraps your app with PostHog context. |
| `PostHogPageView`       | Client component for automatic pageview tracking.                |
| `usePostHog`            | Hook returning the `posthog-js` client instance.                 |
| `useFeatureFlag`        | Hook returning a feature flag's value.                           |
| `useActiveFeatureFlags` | Hook returning all active flag keys.                             |
| `PostHogFeature`        | Component for conditional rendering based on a flag.             |

**Client context** (the same, minus `PostHogProvider`):

| Export                  | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| `PostHogPageView`       | Client component for automatic pageview tracking.    |
| `usePostHog`            | Hook returning the `posthog-js` client instance.     |
| `useFeatureFlag`        | Hook returning a feature flag's value.               |
| `useActiveFeatureFlags` | Hook returning all active flag keys.                 |
| `PostHogFeature`        | Component for conditional rendering based on a flag. |

**Types** (available in both contexts):

| Export                 | Description                         |
| ---------------------- | ----------------------------------- |
| `PostHogProviderProps` | Props for `PostHogProvider`.        |
| `BootstrapFlagsConfig` | Configuration for `bootstrapFlags`. |

### `@posthog/next/server`

| Export                          | Description                                                 |
| ------------------------------- | ----------------------------------------------------------- |
| `getPostHog(apiKey?, options?)` | Returns a `posthog-node` client scoped to the current user. |

### `@posthog/next/middleware`

| Export                        | Description                                  |
| ----------------------------- | -------------------------------------------- |
| `postHogMiddleware(options?)` | Creates a Next.js middleware function.       |
| `DEFAULT_INGEST_PATH`         | The default proxy path prefix (`'/ingest'`). |
| `PostHogMiddlewareOptions`    | Type for middleware configuration.           |
| `PostHogProxyOptions`         | Type for proxy configuration.                |

### `@posthog/next/pages`

| Export                                         | Description                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `PostHogProvider`                              | Composable provider for `_app.tsx`.                              |
| `PostHogPageView`                              | Pageview tracker using `next/router`.                            |
| `getServerSidePostHog(ctx, apiKey?, options?)` | Returns a scoped `posthog-node` client for `getServerSideProps`. |
| `PagesPostHogProviderProps`                    | Type for `PostHogProvider` props.                                |

---

## Architecture Notes

### Cookie format

The identity cookie is named `ph_<sanitized_key>_posthog` and contains JSON:

```json
{
    "distinct_id": "01234567-...",
    "$device_id": "01234567-...",
    "$user_state": "anonymous",
    "$sesid": [1708000000000, "session-uuid", 1708000000000]
}
```

### Server client caching

`getPostHog()` (App Router) reuses `posthog-node` client instances across requests. Clients are cached by `apiKey:host` combination in a module-level `Map`. This avoids creating a new client on every request.

In the Pages Router, `getServerSidePostHog` creates a fresh client per request since it cannot share a module-level cache across the Pages Router execution model.

### Client initialization

The client-side `posthog-js` instance is initialized eagerly during render (not in a `useEffect`). This is intentional — React fires effects bottom-up, so child effects (e.g., a consent banner) would otherwise try to access PostHog before the parent provider's effect has run. The `__loaded` guard on `posthog-js` prevents double initialization in React StrictMode.

### Request scoping via `enterContext()`

On the server, `getPostHog()` calls `client.enterContext()` to scope the shared client to the current request's user. This sets the `distinctId`, `$session_id`, and `$device_id` for all subsequent calls within that request. This is what allows a single cached `posthog-node` instance to serve multiple concurrent requests correctly.

---

## Known Gaps

### No server-side configuration on `PostHogProvider`

The `options` prop on `PostHogProvider` only accepts `posthog-js` (client-side) configuration. There is no way to pass `posthog-node` options for the server-side bootstrap flag evaluation. The provider extracts `api_host` from the client options and maps it to the node client's `host`, but other `posthog-node` settings (e.g., `featureFlagsPollingInterval`, `requestTimeout`) cannot be configured through the provider.

**Workaround:** Use `getPostHog()` from `@posthog/next/server` directly, which accepts `posthog-node` options as its second argument.
