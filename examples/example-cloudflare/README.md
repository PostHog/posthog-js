# Cloudflare Worker with `posthog-node/edge`

A plain Worker using the explicit Edge entrypoint, without `nodejs_compat`.

## Run

First generate local SDK tarballs as described in [the examples guide](../README.md).
Then, in this directory:

```sh
pnpm install
cp .dev.vars.example .dev.vars
# Set your PostHog project API key and ingestion host in .dev.vars.
pnpm dev
```

Visit `http://localhost:8787/`. Look for `cloudflare_edge_request` in PostHog's live events.
Use `https://eu.i.posthog.com` for EU projects.

```sh
pnpm check-types
pnpm build # Bundles for workerd without deploying.
```

To deploy, run `pnpm exec wrangler secret put POSTHOG_PROJECT_API_KEY`, set the host in
`wrangler.toml`, then run `pnpm run deploy`.

For a standalone copy, remove the shared `pnpmfile` setting and install `posthog-node`
5.39.2 or later instead of local tarballs. Earlier versions can finish `flush()` before
`capture()` has queued the event.

## Request lifetime

The client is created inside each request so concurrent requests do not share a queue.
`flushInterval: 0` disables timer-based flushing; `ctx.waitUntil(posthog.flush())`
keeps delivery alive after returning the response. A failed flush is logged without
failing the response. Delivery remains best-effort within the platform's lifetime limits.
If your runtime has no `waitUntil`, await the flush before returning instead.

`example-user` is a demo ID: replace it with an ID from your authenticated session.
This example does not collect query strings or headers. Apply your application's consent
requirements before capturing. Browser autocapture and session replay still need `posthog-js`.
