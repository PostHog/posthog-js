---
'@posthog/next': minor
---

Replace the `getPostHog` and `getServerSidePostHog` exports with a `createPostHog()` factory. Configure PostHog once in a shared module — including an optional `getDistinctId` resolver that attributes server-side events and feature flags to the authenticated user, overriding the client-provided (spoofable) identity — and use the returned `getPostHog` everywhere. App Router server code imports `createPostHog` from `@posthog/next` and calls `getPostHog()` with no arguments. Pages Router server code imports `createPostHog` from `@posthog/next/pages` and calls `getPostHog(ctx)` with the `GetServerSidePropsContext`.

```ts
import 'server-only'
import { createPostHog } from '@posthog/next'
import { auth } from '@/auth'

export const { getPostHog } = createPostHog({
    getDistinctId: async () => (await auth())?.user?.id,
})
```

```ts
import { createPostHog } from '@posthog/next/pages'

export const { getPostHog } = createPostHog({
    getDistinctId: async (ctx) => (ctx ? (await getServerSession(ctx.req, ctx.res, authOptions))?.user?.id : undefined),
})
```
