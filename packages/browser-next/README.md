# @posthog/browser

An experimental PostHog client for modern browsers.

The package root contains the capture host and a bounded in-memory analytics queue. It does not transmit analytics until the first-party delivery extension is installed.

Install Capture Analytics V1 delivery immediately:

```ts
import { createPostHog } from '@posthog/browser'
import { analytics } from '@posthog/browser/analytics'

const posthog = await createPostHog({
    projectToken: '<project-token>',
    extensions: [analytics()],
})
await posthog.capture('signed_up')
await posthog.flush()
```

Or capture synchronously into the core queue and load delivery later:

```ts
import { createPostHog } from '@posthog/browser'

const posthog = await createPostHog({ projectToken: '<project-token>' })
await posthog.capture('signed_up')

await posthog.loadExtension(async () => {
    const { analytics } = await import('@posthog/browser/analytics')
    return analytics()
})
await posthog.flush()
```

`capture()` resolves after queue admission. Without an attached analytics extension, `flush()` resolves without discarding queued events.

This package is private while the API and capture behavior remain experimental.

See [Bundle architecture](./ARCHITECTURE.md) for package boundaries, tree-shaking rules, and bundle review.
