import { cronJobs } from 'convex/server'
import { internal } from './_generated/api.js'

const crons = cronJobs()

// The flag-refresh cadence is configurable at runtime via `POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS`,
// but a cron's interval is fixed when it's registered — and Convex forwards component env vars only
// at runtime, so the var is empty during the deploy-time module analysis that registers crons (see
// #3957, and #3683 for the same constraint biting the `POSTHOG_PERSONAL_API_KEY` gate). A fixed cron
// therefore can't honour the configured interval. Instead the refresh runs as a self-rescheduling
// chain (`lib.ts:refreshLoop`) that reads the interval at runtime and queues its own next run.
//
// This cron is only a supervisor: `ensureRefreshLoop` starts the chain unless it's already running,
// which bootstraps a fresh deploy and self-heals if the chain ever stops. The actual refresh work
// happens on the configured interval, so raising the interval still cuts function-call usage, which
// is the point of the knob. The supervisor's own cadence is a fixed floor — it can't read the
// runtime interval (the same reason the cron can't), so at very long intervals the supervisor
// itself becomes the dominant cost. 5 minutes trades that floor against bootstrap/heal latency.
crons.interval('Ensure PostHog flag refresh loop is running', { minutes: 5 }, internal.lib.ensureRefreshLoop, {})

export default crons
