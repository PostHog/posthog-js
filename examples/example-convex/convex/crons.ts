import { cronJobs } from 'convex/server'
import { internalAction } from './_generated/server.js'
import { internal } from './_generated/api.js'
import { posthog } from './posthog.js'

/**
 * Refresh PostHog feature flag definitions every minute.
 *
 * The PostHog component can't read your app's env vars (Convex components run in an isolated env
 * namespace), so the cron lives here in your app where `process.env.POSTHOG_*` is available. The
 * client class captured the keys at construction time in `posthog.ts` and forwards them through
 * `refreshFlagDefinitions`.
 */
export const refreshPosthogFlags = internalAction({
    args: {},
    handler: async (ctx) => {
        await posthog.refreshFlagDefinitions(ctx)
    },
})

const crons = cronJobs()

crons.interval('refresh posthog feature flag definitions', { minutes: 1 }, internal.crons.refreshPosthogFlags)

export default crons
