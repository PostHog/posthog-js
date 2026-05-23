---
'@posthog/convex': major
---

v2 moves credentials onto the component via [Convex 1.39's typed env-var config](https://docs.convex.dev/components/authoring#environment-variables), bundles the flag-definitions refresh cron inside the component, and renames `POSTHOG_API_KEY` → `POSTHOG_TOKEN`.

**Breaking changes:**

- Requires Convex `^1.39.0` (peer dependency bumped).
- `POSTHOG_API_KEY` env var renamed to `POSTHOG_TOKEN`.
- `apiKey`, `host`, and `personalApiKey` no longer accepted on the `PostHog` client constructor — declare them as env vars on the component instead.
- `apiKey` and `host` are no longer arguments to the component's actions (`capture`, `identify`, `evaluateFlag`, etc.). `refreshFlagDefinitions` no longer takes any arguments.
- The refresh cron is now registered inside the component and only fires when `POSTHOG_PERSONAL_API_KEY` is set — delete any app-level `convex/crons.ts` that existed only to refresh PostHog flags.
- `posthog.refreshFlagDefinitions(ctx)` removed. The cron is the only refresh path now, matching the other PostHog server SDKs.

See the migration guide in the README for the full diff.
