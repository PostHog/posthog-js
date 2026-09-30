# Vercel Edge Function with `posthog-node/edge`

A standalone Web Request/Response handler with `runtime: 'edge'`, without Next.js.

## Run

First generate local SDK tarballs as described in [the examples guide](../README.md).
Then, in this directory:

```sh
pnpm install
cp .env.example .env.local
# Set your PostHog project API key and ingestion host in .env.local.
pnpm vercel:dev
```

The Vercel CLI requires login/project linking. Select **Other** as the framework preset;
leave the project's build command and output directory unset. The CLI wrappers are named
`vercel:dev` and `vercel:build` so Vercel does not auto-detect and invoke them recursively.
Do not configure either wrapper as the project's Development or Build Command.
Visit `http://localhost:3000/api/hello` and look for `vercel_edge_request` in PostHog's live events.
Use `https://eu.i.posthog.com` for EU projects.

```sh
pnpm check-types
pnpm exec vercel pull --yes --environment=preview
pnpm vercel:build
```

To deploy, configure `POSTHOG_PROJECT_API_KEY` and `POSTHOG_HOST` in the Vercel project,
then run `pnpm run deploy`. Local tarballs must also be available in the build environment;
for a standalone copy outside this monorepo, remove the shared `pnpmfile` setting and
install `posthog-node` 5.39.2 or later instead. Earlier versions can finish `flush()`
before `capture()` has queued the event.

## Request lifetime

A request-scoped client avoids sharing queued events across invocations.
`flushInterval: 0` disables timer-based flushing. Vercel's `waitUntil` keeps the flush
alive after returning the response; failures are logged without failing the response.
Delivery remains best-effort within platform lifetime limits. For providers without
`waitUntil`, await the flush before returning instead.

Replace the demo `example-user` with an ID from your authenticated session and honor your
application's consent requirements. Only the pathname is captured, not query strings or
headers. This example is Vercel-specific; Deno/Supabase and other edge platforms need their
own entrypoint and environment-variable access.
