import { defineComponent } from 'convex/server'
import { v } from 'convex/values'

/**
 * The component declares the env vars it needs so the installing app can wire them in
 * `convex/convex.config.ts` (typically via `app.env.*` so existing project-level env vars
 * pass straight through). All three are read via `process.env` inside the component's
 * actions and cron — `POSTHOG_PERSONAL_API_KEY`'s presence is also what gates the local
 * evaluation refresh cron.
 */
export default defineComponent('posthog', {
  env: {
    POSTHOG_TOKEN: v.string(),
    POSTHOG_HOST: v.optional(v.string()),
    POSTHOG_PERSONAL_API_KEY: v.optional(v.string()),
  },
})
