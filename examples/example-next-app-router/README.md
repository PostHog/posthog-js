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

3. From the monorepo root, export packages as tarballs:

    ```bash
    pnpm package:watch
    ```

4. In a new terminal, install dependencies and start the dev server from this directory:

    ```bash
    pnpm install
    pnpm dev
    ```

5. Open [http://localhost:3000](http://localhost:3000)

## Demos

| Route            | Feature           | Description                                                |
| ---------------- | ----------------- | ---------------------------------------------------------- |
| `/auth`          | Identity          | Log in/out with `posthog.identify()` and `posthog.reset()` |
| `/server-flags`  | Server Components | Evaluate feature flags server-side                         |
| `/client-hooks`  | React Hooks       | Use `useFeatureFlag` and friends                           |
| `/ssr-bootstrap` | SSR Bootstrap     | Feature flags on first render with no flicker              |
| `/capture`       | Event Capture     | Capture custom events from client components               |

## Feature Flags

Create these flags in your PostHog project to see the demos in action:

- **`example-flag`** -- Used by the Client Hooks and SSR Bootstrap demos. Can be boolean or multivariate.
