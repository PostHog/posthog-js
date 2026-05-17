<p align="center">
  <img alt="@posthog/convex" src="https://raw.githubusercontent.com/PostHog/posthog/master/frontend/public/hedgehog/heart-hog.png" width="200">
</p>

<h1 align="center">@posthog/convex</h1>

<p align="center">
  PostHog analytics and feature flags for your Convex backend.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@posthog/convex"><img src="https://badge.fury.io/js/@posthog%2Fconvex.svg" alt="npm version"></a>
</p>

## 🦔 What is this?

The official [PostHog](https://posthog.com) component for [Convex](https://convex.dev). Capture events, identify users, manage groups, and evaluate feature flags — all from your queries, mutations, and actions.

Found a bug? Feature request? [File it here](https://github.com/PostHog/posthog-js/issues).

## 🚀 Quick Start

Install the package:

```sh
pnpm add @posthog/convex
```

Register the component in your `convex/convex.config.ts`:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import posthog from "@posthog/convex/convex.config.js";

const app = defineApp();
app.use(posthog);

export default app;
```

Set your PostHog credentials on your Convex deployment:

```sh
npx convex env set POSTHOG_API_KEY phc_your_project_api_key
npx convex env set POSTHOG_HOST https://us.i.posthog.com
```

To enable local feature flag evaluation, also set a [feature flags secure API key](https://posthog.com/docs/feature-flags/local-evaluation#step-1-find-your-feature-flags-secure-api-key) (`phs_…`) with read access to feature flags:

```sh
npx convex env set POSTHOG_PERSONAL_API_KEY phs_your_feature_flags_secure_api_key
```

> Personal API keys (`phx_…`) also still work for local evaluation, but PostHog recommends the project-scoped feature flags secure API key going forward.

Create a `convex/posthog.ts` file to initialize the client. Read the keys from `process.env` and pass them to the constructor — the client captures them and forwards them to component actions as needed:

```ts
// convex/posthog.ts
import { PostHog } from "@posthog/convex";
import { components } from "./_generated/api";

export const posthog = new PostHog(components.posthog, {
  apiKey: process.env.POSTHOG_API_KEY,
  personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY,
  host: process.env.POSTHOG_HOST,
});
```

Schedule a cron in your own `convex/crons.ts` that refreshes the flag definitions on whatever interval suits you. The client class captures the keys you passed in `posthog.ts` and forwards them automatically:

```ts
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { posthog } from "./posthog";

export const refreshPosthogFlags = internalAction({
  args: {},
  handler: async (ctx) => {
    await posthog.refreshFlagDefinitions(ctx);
  },
});

const crons = cronJobs();
crons.interval(
  "refresh posthog feature flag definitions",
  { minutes: 1 },
  internal.crons.refreshPosthogFlags
);

export default crons;
```

That's the whole setup — feature flag methods will start returning live values on the next cron tick, or you can call `posthog.refreshFlagDefinitions(ctx)` from an action whenever you want an immediate refresh.

## 📊 Capturing Events

Import `posthog` from your setup file and call methods directly:

```ts
// convex/myFunctions.ts
import { posthog } from "./posthog";
import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const createUser = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const userId = await ctx.db.insert("users", { email: args.email });

    await posthog.capture(ctx, {
      distinctId: userId,
      event: "user_created",
      properties: { email: args.email },
    });

    return userId;
  },
});
```

### capture

Capture an event. Works in mutations and actions.

```ts
await posthog.capture(ctx, {
  distinctId: "user_123",
  event: "purchase_completed",
  properties: { amount: 99.99, currency: "USD" },
  groups: { company: "acme-corp" },
});
```

Options: `distinctId`, `event`, `properties`, `groups`, `sendFeatureFlags`, `timestamp`, `uuid`, `disableGeoip`.

### identify

Set user properties.

```ts
await posthog.identify(ctx, {
  distinctId: "user_123",
  properties: { name: "Jane Doe", plan: "pro" },
});
```

### groupIdentify

Set group properties.

```ts
await posthog.groupIdentify(ctx, {
  groupType: "company",
  groupKey: "acme-corp",
  properties: { industry: "Technology", employees: 500 },
});
```

### alias

Link two distinct IDs.

```ts
await posthog.alias(ctx, {
  distinctId: "user_123",
  alias: "anonymous_456",
});
```

### captureException

Send an exception to PostHog's error tracking pipeline. Accepts an `Error`, a string, or any object with a `message` field.

```ts
try {
  await chargeCard(...);
} catch (error) {
  await posthog.captureException(ctx, {
    error,
    distinctId: "user_123",
    additionalProperties: { plan: "pro" },
  });
  throw error;
}
```

If you'd rather have **every** uncaught error from your Convex deployment forwarded to PostHog automatically — including ones you didn't explicitly wrap — wire up Convex's first-party PostHog exception reporting integration from the Convex dashboard. Setup lives at [docs.convex.dev/production/integrations/exception-reporting#configuring-posthog-error-tracking](https://docs.convex.dev/production/integrations/exception-reporting#configuring-posthog-error-tracking). Use `captureException` here for cases where you want explicit control (e.g. attaching custom `additionalProperties`); use the Convex-side integration for catch-all coverage.

All of the above methods schedule the PostHog API call asynchronously via `ctx.scheduler.runAfter`, so they return immediately without blocking your mutation or action.

## 🚩 Feature Flags

Two evaluation paths, pick the one that fits the flag:

- **Local** (`getFeatureFlag`, `isFeatureEnabled`, …) — evaluates against definitions cached by the cron. Works in **queries, mutations, and actions**, no per-call network round-trip, reactive (a query reading a flag re-runs when definitions change). Requires `POSTHOG_PERSONAL_API_KEY`. Can't handle every flag — see [the limitations](#local-evaluation--limitations) below.
- **Remote** (`evaluateFlag`, `evaluateFlagPayload`, `evaluateAllFlags`) — hits PostHog's `/flags` endpoint directly. Action-context only, no `personalApiKey` needed, handles every flag.

The local methods are documented first; remote is at the bottom of this section.

### getFeatureFlag

Get a flag's value.

```ts
import { posthog } from "./posthog";
import { query } from "./_generated/server";
import { v } from "convex/values";

