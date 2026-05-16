import { cronJobs } from 'convex/server'
import { internal } from './_generated/api.js'

const crons = cronJobs()

/**
 * Refresh feature flag definitions every minute. The action is a no-op if
 * POSTHOG_PERSONAL_API_KEY is not set on the deployment, so the cron is safe to ship enabled.
 */
crons.interval('posthog refresh feature flag definitions', { minutes: 1 }, internal.lib.refreshFlagDefinitions, {})

export default crons
