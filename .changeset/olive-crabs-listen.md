---
'@posthog/next': minor
---

Replace the `getPostHog` and `getServerSidePostHog` exports with a `createPostHog()` factory. Configure PostHog once in a shared module — including an optional `getDistinctId` resolver that attributes server-side events and feature flags to the authenticated user — and use the returned `getPostHog` everywhere.

```ts
import 'server-only'
import { createPostHog } from '@posthog/next'

export const { getPostHog } = createPostHog()
```

Pass `getDistinctId` to resolve identity from your auth session:

```ts
import 'server-only'
import { createPostHog } from '@posthog/next'
import { auth } from '@/auth'

export const { getPostHog } = createPostHog({
    getDistinctId: async () => (await auth())?.user?.id,
})
```

In the Pages Router, import from `@posthog/next/pages`; the returned `getPostHog(ctx)` requires the `GetServerSidePropsContext` and passes it to the resolver:

```ts
import { createPostHog } from '@posthog/next/pages'

export const { getPostHog } = createPostHog({
    getDistinctId: async (ctx) => (ctx ? (await getServerSession(ctx.req, ctx.res, authOptions))?.user?.id : undefined),
})
```

Call sites are unchanged apart from the import. `getPostHog` is still async, `ctx` is still required in the Pages Router, and per-call `apiKey`/`options` move into `createPostHog()`:

```ts
// Before
import { getPostHog } from '@posthog/next'
const posthog = await getPostHog(apiKey, { host })

// After
import { getPostHog } from '@/lib/posthog'
const posthog = await getPostHog()
```

In the Pages Router, `getServerSidePostHog(ctx)` becomes `getPostHog(ctx)`.
