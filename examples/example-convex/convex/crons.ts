import { cronJobs } from 'convex/server'
import { internalAction } from './_generated/server.js'
import { internal } from './_generated/api.js'
import { posthog } from './posthog.js'

/**
 * Refresh PostHog feature flag definitions every minute.
 *
 * `posthog.refreshFlagDefinitions(ctx)` forwards the credentials configured in `posthog.ts` to
 * the component's refresh action. Adjust the interval to taste — every minute is a reasonable
 * default for most projects.
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
