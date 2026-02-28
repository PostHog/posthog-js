# @posthog/next App Router Example

A Next.js 15 App Router example demonstrating all features of the `@posthog/next` package.

## Setup

1. Copy the environment template:

   ```bash
   cp .env.local.example .env.local
   ```

2. Add your PostHog API key to `.env.local`:

   ```
   NEXT_PUBLIC_POSTHOG_KEY=phc_your_key_here
   NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
   ```

3. Install dependencies and start the dev server from the monorepo root:

   ```bash
   pnpm install
   pnpm --filter @posthog/next-example-app-router dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

## Demos

| Route | Feature | Description |
| --- | --- | --- |
| `/auth` | Identity | Log in/out with `posthog.identify()` and `posthog.reset()` |
| `/server-flags` | Server Components | Evaluate feature flags server-side |
| `/client-hooks` | React Hooks | Use `useFeatureFlagEnabled` and friends |
| `/capture` | Event Capture | Capture custom events from client components |
| `/middleware-demo` | Middleware | Flag-based URL rewrites at the edge |

## Feature Flags

Create these flags in your PostHog project to see the demos in action:

- **`example-flag`** -- Used by the Client Hooks demo. Can be boolean or multivariate.
- **`new-landing`** -- Used by the Middleware demo. Boolean flag that triggers a URL rewrite when enabled.
