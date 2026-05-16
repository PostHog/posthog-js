---
'@posthog/convex': major
---

Feature flags are now evaluated **locally** in the Convex runtime instead of via a per-call action to PostHog. A new component cron polls `/flags/definitions` once a minute, caches the result in a Convex table, and feature flag methods read from that cache and evaluate flags in-process. Methods now work in queries (not just actions) and benefit from Convex's reactivity — a query reading a flag re-runs automatically when definitions change.

**Setup:** set `POSTHOG_PERSONAL_API_KEY` as a Convex env var (alongside `POSTHOG_API_KEY` / `POSTHOG_HOST`). Without it, all feature flag methods return `null`/`undefined`.

**Breaking changes** in this major release:

- Feature flag methods (`getFeatureFlag`, `isFeatureEnabled`, `getFeatureFlagPayload`, `getFeatureFlagResult`, `getAllFlags`, `getAllFlagsAndPayloads`) now accept any context with `runQuery` (queries, mutations, or actions) instead of requiring an action context.
- Methods return `undefined` (or empty objects for the all-flags methods) when local evaluation can't reach a verdict — including when definitions haven't been fetched yet, when a flag uses experience continuity / static cohorts, or when required properties weren't provided. They no longer fall back to a server `/flags` request.
- The `sendFeatureFlagEvents` option has been removed; with local evaluation there is no server-side `/flags` call to emit those events.
- The component now declares a `flagDefinitions` table — re-deploy the component to apply the schema change.
