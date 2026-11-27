import { defineComponent } from 'convex/server'
import { v } from 'convex/values'

/**
 * Event-only variant of the component. It exposes event capture, exception tracking,
 * identify/alias/group calls and remote flag evaluation, but no local flag evaluation. This
 * directory has no `crons.ts` and no schema, so installing it registers no flag-refresh supervisor
 * and creates no tables.
 *
 * The name is `posthog`, the same as the default component, so switching between the two only
 * changes the import in the app's `convex/convex.config.ts`; `components.posthog` stays the same.
 * The default component's cron is registered when its module graph is analysed, before env vars
 * reach the component, so no env var can switch it off. That's why this is a separate component.
 */
export default defineComponent('posthog', {
  env: {
    POSTHOG_PROJECT_TOKEN: v.optional(v.string()),
    POSTHOG_HOST: v.optional(v.string()),
  },
})
