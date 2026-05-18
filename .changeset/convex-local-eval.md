---
'@posthog/convex': major
---

Feature flags are now evaluated **locally** in the Convex runtime instead of via a per-call action to PostHog. Your app schedules a cron that calls `posthog.refreshFlagDefinitions(ctx)` on whatever interval suits you; the component fetches `/flags/definitions`, caches the result in a Convex table, and feature flag methods read from that cache and evaluate flags in-process. Methods work in queries (not just actions) and benefit from Convex's reactivity — a query reading a flag re-runs automatically when definitions change.

**Setup:** pass the keys through `new PostHog(components.posthog, { apiKey, personalApiKey, host })` in your `convex/posthog.ts`. Convex components run in an isolated env namespace, so the client captures the keys at construction time and forwards them to the component when `refreshFlagDefinitions(ctx)` is called. Add a `convex/crons.ts` that schedules `posthog.refreshFlagDefinitions(ctx)` — see the README for the exact shape.

Two evaluation paths in this release. Pick the one that fits the flag:

- **Local** (`getFeatureFlag`, `isFeatureEnabled`, `getFeatureFlagPayload`, `getFeatureFlagResult`, `getAllFlags`, `getAllFlagsAndPayloads`) — query/mutation/action context, no per-call round trip, reactive. Requires `personalApiKey`. Returns `null`/`undefined` when local eval can't reach a verdict (experience continuity, static cohorts, the `is_not_set` operator, or properties you don't pass in).
- **Remote** (`evaluateFlag`, `evaluateFlagPayload`, `evaluateAllFlags`) — action context only. Hits PostHog's `/flags` endpoint directly via `posthog-node`'s `evaluateFlags`. No `personalApiKey` needed. Handles every flag.

**Breaking changes** in this major release:

- Feature flag methods (`getFeatureFlag`, `isFeatureEnabled`, `getFeatureFlagPayload`, `getFeatureFlagResult`, `getAllFlags`, `getAllFlagsAndPayloads`) now accept any context with `runQuery` (queries, mutations, or actions) instead of requiring an action context.
- Methods return `undefined` (or empty objects for the all-flags methods) when local evaluation can't reach a verdict. They no longer fall back to a server `/flags` request.
- The `sendFeatureFlagEvents` option has been removed; with local evaluation there is no server-side `/flags` call to emit those events.
- The component now declares a `flagDefinitions` table — re-deploy the component to apply the schema change.
- The component no longer ships its own cron. Consumers schedule the refresh themselves via `convex/crons.ts`, which makes the polling interval explicit and gives the parent app's env vars a way to reach the action.
