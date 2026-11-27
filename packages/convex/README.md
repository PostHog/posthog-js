# PostHog Convex package

<p align="center">
  <a href="https://www.npmjs.com/package/@posthog/convex"><img src="https://badge.fury.io/js/@posthog%2Fconvex.svg" alt="npm version"></a>
  <a href="https://www.convex.dev/components/posthog/convex"><img src="https://www.convex.dev/components/badge/posthog/convex" alt="Convex Component"></a>
</p>

Please see the main [PostHog docs](https://posthog.com/docs).

SDK usage examples and code snippets live in the official documentation so they stay up to date.

## Documentation

- [Convex library docs](https://posthog.com/docs/libraries/convex)

## Choosing an install

The package ships two component definitions. Both register as `posthog`, so `components.posthog` and `new PostHog(components.posthog)` stay the same whichever one you install.

| Import in `convex/convex.config.ts`            | Use it when                                                                                                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@posthog/convex/convex.config.js` (default)   | You evaluate feature flags locally (`getFeatureFlag`, `isFeatureEnabled`, …). It stores flag definitions and registers a 5-minute cron that keeps them refreshed.                 |
| `@posthog/convex/events-only/convex.config.js` | You only capture events and exceptions, call `identify` / `alias` / `groupIdentify`, or evaluate flags remotely with `evaluateFlag*`. It registers no cron and creates no tables. |

```ts
// convex/convex.config.ts
import { defineApp } from 'convex/server'
import { v } from 'convex/values'
import posthog from '@posthog/convex/events-only/convex.config.js'

const app = defineApp({
  env: {
    POSTHOG_PROJECT_TOKEN: v.optional(v.string()),
    POSTHOG_HOST: v.optional(v.string()),
  },
})
app.use(posthog, {
  env: {
    POSTHOG_PROJECT_TOKEN: app.env.POSTHOG_PROJECT_TOKEN,
    POSTHOG_HOST: app.env.POSTHOG_HOST,
  },
})

export default app
```

The event-only component accepts only `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST`. Local flag evaluation methods throw there and point you to the remote `evaluateFlag*` methods. To switch to local evaluation, change the import back to `@posthog/convex/convex.config.js` and forward `POSTHOG_PERSONAL_API_KEY`.
