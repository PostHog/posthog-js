# Next.js Edge middleware with `posthog-node/edge`

Captures an event in Edge middleware before serving a minimal page. This demonstrates
custom SDK calls, not the `@posthog/next` ingestion-proxy integration.

**This example deliberately uses Next.js 15.** Its `middleware.ts` runs on Edge by
default. Next.js 16's replacement `proxy.ts` runs on Node.js and is not an Edge example.

## Run

First generate local SDK tarballs as described in [the examples guide](../README.md).
Then, in this directory:

```sh
pnpm install
cp .env.example .env.local
# Set your PostHog project API key and ingestion host in .env.local.
pnpm dev
```

Visit `http://localhost:3000/` and look for `nextjs_edge_middleware_request` in PostHog's
live events. Use `https://eu.i.posthog.com` for EU projects. The matcher only tracks `/`,
not static assets or API calls.

```sh
pnpm check-types
pnpm build
pnpm start
```

Set the same environment variables on your hosting provider. Deployment must support
Next.js 15 Edge middleware. For a standalone copy, remove the shared `pnpmfile` setting
and install `posthog-node` 5.39.2 or later instead of local tarballs. Earlier versions can
finish `flush()` before `capture()` has queued the event.

## Request lifetime

A client is created per request with `flushInterval: 0`, so there is no background flush
timer or shared event queue. `NextFetchEvent.waitUntil` keeps the flush alive after
`NextResponse.next()`; failures are logged without interrupting the page response.
Delivery remains best-effort within the platform's lifetime limits.

Replace `example-user` with an ID from your authenticated session and honor your application's
consent requirements. The example intentionally omits query strings and headers. It does
not add browser analytics or replay; use the browser SDK separately for those capabilities.
