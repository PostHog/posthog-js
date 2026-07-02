import { defineComponent } from 'convex/server'
import { v } from 'convex/values'

/**
 * The component declares the env vars it needs so the installing app can wire them in
 * `convex/convex.config.ts` (typically via `app.env.*` so existing project-level env vars
 * pass straight through). These are read via `process.env` inside the component's
 * actions and cron — `POSTHOG_PERSONAL_API_KEY`'s presence is also what gates the local
 * evaluation refresh cron.
 */
export default defineComponent('posthog', {
  env: {
    POSTHOG_PROJECT_TOKEN: v.string(),
    POSTHOG_HOST: v.optional(v.string()),
    POSTHOG_PERSONAL_API_KEY: v.optional(v.string()),
    /**
     * Polling interval for the local-evaluation refresh, in whole seconds. Optional (defaults
     * to 60). Convex component env vars are string-typed on the wire and only forwarded at
     * runtime, so it's read by the self-rescheduling refresh loop in `lib.ts` rather than at
     * cron-registration time — invalid values log a warning and fall back to the default.
     */
    POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS: v.optional(v.string()),
    /**
     * Off-switch for the background local-evaluation refresh loop. Optional; unset by default, so
     * polling stays on whenever `POSTHOG_PERSONAL_API_KEY` is set. Set to `"true"` (or `1`/`yes`/`on`)
     * to stop the poll even with a key configured — e.g. if you only evaluate flags via the remote
     * `evaluateFlag*` actions.
     */
    POSTHOG_DISABLE_LOCAL_EVALUATION: v.optional(v.string()),
  },
})
