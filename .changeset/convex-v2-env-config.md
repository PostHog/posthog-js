---
'@posthog/convex': major
---

v2 moves credentials onto the component via [Convex 1.39's typed env-var config](https://docs.convex.dev/components/authoring#environment-variables), bundles the flag-definitions refresh cron inside the component, and renames `POSTHOG_API_KEY` → `POSTHOG_TOKEN`.

**Breaking changes:**

- Requires Convex `^1.39.0` (peer dependency bumped).
- `POSTHOG_API_KEY` env var renamed to `POSTHOG_TOKEN`, to clearly differentiate the project token (`phc_…`) from `POSTHOG_PERSONAL_API_KEY` (`phx_…` / `phs_…`).
- `apiKey`, `host`, and `personalApiKey` no longer accepted on the `PostHog` client constructor — declare them as env vars on the component instead.
- `apiKey` and `host` are no longer arguments to the component's actions (`capture`, `identify`, `evaluateFlag`, etc.). `refreshFlagDefinitions` no longer takes any arguments.
- The refresh cron is now registered inside the component and only fires when `POSTHOG_PERSONAL_API_KEY` is set — delete any app-level `convex/crons.ts` that existed only to refresh PostHog flags.
- `posthog.refreshFlagDefinitions(ctx)` renamed to `posthog.reloadFeatureFlags(ctx)` for parity with `posthog-node`.
- Local-eval methods (`getFeatureFlag`, `isFeatureEnabled`, etc.) now **throw** when `POSTHOG_PERSONAL_API_KEY` isn't configured, pointing callers at the remote `evaluateFlag` methods. They still return `undefined` during the warm-up window when PAK is set but the cron hasn't fetched yet.
- New optional `POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS` env var lets you tune the cron cadence (default 60 seconds). Raise it on free-tier dev deployments to reduce function-call usage.

See the migration guide in the README for the full diff.