export const getDiscount = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const flag = await posthog.getFeatureFlag(ctx, {
      key: "discount-campaign",
      distinctId: args.userId,
    });

    if (flag === "variant-a") {
      return { discount: 20 };
    }
    return { discount: 0 };
  },
});
```

### isFeatureEnabled

Check if a flag is enabled.

```ts
const enabled = await posthog.isFeatureEnabled(ctx, {
  key: "new-onboarding",
  distinctId: "user_123",
});
```

### getFeatureFlagPayload

Get a flag's JSON payload.

```ts
const payload = await posthog.getFeatureFlagPayload(ctx, {
  key: "pricing-config",
  distinctId: "user_123",
});
```

### getFeatureFlagResult

Get a flag's value and payload in one call.

```ts
const result = await posthog.getFeatureFlagResult(ctx, {
  key: "experiment-flag",
  distinctId: "user_123",
});
if (result) {
  console.log(result.enabled, result.variant, result.payload);
}
```

### getAllFlags

Get all flag values for a user.

```ts
const flags = await posthog.getAllFlags(ctx, {
  distinctId: "user_123",
});
```

### getAllFlagsAndPayloads

Get all flags and their payloads.

```ts
const { featureFlags, featureFlagPayloads } =
  await posthog.getAllFlagsAndPayloads(ctx, {
    distinctId: "user_123",
  });
```

All feature flag methods accept optional `groups`, `personProperties`, `groupProperties`, and `disableGeoip` options. `getAllFlags` and `getAllFlagsAndPayloads` also accept `flagKeys` to filter which flags to evaluate.

### Local evaluation — limitations

Local eval can't reach a verdict for every flag, and for those this component will return `null`. The cases:

- **Experience continuity flags.** Flags with [persist across authentication steps](https://posthog.com/docs/feature-flags/creating-feature-flags#persisting-feature-flags-across-authentication-steps) need server-side anon→identified tracking and aren't included in local eval.
- **Static cohorts.** Cohort membership for static cohorts lives only on the server.
- **Properties not passed in.** Local eval can only see what you give it. If a flag targets `email` or `$browser_version` and you don't pass those in `personProperties`, it can't resolve.
- **The `is_not_set` operator.** Local eval can't prove a property is absent — it only sees what you provide.
- **Cohorts that don't fit the local-eval shape.** Cohorts with variant overrides, non-person properties, more than one cohort in the same flag definition, nested AND/OR filters, or grouped with other conditions can't be translated for local eval. See [the PostHog docs](https://posthog.com/docs/feature-flags/local-evaluation#dynamic-cohort-restrictions) for the full list.

There are also reasons you might *not want* local eval at all, even when it's possible:

- **Low-traffic projects.** PostHog bills each `/flags/definitions` poll as 10 flag-request equivalents. For projects that evaluate fewer flags than that per polling interval, remote evaluation is cheaper.
- **Need-it-now changes.** Local eval accepts up to one polling interval of staleness (default 1 minute with our cron). For flags that must flip in well under that, you want remote eval.
- **No personal API key.** If you don't want to set `POSTHOG_PERSONAL_API_KEY`, the local methods aren't useful — there's nothing for them to read.

For any of those, use the remote-eval methods below instead.

### Remote evaluation

Sibling methods that hit PostHog's `/flags` endpoint directly. They require an **action** context (each call is a network round trip) and don't need `personalApiKey`. They handle every case local eval can't.

```ts
import { posthog } from "./posthog";
import { action } from "./_generated/server";
import { v } from "convex/values";

export const getContinuityFlag = action({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const value = await posthog.evaluateFlag(ctx, {
      key: "my-experience-continuity-flag",
      distinctId: args.userId,
      personProperties: { plan: "pro" },
    });
    return value;
  },
});
```

Three methods:

| Method | Returns |
| --- | --- |
| `posthog.evaluateFlag(ctx, args)` | `FeatureFlagValue \| null` |
| `posthog.evaluateFlagPayload(ctx, args)` | `JsonType \| null` |
| `posthog.evaluateAllFlags(ctx, args)` | `{ featureFlags, featureFlagPayloads }` |

Same option shape as the local methods (`groups`, `personProperties`, `groupProperties`, `disableGeoip`, `flagKeys` on the all-flags variant). Pick local when the flag is suitable and the cost of `/flags/definitions` polling is justified; pick remote when it isn't.

## 📦 Example

See the [example app](../../examples/example-convex/) for a working demo.

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for package-specific development instructions.

## 📄 License

MIT
