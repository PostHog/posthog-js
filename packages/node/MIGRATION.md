# Migrate the Node.js SDK from 5.x.x to 6.0.0

posthog-node 6.x.x sends every event to the [capture v1](https://posthog.com/docs/api/capture-v1) endpoints, `/i/v1/analytics/events` and `/i/v1/ai/events`.

Use the top right copy page button to work through this with your agents.

You don't need to make every change on the day you upgrade your SDK. Required changes fall in these categories:

- **Before you upgrade**: you should make these changes before you upgrade your SDK to 6.x.x.
- **During your upgrade**: These are changes that you need to make in the same PR that upgrades your SDK version.
- **Follow ups**: These are changes that can come in follow up PRs because 6.x.x has limited backward compatibility for methods that are to be deprecated.

posthog-node 5.x.x keeps receiving security fixes for at least one year after the 6.0.0 release.

## Checklist

Read the checklist first, then the sections that apply to you.

**Before you upgrade**

- [ ] You send events through a reverse proxy → [Prepare your proxy](#prepare-your-proxy)
- [ ] You pass a personal API key (`phx_...`) as the project token → [Use a project token](#use-a-project-token)
- [ ] You use `@posthog/convex`, `@posthog/next`, or `@posthog/nuxt`, which depend on posthog-node 5.x.x → [Update wrapper packages](#update-wrapper-packages)
- [ ] You use `@posthog/ai`, `@posthog/mcp`, or `@posthog/openfeature-node-provider`, and your app doesn't list `posthog-node` in its own dependencies → [Update wrapper packages](#update-wrapper-packages)

**During your upgrade**

- [ ] You set `POSTHOG_CAPTURE_MODE` → [Fix removed APIs](#fix-removed-apis)
- [ ] You call `captureException()` or `captureExceptionImmediate()` from TypeScript with positional arguments after `error` → [Fix removed APIs](#fix-removed-apis)
- [ ] You read the result of `prepareEventMessage()` → [Fix removed APIs](#fix-removed-apis)
- [ ] You rely on `flush()` rejecting when delivery fails → [Update error handling](#update-error-handling)
- [ ] You listen for the `'error'` event and inspect the error's type or fields → [Update error handling](#update-error-handling)
- [ ] You read event content from the SDK's debug log, or alert on SDK log text → [Update error handling](#update-error-handling)
- [ ] You send AI events with `captureAi()` and tune the AI queue, timeout, or compression → [Route AI events](#route-ai-events)
- [ ] You set `$is_server`, `$geoip_disable`, or feature flag properties on events, in context, or with `register()`, and expect the SDK's value to win → [Check property precedence](#check-property-precedence)
- [ ] You use `sendFeatureFlags` together with a `before_send` hook that drops events or edits `groups` or `sendFeatureFlags` → [Review before_send hooks](#review-before_send-hooks)
- [ ] Your `before_send` hook returns a new message instead of the one it gets → [Review before_send hooks](#review-before_send-hooks)
- [ ] You turn person processing off with `registerOptions()`, `register({ $process_person_profile: false })`, or context options or properties, and expect it to apply to identify-style events, or build or rename an identify-style event in `before_send` → [Identify-style events](#identify-style-events)
- [ ] You send distinct IDs over 200 UTF-8 bytes → [Fix identity calls](#fix-identity-calls)
- [ ] You set `$lib` or `$lib_version` → [Check SDK identity](#check-sdk-identity)
- [ ] You send a `$session_id` or `$window_id` that isn't a string → [Check dropped events](#check-dropped-events)
- [ ] You send event names over 200 UTF-8 bytes → [Check dropped events](#check-dropped-events)
- [ ] You reuse one event `uuid` for more than one event → [Check event IDs](#check-event-ids)
- [ ] You set `$exception_level` or another reserved exception property in `captureException()` properties → [Check exceptions](#check-exceptions)

**Follow ups**

- [ ] You set `$process_person_profile`, `$cookieless_mode`, `$ignore_sent_at`, or `$product_tour_id` as a property → [Move to event options](#move-to-event-options)
- [ ] You send `$ai_` events with `capture()` or `captureImmediate()` instead of `captureAi()` → [Send AI events with captureAi](#send-ai-events-with-captureai)
- [ ] You call `captureException()` or `captureExceptionImmediate()` from JavaScript with positional arguments after `error` → [Move captureException arguments](#move-captureexception-arguments)

## Before you upgrade

### Prepare your proxy

6.x.x sends events to these endpoints:

| Method                                                                                          | Endpoint                 |
| ----------------------------------------------------------------------------------------------- | ------------------------ |
| `capture`, `identify`, `alias`, `groupIdentify`, `captureException` and the other event methods | `/i/v1/analytics/events` |
| `captureAi`, `captureAiImmediate`, and `@posthog/ai` on posthog-node 6.x.x                      | `/i/v1/ai/events`        |

`captureImmediate` also sends to `/i/v1/analytics/events`.

If you self-host PostHog, see the [self-host docs](https://posthog.com/docs/self-host).

An endpoint that isn't served drops every event sent to it. A `404` that lasts through every retry can mean the deployment has no capture v1 route.

If you send events through your own reverse proxy, update it before you upgrade:

- **Forward both routes.** Forward `/i/v1/analytics/events` and `/i/v1/ai/events` to PostHog.
- **Pass `Authorization` through.** Pass `Authorization` through unchanged when it starts with `Bearer phc_`, `Bearer phs_`, or `Bearer phx_`. `phc_` is the project token, which is no longer in the request body, and PostHog answers `401` without it. `phs_` and `phx_` are the secret key the SDK sends for local feature flag evaluation and remote config.
- **Allow older keys.** Also allow the exact `Bearer <key>` value of an older key without one of these prefixes.
- **Strip other values.** Strip any other `Authorization` value, such as session tokens your app adds to its own requests. See the [proxy reference](https://posthog.com/docs/advanced/proxy/proxy-reference).
- **Pass the other headers through.** Pass every `PostHog-*` header, `Content-Type`, `Content-Encoding`, and `User-Agent` through unchanged. PostHog answers `400` without them, and the batch fails.
- **Accept request bodies up to 20 MB.** AI requests are often larger than 1 MB, the default limit in nginx and ingress-nginx.
- **Pass the capture response through.** A proxy that answers the capture path with its own `200` loses the batch. See unreadable `2xx` responses in [Update error handling](#update-error-handling).

5.x.x halved a batch and retried it when it got a `413`. 6.x.x doesn't split batches. A `413` fails the whole batch, and the events are lost.

Raise the proxy's body limit before you upgrade.

PostHog's managed reverse proxy already does all of this. See the [proxy guides](https://posthog.com/docs/advanced/proxy).

A capture request follows only `307` and `308` redirects, and only to the same origin (scheme, host, and port) as `host`, at most 5 times. It resends the same body and headers.

Any other redirect fails the batch without a retry. If a proxy redirects capture requests to another host, set `host` to the final host.

Capture requests call `fetch` with `redirect: 'manual'`, including a `fetch` you pass in the client options. A custom `fetch` must return `3xx` responses unchanged.

Feature flag requests are unchanged.

### Use a project token

A personal API key (`phx_...`) passed as the project token now disables the client. Capture rejects personal API keys.

A missing or empty project token disables the client too, as in 5.x.x. Either case logs one error, which never includes the key.

A disabled client sends nothing. To build one on purpose, for example in tests, pass `disabled: true`.

### Update wrapper packages

Each wrapper package works with these posthog-node versions:

| Package                                             | Works with posthog-node |
| --------------------------------------------------- | ----------------------- |
| `@posthog/ai`                                       | 5.x.x and 6.x.x         |
| `@posthog/mcp`                                      | 5.x.x and 6.x.x         |
| `@posthog/openfeature-node-provider`                | 5.x.x and 6.x.x         |
| `@posthog/convex`, `@posthog/next`, `@posthog/nuxt` | 5.x.x                   |

On 6.x.x, `@posthog/ai` sends AI events with `captureAi()`. `@posthog/openfeature-node-provider` uses only the feature flag APIs.

`@posthog/convex`, `@posthog/next`, and `@posthog/nuxt` have posthog-node 5.x.x as a dependency. Check each package's changelog for posthog-node 6.x.x support.

Upgrade `@posthog/ai` and `@posthog/mcp` to a version that accepts posthog-node 6.x.x before or together with posthog-node.

These versions accept both posthog-node 5.x.x and 6.x.x. If your app doesn't list `posthog-node` in its own dependencies, upgrading `@posthog/ai` or `@posthog/mcp` can install posthog-node 6.x.x.

`@posthog/openfeature-node-provider` accepts any posthog-node from 5.21.2, so installing it fresh can install posthog-node 6.x.x too.

List `posthog-node` in your dependencies so you choose when to move to 6.x.x.

## During your upgrade

### Fix removed APIs

6.x.x removes or changes these APIs:

| 5.x.x                                              | 6.x.x             |
| -------------------------------------------------- | ----------------- |
| `POSTHOG_CAPTURE_MODE`                             | Not read          |
| `CaptureV1Error`                                   | `CaptureError`    |
| `captureException()` positional arguments          | An options object |
| `captureExceptionImmediate()` positional arguments | An options object |
| `prepareEventMessage()` nested result              | A flat message    |
| `fetchRetryDelay` for capture                      | Ignored           |

6.x.x doesn't read the `POSTHOG_CAPTURE_MODE` environment variable. Capture v1 is the only path. Each client logs one warning when it is created with the variable set.

`CaptureV1Error` was the error name in capture v1 mode. `CaptureError` is exported from `posthog-node`. There is no alias.

In 5.x.x `fetchRetryDelay` set capture retry waits. Capture now ignores it. See [Update error handling](#update-error-handling).

The 5.x.x signatures were `captureException(error, distinctId, properties, uuid, flags)` and `captureExceptionImmediate(error, distinctId, properties, flags)`. In 6.x.x both methods take `(error, { distinctId, properties, options, uuid, flags, level })`.

JavaScript positional calls still work in 6.x.x. TypeScript callers must use the options object.

`captureException()` and `captureExceptionImmediate()` take an options object after `error`:

```ts
// 5.x.x
posthog.captureException(error, 'user_123', { endpoint: '/api/users' })

// 6.x.x
posthog.captureException(error, {
  distinctId: 'user_123',
  properties: { endpoint: '/api/users' },
  level: 'warning',
})
```

In 5.x.x `prepareEventMessage()` returned `{ distinctId, event, properties, options: { uuid, timestamp, disableGeoip } }`. In 6.x.x it returns a flat message, `{ distinctId, event, properties, options, uuid, timestamp, disableGeoip }`, and `options` holds the event options.

`prepareEventMessage()` returns `uuid`, `timestamp`, and `disableGeoip` at the top level:

```ts
// 5.x.x
const { properties, options } = await posthog.prepareEventMessage(message)
const uuid = options.uuid

// 6.x.x
const { properties, options, uuid, timestamp, disableGeoip } = await posthog.prepareEventMessage(message)
// options is now the event options, such as { process_person_profile: false }
```

The result is built in the same order as a real event, including `before_send`. It isn't exactly what is sent.

`$session_id` and `$window_id` stay in `properties`. The SDK moves them only when it sends the event.

`prepareEventMessage()` still rejects with `null` when `before_send` drops the event.

### Update error handling

Capture v1 returns a result for every event, even when the request succeeds. An event can be dropped inside a `2xx` response, for example when it's over a product quota.

6.x.x reports those events as failures. When the whole request is over the billing limit, capture answers `402`, which fails the batch without a retry.

`flush()` no longer rejects when delivery fails. `shutdown()` and `captureImmediate()` still resolve, as in 5.x.x.

Every delivery failure arrives on the `'error'` event as a `CaptureError`:

```ts
import { PostHog, CaptureError } from 'posthog-node'

const posthog = new PostHog('<project_api_key>', { host: 'https://us.i.posthog.com' })

posthog.on('error', (error) => {
  if (error instanceof CaptureError) {
    // error.endpoint: '/i/v1/analytics/events' or '/i/v1/ai/events'
    // error.requestId: the PostHog-Request-Id of the failed request, or '' for a local drop
    // error.drops: [{ uuid, details }] for events that were dropped
    // error.retryExhausted: uuids still unsent when retries ran out, or lost with a failed request
    // error.cause: the underlying HTTP or network error, when the whole request failed
  }
})
```

- **Drop reasons.** `details` names the reason, for example a capture result such as `invalid_options` or `duplicate_event_uuid`, or a local reason: `queue full`, `event too large`, `invalid event`, or `unserializable event`.
- **Local drop reports.** A local drop report lists at most 100 UUIDs. Its message carries the full count.
- **Events with no result.** An event with no result in a `2xx` response counts as delivered.
- **Unreadable `2xx` responses.** A `2xx` response whose body isn't JSON, or has no `results` object, fails the whole batch. The SDK doesn't resend it, and `'error'` lists its events in `retryExhausted`.
- **No `'error'` listener.** The SDK logs one warning per failed batch, for example `[PostHog] 3 event(s) were not delivered to /i/v1/analytics/events: 3 failed with HTTP 400`. The line never contains event content, UUIDs, or the server's response text.
- **Raw errors.** 5.x.x emitted the raw HTTP or network error. Update any code or log-based alerts that match the old errors.

The SDK retries `404`, `408`, `429`, `500`, `502`, `503`, and `504` responses and network errors. Every other status fails the batch at once.

5.x.x retried `408`, `429`, and every `5xx`, but not `404`. A proxy in front of capture can return `404` or `429`.

- **`captureMaxRetries`.** This new option sets how many times a capture request is retried after its first attempt, on both lanes. It accepts 0 to 9. When it isn't set, the SDK uses `fetchRetryCount` (default 3).
- **Waits.** Waits start at 100 ms and double each retry, up to 30 seconds. Each wait varies randomly by up to 25%, so many clients don't retry at the same moment.
- **`Retry-After`.** A `Retry-After` header sets the minimum wait, up to 30 seconds.
- **`fetchRetryDelay`.** `fetchRetryDelay` (default 3000 ms) no longer affects capture. It still applies to other requests.
- **Unanswered attempts.** Queued events whose last attempt got no response, such as after a network error or a timeout, stay in the queue and are sent again on the next flush.
- **`Immediate` methods.** An event sent with an `Immediate` method isn't kept, and `'error'` reports it in `retryExhausted`.

The SDK's own logs no longer print whole events or `before_send` error messages:

- **Debug mode.** Debug mode logs event names, UUIDs, and counts instead of whole events.
- **Hook errors.** The SDK logs a `before_send` error with the error's type, not its message.
- **HTTP errors.** When a request fails with an HTTP error status, the `CaptureError` message and its `cause` include up to 512 characters of the server or proxy response text. Debug mode logs that error.
- **Event values.** The failed-batch line, the invalid UUID warning, the invalid timestamp warning, and the session ID warning never include event values.
- **Log-based alerts.** Log-based alerts that match 5.x.x log text stop matching. Listen for `'error'` instead.

### Check queues and batches

Analytics events and `captureAi()` events use separate lanes. Each lane has its own queue, batches, and requests, so a slow or failing lane never delays or drops the other lane's events.

- **Batch size.** Batches stop before an event that would take them past about 5 MiB of serialized events. `flushAt` and `maxBatchSize` still cap the number of events.
- **Event size.** The SDK drops an analytics event larger than 10 MiB before sending and reports it through `'error'`.
- **Queue size.** `maxQueueSize` (default 10000) now applies to analytics events only. When a queue is full, the SDK drops the oldest event and reports it through `'error'`.
- **Flush and shutdown.** `flush()` and `shutdown()` send both lanes at the same time. `shutdown(shutdownTimeoutMs)` uses one deadline for both. The SDK reports events still queued at the deadline through `'error'`.
- **The `'flush'` event.** It fires once per lane.
- **Event payloads.** The `'capture'` and `'flush'` events carry each message as it was queued, before the SDK builds the capture v1 event. Its properties can still hold `$session_id` or `$window_id`, although the SDK moves them before sending.
- **Compression.** `captureCompression` (new) sets how analytics requests are compressed: `'none'`, `'gzip'`, `'deflate'`, or `'zstd'`. The default is `'gzip'`. `disableCompression: true` still turns compression off when `captureCompression` isn't set.
- **`'zstd'`.** It needs Node 22.15 or later and falls back to `'gzip'` elsewhere, including the edge build.
- **Timeout.** `requestTimeout` (default 10000 ms) still sets the timeout of analytics requests.

### Route AI events

`captureAi()` and `captureAiImmediate()` send to `/i/v1/ai/events`. In 5.x.x they sent to the legacy AI endpoint.

- **Large events.** The SDK drops an AI event whose `properties` are larger than 8 MiB before sending and reports it through `'error'`.
- **Event names.** PostHog drops an event sent with `captureAi()` whose name doesn't start with `$ai_` (`misrouted_event`), and `'error'` reports it. Send other events with `capture()`.
- **`@posthog/ai` on 6.x.x.** `@posthog/ai` sends every AI event with `captureAi()` when the client is posthog-node 6.x.x. `enableFullAiCapture` then controls only string truncation and media redaction.
- **`@posthog/ai` on 5.x.x.** Nothing changes. AI events use `capture()` unless `enableFullAiCapture` is set.
- **Missing distinct IDs.** When an `@posthog/ai` integration has no user distinct ID, it sends the event under the trace or run ID with the option `process_person_profile: false`. A `registerOptions()` or context `process_person_profile: true` then doesn't create a person for each trace.
- **Empty distinct IDs.** An empty or whitespace-only distinct ID counts as missing.

The AI lane has its own settings. It doesn't read `maxQueueSize`, `requestTimeout`, `captureCompression`, or `disableCompression`.

| Option                      | Default  |
| --------------------------- | -------- |
| `captureAiMaxQueueSize`     | 1000     |
| `captureAiRequestTimeoutMs` | 30000    |
| `captureAiCompression`      | `'gzip'` |

`captureAiMaxQueueSize` sets how many AI events are held in memory. When the queue is full, the oldest is dropped and reported.

`captureAiRequestTimeoutMs` is the timeout of each AI request, in milliseconds.

`captureAiCompression` takes the same values as `captureCompression`. We recommend `'zstd'` on Node 22.15 or later.

`captureMaxRetries`, `flushAt`, `flushInterval`, and `maxBatchSize` apply to both lanes. The SDK logs an invalid value for one of these options once and uses the default.

### Check property precedence

Each event is built in this order. Each step fills only the properties and options the steps before it left unset, except for `$lib` and `$lib_version` (see [Check SDK identity](#check-sdk-identity)):

1. The call's own `properties` and `options`, then its `groups` (merged into `$groups`) and `disableGeoip` (fills `$geoip_disable`). An identify-style event also gets its `process_person_profile` option here (see [Identify-style events](#identify-style-events)).
2. Context `properties` and `options`, from `withContext()`, `enterContext()`, or the Express, NestJS, Hono, and `instrumentRequest` integrations.
3. `register()` properties and `registerOptions()` options.
4. Values the SDK adds:
   - `$lib` and `$lib_version`, the client's library name and version (see [Check SDK identity](#check-sdk-identity))
   - `$is_server` from `isServer`
   - `$geoip_disable` from `disableGeoip`
   - The `$feature/<key>` and `$active_feature_flags` properties from `flags` or `sendFeatureFlags`
   - `$trace_id` and `$span_id` from the active OpenTelemetry span on `$exception` events
   - `options.process_person_profile = false` for an event without a distinct ID
5. `before_send`, which sees the result of steps 1 to 4 and can change or remove any of it. Nothing is added after it.

A property set to `undefined` counts as unset, and one set to `null` counts as set. A `null` or `undefined` option counts as unset, so a later step can fill it.

A `$lib` or `$lib_version` counts as unset unless it's a non-empty string.

`$set`, `$set_once`, `$groups`, and `$group_set` fill one level deep. When the call and a later step both set one of them to an object, the later step adds only the keys the call left out.

For example, `register({ $set: { plan: 'free', source: 'web' } })` and a call with `properties: { $set: { plan: 'pro' } }` send `{ plan: 'pro', source: 'web' }`. A `$set` in `register()` or a context sets those person properties on every event it reaches.

The call's `groups` merges into its own `$groups` property key by key, and `groups` wins for a key both set. 5.x.x replaced the `$groups` property with `groups`.

These changes follow from this order:

- **SDK values.** A `$lib`, `$is_server`, `$geoip_disable`, or feature flag property set on the event, in context, or with `register()` now wins over the SDK's value. In 5.x.x the SDK overwrote some of them. For `$lib_version`, see [Check SDK identity](#check-sdk-identity).
- **The `disableGeoip` setting.** `disableGeoip` still defaults to `true`, so events get `$geoip_disable: true` unless something else sets it.
- **`$geoip_disable` properties.** A `$geoip_disable` property set on the event, in context, with `register()`, or in `before_send` now wins over the client setting. For example, `register({ $geoip_disable: false })` turns GeoIP lookup on for events.
- **The `disableGeoip` argument.** A per-call `disableGeoip` argument belongs to that event, so it wins over context and `register()`. A `$geoip_disable` in the call's own `properties` still wins over it.
- **`disableGeoip: false`.** A per-call `disableGeoip: false` now sends `$geoip_disable: false`.
- **Feature flag requests.** Feature flag requests still follow the `disableGeoip` client setting.

### Review before_send hooks

Review your `before_send` hooks for the new event shape. Capture v1 sends processing options in an `options` object, next to `properties`.

A hook that returns a new message must copy `options`, or the event is sent without them. That includes the `process_person_profile: false` the SDK sets for an event without a distinct ID, so PostHog would create a person for its generated ID.

- **What the hook sees.** `before_send` now sees `$lib`, `$lib_version`, `$is_server`, `$geoip_disable`, feature flag properties, and `options`. In 5.x.x the SDK added these properties after the hook, and events had no `options`.
- **Trace and session IDs.** Trace IDs and the `$session_id` from context were already set before the hook in 5.x.x.
- **Events without a distinct ID.** The hook now sees `process_person_profile: false` in `options`.
- **Identify-style events.** For an [identify-style event](#identify-style-events), the hook sees the event's `process_person_profile`. A hook that builds an identify-style event, or renames an event to one, gets no default and must set `options.process_person_profile` itself.
- **Options.** To change an option in `before_send`, edit `options`. The first hook always gets an `options` object. With an array of hooks, each later hook gets what the previous one returned, which may have no `options`.
- **Copies.** `before_send` gets its own copy of the event's plain objects and arrays. Changing a nested value no longer changes your objects or the `register()` and context values, as it could in 5.x.x. Class instances, such as `Date`, aren't copied.
- **GeoIP and groups.** `$geoip_disable` and `$groups` are set before `before_send`, so to change them, edit the properties. Changing the message's `disableGeoip` or `groups` field has no effect.
- **Hooks that throw.** A `before_send` hook that throws drops the event, as in 5.x.x. The error log names the event and the error's type, not its message, which can hold the data the hook was removing. The SDK prints it with `console.error` even when `debug` is off. In 5.x.x it showed only with `debug` on.
- **Feature flag requests.** With `sendFeatureFlags`, the `/flags` request now runs before `before_send` and uses the event's own distinct ID, even for an event the hook then drops. Changes the hook makes to the message's `groups` or `sendFeatureFlags` no longer reach that request, as editing those objects in place could in 5.x.x.
- **Skipping the `/flags` request.** To avoid that request, call `evaluateFlags()` yourself and pass the snapshot as `flags`.

### Fix identity calls

- **Empty IDs.** An empty or whitespace-only `distinctId` counts as missing. The event uses the context distinct ID, or else a generated personless distinct ID with `options.process_person_profile = false`. 5.x.x sent a whitespace-only ID, and capture dropped the event.
- **Personless events.** The SDK's `process_person_profile: false` for a personless event fills only an unset option. An option set on the event, in context, or with `registerOptions()` wins over it.
- **Group fallback.** `groupIdentify` uses the `distinctId` you pass, then the context distinct ID, then `$<groupType>_<groupKey>`. In 5.x.x it skipped the context ID.
- **Long group IDs.** If `$<groupType>_<groupKey>` is over 200 bytes, pass `distinctId`.
- **Group sessions.** `groupIdentify` never adds the context session ID.
- **Sessions.** `identify` and `alias` now add the context session ID as `$session_id`, like `capture`. 5.x.x didn't add it to them.
- **Alias.** `alias` never takes its alias target from context or `register()`.
- **Long distinct IDs.** PostHog drops an event whose distinct ID is over 200 UTF-8 bytes (`distinct_id_too_large`), and `'error'` reports it. Legacy capture shortened the ID and kept the event.
- **Generated IDs.** Generated personless distinct IDs and event UUIDs are UUIDv7, with random bits from `crypto.getRandomValues` instead of `Math.random`.

Context and `register()` properties and options now reach `identify`, `alias`, and `groupIdentify` events, not only `capture`.

### Identify-style events

`$identify`, `$create_alias`, `$merge_dangerously`, `$groupidentify`, `$set`, and `$set_once` events create, merge, or update persons and groups.

With person processing off, PostHog drops `$identify`, `$create_alias`, `$merge_dangerously`, and `$groupidentify` events and ignores the person update of a `$set` or `$set_once` event, so these events default to `process_person_profile: true`, whichever method sends them:

- **The call's option.** The call's own `process_person_profile` option wins. If a `capture()` or `captureAi()` call has none, its `$process_person_profile` property becomes the option and is removed from the properties. The `properties` of `identify`, `setPersonProperties`, and `groupIdentify` are person and group properties, so set the option there.
- **The default.** Otherwise the option is `true`, so person processing turned off with `registerOptions()`, context options, or a `$process_person_profile: false` property in `register()` or a context doesn't reach these events. `identify`, `alias`, and `groupIdentify` keep creating and updating persons and groups, as in 5.x.x.
- **Personless IDs.** An event with a generated personless distinct ID keeps `process_person_profile: false`. The `$<groupType>_<groupKey>` ID `groupIdentify` falls back to isn't generated, so it gets `true`.
- **`null` values.** A `null` option or property counts as unset.
- **Layered properties.** Once the event has its option, the SDK removes any `$process_person_profile` property from context or `register()` before `before_send`, so the hook sees one value, and a hook that drops `options` can't bring back a layered `false`.
- **`before_send`.** `before_send` sees the option and can change it.
- **Event names.** The SDK checks the event name the call used. A `before_send` hook that builds an identify-style event, or renames an event to one, gets no default and must set `options.process_person_profile` itself.
- **Other methods.** `setPersonProperties`, `unsetPersonProperties`, and `capture()` with one of these event names get the same default. In 5.x.x they took a `$process_person_profile` property from `register()` or a context.
- **Keeping one personless.** To send an identify-style event without person processing, set `process_person_profile: false` on the call or in `before_send`, or turn off person processing for the project in PostHog.

### Check tracing headers

The Express, NestJS, Hono, and `instrumentRequest` integrations read the `X-POSTHOG-DISTINCT-ID` and `X-POSTHOG-SESSION-ID` request headers into the request context, as in 5.x.x. These headers only fill a missing distinct ID or session ID, and any client can set them, so never use them for authentication.

To stop reading them, set the new client option `captureTracingHeaders: false`:

```ts
const posthog = new PostHog('<project_api_key>', { captureTracingHeaders: false })
```

`captureTracingHeaders: false` doesn't turn off the `readPostHogCookie` fallback, which reads the session ID, and an identified user's distinct ID, from the posthog-js cookie. With the headers off, that fallback reads the cookie on every request.

To stop all request linking, set `captureTracingHeaders: false` and leave `readPostHogCookie` off (its default).

### Check SDK identity

Each event's `$lib` and `$lib_version` properties name the library that sent it. The SDK sends them in the event's properties, and PostHog stores the values the event sends.

The SDK fills them after the event, context, and `register()` values, and only counts a `$lib` or `$lib_version` that's a non-empty string:

- **Nothing sets `$lib`.** The SDK sets both to the client's library name and version: `posthog-node`, `posthog-edge`, or the name a wrapper package such as `@posthog/mcp` sets. This replaces a `$lib_version` set without `$lib`.
- **`$lib` is the client's own library name and `$lib_version` is missing.** The SDK fills in `$lib_version`.
- **`$lib` names another library.** The SDK sends both as set, even without `$lib_version`. Set both when you override them.

An app that relays events from another PostHog SDK, such as posthog-js events with `$lib: 'web'`, now keeps their `$lib` and `$lib_version`. 5.x.x replaced them with `posthog-node` and its version.

`before_send` sees the result and can change or remove either property. In 5.x.x the SDK overwrote them after `before_send`.

The client also sends its library name and version in the `PostHog-Sdk-Info` request header. PostHog uses the header only for an event whose `$lib` is missing, empty, or not a string, such as one whose `before_send` removed it.

If an event's `$lib` matches the header's library and its `$lib_version` is missing, empty, or not a string, PostHog fills in `$lib_version` from the header.

`@posthog/mcp` labels the whole client, as in 5.x.x. Every event that the client you pass to `instrument()` or `PostHogMCP` captures afterwards reports `$lib` `posthog-node-mcp` and the `@posthog/mcp` version.

In 6.x.x a `$lib` set on the event, in context, or with `register()` wins over the label. If your app also captures its own events, give MCP analytics its own client.

To find MCP traffic, filter on `$mcp_*` events rather than `$lib`.

### Check dropped events

Capture rejects a whole request when one event has a broken field. 6.x.x drops only that event before sending, so the rest of the batch is delivered.

- **Invalid names.** The SDK drops an event whose name is missing, empty, or not a string and reports it through `'error'` (`details: 'invalid event'`). 5.x.x sent it, and an object name was sent as `"[object Object]"`.
- **Invalid distinct IDs.** The SDK drops an event whose `before_send` hook leaves `distinctId` missing, `null`, or not a string the same way. 5.x.x sent it.
- **Non-string distinct IDs.** A non-string `distinctId` you pass is now turned into a string before `before_send` runs, so the hook sees `'42'`, not `42`.
- **Empty distinct IDs.** A hook that sets `distinctId` to `''` still sends the event, and PostHog drops it and reports it.
- **Malformed Unicode.** The SDK drops an event whose name, distinct ID, session ID, or window ID isn't well-formed Unicode (it has a lone surrogate) the same way.
- **Values that throw.** The SDK drops an event with a property value that throws when the SDK reads or serializes it, such as a getter or a `toJSON` method that throws. It drops that event alone and reports it through `'error'` (`details: 'unserializable event'`).
- **Reports for values that throw.** The report has no event content, and the SDK doesn't keep or log the error. When the event has no UUID yet, the report counts it but doesn't list it.
- **Values that throw in 5.x.x.** A value that threw when the client read the call's properties dropped the event and printed the raw error with `console.error`, without `'error'`. A value that threw during serialization failed the whole batch, up to `maxBatchSize` events, and emitted the raw error on `'error'`.
- **Lone surrogates in properties.** The SDK replaces a lone surrogate in a property string with U+FFFD and keeps the event. Before, one bad character failed the whole request.
- **Non-finite numbers.** The SDK sends `NaN`, `Infinity`, and `-Infinity` as `null` and keeps the event. A `NaN` under `$set` clears that person property.
- **Long names.** PostHog drops an event whose name is over 200 UTF-8 bytes (`event_name_too_long`), and `'error'` reports it. Legacy capture had no event name limit. Check your event names before you upgrade.

Capture v1 sends `$session_id` and `$window_id` as top-level event fields, not as properties. The SDK moves them out of `properties` for you:

- **A string.** The SDK sends it as given.
- **`null` and `undefined`.** They count as unset.
- **Any other value.** The SDK drops it and logs a warning with the key and the value's type, not the value. 5.x.x sent it as a property.

### Check timestamps

The SDK sends timestamps in UTC, with millisecond precision. A string timestamp with more than 3 fractional digits keeps them.

The SDK still replaces an invalid `timestamp` with the current time. It now logs a warning, which never includes the value.

### Check event IDs

- **Duplicates.** Each event needs its own UUID. Capture keeps the first event for each UUID in a request and drops the later copies. `'error'` reports each dropped copy in `CaptureError.drops` with `details: 'duplicate_event_uuid'`. 5.x.x sent every copy to legacy capture.
- **Accepted forms.** The SDK accepts a UUID with hyphens, 32 hex digits, `{...}` braces, or a `urn:uuid:` prefix, in any case. It sends the lowercase hyphenated form, and `captureAi()` returns that form.
- **Other values.** The SDK replaces any other value with a generated UUID and logs a warning that doesn't include the value. An empty string counts as unset.

### Check exceptions

- **The `level` field.** `level` sets `$exception_level`. Its TypeScript type allows `'fatal'`, `'error'`, `'warning'`, `'log'`, `'info'`, and `'debug'`, so `'warn'` doesn't compile.
- **Runtime values.** At runtime the SDK also reads `level` case-insensitively. `critical`, `alert`, and `emergency` mean `fatal`, `warn` means `warning`, `notice` means `info`, and `trace` means `debug`, as in posthog-python.
- **The default.** The default is `'error'`, and the SDK ignores an unknown value.
- **Reserved properties.** The SDK ignores exception properties it owns, such as `$exception_list` and `$exception_level`, in `properties`. Use `level` instead.
- **Reserved properties in context.** A reserved property the SDK doesn't set, such as `$exception_types`, still reaches the event when you set it in context or with `register()`, so don't set it there.

## Follow ups

### Move to event options

Capture v1 sends processing options in an `options` object, next to `properties`.

`capture`, `captureAi`, `identify`, `alias`, `groupIdentify`, `setPersonProperties`, `unsetPersonProperties`, `captureException`, and their `Immediate` variants take an `options` field:

```ts
posthog.capture({
  distinctId: 'user_123',
  event: 'signed_up',
  options: { cookieless_mode: true },
})
```

- **Every event.** `registerOptions(options)` (new) sets options on every event, like `register()` does for properties. `unregisterOptions(key)` removes one. Both return a promise.
- **One context.** `withContext()` and `enterContext()` accept `options`, which apply to every event in the context.
- **Validation.** The SDK sends options as given and no longer converts their values. PostHog validates them and drops an event whose option value it can't read, which reaches `'error'` with `details: 'invalid_options'`.
- **Boolean options.** Capture reads common forms of a boolean option value, such as the strings `"true"`, `"yes"`, `"on"`, or `"1"`, but a value it can't read drops the whole event (`invalid_options`). Pass `true` or `false`.
- **Values that aren't an object.** The SDK logs an `options` value that isn't an object as an error and ignores it. It still sends the event.

Legacy option properties still work, but an option overrides its legacy property. Use options. On an [identify-style event](#identify-style-events), a `$process_person_profile` property passed to `capture()` or `captureAi()` becomes the call's option, so it wins over context and `registerOptions()`.

| Legacy option property    | Option                    |
| ------------------------- | ------------------------- |
| `$process_person_profile` | `process_person_profile`  |
| `$cookieless_mode`        | `cookieless_mode`         |
| `$ignore_sent_at`         | `disable_skew_correction` |
| `$product_tour_id`        | `product_tour_id`         |

### Send AI events with captureAi

Send `$ai_` events with `captureAi()` or `captureAiImmediate()`, not `capture()`. Only these methods use the AI endpoint, and `@posthog/ai` on posthog-node 6.x.x already uses them.

An `$ai_` event sent with `capture()` goes to the analytics endpoint. PostHog accepts it there for now, but this is temporary.

`@posthog/ai` takes per-event options too. It takes `posthogOptions` on each wrapped provider call and on `withTracing()`. It takes `options` on the LangChain callback handler and the OpenAI Agents, Claude Agent SDK, Google ADK, and Genkit integrations:

```ts
await openai.responses.create({
  model: 'gpt-5-mini',
  input: 'Hello',
  posthogDistinctId: 'user_123',
  posthogOptions: { process_person_profile: false },
})

const handler = new LangChainCallbackHandler({ client: posthog, options: { process_person_profile: false } })
```

An event with no distinct ID still has person processing turned off, whatever its options say.

### Add MCP event options

`@posthog/mcp` takes per-event options as `eventOptions`, per call or from an `instrument()` callback, and passes them as the event's `options`. Its `beforeSend` hook gets them as `event.options` and can change them.

On 6.x.x, an MCP event from a session with no resolved identity carries the `process_person_profile: false` option, so a client `before_send` sees the anonymous default there.

As a per-event option it wins over a `registerOptions()` or context `process_person_profile`. A `process_person_profile` you set in `eventOptions` wins over the default.

### Move captureException arguments

JavaScript positional calls to `captureException()` and `captureExceptionImmediate()` still work in 6.x.x. The options object in [Fix removed APIs](#fix-removed-apis) replaces them.

The positional form logs one deprecation error per method per process. It will be removed in the next major version.

Arguments after the options object are ignored, with one warning per process.
