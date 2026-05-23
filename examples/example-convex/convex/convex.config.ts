import { defineApp } from 'convex/server'
import { v } from 'convex/values'
import posthog from '@posthog/convex/convex.config.js'
import agent from '@convex-dev/agent/convex.config'

const app = defineApp({
    env: {
        POSTHOG_TOKEN: v.string(),
        POSTHOG_HOST: v.optional(v.string()),
        POSTHOG_PERSONAL_API_KEY: v.optional(v.string()),
        POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS: v.optional(v.string()),
    },
})

// Forward the app-level env vars into the component. Setting them with `npx convex env set` on
// the deployment makes them available here at deploy time and inside the component at runtime.
app.use(posthog, {
    env: {
        POSTHOG_TOKEN: app.env.POSTHOG_TOKEN,
        POSTHOG_HOST: app.env.POSTHOG_HOST,
        POSTHOG_PERSONAL_API_KEY: app.env.POSTHOG_PERSONAL_API_KEY,
        POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS: app.env.POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS,
    },
})
app.use(agent)

export default app
