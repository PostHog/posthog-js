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

## Install another way

`posthog-node` needs Node.js 20.20 or later on Node.js 20, or Node.js 22.22 or later.

The wizard detects your framework, installs the SDK, and sets up your first events. Run it in your project directory:

```bash
npx -y @posthog/wizard@latest
```

To install manually, use your package manager.

npm:

```bash
npm install posthog-node@6 --save
```

Yarn:

```bash
yarn add posthog-node@6
```

pnpm:

```bash
pnpm add posthog-node@6
```

Bun:

```bash
bun add posthog-node@6
```

Set your project token before you make any calls. You can find your project token and host in your [project settings](https://app.posthog.com/project/settings).

> **Note.** Don't hardcode API keys or tokens. Set them as environment variables instead.

## Identify users

> **Identifying users is required.** Backend events need a `distinctId` that matches the ID your frontend uses when it calls `posthog.identify()`. Without it, backend events are orphaned. They can't be linked to frontend events, [session replays](https://posthog.com/docs/session-replay), [LLM traces](https://posthog.com/docs/ai-engineering), or [error tracking](https://posthog.com/docs/error-tracking).
>
> See the guide on [identifying users](https://posthog.com/docs/getting-started/identify-users) for how to set this up.

## Configure the client

Pass options as the second argument to `new PostHog()`.

| Option                        | Default                    | What it sets                               |
| :---------------------------- | :------------------------- | :----------------------------------------- |
| `host`                        | `https://us.i.posthog.com` | Your PostHog host                          |
| `flushAt`                     | `20`                       | Capture calls before a flush               |
| `flushInterval`               | `5000`                     | Milliseconds between flushes               |
| `maxBatchSize`                | `100`                      | Events per batch                           |
| `maxQueueSize`                | `10000`                    | Events held in the queue                   |
| `secretKey`                   | `null`                     | Secret API key for flags                   |
| `personalApiKey`              | `null`                     | Deprecated alias for `secretKey`           |
| `featureFlagsPollingInterval` | `30000`                    | Milliseconds between flag definition polls |
| `enableLocalEvaluation`       | `true`                     | Polling for flag definitions               |
| `requestTimeout`              | `10000`                    | Milliseconds before a call times out       |
| `captureMaxRetries`           | `3`                        | Retries of a failed capture request        |
| `captureCompression`          | `'gzip'`                   | Compression of capture requests            |
| `fetchRetryCount`             | `3`                        | Retries of a failed request                |
| `fetchRetryDelay`             | `3000`                     | Milliseconds between request retries       |
| `maxCacheSize`                | `50000`                    | Size of the `$feature_flag_called` cache   |
| `disableGeoip`                | `true`                     | GeoIP lookups off                          |
| `disabled`                    | `false`                    | Sending off                                |
| `isServer`                    | `true`                     | The `$is_server` event property            |
| `evaluationContexts`          | `undefined`                | Tags that limit which flags are evaluated  |

- **`maxBatchSize`** can't be lower than `flushAt`.
- **`maxQueueSize`** drops the oldest events when the queue is full.
- **`secretKey`** is a server-side [secret API key](https://posthog.com/docs/feature-flags/local-evaluation#step-1-get-a-secret-api-key) for local evaluation and remote config. Use a project secret API key with the `feature_flag:read` scope. Setting it starts polling for flag definitions unless `enableLocalEvaluation` is `false`, even if you don't evaluate flags.
- **`personalApiKey`** has the same permissions as `secretKey`. The option name doesn't change them.
- **`featureFlagsPollingInterval`** has a minimum of `100`.
- **`enableLocalEvaluation`** set to `false` stops the SDK polling for flag definitions, even if `secretKey` or `personalApiKey` is set.
- **`captureMaxRetries`** waits start at 100 ms and double each retry, up to 30 seconds. When it isn't set, the SDK uses `fetchRetryCount`.
- **`captureCompression`** accepts `'none'`, `'gzip'`, `'deflate'`, or `'zstd'`. `'zstd'` needs Node.js 22.15 or later and falls back to `'gzip'` elsewhere.
- **`fetchRetryDelay`** doesn't apply to capture requests.
- **`maxCacheSize`** bounds the cache that deduplicates `$feature_flag_called` events per user.
- **`disableGeoip`** set to `true` turns off GeoIP resolution for events and feature flags.
- **`disabled`** set to `true` stops the SDK sending any data. Use it in local environments.
- **`isServer`** should keep its default for server-side events. Set it to `false` when you use `posthog-node` from a client-like runtime, CLI, or desktop app, so device OS attribution is handled normally.
- **`evaluationContexts`** returns only flags with a matching evaluation context tag, or no tags at all. This cuts unneeded flag evaluations. See [evaluation contexts](https://posthog.com/docs/feature-flags/evaluation-contexts). The legacy `evaluationEnvironments` option still works.

> **Note.** In AWS Lambda or a similar serverless environment, await `client.flush()` before returning if you reuse the client across invocations. Call `shutdown()` only when you finish using that client or before your program exits. See [Run in serverless](#run-in-serverless) for an example.

## Capture events

You can send custom events using `capture`:

```js
client.capture({
  distinctId: 'distinct_id_of_the_user',
  event: 'user signed up',
})
```

> **Tip.** We recommend an `[object] [verb]` format for your event names, where `[object]` is the entity that the behavior relates to, and `[verb]` is the behavior itself. For example, `project created`, `user signed up`, or `invite sent`.

### Set event properties

You can include more information with the event in a [properties](https://posthog.com/docs/data/events#event-properties) object:

```js
client.capture({
  distinctId: 'distinct_id_of_the_user',
  event: 'user signed up',
  properties: {
    login_type: 'email',
    is_free_trial: true,
  },
})
```

### Capture pageviews

If you run a backend-only implementation and don't capture events from your frontend, you can send `$pageview` events from your backend:

```js
client.capture({
  distinctId: 'distinct_id_of_the_user',
  event: '$pageview',
  properties: {
    $current_url: 'https://example.com',
  },
})
```

## Set person properties

The Node.js SDK captures identified events by default. These create [person profiles](https://posthog.com/docs/data/persons). To set [person properties](https://posthog.com/docs/product-analytics/person-properties) in these profiles, include `$set` and `$set_once` when you capture an event:

```js
client.capture({
  distinctId: 'distinct_id_of_the_user',
  event: 'movie_played',
  properties: {
    $set: { name: 'Max Hedgehog' },
    $set_once: { initial_url: '/blog' },
  },
})
```

For the difference between `$set` and `$set_once`, see the [person properties docs](https://posthog.com/docs/product-analytics/person-properties#what-is-the-difference-between-set-and-set_once).

You can also use helper methods to set or remove person properties without hand-building `$set`, `$set_once`, or `$unset` payloads. See [person properties](https://posthog.com/docs/product-analytics/person-properties) for examples.

To capture [anonymous events](https://posthog.com/docs/data/anonymous-vs-identified-events) without person profiles, set the event's `process_person_profile` option to `false`:

```js
client.capture({
  distinctId: 'distinct_id_of_the_user',
  event: 'movie_played',
  options: {
    process_person_profile: false,
  },
})
```

## Alias users

Sometimes you want to assign multiple distinct IDs to a single user. This helps when your primary distinct ID is inaccessible. For example, a distinct ID used on the frontend may not be available in your backend.

In this case, use `alias` to assign another distinct ID to the same user.

```js
client.alias({
  distinctId: 'distinct_id',
  alias: 'alias_id',
})
```

Read the docs on [alias](https://posthog.com/docs/product-analytics/identify#alias-assigning-multiple-distinct-ids-to-the-same-user) before you use this method.

## Register super properties

Super properties are included with every event the client captures. Use `register` to set them:

```js
client.register({
  app_version: '1.2.0',
  environment: 'production',
})

// Both events include app_version and environment
client.capture({
  distinctId: 'distinct_id',
  event: 'page_viewed',
})
client.capture({
  distinctId: 'distinct_id',
  event: 'button_clicked',
})
```

If an event sets a property with the same key as a super property, the event's property takes precedence:

```js
client.register({ environment: 'production' })

// This event is captured with environment='staging'
client.capture({
  distinctId: 'distinct_id',
  event: 'page_viewed',
  properties: { environment: 'staging' },
})
```

To remove a super property, use `unregister`:

```js
client.unregister('environment')
```

Super properties are global. They apply to every event for the lifetime of the client instance. For properties that should apply only to a specific scope, such as a single request or transaction, [use contexts](#use-contexts) instead.

## Use contexts

The Node.js SDK uses nested contexts to manage state that's shared across events. Contexts add properties to multiple events, including exceptions, during a single user's interaction with your product.

You can enter a context using `withContext`:

```js
posthog.withContext(
  {
    distinctId: 'user-123',
    properties: { transactionId: 'abc123' },
  },
  () => {
    // This event is captured with the distinct ID and properties set above
    posthog.capture({ event: 'order_processed' })
  }
)
```

Contexts persist across function calls. If you enter a context, call a function, and capture an event in the called function, the event uses the properties set in the parent context:

```js
function someFunction() {
  // When called from `outerFunction`, this event is captured
  // with transactionId='abc123'
  posthog.capture({ event: 'order_processed' })
}

function outerFunction() {
  posthog.withContext({ properties: { transactionId: 'abc123' } }, () => {
    someFunction()
  })
}
```

By default, each context inherits from its parent contexts:

```js
posthog.withContext(
  {
    properties: {
      someKey: 'value-1',
      someOtherKey: 'another-value',
    },
  },
  () => {
    posthog.withContext({ properties: { someKey: 'value-2' } }, () => {
      // Captured with someKey='value-2', someOtherKey='another-value'
      posthog.capture({ event: 'order_processed' })
    })

    // Captured with someKey='value-1', someOtherKey='another-value'
    posthog.capture({ event: 'order_completed' })
  }
)
```

To turn off nesting, so the child context is fresh and has no inherited properties, pass `{ fresh: true }`.

> **Note.** Properties passed directly to `capture` calls override context state in the final event.

### Identification context

Contexts can be associated with a distinct ID:

```js
posthog.withContext({ distinctId: 'user-123' }, () => {
  // Associated with "user-123"
  posthog.capture({ event: 'order_processed' })

  // Overrides to "another-user"
  posthog.capture({
    distinctId: 'another-user',
    event: 'order_processed',
  })
})
```

### Session context

```js
posthog.withContext({ sessionId: 'some-session' }, () => {
  // Associated with session "some-session"
  posthog.capture({ event: 'image_uploaded' })

  // Overrides to "next-session"
  posthog.capture({
    event: 'image_uploaded',
    properties: { $session_id: 'next-session' },
  })
})
```

### Custom context parameters

```js
posthog.withContext({ properties: { flightNumber: 'TAC313' } }, () => {
  // Associated with flightNumber TAC313
  posthog.capture({ event: 'flight_cancelled' })

  // Overrides to PL7714
  posthog.capture({
    event: 'flight_cancelled',
    properties: { flightNumber: 'PL7714' },
  })
})
```

## Add Express context

If you use Express, add request-scoped PostHog context with the built-in middleware helpers. Register `setupExpressRequestContext` before your routes, so events captured during a request use the incoming session and distinct ID headers. Register `setupExpressErrorHandler` after your routes if you want to send Express errors to PostHog error tracking.

```ts
import express from 'express'
import { PostHog, setupExpressRequestContext, setupExpressErrorHandler } from 'posthog-node'

const app = express()
const posthog = new PostHog('<ph_project_api_key>', {
  host: 'https://us.i.posthog.com',
})

// Register before routes.
setupExpressRequestContext(posthog, app)

app.post('/checkout', (req, res) => {
  posthog.capture({ event: 'checkout_started' })
  res.json({ status: 'ok' })
})

// Optional: register after routes to capture Express errors.
setupExpressErrorHandler(posthog, app)
```

The request context middleware reads these incoming headers:

| Header                  | Context property | What it does                            |
| ----------------------- | ---------------- | --------------------------------------- |
| `x-posthog-session-id`  | `sessionId`      | Links server events to a client session |
| `x-posthog-distinct-id` | `distinctId`     | Sets the event distinct ID              |

It also adds request metadata as event properties:

- **`$current_url`** is the request URL.
- **`$request_method`** is the HTTP method, such as GET or POST.
- **`$request_path`** is the request path.
- **`$user_agent`** is the user agent string.
- **`$ip`** is the client IP, parsed from `x-forwarded-for` if you're behind a proxy.

Properties and a `distinctId` passed directly to `capture` take precedence over request context. Tracing headers are client-controlled analytics context, not authentication or authorization. Pass an authenticated `distinctId` explicitly for security-sensitive server-side decisions.

To stop reading these headers, set the client option `captureTracingHeaders: false`.

### Send headers from the client

If you use the PostHog JavaScript web SDK on the frontend, configure [`tracing_headers`](https://posthog.com/docs/libraries/js/reference) for your Express backend hostname. Browser requests then include `X-POSTHOG-SESSION-ID` and `X-POSTHOG-DISTINCT-ID`, which the Express middleware reads.

### Use Fastify

See the [Fastify guide](https://posthog.com/docs/libraries/fastify) for installation, request context, event capture, error handling, and shutdown.

## Record metrics

`posthog.metrics` records counters, gauges, and histograms with no OpenTelemetry dependency. See [Node.js metrics installation](https://posthog.com/docs/metrics/installation/nodejs) for setup and [Query what you send](https://posthog.com/docs/metrics/query-what-you-send) for how the data reads back. Pass options in the `metrics` client option:

```ts
const posthog = new PostHog('<ph_project_api_key>', {
  host: 'https://us.i.posthog.com',
  metrics: { serviceName: 'billing-worker', environment: 'production' },
})
```

The `MetricsConfig` entry in this reference lists every option and its default.

`metrics.histogram()` also accepts a `bounds` option for the bucket boundaries. The types `MetricsConfig` and `TracesConfig` come from `@posthog/core`, and `posthog-node` re-exports `MetricsConfig`.

## Trace requests

> **The span API is experimental.** Tracing is new in `posthog-node` and its API can still change in a minor release. Spans you send are kept. Only the SDK surface isn't frozen yet.

Tracing records **spans**, which are timed units of work. They show where time went in a request and how work fans out across your services. Spans created inside a request context carry the person and session they belong to, so a slow trace links back to the person who experienced it.

Tracing is off until you set the `traces` option. You don't need an OpenTelemetry dependency. For what you can do with spans once they arrive, see [Distributed tracing](https://posthog.com/docs/distributed-tracing/start-here).

```ts
import { PostHog } from 'posthog-node'

const posthog = new PostHog('<ph_project_api_key>', {
  host: 'https://us.i.posthog.com',
  traces: {
    serviceName: 'checkout-api',
  },
})
```

Set `serviceName`, because PostHog groups operations by service and span name. The `TracesConfig` entry in this reference lists every option and its default.

### Create spans

`withSpan` runs a callback with a span active for its duration and ends the span for you. A synchronous callback ends the span at return. An async callback ends it when the promise settles. Spans created inside the callback nest under it.

```ts
await posthog.withSpan('POST /checkout', async (span) => {
  span.setAttribute('plan', user.plan)

  const order = await posthog.withSpan('create-order', () => createOrder(cart))
  await posthog.withSpan('charge-card', () => stripe.charge(order))

  return order
})
```

If the callback throws or rejects, the span records the exception, its status is set to `error`, and your original error propagates unchanged.

The recorded exception includes the stack trace, which contains file paths from your server. To keep those in your process, delete `exception.stacktrace` in [`beforeSpanSend`](#scrub-and-drop-spans).

Use `startSpan` for work that can't wrap a callback. **`startSpan` doesn't make the span active.** Spans created afterwards aren't its children unless you pass `parent` explicitly, and you must call `end()` yourself.

```ts
const span = posthog.startSpan('background-sync', { attributes: { queue: 'emails' } })

// Explicitly parent a child to a span that isn't active.
const child = posthog.startSpan('send-batch', { parent: span })
child.end()

span.end()
```

`getActiveSpan()` returns the span currently active on this execution path, or `null` outside any `withSpan` callback.

### Name spans and set attributes

Span names should be low-cardinality operation names, such as `GET /users/:id`, not `GET /users/123`. Variable values belong in attributes, which accept strings, numbers, booleans, BigInt values, and arrays of those.

```ts
await posthog.withSpan('GET /users/:id', { kind: 'server' }, async (span) => {
  span.setAttributes({ 'user.id': id, 'db.rows': rows.length })
  span.addEvent('cache-miss')

  if (rows.length === 0) {
    span.setStatus('error', 'user not found')
  }
})
```

The `Span` entry in this reference documents every span method. `withSpan` and `startSpan` take the same options, which the `StartSpanOptions` entry documents.

### Trace across services

Spans use [W3C Trace Context](https://www.w3.org/TR/trace-context/), so a trace can span several services. Pass an inbound `traceparent` header as `parent` to continue a trace another service started, and send `span.traceparent()` onward when you call out.

```ts
app.post('/checkout', async (req, res) => {
  await posthog.withSpan('POST /checkout', { kind: 'server', parent: req.get('traceparent') }, async (span) => {
    const traceparent = span.traceparent()

    await fetch('https://payments.internal/charge', {
      method: 'POST',
      headers: traceparent ? { traceparent } : {},
    })

    res.json({ status: 'ok' })
  })
})
```

A missing or malformed `traceparent` starts a new trace rather than throwing.

A continued trace propagates the sampled flag it was handed, so a downstream sampler sees the decision the head service made. PostHog itself doesn't sample. A span is recorded and exported whichever way that flag is set.

### Link traces to people

Spans created inside a PostHog request context carry `posthogDistinctId` and `sessionId` attributes. These make a trace reachable from a person or a session replay recording. Use the [Express middleware](#add-express-context) or [`withContext`](#use-contexts):

```ts
posthog.withContext({ distinctId: user.id, sessionId }, async () => {
  await posthog.withSpan('POST /checkout', () => processOrder())
})
```

Spans created outside a request context omit those attributes.

### Scrub and drop spans

`beforeSpanSend` runs on every finished span before it's queued for export. Edit the span in place to strip attributes you don't want leaving your process, or return `null` to drop the span entirely.

```ts
const posthog = new PostHog('<ph_project_api_key>', {
  host: 'https://us.i.posthog.com',
  traces: {
    serviceName: 'checkout-api',
    beforeSpanSend: (span) => {
      if (span.attributes['http.route'] === '/health') return null

      delete span.attributes['http.request.header.authorization']
      return span
    },
  },
})
```

The hook sees plain values rather than the OTLP wire encoding, so `span.attributes.userId` reads as `42`, not `{ intValue: '42' }`. It runs after PostHog attaches `posthogDistinctId` and `sessionId`, so the hook can see and scrub those too.

- **Read-only IDs.** `traceId`, `spanId`, and `parentSpanId` are read-only. Rewriting them would orphan child spans that were already exported, so assignments are ignored.
- **Throwing hooks.** A hook that throws drops the span rather than exporting it without scrubbing.
- **Hook chains.** Pass an array to run several hooks left to right. The first one to return `null` stops the chain.

### The span limits

A span is capped at 128 attributes and 128 events, each event at 128 attributes, and each string attribute value at 8192 characters. The endpoint rejects a span that's too large, and a rejected span is lost whole rather than truncated. The caps bound a span before it gets there.

Past the cap, the earliest attributes and events are kept, and the number dropped is reported alongside the span. A truncated span then reads as truncated, not as quietly incomplete. The attributes PostHog attaches itself, `posthogDistinctId` and `sessionId`, don't count toward the cap and are never dropped. A span at the limit still links back to its person and session.

The event cap is absolute. An `exception` event the SDK records for you spends an ordinary slot like any other. A span that fills its events and then throws keeps its `error` status but not the exception detail, and reports the loss in `droppedEventsCount`. Raise `maxEventsPerSpan` on spans that record many events and can also fail.

The length bound reaches inside a value, including strings nested in arrays and objects, and applies to `exception.stacktrace` like any other attribute. All four caps are re-applied after `beforeSpanSend`, so a hook that enriches a span can't push it back over.

### Flush and end spans

Both `flush()` and `shutdown()` export spans that have already ended. A span still open at `flush()` is exported once it ends. A span still open at `shutdown()` is discarded, so end your spans before you shut down. `withSpan` does this for you.

If your serverless handler reuses a client across invocations, await `flush()` before returning. It flushes events and ended spans concurrently without stopping flag polling or cleaning up cache-provider resources. Reserve `shutdown()` for a disposable client or program exit. Catch and log flush failures so telemetry errors don't fail the invocation or replace an application error.

For AWS Lambda, bound the wait to `context.getRemainingTimeInMillis()` with a 100 ms safety margin:

```ts
export const handler = async (_event, context) => {
  try {
    await posthog.withSpan('handler', () => doWork())
  } finally {
    let flushTimeout: ReturnType<typeof setTimeout> | undefined
    try {
      const remainingMs = Math.max(0, context.getRemainingTimeInMillis() - 100)
      await Promise.race([
        posthog.flush(),
        new Promise((_, reject) => {
          flushTimeout = setTimeout(() => reject(new Error('PostHog flush timed out')), remainingMs)
        }),
      ])
    } catch (err) {
      console.error('PostHog flush failed', err)
    } finally {
      clearTimeout(flushTimeout)
    }
  }
}
```

This timeout limits the wait, not the delivery attempt. See [Run in serverless](#run-in-serverless) for timeout behavior and other platforms.

> **Edge runtimes.** On edge runtimes, spans nest across `await` only when you pass `parent` explicitly. The Node.js runtime tracks the active span with `AsyncLocalStorage`. The edge build can't, so after an `await`, `getActiveSpan()` returns `null` and a new span starts a new trace. Pass the span your callback receives instead:
>
> ```ts
> await posthog.withSpan('handler', async (span) => {
>   const user = await loadUser()
>   await posthog.withSpan('render', { parent: span }, () => render(user))
> })
> ```

## Use feature flags

PostHog's [feature flags](https://posthog.com/docs/feature-flags) let you safely deploy and roll back new features, and target specific users and groups with them.

There are two steps to implement feature flags in Node.js.

### Step 1: Evaluate flags once

Call `client.evaluateFlags()` once for the user, then read values from the returned snapshot.

Boolean feature flags:

```js
const flags = await client.evaluateFlags('distinct_id_of_your_user')

if (flags.isEnabled('flag-key')) {
  // Do something differently for this user
  // Optional: fetch the payload
  const matchedFlagPayload = flags.getFlagPayload('flag-key')
}
```

Multivariate feature flags:

```js
const flags = await client.evaluateFlags('distinct_id_of_your_user')
const enabledVariant = flags.getFlag('flag-key')

if (enabledVariant === 'variant-key') {
  // replace 'variant-key' with the key of your variant
  // Do something differently for this user
  // Optional: fetch the payload
  const matchedFlagPayload = flags.getFlagPayload('flag-key')
}
```

`flags.getFlag()` returns the variant string for multivariate flags, `true` for enabled boolean flags, `false` for disabled flags, and `undefined` when the evaluation didn't return the flag.

> **Note.** `client.isFeatureEnabled()`, `client.getFeatureFlag()`, `client.getFeatureFlagPayload()`, and `capture({ sendFeatureFlags: true })` still work during the migration period, but they're deprecated. Prefer `evaluateFlags()` for new code.

### Step 2: Include flags in events

If you want to use your feature flag to break down or filter events in your [insights](https://posthog.com/docs/product-analytics/insights), include feature flag information in those events. This attributes the feature flag value correctly to the event.

> **Note.** This step is only required for events captured using the server-side SDKs or the [API](https://posthog.com/docs/api).

There are two methods to include feature flag information in your events.

**Method 1: Pass the evaluated flags snapshot to `capture()`.** Pass the same `flags` object that you used for branching. This attaches the exact flag values from that evaluation and doesn't make another `/flags` request.

```js
const flags = await client.evaluateFlags('distinct_id_of_your_user')

if (flags.isEnabled('flag-key')) {
  // Do something differently for this user
}

client.capture({
  distinctId: 'distinct_id_of_your_user',
  event: 'event_name',
  flags,
})
```

By default, this attaches every flag in the snapshot using `$feature/<flag-key>` properties and `$active_feature_flags`.

To reduce event property bloat, pass a filtered snapshot:

```js
// Attach only flags accessed with isEnabled() or getFlag() before this call
client.capture({
  distinctId: 'distinct_id_of_your_user',
  event: 'event_name',
  flags: flags.onlyAccessed(),
})

// Attach only specific flags
client.capture({
  distinctId: 'distinct_id_of_your_user',
  event: 'event_name',
  flags: flags.only(['checkout-flow', 'new-dashboard']),
})
```

`onlyAccessed()` is order-dependent. If you call it before you access any flags with `isEnabled()` or `getFlag()`, no feature flag properties are attached.

**Method 2: Include the `$feature/feature_flag_name` property manually.** In the event properties, include `$feature/feature_flag_name: variant_key`:

```js
client.capture({
  distinctId: 'distinct_id_of_your_user',
  event: 'event_name',
  properties: {
    // Replace feature-flag-key with your flag key and 'variant-key' with the key of your variant
    '$feature/feature-flag-key': 'variant-key',
  },
})
```

### Evaluate specific flags

By default, `evaluateFlags()` evaluates every flag for the user. If you only need a few flags, pass `flagKeys` to request only those flags:

```js
const flags = await client.evaluateFlags('distinct_id_of_your_user', {
  flagKeys: ['checkout-flow', 'new-dashboard'],
})
```

### Send `$feature_flag_called` events

`$feature_flag_called` events tell PostHog when a user accessed a flag, and power [analytics and insights](https://posthog.com/docs/product-analytics/insights) on the flag. With `evaluateFlags()`, the SDK sends this event when you call `flags.isEnabled()` or `flags.getFlag()` for a flag.

The SDK deduplicates these events per `(distinct_id, flag, value)` in a local cache. If you reinitialize the PostHog client, the cache resets and `$feature_flag_called` events may be sent again. PostHog handles duplicates, so duplicate `$feature_flag_called` events don't affect your analytics.

`flags.getFlagPayload()` doesn't send `$feature_flag_called` events and doesn't count as an access for `onlyAccessed()`.

### Override server properties

Sometimes you want to evaluate feature flags using [person properties](https://posthog.com/docs/product-analytics/person-properties), [groups](https://posthog.com/docs/product-analytics/group-analytics), or group properties that haven't been ingested yet, or were set incorrectly earlier.

You can provide properties to evaluate the flag with by using the `personProperties`, `groups`, and `groupProperties` arguments. PostHog then uses these values to evaluate the flag, instead of any properties currently stored on your PostHog server.

```js
const flags = await client.evaluateFlags('distinct_id_of_the_user', {
  personProperties: {
    property_name: 'value',
  },
  groups: {
    your_group_type: 'your_group_id',
    another_group_type: 'your_group_id',
  },
  groupProperties: {
    your_group_type: {
      group_property_name: 'value',
    },
    another_group_type: {
      group_property_name: 'value',
    },
  },
})

if (flags.isEnabled('flag-key')) {
  // Do something differently for this user
}
```

### Override GeoIP properties

By default, a user's GeoIP properties are set using the IP address they use to capture events on the frontend. You may want to override these properties when you evaluate feature flags. A common reason is that you don't use PostHog on your frontend, so the user has no GeoIP properties.

You can override GeoIP properties by including them in the `personProperties` argument when you evaluate feature flags. This is useful when you evaluate flags on your backend and want to use the client's location instead of your server's location.

You can override these GeoIP properties:

- `$geoip_country_code`
- `$geoip_country_name`
- `$geoip_city_name`
- `$geoip_city_confidence`
- `$geoip_continent_code`
- `$geoip_continent_name`
- `$geoip_latitude`
- `$geoip_longitude`
- `$geoip_postal_code`
- `$geoip_subdivision_1_code`
- `$geoip_subdivision_1_name`
- `$geoip_subdivision_2_code`
- `$geoip_subdivision_2_name`
- `$geoip_subdivision_3_code`
- `$geoip_subdivision_3_name`
- `$geoip_time_zone`

Include any of these properties in `personProperties` alongside your other person properties.

### Set a request timeout

Set the `featureFlagsRequestTimeoutMs` option when you initialize the client to set a flag request timeout. This stops your code from being blocked if PostHog's servers are too slow to respond. The default is 3 seconds.

```js
const client = new PostHog('<ph_project_api_key>', {
  host: 'https://us.i.posthog.com',
  featureFlagsRequestTimeoutMs: 3000, // Time in milliseconds. Defaults to 3000 (3 seconds).
})
```

> **Note.** For remote config flags, see the [remote config docs](https://posthog.com/docs/feature-flags/remote-config). Remote config requires the [secret API key](https://posthog.com/docs/feature-flags/remote-config#step-1-get-a-secret-api-key), passed as the `secretKey` option.

### Evaluate flags locally

Evaluating feature flags requires a request to PostHog. You can improve performance by evaluating flags locally. PostHog then periodically requests and stores feature flag definitions locally, so you can evaluate flags without more requests.

Use local evaluation when you can, since it resolves flags faster and with fewer API calls.

For how to implement local evaluation, see the [local evaluation guide](https://posthog.com/docs/feature-flags/local-evaluation).

```js
const flags = await client.evaluateFlags('user distinct id', {
  groups: { organization: 'google' },
  groupProperties: { organization: { is_authorized: true } },
})

const flagValue = flags.getFlag('flag-key')
```

### Reload feature flags

When you initialize PostHog, you can configure the interval at which feature flags are polled. If you need to force a reload, use `reloadFeatureFlags`:

```js
await client.reloadFeatureFlags()

// Do something with feature flags here
```

### Share definitions across workers

In multi-worker or edge environments, you can implement custom caching for flag definitions using Redis, Cloudflare KV, or other storage backends. This shares definitions across workers and coordinates fetches. See the guide for [local evaluation in distributed environments](https://posthog.com/docs/feature-flags/local-evaluation/distributed-environments?tab=Node.js).

## Run experiments

[Experiments](https://posthog.com/docs/experiments/start-here) use feature flags, so the code for running an experiment is very similar to the feature flags code:

```js
const flags = await client.evaluateFlags('user_distinct_id')
const variant = flags.getFlag('experiment-feature-flag-key')

if (variant === 'variant-name') {
  // Do something
}
```

You can also [run experiments without using feature flags](https://posthog.com/docs/experiments/running-experiments-without-feature-flags).

## Use group analytics

Group analytics lets you associate an event with a group, such as a team or an organization. Read the [group analytics guide](https://posthog.com/docs/product-analytics/group-analytics) for more information.

To create a group or update its properties, use `groupIdentify`:

```js
client.groupIdentify({
  groupType: 'company',
  groupKey: 'company_id_in_your_db',
  properties: {
    name: 'Awesome Inc',
    employees: 11,
  },
  // optional distinct ID to associate event with an existing person
  distinctId: 'xyz',
})
```

`name` is a special property that the PostHog UI uses for the name of the group. If you don't set a `name` property, the group ID is used instead.

If you don't pass `distinctId`, `groupIdentify` uses the context distinct ID. With no context distinct ID, it uses `$<groupType>_<groupKey>`, which is `$company_company_id_in_your_db` in the example above. That default makes each group appear as a separate person in PostHog. To avoid this, use a consistent `distinctId`, such as `group_identifier`.

Once a group is created, pass the `groups` parameter to `capture` to capture an event with group analytics.

```js
client.capture({
  event: 'some_event',
  distinctId: 'user_distinct_id',
  groups: { company: 'company_id_in_your_db' },
})
```

## Enable GeoIP properties

By default, the SDK disregards the server IP, doesn't add GeoIP properties to events, and doesn't use them for feature flag evaluation. Server-side GeoIP properties come from your server's IP address rather than the user's, which resolves the wrong location.

To add GeoIP properties, set `disableGeoip` to `false` when you initialize the client:

```js
const posthog = new PostHog('<ph_project_api_key>', {
  host: 'https://us.i.posthog.com',
  disableGeoip: false,
})
```

This setting affects these properties:

1. `$geoip_city_name`
2. `$geoip_country_name`
3. `$geoip_country_code`
4. `$geoip_continent_name`
5. `$geoip_continent_code`
6. `$geoip_postal_code`
7. `$geoip_time_zone`
8. `$geoip_subdivision_1_code`
9. `$geoip_subdivision_1_name`
10. `$geoip_subdivision_2_code`
11. `$geoip_subdivision_2_name`

You can also turn GeoIP on or off for a single capture call:

```js
client.capture({
  distinctId: distinctId,
  event: 'your_event',
  disableGeoip: true,
})
```

## Flush or shut down

Await `shutdown()` when you finish using a disposable client or before your program exits. It stops flag polling, cleans up cache-provider resources, and attempts to flush remaining events. Don't call it after each request if you intend to reuse the client. Use `flush()` instead.

```js
await client.shutdown()
```

The optional shutdown timeout is in milliseconds and defaults to `30000` (30 seconds). Completion doesn't guarantee that PostHog received every event.

## Enable debug mode

If you don't see the events or feature flag evaluations you expect, turn on debug mode to see what's happening.

Call the `debug()` method in your code. It turns on verbose logs about the inner workings of the SDK.

```js
client.debug()
```

## Handle SDK errors

Problems with the SDK can have many causes, from an incorrectly configured API key to network issues.

The SDK doesn't throw errors for things that happen in the background, so it doesn't affect your process. You can hook into the errors to get more information:

```js
client.on('error', (err) => {
  // Whatever handling you want
  console.error('PostHog had an error!', err)
})
```

Delivery failures arrive on this event as a `CaptureError`. See the `CaptureError` entry in this reference for its fields.

## Run in serverless

The Node.js SDK queues and batches events in the background. AWS Lambda or [Vercel Functions](https://posthog.com/docs/libraries/vercel) can freeze the runtime after a handler returns, before background requests finish.

Keep a shared client outside the handler to reuse it across invocations in the same runtime. Await `flush()` before returning, including when application code throws. Catch and log flush failures so telemetry errors don't fail the invocation or replace an application error.

An explicit `flush()` has no overall timeout. This AWS Lambda example uses `context.getRemainingTimeInMillis()` and reserves 100 ms for returning from the handler:

```js
import { PostHog } from 'posthog-node'

const client = new PostHog('<ph_project_api_key>', {
  host: 'https://us.i.posthog.com',
  flushInterval: 0,
})

export const handler = async (_event, context) => {
  try {
    client.capture({
      distinctId: 'distinct_id_of_the_user',
      event: 'thing_happened',
    })

    client.capture({
      distinctId: 'distinct_id_of_the_user',
      event: 'other_thing_happened',
    })
  } finally {
    let flushTimeout
    try {
      const remainingMs = Math.max(0, context.getRemainingTimeInMillis() - 100)
      await Promise.race([
        client.flush(),
        new Promise((_, reject) => {
          flushTimeout = setTimeout(() => reject(new Error('PostHog flush timed out')), remainingMs)
        }),
      ])
    } catch (err) {
      console.error('PostHog flush failed', err)
    } finally {
      clearTimeout(flushTimeout)
    }
  }
}
```

The timeout only limits the wait. It doesn't cancel the in-flight flush, which can continue if the runtime remains active. The platform can freeze or terminate the runtime before delivery completes. On other platforms, calculate the timeout from the request deadline.

`flushInterval: 0` turns off timer-driven flushing. Setting `flushAt: 1` starts a background flush after each queued event, but neither setting waits for delivery. You still need to await `flush()` before returning.

To wait for one event's delivery attempt instead of queuing it, use `await client.captureImmediate({ distinctId: "distinct_id_of_the_user", event: "thing_happened" })`.

If you create a disposable client for one invocation, await `shutdown()` after its final work instead of `flush()`. Don't reuse that client afterward. Use awaited `shutdown()` for program exit, too. Flush and shutdown can fail or time out. Neither guarantees ingestion.

## Capture LLM usage

You can capture LLM usage and performance data by combining the `posthog-node` and `@posthog/ai` libraries. These work with LLM providers like OpenAI and Vercel's AI SDK. Learn more in the [AI observability docs](https://posthog.com/docs/ai-observability).

## Track errors

You can capture errors using the `posthog-node` library. You then see stack traces and source code, and can watch associated session recordings. Learn more in the [error tracking docs](https://posthog.com/docs/error-tracking/installation/node).
