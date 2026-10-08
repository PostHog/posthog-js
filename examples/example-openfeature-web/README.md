# example-openfeature-web

Minimal browser example of the **[`@posthog/openfeature-web-provider`](../../packages/openfeature-web-provider)** — evaluating PostHog feature flags through the standard [OpenFeature](https://openfeature.dev) web SDK, backed by `posthog-js`.

The server equivalent lives in [`example-openfeature-node`](../example-openfeature-node) (see `@posthog/openfeature-node-provider`).

## What it shows

- Initializing `posthog-js` (you own the client lifecycle and user identity).
- Registering `PostHogWebProvider` with `OpenFeature.setProviderAndWait(...)`.
- Synchronous flag evaluation via the vendor-neutral OpenFeature client
  (`getBooleanValue` / `getStringValue` / `getObjectValue`).

See [`src/main.ts`](./src/main.ts).

## Run it

These examples install workspace packages as tarballs (see [`../README.md`](../README.md)).

1. From the repo root, build the tarballs:
   ```bash
   pnpm package:watch
   ```
2. In this folder, install and start:
   ```bash
   pnpm install
   pnpm start
   ```
3. Open the printed local URL. Set `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` in a
   `.env` file (or edit `src/main.ts`) and use real flag keys from your project.

> The lockfile is generated on first `pnpm install` per the examples tarball workflow.
