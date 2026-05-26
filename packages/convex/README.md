<p align="center">
  <img alt="@posthog/convex" src="https://res.cloudinary.com/dmukukwp6/image/upload/q_auto,f_auto/posthog_convex_c017c269f8.png" width="500">
</p>

<h1 align="center">@posthog/convex</h1>

<p align="center">
  PostHog analytics and feature flags for your Convex backend.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@posthog/convex"><img src="https://badge.fury.io/js/@posthog%2Fconvex.svg" alt="npm version"></a>
  <a href="https://www.convex.dev/components/posthog/convex"><img src="https://www.convex.dev/components/badge/posthog/convex" alt="Convex Component"></a>
</p>

## 🦔 What is this?

The official [PostHog](https://posthog.com) component for [Convex](https://convex.dev). Capture events, identify users, manage groups, and evaluate feature flags — all from your queries, mutations, and actions.

Found a bug? Feature request? [File it here](https://github.com/PostHog/posthog-js/issues).

## 🚀 Quick Start

Install the package (requires Convex 1.39 or newer):

```sh
pnpm add @posthog/convex
```

Register the component in your `convex/convex.config.ts` and forward the env vars from your app to the component:

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import { v } from "convex/values";
import posthog from "@posthog/convex/convex.config.js";

const app = defineApp({
  env: {
    // Required. PostHog project token (`phc_…`) — used to send events and evaluate flags remotely.
    POSTHOG_TOKEN: v.string(),
    // Optional. PostHog host. Defaults to `https://us.i.posthog.com`; use `https://eu.i.posthog.com` for EU Cloud or your self-hosted URL.
    POSTHOG_HOST: v.optional(v.string()),
    // Optional. A feature flags secure API key (`phs_…`, recommended) or personal API key (`phx_…`). Setting it enables local feature flag evaluation and starts the refresh cron.
    POSTHOG_PERSONAL_API_KEY: v.optional(v.string()),
    // Optional. Cron interval (seconds) for refreshing flag definitions. Defaults to 60. Raise it on free-tier dev deployments to reduce function-call usage.
    POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS: v.optional(v.string()),
  },
});

app.use(posthog, {
  env: {
    POSTHOG_TOKEN: app.env.POSTHOG_TOKEN,
    POSTHOG_HOST: app.env.POSTHOG_HOST,
    POSTHOG_PERSONAL_API_KEY: app.env.POSTHOG_PERSONAL_API_KEY,
    POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS: app.env.POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS,
  },
});

export default app;
```

Set your PostHog credentials on your Convex deployment:

```sh
npx convex env set POSTHOG_TOKEN phc_your_project_token
npx convex env set POSTHOG_HOST https://us.i.posthog.com
```

To enable local feature flag evaluation, also set a [feature flags secure API key](https://posthog.com/docs/feature-flags/local-evaluation#step-1-find-your-feature-flags-secure-api-key) (`phs_…`) with read access to feature flags:

```sh
npx convex env set POSTHOG_PERSONAL_API_KEY phs_your_feature_flags_secure_api_key
```

> Personal API keys (`phx_…`) also still work for local evaluation, but PostHog recommends the project-scoped feature flags secure API key going forward. This env var also gates the component's built-in refresh cron: when it's set the cron is registered at deploy time and refreshes flag definitions once a minute; when it isn't, the cron isn't registered at all so idle dev deployments don't burn function calls. The gate is evaluated at module-load (i.e. deploy) time — `npx convex dev` redeploys automatically when you set the env var, but production deployments need a manual redeploy for the cron to start.

Create a `convex/posthog.ts` file to initialize the client. Credentials live on the component, so this file is just for callbacks (identify, beforeSend):

```ts
// convex/posthog.ts
import { PostHog } from "@posthog/convex";
import { components } from "./_generated/api";

export const posthog = new PostHog(components.posthog);
```

That's the whole setup — feature flag methods will start returning live values on the next cron tick. The component refreshes flag definitions every minute when `POSTHOG_PERSONAL_API_KEY` is set. To tune the cadence (e.g. raise it to `300` for a free-tier dev deployment), set `POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS` and redeploy:

```sh
npx convex env set POSTHOG_FLAGS_POLLING_INTERVAL_SECONDS 300
```

If you call a local-eval method (`getFeatureFlag`, `isFeatureEnabled`, …) without `POSTHOG_PERSONAL_API_KEY` configured, the client throws with a pointer to the remote `evaluateFlag` / `evaluateFlagPayload` / `evaluateAllFlags` methods. While the first cron tick is still in flight (PAK is set but no definitions are cached yet) the local methods return `undefined` so your fallback path keeps working.

Need to force a refresh between cron ticks (e.g. just after creating a flag in development)? Call `posthog.reloadFeatureFlags(ctx)` from an action — same name and shape as `posthog-node`.

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
- **Cohorts that don't fit the local-eval shape.** Cohorts with variant overrides, non-person properties, more than one cohort in the same flag definition, nested AND/OR filters, or grouped with other conditions can't be translated for local eval. See [the PostHog docs](https://posthog.com/docs/feature-flags/local-evaluation#dynamic-cohort-restrictions) for the full list.

Local eval doesn't fire `$feature_flag_called` events. PostHog Experiments counts exposures off these — `posthog-node` emits them automatically on every local eval, but this component can't do the same: Convex queries are pure functions, so they can't schedule a `capture` from inside the eval path without breaking Convex's contract. If you're running an experiment against a locally-evaluated flag, fire one manually from a mutation or action:

```ts
await posthog.capture(ctx, {
  event: "$feature_flag_called",
  distinctId: userId,
  properties: {
    $feature_flag: "flag-key",
    $feature_flag_response: value,
    locally_evaluated: true,
  },
});
```

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

## 🔄 Differences from `posthog-node`

Method names and option shapes (`groups`, `personProperties`, `groupProperties`, `disableGeoip`, `flagKeys`) match `posthog-node` where they reasonably can. The differences:

- **Every method takes a Convex `ctx` first.** `posthog.capture(ctx, { … })` rather than `posthog.capture({ … })`. Required by Convex's runtime.
- **Flag methods and `captureException` use an args object instead of positional args.** `getFeatureFlag(ctx, { key, distinctId, … })` rather than `getFeatureFlag(key, distinctId, …)`. The event methods (`capture`, `identify`, `alias`, `groupIdentify`) already use args objects in `posthog-node`, so those match.
- **No `captureImmediate` / `identifyImmediate` / `aliasImmediate` variants.** All component actions use the `Immediate` paths under the hood — Convex isolates don't have a clean lifecycle hook for batching and flushing, so the queued mode is gone.
- **No `flush()` / `shutdown()`.** Same reason — there's nothing to flush.
- **Local-eval methods don't auto-fall-back to remote.** `posthog-node`'s `getFeatureFlag` quietly hits `/flags` when local eval can't reach a verdict. Ours returns `undefined` (or `null` from `getFeatureFlagResult`) and you call `evaluateFlag` / `evaluateFlagPayload` / `evaluateAllFlags` explicitly for remote. Auto-fallback would force every local-eval call into an action context (since queries can't make network calls), which would defeat the reactivity win.
- **Local-eval methods throw when `POSTHOG_PERSONAL_API_KEY` isn't configured.** `posthog-node` returns `undefined`; the throw here points you at the remote `evaluate*` methods so you can't get stuck wondering why your rollouts don't take effect.

## ⬆️ Migrating from v1

v2 moves credentials from the client constructor onto the component itself, using [Convex 1.39's typed component env vars](https://docs.convex.dev/components/authoring#environment-variables). It also bundles the refresh cron inside the component. The result is less plumbing per call site and a setup that's safe to leave running on free-tier dev deployments.

To upgrade:

1. **Bump your app's `convex` dependency** to `^1.39.0` (required for the typed component env-var API).
2. **Rename** the `POSTHOG_API_KEY` env var to `POSTHOG_TOKEN`. The new name is unambiguous: this is your PostHog project token (`phc_…`), distinct from `POSTHOG_PERSONAL_API_KEY` (the `phx_…` / `phs_…` key used for local flag evaluation).
   ```sh
   npx convex env set POSTHOG_TOKEN phc_your_project_token
   npx convex env unset POSTHOG_API_KEY
   ```
3. **Declare the env vars on your app and forward them to the component** in `convex/convex.config.ts`:
   ```ts
   const app = defineApp({
     env: {
       POSTHOG_TOKEN: v.string(),
       POSTHOG_HOST: v.optional(v.string()),
       POSTHOG_PERSONAL_API_KEY: v.optional(v.string()),
     },
   });
   app.use(posthog, {
     env: {
       POSTHOG_TOKEN: app.env.POSTHOG_TOKEN,
       POSTHOG_HOST: app.env.POSTHOG_HOST,
       POSTHOG_PERSONAL_API_KEY: app.env.POSTHOG_PERSONAL_API_KEY,
     },
   });
   ```
4. **Drop the credential options** from `new PostHog(...)`:
   ```diff
   - export const posthog = new PostHog(components.posthog, {
   -   apiKey: process.env.POSTHOG_API_KEY,
   -   personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY,
   -   host: process.env.POSTHOG_HOST,
   - });
   + export const posthog = new PostHog(components.posthog);
   ```
5. **Delete your `convex/crons.ts`** if it only existed to refresh PostHog flag definitions — the component ships its own cron now, conditionally registered only when `POSTHOG_PERSONAL_API_KEY` is set. `posthog.refreshFlagDefinitions(ctx)` was renamed to `posthog.reloadFeatureFlags(ctx)` for parity with `posthog-node`; the cron is the primary refresh path but you can still call this manually from an action when you need an immediate refresh.

Everything else — the `capture`, `identify`, `getFeatureFlag`, `evaluateFlag`, etc. APIs — is unchanged.

## 📦 Example

See the [example app](../../examples/example-convex/) for a working demo.

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for package-specific development instructions.

## 📄 License

MIT
