# example-openfeature-node

Minimal Node example of the **[`@posthog/openfeature-node-provider`](../../packages/openfeature-node-provider)** — evaluating PostHog feature flags through the standard [OpenFeature](https://openfeature.dev) server SDK, backed by `posthog-node`.

The browser equivalent lives in [`example-openfeature-web`](../example-openfeature-web) (see `@posthog/openfeature-web-provider`).

## What it shows

- Constructing a `posthog-node` client (you own its lifecycle; call `shutdown()` on exit).
- Registering `PostHogServerProvider` with `OpenFeature.setProviderAndWait(...)`.
- Async flag evaluation via the vendor-neutral OpenFeature client
  (`getBooleanValue` / `getStringValue` / `getObjectValue`), with the distinct id
  supplied per-call through the evaluation context's `targetingKey`.

See [`index.ts`](./index.ts).

## Run it

These examples install workspace packages as tarballs (see [`../README.md`](../README.md)).

1. From the repo root, build the tarballs:
   ```bash
   pnpm package:watch
   ```
2. In this folder, install and run:
   ```bash
   pnpm install
   POSTHOG_PROJECT_API_KEY=<ph_project_api_key> pnpm start
   ```
   Use real flag keys from your project.

> The lockfile is generated on first `pnpm install` per the examples tarball workflow.
