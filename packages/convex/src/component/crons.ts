import { cronJobs } from 'convex/server'
import { internal } from './_generated/api.js'

const crons = cronJobs()

// A cron's interval is fixed at registration, but Convex forwards component env vars only at
// runtime, so `POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS` is empty when crons are analysed (#3957;
// #3683 hit the same wall with the `POSTHOG_PERSONAL_API_KEY` gate). So the refresh runs as a
// self-rescheduling chain (`lib.ts:refreshLoop`) that reads the interval at runtime; this cron only
// supervises — `ensureRefreshLoop` (re)starts the chain to bootstrap a deploy and self-heal a stop.
// Its 5-minute cadence is a fixed floor (it can't read the runtime interval either), traded against
// bootstrap/heal latency; at very long intervals the supervisor itself dominates the cost.
crons.interval('Ensure PostHog flag refresh loop is running', { minutes: 5 }, internal.lib.ensureRefreshLoop, {})

export default crons
