# Cloudflare Workers with Hono and Vite

This example demonstrates how to use Cloudflare Workers with Hono, Vite, and the PostHog Rollup plugin for source map uploads.

## Setup

```bash
pnpm install
pnpm run dev
```

## PostHog Source Maps

This example uses `@posthog/rollup-plugin` to upload source maps to PostHog for error tracking. Set these environment variables before building:

```bash
export POSTHOG_PERSONAL_API_KEY=your_personal_api_key
export POSTHOG_PROJECT_ID=your_project_id
export POSTHOG_API_HOST=https://us.i.posthog.com  # optional, defaults to US cloud
```

## Deploy

```bash
pnpm run deploy
```

## Cloudflare Types

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```bash
pnpm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiating `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```
