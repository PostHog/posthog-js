# Getting started

The Node.js SDK runs on your server, on Node.js 20 or later.

To send your first event, install `posthog-node`, create one client with your project token and host from your [project settings](https://app.posthog.com/project/settings), and call `capture` with a `distinctId` and an event name.

The client queues events and sends them in batches, so call `shutdown` before your process exits, or the last events are lost.

## Install

```bash
npm install posthog-node@~6.0
```

## Initialize

```ts
import { PostHog } from 'posthog-node'

const client = new PostHog('<ph_project_api_key>', { host: 'https://us.i.posthog.com' })
```

## Capture an event

```ts
client.capture({ distinctId: 'user_123', event: 'signed_up', properties: { plan: 'pro' } })
```

## Shut down

Flush queued events before the process exits.

```ts
await client.shutdown()
```

## Share context across calls

Wrap a request or job in `withContext()` so telemetry inside shares user and session state across function calls and `await`.

```ts
await client.withContext(
  { distinctId: 'user_123', sessionId: '0190f6d2-7c1e-7b3a-9f5e-1c2d3e4f5a6b', properties: { plan: 'pro' } },
  async () => {
    client.capture({ event: 'order_placed' })
  }
)
```

Use the built-in integrations to populate request context from incoming headers (`x-posthog-distinct-id`, `x-posthog-session-id`) and optional browser cookies (`readPostHogCookie`):

- **Express.** Call `setupExpressRequestContext(client, app)` before your routes, and `setupExpressErrorHandler(client, app)` after them.
- **NestJS.** Register `PostHogInterceptor` from `posthog-node/nestjs` globally.
- **Hono and Fetch.** Wrap handlers with `posthogHonoMiddleware(client)` or `instrumentRequest(client, request, handler)`.

Events and exceptions inherit `distinctId`, `sessionId` (`$session_id`), `properties`, and `options`, while logs and spans inherit `distinctId` and `sessionId`. Flag methods (`evaluateFlags()`, `getAllFlags()`, `getAllFlagsAndPayloads()`, and `getFeatureFlagResult()`) read `distinctId` when omitted.

Tracing headers are untrusted client data, never authentication. Pass an authenticated `distinctId` explicitly for authorization or sensitive decisions.

## Flush in short-lived runtimes

Serverless Node runtimes (AWS Lambda, Vercel Functions) can freeze as soon as a handler returns. Reuse a module-scope client across calls and await `client.flush()` before returning, or pass `waitUntil` in `PostHogOptions`.

`flush()` has no overall timeout and never rejects, so race it against your remaining handler time. Save `shutdown()` for process exit, since a shut-down client stops sending.

On Cloudflare Workers and edge runtimes (`posthog-node/edge`), create a client per request with `flushAt: 1`, `flushInterval: 0`, and `waitUntil: ctx.waitUntil.bind(ctx)`. The edge entrypoint has no `AsyncLocalStorage`, so `withContext()` doesn't propagate IDs and `withSpan()` doesn't nest across `await`. Pass `distinctId` and `{ parent: span }` explicitly instead.

## Handle background errors

Background batching, flag polling, and remote config calls never throw into your request path. Listen on the `'error'` event to catch `CaptureError`, `RemoteConfigPayloadError`, and network failures:

```ts
client.on('error', (err) => {
  console.error('PostHog error:', err)
})
```
