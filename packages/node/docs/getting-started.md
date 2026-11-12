# Getting started

The Node.js SDK runs on your server, on Node.js 20 or later.

To send your first event, install `posthog-node`, create one client with your project token and host from your [project settings](https://app.posthog.com/project/settings), and call `capture` with a `distinctId` and an event name.

The client queues events and sends them in batches, so call `shutdown` before your process exits, or the last events are lost.

## Install

```bash
npm install posthog-node
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

## Express request context

Call `setupExpressRequestContext(client, app)` before your routes and `setupExpressErrorHandler(client, app)` after them. Events captured during a request then include `$current_url`, `$request_method`, `$request_path`, `$user_agent`, and `$ip`. The IP comes from `x-forwarded-for` when the app runs behind a proxy.

## AWS Lambda

`flush` has no overall timeout. In a Lambda handler, race it against the time the invocation has left, and keep 100 ms to return.

```ts
const remainingMs = Math.max(0, context.getRemainingTimeInMillis() - 100)
let timer: ReturnType<typeof setTimeout> | undefined
try {
  await Promise.race([
    client.flush(),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('PostHog flush timed out')), remainingMs)
    }),
  ])
} catch (err) {
  console.error('PostHog flush failed', err)
} finally {
  clearTimeout(timer)
}
```

The timeout limits the wait. It does not cancel the flush.

## Handle SDK errors

The SDK does not throw for failures in background work. Listen for them on the client.

```ts
client.on('error', (err) => {
  console.error('PostHog had an error', err)
})
```

## Feature flag limits

`featureFlagsPollingInterval` has a minimum of `100` ms. `maxCacheSize` sets the size of the cache that deduplicates `$feature_flag_called` events per user, and defaults to `50000`.
