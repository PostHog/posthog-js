# Next.js 16 Edge Route Handler with `posthog-node/edge`

A minimal API-only App Router project. `app/api/hello/route.ts` explicitly sets
`export const runtime = 'edge'` and captures an event using `posthog-node/edge`.
No middleware, proxy, or browser SDK is needed.

**Next.js 16.3 warns that the Edge Runtime is deprecated.** This example demonstrates
explicit Edge compatibility, not the recommended runtime for new Next.js applications.
Prefer the Node.js runtime with `posthog-node` unless you specifically need Edge.
See [Next.js's deprecation notice](https://nextjs.org/docs/messages/edge-runtime-deprecated)
and our [Next.js example](../example-nextjs), which uses `posthog-node` in
[server actions](../example-nextjs/src/app/actions.ts).

## Run

First generate local SDK tarballs as described in [the examples guide](../README.md).
Then, in this directory:

```sh
pnpm install
cp .env.example .env.local
# Set your PostHog project API key and ingestion host in .env.local.
pnpm dev
```

Visit `http://localhost:3000/api/hello` and look for `nextjs_edge_route_request` in
PostHog's live events. Use `https://eu.i.posthog.com` for EU projects.
The root `/` has no page and returns 404.

```sh
pnpm check-types
pnpm build
pnpm start
```

Set the same environment variables on a hosting provider supporting Next.js Edge Route
Handlers. For a standalone copy, remove the shared `pnpmfile` setting and install
`posthog-node` 5.39.2 or later instead of local tarballs. Earlier versions can finish
`flush()` before `capture()` has queued the event.

## Request lifetime

The client is request-scoped, with `flushInterval: 0` to disable background timers.
The handler awaits `flush()` before returning, so delivery does not depend on a
provider-specific `waitUntil`. This adds the flush duration to response latency.
Flush failures are logged without failing the response; delivery is best-effort, not durable.

Replace the demo `example-user` with an ID from your authenticated session and honor your
application's consent requirements. Only the pathname is captured, not query strings or
headers.

Next.js 16's `proxy.ts` uses Node.js, but Route Handlers can still explicitly opt into
Edge. For the older Edge middleware use case, see [the Next.js 15 example](../example-nextjs-edge-middleware).
