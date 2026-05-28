import { cronJobs } from 'convex/server'
import { api } from './_generated/api.js'
import { env } from './_generated/server.js'

const crons = cronJobs()

// Override via `POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS` for faster propagation.
export const DEFAULT_INTERVAL_SECONDS = 600

// Convex component env vars are string-typed. Invalid values warn and fall back rather than
// failing the deploy. Exported for unit testing.
export function readPollingIntervalSeconds(): number {
  const raw = (env.POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS ?? '').trim()
  if (!raw) return DEFAULT_INTERVAL_SECONDS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    console.warn(
      `[PostHog] POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS="${raw}" is not a positive integer; ` +
        `falling back to ${DEFAULT_INTERVAL_SECONDS}s.`
    )
    return DEFAULT_INTERVAL_SECONDS
  }
  return parsed
}

// Registered unconditionally — Convex forwards component env vars only at runtime, so a
// load-time gate on `POSTHOG_PERSONAL_API_KEY` sees an empty value at deploy-time module
// analysis and silently drops the cron. The handler in `lib.ts` gates at runtime instead.
crons.interval(
  'Refresh PostHog feature flag definitions',
  { seconds: readPollingIntervalSeconds() },
  api.lib.refreshFlagDefinitions,
  {}
)

export default crons
