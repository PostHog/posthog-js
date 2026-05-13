# PostHog Next.js Config

This package handles sourcemap configuration and upload for the PostHog Error Tracking product.

Please see the main [PostHog Error Tracking docs](https://posthog.com/docs/error-tracking).

## Usage

```typescript
// next.config.ts
import { withPostHogConfig } from '@posthog/nextjs-config'

const nextConfig = {
  // Your Next.js configuration here
}

export default withPostHogConfig(nextConfig, {
  personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY!, // Personal API key used for sourcemap uploads, see https://app.posthog.com/settings/user-api-keys
  projectId: process.env.POSTHOG_PROJECT_ID!, // Project ID, see https://app.posthog.com/settings/project#variables
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST!, // (optional) Host URL, defaults to https://us.posthog.com
  sourcemaps: {
    // (optional)
    enabled: true, // (optional) Enable sourcemaps generation and upload, default to true on production builds
    releaseName: 'my-application', // (optional) Release name, defaults to repository name
    releaseVersion: '1.0.0', // (optional) Release version, defaults to current git commit
    deleteAfterUpload: true, // (optional) Delete sourcemaps after upload, defaults to true
  },
})
```

## Combining with other Next.js config wrappers

`withPostHogConfig` returns a function-form Next.js config. Some other wrappers
(e.g. `next-intl`, `next-mdx`) do not correctly forward function-form configs,
which would silently drop PostHog's webpack/compiler hooks — no source maps
would be generated or uploaded, and no errors would appear.

To avoid this, make `withPostHogConfig` the **outermost** wrapper:

```typescript
// ✅ Correct: withPostHogConfig is the outermost wrapper
export default withPostHogConfig(withNextIntl(nextConfig), { ... })

// ❌ Incorrect: another wrapper around withPostHogConfig may silently drop it
export default withNextIntl(withPostHogConfig(nextConfig, { ... }))
```

If the inner config function is never invoked during a build,
`@posthog/nextjs-config` will emit a warning at process exit pointing this out.

## Questions?

### [Check out our community page.](https://posthog.com/posts)
