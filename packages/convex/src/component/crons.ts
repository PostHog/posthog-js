import { cronJobs } from 'convex/server'
import { api } from './_generated/api.js'

const crons = cronJobs()

export const DEFAULT_INTERVAL_SECONDS = 60

/**
 * Parse the optional `POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS` env var into a positive integer.
 *
 * Convex component env vars are string-typed, so we coerce here. Invalid values fall back to
 * the default rather than failing the deploy — flags will still refresh on the default cadence
 * and the operator gets a warning to act on. Exported for unit testing.
 */
export function readPollingIntervalSeconds(): number {
  const raw = (process.env.POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS ?? '').trim()
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

/**
 * The refresh cron is registered only when `POSTHOG_PERSONAL_API_KEY` is configured for the
 * component. Without it, local evaluation can't run, so there's no reason to pay the per-tick
 * resource cost — particularly on idle dev deployments on the free tier.
 *
 * Toggling local evaluation on or off therefore requires redeploying the component, which
 * `npx convex env set` triggers automatically in `npx convex dev`. The cron handler itself also
 * guards against a stale registration where the env var was cleared after deploy.
 */
// Trim before checking, matching how `readConfig()` in `lib.ts` interprets the env var.
// `npx convex env set` can leave trailing whitespace; without the trim, a value like `" "` would
// register the cron but then no-op every tick once `readConfig()` rejects the trimmed-to-empty
// PAK — wasted function calls, especially painful on free-tier deployments.
if ((process.env.POSTHOG_PERSONAL_API_KEY ?? '').trim()) {
  crons.interval(
    'Refresh PostHog feature flag definitions',
    { seconds: readPollingIntervalSeconds() },
    api.lib.refreshFlagDefinitions,
    {}
  )
}

export default crons
