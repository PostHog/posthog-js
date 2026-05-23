import { cronJobs } from 'convex/server'
import { internal } from './_generated/api.js'

const crons = cronJobs()

/**
 * The refresh cron is registered only when `POSTHOG_PERSONAL_API_KEY` is configured for the
 * component. Without it, local evaluation can't run, so there's no reason to pay the per-tick
 * resource cost — particularly on idle dev deployments on the free tier.
 *
 * Toggling local evaluation on or off therefore requires redeploying the component, which
 * `npx convex env set` triggers automatically in `npx convex dev`. The cron handler itself also
 * guards against a stale registration where the env var was cleared after deploy.
 */
if (process.env.POSTHOG_PERSONAL_API_KEY) {
  crons.interval('Refresh PostHog feature flag definitions', { minutes: 1 }, internal.lib.refreshFlagDefinitions, {})
}

export default crons
