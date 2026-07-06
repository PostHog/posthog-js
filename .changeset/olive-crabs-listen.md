---
'@posthog/next': minor
---

Replace the `getPostHog` and `getServerSidePostHog` exports with a `createPostHog()` factory. Configure PostHog once in a shared module — including an optional `getDistinctId` resolver that attributes server-side events and feature flags to the authenticated user, overriding the client-provided (spoofable) identity — and use the returned `getPostHog` / `getServerSidePostHog` everywhere.

```ts
// lib/posthog.ts
import 'server-only'
import { createPostHog } from '@posthog/next'
import { auth } from '@/auth'

export const { getPostHog } = createPostHog({
    getDistinctId: async () => (await auth())?.user?.id,
})
```
