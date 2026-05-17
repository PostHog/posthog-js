# Example app — Convex backend

Demonstrates every surface of the `@posthog/convex` component end-to-end.

## Files

- `convex.config.ts` — Registers the PostHog component.
- `posthog.ts` — Initialises the `PostHog` client, reading API keys from `process.env` and passing
  them to the constructor. The client forwards them to component actions as needed.
- `crons.ts` — A one-minute cron that calls `posthog.refreshFlagDefinitions(ctx)`. The component
  no longer ships its own cron in v1 — you own the schedule.
- `example.ts` — Public mutations/queries/actions used by the demo UI to fire each method:
  - **Analytics** (mutation context): `testCapture`, `testIdentify`, `testCaptureException`,
    `testThrowError`. (`groupIdentify` and `alias` are also part of the SDK — see the package
    README for those — but omitted from the demo to keep the surface tight.)
  - **Feature flags — local eval** (query context, requires `personalApiKey`): `testGetFeatureFlag`,
    `testIsFeatureEnabled`, `testGetFeatureFlagPayload`, `testGetFeatureFlagResult`, `testGetAllFlags`,
    `testGetAllFlagsAndPayloads`.
  - **Feature flags — remote eval** (action context, hits PostHog's `/flags`): `testEvaluateFlag`,
    `testEvaluateFlagPayload`, `testEvaluateAllFlags`.
  - **Cache helpers**: `flagDefinitionsStatus` (query) and `refreshFlags` (action) — power the
    right-column "Local evaluation" card in the UI.
- `aiSdk/`, `convexAgent/` — Three approaches each for capturing `$ai_generation` events.
  See [LLM analytics for Convex](https://posthog.com/docs/llm-analytics/installation/convex).
- `schema.ts` — Empty; the demo doesn't persist anything itself.
