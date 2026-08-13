# @posthog/browser

An experimental PostHog client for modern browsers.

The package contains a small capture host. Product features use the shared
`@posthog/browser-common` extension contract.

```ts
import { createPostHog } from '@posthog/browser'

const posthog = await createPostHog({ projectToken: '<project-token>' })
await posthog.capture('signed_up')
```

This package is private while the API and capture behavior remain experimental.

See [Bundle architecture](./ARCHITECTURE.md) for package boundaries, tree-shaking rules, and bundle review.
