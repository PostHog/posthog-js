# Migrating from posthog-node 5.x to 6.0

posthog-node 6.0 sends every event through capture v1 and removes the legacy capture path.
Most apps upgrade without code changes.
Read the checklist first, then the sections that apply to you.

For background on capture v1, its options, limits and per-event results, see the [capture v1 API docs](https://posthog.com/docs/api/capture-v1) and the [capture v1 SDK guide](https://posthog.com/docs/libraries/capture-v1).

## Checklist

You need to change code or configuration if your app does any of these:

- sends events through a reverse proxy, or to a self-hosted PostHog (see [Reverse proxies and self-hosted PostHog](#reverse-proxies-and-self-hosted-posthog))
- relies on `flush()`, `shutdown()` or `captureImmediate()` rejecting when delivery fails
- listens for the `'error'` event and inspects the error's type or fields
- sets `POSTHOG_CAPTURE_MODE`
- calls `captureException()` or `captureExceptionImmediate()` with positional arguments after `error` (still works in 6.x, with a deprecation error)
- sets `$exception_level` or another reserved exception property in `captureException()` properties
- reads the result of `prepareEventMessage()`
- reuses one event `uuid` for more than one event
- passes strings such as `"true"` for `$process_person_profile`, `$cookieless_mode` or `$ignore_sent_at`
- sets `$is_server`, `$geoip_disable` or feature flag properties on events, in context or with `register()`, and expects the SDK's value to win
- sets `$lib` or `$lib_version`
- sends a `$session_id` or `$window_id` that is not a string
- passes a personal API key (`phx_...`) as the project API key
- reads event content from the SDK's debug log, or alerts on SDK log text
- sends AI events with `captureAi()` and tunes the AI queue, timeout or compression
- uses `sendFeatureFlags` together with a `before_send` hook that drops events or edits `groups` or `sendFeatureFlags`
- uses `@posthog/convex`, `@posthog/next` or `@posthog/nuxt` (stay on posthog-node 5 for now)

## Reverse proxies and self-hosted PostHog

posthog-node 6.0 sends events to new paths:

| Method                                                                                                              | Endpoint                 |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `capture`, `captureImmediate`, `identify`, `alias`, `groupIdentify`, `captureException` and the other event methods | `/i/v1/analytics/events` |
| `captureAi`, `captureAiImmediate`, and `@posthog/ai` on posthog-node 6                                              | `/i/v1/ai/events`        |

An `$ai_*` event sent with `capture()` goes to the analytics endpoint. Only `captureAi()` and `captureAiImmediate()` use the AI endpoint.

If you send events to a self-hosted PostHog, check that it serves both endpoints before you upgrade.
An endpoint that is not served drops every event sent to it.
A `404` that lasts through every retry can mean the deployment has no capture v1 route.

If you send events through your own reverse proxy, update it before you upgrade:

- Forward `/i/v1/analytics/events` and `/i/v1/ai/events` to PostHog.
- Pass `Authorization` through unchanged when it starts with `Bearer phc_`, `Bearer phs_` or `Bearer phx_`. `phc_` is the project API key, which is no longer in the request body, and PostHog answers `401` without it. `phs_` and `phx_` are the secret key the SDK sends for local feature flag evaluation and remote config. Also allow the exact `Bearer <key>` value of an older key without one of these prefixes. Strip any other `Authorization` value, such as session tokens your app adds to its own requests. See the [proxy reference](https://posthog.com/docs/advanced/proxy/proxy-reference).
- Pass every `PostHog-*` header, `Content-Type`, `Content-Encoding` and `User-Agent` through unchanged. PostHog answers `400` without them, and the batch fails.
- Accept request bodies up to 20 MB. AI requests are often larger than 1 MB, the default limit in nginx and ingress-nginx.

The body limit matters more than before. 5.x halved a batch and retried it when it got a `413`. 6.0 does not split batches: a `413` fails the whole batch, and the events are lost.
Raise the proxy's body limit before you upgrade.

PostHog's managed reverse proxy already does all of this. See the [proxy guides](https://posthog.com/docs/advanced/proxy).

### Redirects

A capture request follows only `307` and `308` redirects, and only to the same origin (scheme, host and port) as `host`, at most 5 times.
It resends the same body and headers.
Any other redirect fails the batch without a retry.
If a proxy redirects capture requests to another host, set `host` to the final host.
Feature flag requests are unchanged.

## Removed and renamed

| 5.x                                                                                                             | 6.0                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTHOG_CAPTURE_MODE` environment variable                                                                     | Not read. Capture v1 is the only path. The client logs one warning when the variable is set.                                                                                                |
| `CaptureV1Error` (the error name in capture v1 mode)                                                            | `CaptureError`, exported from `posthog-node`. There is no alias.                                                                                                                            |
| `captureException(error, distinctId, properties, uuid, flags)`                                                  | `captureException(error, { distinctId, properties, options, uuid, flags, level })`. JavaScript positional calls still work in 6.x. TypeScript callers must use the options object.          |
| `captureExceptionImmediate(error, distinctId, properties, flags)`                                               | `captureExceptionImmediate(error, { distinctId, properties, options, uuid, flags, level })`. JavaScript positional calls still work in 6.x. TypeScript callers must use the options object. |
| `prepareEventMessage()` returns `{ distinctId, event, properties, options: { uuid, timestamp, disableGeoip } }` | Returns a flat message: `{ distinctId, event, properties, options, uuid, timestamp, disableGeoip }`. `options` holds the event options.                                                     |
| `fetchRetryDelay` set capture retry waits                                                                       | Capture ignores it. See [Retries](#retries).                                                                                                                                                |

### `captureException()`

```ts
// 5.x
posthog.captureException(error, 'user_123', { endpoint: '/api/users' })

// 6.0
posthog.captureException(error, {
  distinctId: 'user_123',
  properties: { endpoint: '/api/users' },
  level: 'warning',
})
```

- The positional form logs one deprecation error per method per process. It will be removed in the next major version.
- Arguments after the options object are ignored, with one warning per process.
- `level` sets `$exception_level`. It is read case-insensitively, and `critical`, `alert` and `emergency` mean `fatal`, `warn` means `warning`, `notice` means `info` and `trace` means `debug`, as in posthog-python. The default is `'error'`, and an unknown value is ignored.
- Exception properties the SDK owns, such as `$exception_list` and `$exception_level`, are ignored in `properties`. Use `level` instead.

### `prepareEventMessage()`

```ts
// 5.x
const { properties, options } = await posthog.prepareEventMessage(message)
const uuid = options.uuid

// 6.0
const { properties, options, uuid, timestamp, disableGeoip } = await posthog.prepareEventMessage(message)
// options is now the event options, such as { process_person_profile: false }
```

The result is built in the same order as a real event, including `before_send`.
It still rejects with `null` when `before_send` drops the event.

## Errors and the `'error'` event

Capture v1 returns a result for every event, even when the request succeeds.
An event can be dropped inside a `2xx` response, for example when it is over a product quota.
6.0 reports those events as failures.
When the whole request is over the billing limit, capture answers `402`, which fails the batch without a retry.

`flush()`, `shutdown()` and `captureImmediate()` no longer reject when delivery fails.
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

- `details` names the reason, for example a capture result such as `invalid_options` or `duplicate_event_uuid`, or a local reason: `queue full`, `event too large`, `invalid event` or `unserializable event`.
- A local drop report lists at most 100 uuids. Its message carries the full count.
- An event with no result in a `2xx` response counts as delivered. A proxy that answers the capture path with its own `200` therefore reports nothing. Make sure your proxy passes the capture response through.
- With no `'error'` listener, the SDK logs one warning per failed batch, for example `[PostHog] 3 event(s) were not delivered to /i/v1/analytics/events: 3 failed with HTTP 400`. The line never contains event content, uuids or the server's response text.
- 5.x emitted the raw HTTP or network error. Update any code or log-based alerts that match the old errors.

## Retries

The SDK retries `404`, `408`, `429`, `500`, `502`, `503` and `504` responses and network errors.
Every other status fails the batch at once.
5.x retried `408`, `429` and every `5xx`, but not `404`.
A proxy in front of capture can return `404` or `429`.

- `captureMaxRetries` (new) sets how many times a capture request is retried after its first attempt, on both lanes. It accepts 0 to 9. When it is not set, the SDK uses `fetchRetryCount` (default 3).
- Waits start at 100 ms and double each retry, up to 30 seconds. Each wait varies randomly by up to 25%, so many clients do not retry at the same moment.
- A `Retry-After` header sets the minimum wait, up to 30 seconds.
- `fetchRetryDelay` (default 3000 ms) no longer affects capture. It still applies to other requests.
- Events whose last attempt got no response, such as after a network error or a timeout, stay in the queue and are sent again on the next flush.

## Lanes, batching and sizes

Analytics events and `captureAi()` events use separate lanes.
Each lane has its own queue, batches and requests, so a slow or failing lane never delays or drops the other lane's events.

- Batches stop before an event that would take them past about 5 MiB of serialized events. `flushAt` and `maxBatchSize` still cap the number of events.
- An analytics event larger than 10 MiB is dropped before sending and reported through `'error'`.
- `maxQueueSize` (default 10000) now applies to analytics events only. When a queue is full, the oldest event is dropped and reported through `'error'`.
- `flush()` and `shutdown()` send both lanes at the same time. `shutdown(shutdownTimeoutMs)` uses one deadline for both. Events still queued at the deadline are reported through `'error'`.
- The `'flush'` event fires once per lane.
- The `'capture'` and `'flush'` events carry each message as it was queued, before the SDK builds the capture v1 event. Its properties can still hold `$lib`, `$lib_version`, legacy option properties such as `$process_person_profile`, and `$session_id` or `$window_id`, although the SDK removes or moves them before sending.
- `captureCompression` (new) sets how analytics requests are compressed: `'none'`, `'gzip'`, `'deflate'` or `'zstd'`. The default is `'gzip'`. `disableCompression: true` still turns compression off when `captureCompression` is not set. `'zstd'` needs Node 22.15 or later and falls back to `'gzip'` elsewhere, including the edge build.
- `requestTimeout` (default 10000 ms) still sets the timeout of analytics requests.

## AI events

`captureAi()` and `captureAiImmediate()` send to `/i/v1/ai/events`.
In 5.x they sent to the legacy AI endpoint.

- An AI event whose `properties` are larger than 8 MiB is dropped before sending and reported through `'error'`.
- The AI lane has its own settings. It does not read `maxQueueSize`, `requestTimeout`, `captureCompression` or `disableCompression`.

  | Option                      | Default  | What it does                                                             |
  | --------------------------- | -------- | ------------------------------------------------------------------------ |
  | `captureAiMaxQueueSize`     | 1000     | AI events held in memory. When full, the oldest is dropped and reported. |
  | `captureAiRequestTimeoutMs` | 30000    | Timeout of each AI request, in milliseconds.                             |
  | `captureAiCompression`      | `'gzip'` | Same values as `captureCompression`.                                     |

- `captureMaxRetries`, `flushAt`, `flushInterval` and `maxBatchSize` apply to both lanes.
- An invalid value for one of these options is logged once, and the default is used.

`@posthog/ai` sends every AI event with `captureAi()` when the client is posthog-node 6.
`enableFullAiCapture` then controls only string truncation and media redaction.
With posthog-node 5, nothing changes: AI events use `capture()` unless `enableFullAiCapture` is set.
When an `@posthog/ai` integration has no user distinct id, it sends the event under the trace or run id with the option `process_person_profile: false`, so a `registerOptions()` or context `process_person_profile: true` doesn't create a person for each trace. An empty or whitespace-only distinct id counts as missing.

## Event options

Capture v1 sends processing options in an `options` object, next to `properties`.

- `capture`, `captureAi`, `identify`, `alias`, `groupIdentify`, `setPersonProperties`, `unsetPersonProperties`, `captureException` and their `Immediate` variants take an `options` field:

  ```ts
  posthog.capture({
    distinctId: 'user_123',
    event: 'signed_up',
    options: { cookieless_mode: true },
  })
  ```

- `registerOptions(options)` (new) sets options on every event, like `register()` does for properties. `unregisterOptions(key)` removes one. Both return a promise.
- `withContext()` and `enterContext()` accept `options`, which apply to every event in the context.
- Options are sent as given. The SDK no longer converts their values. PostHog validates them and drops an event whose option value it cannot read, which reaches `'error'` with `details: 'invalid_options'`.
- An `options` value that is not an object is logged as an error and ignored. The event is still sent.
- The legacy option properties, the `$`-prefixed properties legacy capture reads as settings, still work. They fill the matching option only when it is unset, and the SDK always removes them from `properties`. Their values are no longer converted, so pass `true` or `false`, not `"true"`.

  | Legacy option property    | Option                    |
  | ------------------------- | ------------------------- |
  | `$process_person_profile` | `process_person_profile`  |
  | `$cookieless_mode`        | `cookieless_mode`         |
  | `$ignore_sent_at`         | `disable_skew_correction` |
  | `$product_tour_id`        | `product_tour_id`         |

- An option set at any layer wins over its legacy property set at any layer. For example, `registerOptions({ cookieless_mode: true })` wins over an event's `$cookieless_mode: false` property. When you move a default to options, move the per-event overrides of that key to options too.
- A `null` or `undefined` option counts as unset, so a later layer can fill it.

## Layer order

Each event is built in this order. Each step fills only the properties and options the steps before it left unset:

1. the call's own `properties` and `options`, then its `groups` (merged into `$groups`) and `disableGeoip` (fills `$geoip_disable`)
2. context `properties` and `options`, from `withContext()`, `enterContext()` or the Express and NestJS integrations
3. `register()` properties and `registerOptions()` options
4. values the SDK adds: `$is_server` (from `isServer`), `$geoip_disable` (from `disableGeoip`), the `$feature/<key>` and `$active_feature_flags` properties (from `flags` or `sendFeatureFlags`), `$trace_id` and `$span_id` from the active OpenTelemetry span on `$exception` events, and `options.process_person_profile = false` for an event without a distinct id
5. `before_send`, which sees the result of steps 1 to 4 and can change or remove any of it. Nothing is added after it.
6. legacy option properties, which fill unset options and are then removed

A property set to `undefined` counts as unset.
`$set`, `$set_once`, `$groups` and `$group_set` fill one level deep.
When the call and a later step both set one of them to an object, the later step adds only the keys the call left out.
For example, `register({ $set: { plan: 'free', source: 'web' } })` and a call with `properties: { $set: { plan: 'pro' } }` send `{ plan: 'pro', source: 'web' }`.

These changes follow from this order:

- A `$is_server`, `$geoip_disable` or feature flag property set on the event, in context or with `register()` now wins over the SDK's value. In 5.x the SDK overwrote some of them.
- `before_send` now sees `$is_server`, `$geoip_disable`, feature flag properties, trace ids and `options`. In 5.x it ran before the SDK added them. To change an option in `before_send`, edit `options`, which is always an object.
- Review your `before_send` hooks for the new event shape. A legacy property such as `$process_person_profile` that the hook sets does not replace an option that is already set. A hook that returns a new message must copy `options`, or the event is sent without them. That includes the `process_person_profile: false` the SDK sets for an event without a distinct id, so PostHog would create a person for its generated id.
- `before_send` gets its own copy of the event's plain objects and arrays. Changing a nested value no longer changes your objects or the `register()` and context values, as it could in 5.x. Class instances, such as `Date`, are not copied.
- `$geoip_disable` and `$groups` are set before `before_send`, so to change them, edit the properties. Changing the message's `disableGeoip` or `groups` field has no effect.
- A `before_send` hook that throws drops the event, as in 5.x. The error log names the event and the error's type, not its message, which can hold the data the hook was removing.
- With `sendFeatureFlags`, the `/flags` request now runs before `before_send` and uses the event's own distinct id, even for an event the hook then drops. Changes the hook makes to the message's `groups` or `sendFeatureFlags` no longer reach that request, as editing those objects in place could in 5.x. To avoid that request, call `evaluateFlags()` yourself and pass the snapshot as `flags`.
- Context and `register()` properties and options now reach `identify`, `alias` and `groupIdentify` events, not only `capture`.

## GeoIP

`disableGeoip` still defaults to `true`, so events get `$geoip_disable: true` unless something else sets it.

- A `$geoip_disable` property set on the event, in context, with `register()` or in `before_send` now wins over the client setting. For example, `register({ $geoip_disable: false })` turns GeoIP lookup on for events.
- A per-call `disableGeoip` argument belongs to that event, so it wins over context and `register()`. A `$geoip_disable` in the call's own `properties` still wins over it.
- A per-call `disableGeoip: false` now sends `$geoip_disable: false`.
- Feature flag requests still follow the `disableGeoip` client setting.

## Identity and request context

- An empty or whitespace-only `distinctId` counts as missing. The event uses the context distinct id, or else a generated personless distinct id with `options.process_person_profile = false`. 5.x sent a whitespace-only id, and capture dropped the event.
- The SDK's `process_person_profile: false` for a personless event fills only an unset option. An option set on the event, in context or with `registerOptions()` wins over it. A `$process_person_profile: true` property no longer turns person processing back on. Set the option instead.
- `groupIdentify` uses the `distinctId` you pass, then the context distinct id, then `$<groupType>_<groupKey>`. In 5.x it skipped the context id. If `$<groupType>_<groupKey>` is over 200 bytes, pass `distinctId`.
- `groupIdentify` never adds the context session id.
- `alias` never takes its alias target from context or `register()`.
- PostHog drops an event whose distinct id is over 200 UTF-8 bytes (`distinct_id_too_large`), and `'error'` reports it. Legacy capture shortened the id and kept the event.
- Generated personless distinct ids and event uuids are UUIDv7, with random bits from `crypto.getRandomValues` instead of `Math.random`.

### Tracing headers

The Express and NestJS integrations read the `X-POSTHOG-DISTINCT-ID` and `X-POSTHOG-SESSION-ID` request headers into the request context, as in 5.x.
These headers only fill a missing distinct id or session id, and any client can set them, so never use them for authentication.
To stop reading them, set the new client option `captureTracingHeaders: false`:

```ts
const posthog = new PostHog('<project_api_key>', { captureTracingHeaders: false })
```

## SDK identity

PostHog sets `$lib` and `$lib_version` on every event from the `PostHog-Sdk-Info` request header, which the client sets.
The SDK removes `$lib` and `$lib_version` from the properties it sends.
A value you set on an event, in context, with `register()` or in `before_send` does not reach PostHog.

## Session and window ids

Capture v1 sends `$session_id` and `$window_id` as top-level event fields, not as properties.
The SDK moves them out of `properties` for you.

- A string is sent as given.
- `null` and `undefined` count as unset.
- Any other value is dropped, and the SDK logs a warning with the key and the value's type, not the value. 5.x sent it as a property.

## Invalid events

Capture rejects a whole request when one event has a broken field.
6.0 drops only that event before sending, so the rest of the batch is delivered.

- An event whose name is missing, empty or not a string is dropped and reported through `'error'` (`details: 'invalid event'`). 5.x sent it, and an object name was sent as `"[object Object]"`.
- An event whose name, distinct id, session id or window id is not well-formed Unicode (it has a lone surrogate) is dropped the same way.
- An event with a property value that throws when the SDK reads or serializes it, such as a getter or a `toJSON` method that throws, is dropped alone and reported through `'error'` (`details: 'unserializable event'`). The report has no event content, and the SDK does not keep or log the error. When the event has no uuid yet, the report counts it but does not list it.
- In 5.x, a value that threw when the client read the call's properties dropped the event and printed the raw error with `console.error`, without `'error'`. A value that threw during serialization failed the whole batch, up to `maxBatchSize` events, and emitted the raw error on `'error'`.
- A lone surrogate in a property string is replaced with U+FFFD, and the event is kept. Before, one bad character failed the whole request.
- `NaN`, `Infinity` and `-Infinity` are sent as `null`, and the event is kept. A `NaN` under `$set` clears that person property.
- PostHog drops an event whose name is over 200 UTF-8 bytes (`event_name_too_long`), and `'error'` reports it. Legacy capture had no event name limit. Check your event names before you upgrade.

## Timestamps

- Timestamps are sent in UTC, with millisecond precision.
- An invalid `timestamp` is still replaced with the current time. The SDK now logs a warning, which never includes the value.

## Event uuids

- Each event needs its own uuid. Capture keeps the first event for each uuid in a request and drops the later copies. `'error'` reports each dropped copy in `CaptureError.drops` with `details: 'duplicate_event_uuid'`. 5.x sent every copy to legacy capture.
- The SDK accepts a uuid with hyphens, 32 hex digits, `{...}` braces or a `urn:uuid:` prefix, in any case. It sends the lowercase hyphenated form, and `captureAi()` returns that form.
- Any other value is replaced with a generated uuid, and the SDK logs a warning that does not include the value. An empty string counts as unset.

## API keys

- A missing or empty project API key disables the client, as in 5.x.
- A personal API key (`phx_...`) passed as the project API key now disables the client too. Capture rejects personal API keys.
- Either case logs one error, which never includes the key.
- A disabled client sends nothing. To build one on purpose, for example in tests, pass `disabled: true`.

## Logs

The SDK's own logs no longer print whole events or `before_send` error messages.

- Debug mode logs event names, uuids and counts instead of whole events.
- A `before_send` error is logged with the error's type, not its message.
- In debug mode, a capture error can still include the server or proxy response text.
- The failed-batch line, the invalid uuid warning, the invalid timestamp warning and the session id warning never include event values.
- Log-based alerts that match 5.x log text will stop matching. Listen for `'error'` instead.

## Wrapper packages

| Package                                             | Works with                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `@posthog/ai`                                       | posthog-node 5 and 6. On 6 it sends AI events with `captureAi()`.             |
| `@posthog/mcp`                                      | posthog-node 5 and 6                                                          |
| `@posthog/convex`, `@posthog/next`, `@posthog/nuxt` | posthog-node 5. They move to posthog-node 6 in their own next major versions. |

Upgrade `@posthog/ai` and `@posthog/mcp` to a version that accepts posthog-node 6 before or together with posthog-node.

## posthog-node 5.x support

posthog-node 5.x keeps receiving security fixes for at least one year after the 6.0 release.
