---
title: "PostHog Node.js SDK 6.x (experimental)"
sidebar: Docs
showTitle: true
contentMaxWidthClass: max-w-full
platformLogo: nodejs
tableOfContents:
  - value: "Getting started"
    url: getting-started
    depth: 0
  - value: "Setup"
    url: setup
    depth: 0
  - value: "Capture"
    url: capture
    depth: 0
  - value: "Identify"
    url: identify
    depth: 0
  - value: "Traces"
    url: traces
    depth: 0
  - value: "Alias"
    url: alias
    depth: 0
  - value: "Capture AI"
    url: capture-ai
    depth: 0
  - value: "Capture exception"
    url: capture-exception
    depth: 0
  - value: "Debug"
    url: debug
    depth: 0
  - value: "Emails"
    url: emails
    depth: 0
  - value: "Flush"
    url: flush
    depth: 0
  - value: "Get feature flag"
    url: get-feature-flag
    depth: 0
  - value: "Get feature flag payload"
    url: get-feature-flag-payload
    depth: 0
  - value: "Get feature flag result"
    url: get-feature-flag-result
    depth: 0
  - value: "Get feature flags"
    url: get-feature-flags
    depth: 0
  - value: "Get feature flags and payloads"
    url: get-feature-flags-and-payloads
    depth: 0
  - value: "Evaluate flags"
    url: evaluate-flags
    depth: 0
  - value: "Group identify"
    url: group-identify
    depth: 0
  - value: "Is feature enabled"
    url: is-feature-enabled
    depth: 0
  - value: "Is opt out"
    url: is-opt-out
    depth: 0
  - value: "Opt in"
    url: opt-in
    depth: 0
  - value: "Register"
    url: register
    depth: 0
  - value: "Reload feature flags"
    url: reload-feature-flags
    depth: 0
  - value: "Set person properties"
    url: set-person-properties
    depth: 0
  - value: "Shutdown"
    url: shutdown
    depth: 0
  - value: "Unregister"
    url: unregister
    depth: 0
  - value: "Flag definition loader"
    url: flag-definition-loader
    depth: 0
  - value: "Remote config"
    url: remote-config
    depth: 0
  - value: "SDK utils"
    url: sdk-utils
    depth: 0
  - value: "Types"
    url: types
    depth: 0
---

## Getting started


### Install

```bash
npm install posthog-node
```

### Initialize

```ts
import { PostHog } from 'posthog-node'

const client = new PostHog('<ph_project_api_key>', { host: 'https://us.i.posthog.com' })
```

### Capture

```ts
client.capture({ distinctId: 'user_123', event: 'signed_up', properties: { plan: 'pro' } })
```

### Shut down

Flush queued events before the process exits.

```ts
await client.shutdown()
```

## Setup

### `new PostHog(...)`

> **new PostHog**(`apiKey`, `options?`): `PostHog`

Initialize a new PostHog client instance.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `apiKey` | `string` | Your PostHog project API key |
| `options?` | `PostHogOptions` | Configuration options for the client |

#### Returns

`PostHog`

#### Examples

```ts
// Basic initialization
const client = new PostHogBackendClient(
  'your-api-key',
  { host: 'https://app.posthog.com' }
)
```

```ts
// With a secret key (Personal API Key or Project Secret API Key) for local evaluation
const client = new PostHogBackendClient(
  'your-api-key',
  {
    host: 'https://app.posthog.com',
    secretKey: 'your-secret-key'
  }
)
```

## Capture

### `PostHog.capture`

> **capture**(`props`): `void`

Capture an event manually.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `props` | `EventMessage` | The event properties |

#### Returns

`void`

void

#### Example

```ts
// Basic capture
client.capture({
  distinctId: 'user_123',
  event: 'button_clicked',
  properties: { button_color: 'red' }
})
```

### `PostHog.captureImmediate`

> **captureImmediate**(`props`): `Promise`\<`void`\>

Capture an event immediately (synchronously).

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `props` | `EventMessage` | The event properties |

#### Returns

`Promise`\<`void`\>

Promise that resolves when the event is captured

#### Examples

```ts
// Basic immediate capture
await client.captureImmediate({
  distinctId: 'user_123',
  event: 'button_clicked',
  properties: { button_color: 'red' }
})
```

```ts
// With feature flags
await client.captureImmediate({
  distinctId: 'user_123',
  event: 'user_action',
  sendFeatureFlags: true
})
```

```ts
// With custom feature flags options
await client.captureImmediate({
  distinctId: 'user_123',
  event: 'user_action',
  sendFeatureFlags: {
    onlyEvaluateLocally: true,
    personProperties: { plan: 'premium' },
    groupProperties: { org: { tier: 'enterprise' } }
    flagKeys: ['flag1', 'flag2']
  }
})
```

### `CaptureError`

Surfaced on the client error channel whenever a capture batch did not
fully deliver: some events were `drop`ped, some `retry` events outlived the
attempt budget, or the batch hit a terminal transport/HTTP/parse failure.

A 2xx with drops is still a partial failure and is reported here — a
successful HTTP status does not mean every event was accepted.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new CaptureError**(`options`): `CaptureError`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `CaptureErrorParams` |

###### Returns

`CaptureError`

#### Properties

| Property | Modifier | Type | Default value | Overrides |
| ------ | ------ | ------ | ------ | ------ |
| <a id="cause"></a> `cause?` | `public` | `unknown` | `undefined` | `Error.cause` |
| <a id="drops"></a> `drops` | `readonly` | `CaptureDroppedEvent`[] | `undefined` | - |
| <a id="endpoint"></a> `endpoint` | `readonly` | `CaptureEndpoint` | `undefined` | - |
| <a id="name"></a> `name` | `public` | `string` | `'CaptureError'` | `Error.name` |
| <a id="requestid"></a> `requestId` | `readonly` | `string` | `undefined` | - |
| <a id="retryexhausted"></a> `retryExhausted` | `readonly` | `string`[] | `undefined` | - |

## Identify

### `PostHog.identify`

> **identify**(`data`): `void`

Identify a user and set their properties.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `data` | `IdentifyMessage` | The identify data containing distinctId and properties |

#### Returns

`void`

#### Examples

```ts
// Basic identify with properties
client.identify({
  distinctId: 'user_123',
  properties: {
    name: 'John Doe',
    email: 'john@example.com',
    plan: 'premium'
  }
})
```

```ts
// Using $set and $set_once
client.identify({
  distinctId: 'user_123',
  properties: {
    $set: { name: 'John Doe', email: 'john@example.com' },
    $set_once: { first_login: new Date().toISOString() }
    $anon_distinct_id: 'anonymous_user_456'
  }
})
```

### `PostHog.identifyImmediate`

> **identifyImmediate**(`data`): `Promise`\<`void`\>

Identify a user and set their properties immediately (synchronously).

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `data` | `IdentifyMessage` | The identify data containing distinctId and properties |

#### Returns

`Promise`\<`void`\>

Promise that resolves when the identify is processed

#### Example

```ts
// Basic immediate identify
await client.identifyImmediate({
  distinctId: 'user_123',
  properties: {
    name: 'John Doe',
    email: 'john@example.com'
  }
})
```

## Traces

### `PostHog.getActiveSpan`

> **getActiveSpan**(): `Span` \| `null`

**`Experimental`**

The span currently active on this async execution path, or `null` outside
any `withSpan` callback.

On the edge build this returns `null` after an `await`, because the active
span is tracked synchronously there.

 Subject to change in a minor release.

#### Returns

`Span` \| `null`

#### Example

```ts
// Propagate the trace to another service
const traceparent = posthog.getActiveSpan()?.traceparent()
await fetch(url, { headers: traceparent ? { traceparent } : {} })
```

### `PostHog.startSpan`

> **startSpan**(`name`, `options?`): `Span`

**`Experimental`**

Starts a span without making it active — for work that can't wrap a
callback. Prefer `withSpan`, which ends the span for you.

Always returns a handle, so calling code never has to branch: when the
`traces` option is absent, the SDK is disabled, or the user has opted out,
the handle is inert and nothing is exported. An inert handle given a
`parent` header still returns it from `traceparent()`, so a service with
tracing off passes a distributed trace through instead of severing it.

 Subject to change in a minor release.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |
| `options?` | `StartSpanOptions` |

#### Returns

`Span`

#### Example

```ts
const span = posthog.startSpan('checkout', { attributes: { plan: 'pro' } })
span.setAttribute('cart.items', 3)
span.end()
```

### `PostHog.withSpan`

> **withSpan**\<`T`\>(`name`, `fn`): `T`

**`Experimental`**

Runs a callback with a span active for its duration and ends the span for
you — at return for a sync callback, at settle for an async one. Takes an
optional `StartSpanOptions` between the name and the callback:
`withSpan(name, fn)` or `withSpan(name, options, fn)`.

Spans started inside the callback nest under it automatically. If the
callback throws or rejects, the span records the exception and the original
error is rethrown unchanged. A callback that ends the span itself gets the
rethrow but not the recording, since the span is already exported by then.

Spans nest across `await` only on the Node runtime, which tracks the active
span with `AsyncLocalStorage`. The edge build restores the active span when
the callback returns its promise, so spans started after an `await` there
begin a new trace.

 Subject to change in a minor release.

##### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-1"></a> `T` |

##### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |
| `fn` | (`span`) => `T` |

##### Returns

`T`

##### Example

```ts
await posthog.withSpan('POST /checkout', { parent: req.get('traceparent') }, async (span) => {
  span.setAttribute('plan', user.plan)
  return processOrder()
})
```

#### Call Signature

> **withSpan**\<`T`\>(`name`, `options`, `fn`): `T`

**`Experimental`**

Runs a callback with a span active for its duration and ends the span for
you — at return for a sync callback, at settle for an async one. Takes an
optional `StartSpanOptions` between the name and the callback:
`withSpan(name, fn)` or `withSpan(name, options, fn)`.

Spans started inside the callback nest under it automatically. If the
callback throws or rejects, the span records the exception and the original
error is rethrown unchanged. A callback that ends the span itself gets the
rethrow but not the recording, since the span is already exported by then.

Spans nest across `await` only on the Node runtime, which tracks the active
span with `AsyncLocalStorage`. The edge build restores the active span when
the callback returns its promise, so spans started after an `await` there
begin a new trace.

 Subject to change in a minor release.

##### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-2"></a> `T` |

##### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |
| `options` | `StartSpanOptions` |
| `fn` | (`span`) => `T` |

##### Returns

`T`

##### Example

```ts
await posthog.withSpan('POST /checkout', { parent: req.get('traceparent') }, async (span) => {
  span.setAttribute('plan', user.plan)
  return processOrder()
})
```

### `enrichCurrentSpan`

> **enrichCurrentSpan**(`client`): `void`

Notify installed span processors after request IDs become available.
This entry point does not load OpenTelemetry; without a processor it does nothing.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `PostHogBackendClient` |

#### Returns

`void`

## Alias

### `PostHog.alias`

> **alias**(`data`): `void`

Create an alias to link two distinct IDs together.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `data` | \{ `alias`: `string`; `disableGeoip?`: `boolean`; `distinctId`: `string`; `options?`: `Record`\<`string`, `JsonType`\>; \} | The alias data containing distinctId and alias |
| `data.alias` | `string` | - |
| `data.disableGeoip?` | `boolean` | - |
| `data.distinctId` | `string` | - |
| `data.options?` | `Record`\<`string`, `JsonType`\> | - |

#### Returns

`void`

#### Example

```ts
// Link an anonymous user to an identified user
client.alias({
  distinctId: 'anonymous_123',
  alias: 'user_456'
})
```

### `PostHog.aliasImmediate`

> **aliasImmediate**(`data`): `Promise`\<`void`\>

Create an alias to link two distinct IDs together immediately (synchronously).

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `data` | \{ `alias`: `string`; `disableGeoip?`: `boolean`; `distinctId`: `string`; `options?`: `Record`\<`string`, `JsonType`\>; \} | The alias data containing distinctId and alias |
| `data.alias` | `string` | - |
| `data.disableGeoip?` | `boolean` | - |
| `data.distinctId` | `string` | - |
| `data.options?` | `Record`\<`string`, `JsonType`\> | - |

#### Returns

`Promise`\<`void`\>

Promise that resolves when the alias is processed

#### Example

```ts
// Link an anonymous user to an identified user immediately
await client.aliasImmediate({
  distinctId: 'anonymous_123',
  alias: 'user_456'
})
```

## Capture AI

### `PostHog.captureAi`

> **captureAi**(`props`): `string` \| `undefined`

Capture an AI event on the dedicated AI capture endpoint.

Beta: the signature is stable; operational limits (per-event size cap,
batching, endpoint) may change without notice. Delivery is async, and no
redaction or truncation is applied to the payload.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `props` | `EventMessage` | The event properties |

#### Returns

`string` \| `undefined`

The event UUID, or `undefined` when the client is disabled

### `PostHog.captureAiImmediate`

> **captureAiImmediate**(`props`): `Promise`\<`string` \| `undefined`\>

Capture an AI event on the dedicated AI capture endpoint, resolving after
the send completes. Use in short-lived processes (serverless) where the
runtime may freeze before a background flush runs.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `props` | `EventMessage` | The event properties |

#### Returns

`Promise`\<`string` \| `undefined`\>

The event UUID, or `undefined` when the client is disabled

## Capture exception

### `PostHog.captureException`

> **captureException**(`error`, `options?`): `void`

Capture an error exception as an event.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `error` | `unknown` | The error to capture |
| `options?` | `CaptureExceptionOptions` | Optional distinct id, properties, options, uuid, flags snapshot and level |

#### Returns

`void`

#### Remarks

The 5.x positional form `captureException(error, distinctId, properties, uuid, flags)` still
works in 6.x but logs a deprecation error once per process, and will be removed in the next
major version.

#### Examples

```ts
// Capture an error with user ID
try {
  // Some risky operation
  riskyOperation()
} catch (error) {
  client.captureException(error, { distinctId: 'user_123' })
}
```

```ts
// Capture with additional properties and a level
try {
  apiCall()
} catch (error) {
  client.captureException(error, {
    distinctId: 'user_123',
    properties: { endpoint: '/api/users', method: 'POST', status_code: 500 },
    level: 'warning',
  })
}
```

### `PostHog.captureExceptionImmediate`

> **captureExceptionImmediate**(`error`, `options?`): `Promise`\<`void`\>

Capture an error exception as an event immediately (synchronously).

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `error` | `unknown` | The error to capture |
| `options?` | `CaptureExceptionOptions` | Optional distinct id, properties, options, uuid, flags snapshot and level |

#### Returns

`Promise`\<`void`\>

Promise that resolves when the error is captured

#### Remarks

The 5.x positional form `captureExceptionImmediate(error, distinctId, properties, flags)` still
works in 6.x but logs a deprecation error once per process, and will be removed in the next
major version.

#### Examples

```ts
// Capture an error immediately with user ID
try {
  // Some risky operation
  riskyOperation()
} catch (error) {
  await client.captureExceptionImmediate(error, { distinctId: 'user_123' })
}
```

```ts
// Capture with additional properties
try {
  apiCall()
} catch (error) {
  await client.captureExceptionImmediate(error, {
    distinctId: 'user_123',
    properties: { endpoint: '/api/users', method: 'POST', status_code: 500 },
  })
}
```

### `PostHogSentryIntegration`

Class-based Sentry integration.

#### Deprecated

This integration is deprecated and will be removed in a future major version. Use PostHog Error Tracking for Node instead:
https://posthog.com/docs/error-tracking/installation/node

#### Implements

- `_SentryIntegrationClass`

#### Constructors

##### Constructor

> **new PostHogSentryIntegration**(`_posthog`, `organization?`, `prefix?`, `severityAllowList?`, `sendExceptionsToPostHog?`): `PostHogSentryIntegration`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `_posthog` | `PostHogBackendClient` |
| `organization?` | `string` |
| `prefix?` | `string` |
| `severityAllowList?` | (`"fatal"` \| `"error"` \| `"warning"` \| `"log"` \| `"info"` \| `"debug"`)[] \| `"*"` |
| `sendExceptionsToPostHog?` | `boolean` |

###### Returns

`PostHogSentryIntegration`

#### Properties

| Property | Modifier | Type | Default value |
| ------ | ------ | ------ | ------ |
| <a id="name-2"></a> ~~`name`~~ | `public readonly` | `"posthog-node"` | `NAME` |
| <a id="setuponce"></a> ~~`setupOnce`~~ | `public` | (`addGlobalEventProcessor`, `getCurrentHub`) => `void` | `undefined` |
| <a id="posthog_id_tag"></a> ~~`POSTHOG_ID_TAG`~~ | `public static readonly` | `"posthog_distinct_id"` | `'posthog_distinct_id'` |

### `sentryIntegration`

> **sentryIntegration**(`_posthog`, `options?`): `_SentryIntegration`

Creates the function-based Sentry integration.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `_posthog` | `PostHogBackendClient` |
| `options?` | `SentryIntegrationOptions` |

#### Returns

`_SentryIntegration`

#### Deprecated

This integration is deprecated and will be removed in a future major version. Use PostHog Error Tracking for Node instead:
https://posthog.com/docs/error-tracking/installation/node

### `setupExpressErrorHandler`

> **setupExpressErrorHandler**(`_posthog`, `app`): `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `_posthog` | `PostHogBackendClient` |
| `app` | \{ `use`: (`middleware`) => `unknown`; \} |
| `app.use` | (`middleware`) => `unknown` |

#### Returns

`void`

## Debug

### `PostHog.isDebug`

> **get** **isDebug**(): `boolean`

##### Returns

`boolean`

### `PostHog.debug`

> **debug**(`enabled?`): `void`

Enable or disable debug logging.

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `enabled?` | `boolean` | `true` | Whether to enable debug logging |

#### Returns

`void`

#### Examples

```ts
// Enable debug logging
client.debug(true)
```

```ts
// Disable debug logging
client.debug(false)
```

## Emails

### `PostHog.emails`

> **get** **emails**(): `Emails`

The `posthog.emails` API: sends transactional email from PostHog email templates, and reads
the status of each email it sent.

Needs `secretKey`, a project secret API key with the `hog_flow:write` scope. A key with only
`hog_flow:read` can read statuses but not send. Requests go to `appHost`, or to the PostHog
Cloud app host of `host`. `send` and `get` resolve to `{ data, error }` and do not reject.
`data.id` is the queued email's message ID, which `get` takes. A disabled client sends nothing
and returns the error `client_disabled`. After `shutdown()`, the client sends nothing and
returns the error `client_closed`.

##### Example

```ts
const client = new PostHog('phc_...', { secretKey: 'phs_...', host: 'https://eu.i.posthog.com' })
const { data, error } = await client.emails.send({
  to: 'user@example.com',
  templateId: '0190f6d2-7c1e-7b3a-9f5e-1c2d3e4f5a6b',
  templateData: { name: 'Ada' },
  distinctId: 'user_123',
  idempotencyKey: 'welcome:user_123',
})
if (error) {
  console.error(error.code, error.message)
}

const status = await client.emails.get(data.id) // later, for example from a job
```

##### Returns

`Emails`

#### Description

The `posthog.emails` API: sends transactional email from PostHog email templates.
Needs `secretKey`, a project secret API key with the `hog_flow:write` scope.

### `EmailError`

PostHog did not queue the email, or the client could not tell whether it did.

Branch on `code`, PostHog's stable error code, or on `name`, a coarse category of the
failure. The message never contains the secret key or the request body.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new EmailError**(`params`): `EmailError`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `params` | `EmailErrorParams` |

###### Returns

`EmailError`

#### Properties

| Property | Modifier | Type | Description | Overrides |
| ------ | ------ | ------ | ------ | ------ |
| <a id="code"></a> `code` | `readonly` | `string` | PostHog's error code, such as `quota_limited`, or an SDK code such as `network_error`. | - |
| <a id="docsurl"></a> `docsUrl?` | `readonly` | `string` | - | - |
| <a id="field"></a> `field?` | `readonly` | `string` | The request field the error is about, when PostHog named one. | - |
| <a id="fix"></a> `fix?` | `readonly` | `string` | - | - |
| <a id="name-1"></a> `name` | `public` | `EmailErrorName` | - | `Error.name` |
| <a id="retryafterms"></a> `retryAfterMs?` | `readonly` | `number` | How long PostHog asked the client to wait before it sends again, in milliseconds. | - |
| <a id="statuscode"></a> `statusCode?` | `readonly` | `number` | The HTTP status, when PostHog answered. | - |
| <a id="why"></a> `why?` | `readonly` | `string` | - | - |

## Flush

### `PostHog.flush`

> **flush**(): `Promise`\<`void`\>

Sends all queued events and spans, and resolves when every send has finished.
It does not reject when delivery fails: those failures arrive on the `'error'` event.

#### Returns

`Promise`\<`void`\>

### `PostHog.flushWithPendingPromises`

> **flushWithPendingPromises**(): `Promise`\<`void`\>

Flushes the queue of pending events.

This function will return a promise that will resolve when the flush is complete,
or reject if there was an error (for example if the server or network is down).

If there is already a flush in progress, this function will wait for that flush to complete.

It's recommended to do error handling in the callback of the promise.

#### Returns

`Promise`\<`void`\>

#### Example

```js
// flush with error handling
posthog.flush().then(() => {
  console.log('Flush complete')
}).catch((err) => {
  console.error('Flush failed', err)
})
```

#### Throws

PostHogFetchHttpError

#### Throws

PostHogFetchNetworkError

#### Throws

Error

## Get feature flag

### `PostHog.getFeatureFlag`

> **getFeatureFlag**(`key`, `distinctId`, `options?`): `Promise`\<`FeatureFlagValue` \| `undefined`\>

Get the value of a feature flag for a specific user.

A boolean `false` is a conclusive off evaluation. `undefined` means no result is available,
for example because the key was not returned or local-only evaluation was inconclusive.
Local evaluation resolves cached inactive definitions to `false`; remote evaluation omits
globally inactive flags, so the result depends on which evaluation path is available.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature flag key |
| `distinctId` | `string` | The user's distinct ID |
| `options?` | \{ `disableGeoip?`: `boolean`; `groupProperties?`: `Record`\<`string`, `Properties`\>; `groups?`: `Record`\<`string`, `string`\>; `onlyEvaluateLocally?`: `boolean`; `personProperties?`: `Properties`; `sendFeatureFlagEvents?`: `boolean`; \} | Optional configuration for flag evaluation |
| `options.disableGeoip?` | `boolean` | - |
| `options.groupProperties?` | `Record`\<`string`, `Properties`\> | - |
| `options.groups?` | `Record`\<`string`, `string`\> | - |
| `options.onlyEvaluateLocally?` | `boolean` | - |
| `options.personProperties?` | `Properties` | - |
| `options.sendFeatureFlagEvents?` | `boolean` | - |

#### Returns

`Promise`\<`FeatureFlagValue` \| `undefined`\>

Promise that resolves to the flag value, or undefined when no evaluation is available

#### Examples

```ts
// Basic feature flag check
const flagValue = await client.getFeatureFlag('new-feature', 'user_123')
if (flagValue === 'variant-a') {
  // Show variant A
} else if (flagValue === 'variant-b') {
  // Show variant B
} else {
  // Flag evaluated off, or no value was returned
}
```

```ts
// With groups and properties
const flagValue = await client.getFeatureFlag('org-feature', 'user_123', {
  groups: { organization: 'acme-corp' },
  personProperties: { plan: 'enterprise' },
  groupProperties: { organization: { tier: 'premium' } }
})
```

```ts
// Only evaluate locally
const flagValue = await client.getFeatureFlag('local-flag', 'user_123', {
  onlyEvaluateLocally: true
})
```

#### Deprecated

Use evaluateFlags and call `flags.getFlag(key)` on the returned snapshot.
  This consolidates flag evaluation into a single `/flags` request per incoming request and
  avoids drift between the values your code branched on and the values attached to events.
  Will be removed in the next major version.

## Get feature flag payload

### `PostHog.getFeatureFlagPayload`

> **getFeatureFlagPayload**(`key`, `distinctId`, `matchValue?`, `options?`): `Promise`\<`JsonType` \| `undefined`\>

Get the payload for a feature flag.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature flag key |
| `distinctId` | `string` | The user's distinct ID |
| `matchValue?` | `FeatureFlagValue` | Optional match value to get payload for |
| `options?` | \{ `disableGeoip?`: `boolean`; `groupProperties?`: `Record`\<`string`, `Properties`\>; `groups?`: `Record`\<`string`, `string`\>; `onlyEvaluateLocally?`: `boolean`; `personProperties?`: `Properties`; `sendFeatureFlagEvents?`: `boolean`; \} | Optional configuration for flag evaluation |
| `options.disableGeoip?` | `boolean` | - |
| `options.groupProperties?` | `Record`\<`string`, `Properties`\> | - |
| `options.groups?` | `Record`\<`string`, `string`\> | - |
| `options.onlyEvaluateLocally?` | `boolean` | - |
| `options.personProperties?` | `Properties` | - |
| `options.sendFeatureFlagEvents?` | `boolean` | **Deprecated** THIS OPTION HAS NO EFFECT, kept here for backwards compatibility reasons. |

#### Returns

`Promise`\<`JsonType` \| `undefined`\>

Promise that resolves to the flag payload or undefined

#### Examples

```ts
// Get payload for a feature flag
const payload = await client.getFeatureFlagPayload('flag-key', 'user_123')
if (payload) {
  console.log('Flag payload:', payload)
}
```

```ts
// Get payload with specific match value
const payload = await client.getFeatureFlagPayload('flag-key', 'user_123', 'variant-a')
```

```ts
// With groups and properties
const payload = await client.getFeatureFlagPayload('org-flag', 'user_123', undefined, {
  groups: { organization: 'acme-corp' },
  personProperties: { plan: 'enterprise' }
})
```

#### Deprecated

Use evaluateFlags and call `flags.getFlagPayload(key)` on the returned
  snapshot. This consolidates flag evaluation into a single `/flags` request per incoming
  request. Will be removed in the next major version.

## Get feature flag result

### `PostHog.getFeatureFlagResult`

> **getFeatureFlagResult**(`key`, `options?`): `Promise`\<`FeatureFlagResult` \| `undefined`\>

Get the result of evaluating a feature flag, including its value and payload.
This is more efficient than calling getFeatureFlag and getFeatureFlagPayload separately when you need both.
A result with `enabled: false` is a conclusive off evaluation; `undefined` means no evaluation
is available. Local evaluation resolves cached inactive definitions to `enabled: false`, while
remote evaluation omits globally inactive flags.

##### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature flag key |
| `options?` | `FlagEvaluationOptions` | Optional configuration for flag evaluation |

##### Returns

`Promise`\<`FeatureFlagResult` \| `undefined`\>

Promise that resolves to the flag result or undefined

##### Examples

```ts
// Get flag result
const result = await client.getFeatureFlagResult('my-flag', 'user_123')
if (result) {
  console.log('Flag enabled:', result.enabled)
  console.log('Variant:', result.variant)
  console.log('Payload:', result.payload)
}
```

```ts
// With groups and properties
const result = await client.getFeatureFlagResult('org-feature', 'user_123', {
  groups: { organization: 'acme-corp' },
  personProperties: { plan: 'enterprise' }
})
```

#### Call Signature

> **getFeatureFlagResult**(`key`, `distinctId`, `options?`): `Promise`\<`FeatureFlagResult` \| `undefined`\>

##### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature flag key |
| `distinctId` | `string` | The user's distinct ID |
| `options?` | `FlagEvaluationOptions` | Optional configuration for flag evaluation |

##### Returns

`Promise`\<`FeatureFlagResult` \| `undefined`\>

Promise that resolves to the flag result or undefined

##### Description

Get the result of evaluating a feature flag, including its value and payload.
This is more efficient than calling getFeatureFlag and getFeatureFlagPayload separately when you need both.

##### Example

```ts
const result = await client.getFeatureFlagResult('my-flag', 'user_123')
if (result) {
  console.log('Flag enabled:', result.enabled)
  console.log('Variant:', result.variant)
  console.log('Payload:', result.payload)
}
```

## Get feature flags

### `PostHog.getAllFlags`

> **getAllFlags**(`options?`): `Promise`\<`Record`\<`string`, `FeatureFlagValue`\>\>

Get all feature flag values for a specific user.

##### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options?` | `AllFlagsOptions` | Optional configuration for flag evaluation |

##### Returns

`Promise`\<`Record`\<`string`, `FeatureFlagValue`\>\>

Promise that resolves to a record of flag keys and their values

##### Examples

```ts
// Get all flags for a user
const allFlags = await client.getAllFlags('user_123')
console.log('User flags:', allFlags)
// Output: { 'flag-1': 'variant-a', 'flag-2': false, 'flag-3': 'variant-b' }
```

```ts
// With specific flag keys
const specificFlags = await client.getAllFlags('user_123', {
  flagKeys: ['flag-1', 'flag-2']
})
```

```ts
// With groups and properties
const orgFlags = await client.getAllFlags('user_123', {
  groups: { organization: 'acme-corp' },
  personProperties: { plan: 'enterprise' }
})
```

#### Call Signature

> **getAllFlags**(`distinctId`, `options?`): `Promise`\<`Record`\<`string`, `FeatureFlagValue`\>\>

##### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `distinctId` | `string` | The user's distinct ID |
| `options?` | `AllFlagsOptions` | Optional configuration for flag evaluation |

##### Returns

`Promise`\<`Record`\<`string`, `FeatureFlagValue`\>\>

Promise that resolves to a record of flag keys and their values

##### Description

Get all feature flag values for a specific user.

## Get feature flags and payloads

### `PostHog.getAllFlagsAndPayloads`

> **getAllFlagsAndPayloads**(`options?`): `Promise`\<`Partial`\<`Pick`\<`PostHogFlagsResponse`, `"featureFlags"` \| `"featureFlagPayloads"`\>\>\>

Get all feature flag values and payloads for a specific user.

##### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options?` | `AllFlagsOptions` | Optional configuration for flag evaluation |

##### Returns

`Promise`\<`Partial`\<`Pick`\<`PostHogFlagsResponse`, `"featureFlags"` \| `"featureFlagPayloads"`\>\>\>

Promise that resolves to flags and payloads

##### Examples

```ts
// Get all flags and payloads for a user
const result = await client.getAllFlagsAndPayloads('user_123')
console.log('Flags:', result.featureFlags)
console.log('Payloads:', result.featureFlagPayloads)
```

```ts
// With specific flag keys
const result = await client.getAllFlagsAndPayloads('user_123', {
  flagKeys: ['flag-1', 'flag-2']
})
```

```ts
// Only evaluate locally
const result = await client.getAllFlagsAndPayloads('user_123', {
  onlyEvaluateLocally: true
})
```

#### Call Signature

> **getAllFlagsAndPayloads**(`distinctId`, `options?`): `Promise`\<`Partial`\<`Pick`\<`PostHogFlagsResponse`, `"featureFlags"` \| `"featureFlagPayloads"`\>\>\>

##### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `distinctId` | `string` | The user's distinct ID |
| `options?` | `AllFlagsOptions` | Optional configuration for flag evaluation |

##### Returns

`Promise`\<`Partial`\<`Pick`\<`PostHogFlagsResponse`, `"featureFlags"` \| `"featureFlagPayloads"`\>\>\>

Promise that resolves to flags and payloads

##### Description

Get all feature flag values and payloads for a specific user.

## Evaluate flags

### `PostHog.evaluateFlags`

> **evaluateFlags**(`options?`): `Promise`\<`FeatureFlagEvaluations`\>

Evaluate all feature flags for a user in a single call and return a
FeatureFlagEvaluations snapshot. Branch on `.isEnabled()` / `.getFlag()`,
then pass the same snapshot to `capture()` via the `flags` option so the
captured event carries the exact flag values the code branched on.

Prefer this over repeated `isFeatureEnabled()` / `getFeatureFlag()` calls and
over `capture({ sendFeatureFlags: true })` — it consolidates flag evaluation
into a single `/flags` request per incoming request.

**Local evaluation is transparent.** When the poller can resolve a flag from
cached definitions, no network call is made and the snapshot's `$feature_flag_called`
events are tagged `locally_evaluated: true`. A requested key missing from local
definitions is included in a `/flags` fallback unless `onlyEvaluateLocally` is true.
Locally resolved values remain authoritative when remote results are merged. In particular,
a cached inactive definition is a conclusive `false` result locally, while remote evaluation
omits globally inactive flags and therefore leaves those keys absent.

**Exposure events.** `isEnabled()` and `getFlag()` send a `$feature_flag_called` event the
first time each flag value is read for a user. Experiments use these events as exposures.
The client's `sendFeatureFlagEvent` option sets the default for these reads. Pass
`{ sendFeatureFlagEvents: true }` or `{ sendFeatureFlagEvents: false }` to a read to override
it, so one snapshot can serve both experiment flags and flags that should send no events.
`getFlagPayload()` never sends events.

**Trim the request.** Pass `flagKeys` to scope local evaluation, the underlying
`/flags` request, and the returned snapshot to a subset of flags. Remote evaluation
responses are not cached, so a key missing both locally and remotely costs one
`/flags` request per `evaluateFlags()` call.

**Trim the event payload.** Use `flags.only([...])` or `flags.onlyAccessed()`
to filter which flags get attached to a captured event without re-fetching.

##### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options?` | `AllFlagsOptions` | Optional configuration for flag evaluation. Supports the same fields as `getAllFlags()`. `flagKeys` scopes local evaluation, the `/flags` request, and the returned snapshot. `onlyEvaluateLocally` prevents fallback and leaves unresolved keys absent; the snapshot's `unresolvedFlags` lists them with a reason. |

##### Returns

`Promise`\<`FeatureFlagEvaluations`\>

Promise that resolves to a `FeatureFlagEvaluations` snapshot

##### Examples

Basic usage:
```ts
const flags = await client.evaluateFlags('user_123', {
  personProperties: { plan: 'enterprise' },
})
if (flags.isEnabled('new-dashboard')) {
  renderNewDashboard()
}
client.capture({ distinctId: 'user_123', event: 'page_viewed', flags })
```

Scope the `/flags` request to specific keys:
```ts
const flags = await client.evaluateFlags('user_123', {
  flagKeys: ['new-dashboard', 'checkout-flow'],
  personProperties: { plan: 'enterprise' },
})
```

Attach only the flags the developer actually checked:
```ts
const flags = await client.evaluateFlags('user_123')
if (flags.isEnabled('new-dashboard')) { ... }
client.capture({ distinctId: 'user_123', event: 'page_viewed', flags: flags.onlyAccessed() })
```

Use `withContext()` to avoid repeating the distinctId:
```ts
await client.withContext({ distinctId: 'user_123' }, async () => {
  const flags = await client.evaluateFlags()
  if (flags.isEnabled('new-dashboard')) { ... }
  client.capture({ event: 'page_viewed', flags })
})
```

#### Call Signature

> **evaluateFlags**(`distinctId`, `options?`): `Promise`\<`FeatureFlagEvaluations`\>

##### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `distinctId` | `string` | The user's distinct ID |
| `options?` | `AllFlagsOptions` | Optional configuration for flag evaluation. `flagKeys` scopes local evaluation, the `/flags` request, and the returned snapshot. Missing local keys trigger fallback unless `onlyEvaluateLocally` is true. |

##### Returns

`Promise`\<`FeatureFlagEvaluations`\>

##### Description

Evaluate all feature flags for a specific user.

### `FeatureFlagEvaluations`

A snapshot of feature flag evaluations for a single distinctId at a point in time.

Returned by IPostHog.evaluateFlags — branch on `isEnabled()` / `getFlag()`
and pass the same object to `capture()` via the `flags` option so the captured event
carries the exact flag values the code branched on.

```ts
const flags = await posthog.evaluateFlags(distinctId, { personProperties: { plan: 'enterprise' } })

if (flags.isEnabled('new-dashboard')) {
  renderNewDashboard()
}

posthog.capture({ distinctId, event: 'page_viewed', flags })
```

To narrow the set of flags that get attached to a captured event, use the in-memory
helpers `only([...])` and `onlyAccessed()`. To narrow the set of flags requested from
the server in the first place, pass `flagKeys` to `evaluateFlags()`.

#### Accessors

##### keys

###### Get Signature

> **get** **keys**(): `string`[]

Returns the flag keys that are part of this evaluation.

###### Returns

`string`[]

##### unresolvedFlags

###### Get Signature

> **get** **unresolvedFlags**(): `Readonly`\<`Record`\<`string`, `UnresolvedFlagReason`\>\>

Flags that have a loaded local definition but that neither local evaluation nor a remote
fallback resolved, mapped to the reason local evaluation was inconclusive. These flags are
absent from `keys`, and their accessors return undefined (`isEnabled` returns false). Reading
this does not count as an access and does not fire any event.

Always empty on snapshots returned by `only()` / `onlyAccessed()`.

###### Returns

`Readonly`\<`Record`\<`string`, `UnresolvedFlagReason`\>\>

#### Methods

##### getFlag()

> **getFlag**(`key`, `options?`): `FeatureFlagValue` \| `undefined`

Get the evaluated value of a feature flag. Fires a `$feature_flag_called` event
on the first access per (distinctId, flag, value) tuple, unless events are off for
this read (see `options.sendFeatureFlagEvents`).

Returns the variant string for multivariate flags, `true` for boolean flags that
evaluate on, `false` for boolean flags that conclusively evaluate off, and `undefined`
for flags that were not returned by the evaluation. Cached inactive definitions are
conclusive `false` results during local evaluation, while remote evaluation omits
globally inactive flags.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature flag key |
| `options?` | \{ `sendFeatureFlagEvents?`: `boolean`; \} | `sendFeatureFlagEvents`: whether this read sends a `$feature_flag_called` event. Defaults to the client's `sendFeatureFlagEvent` option, which defaults to `true`. When `false`, the read sends nothing and does not mark the flag as reported, so a later read that sends events still reports it. The flag still counts as accessed for `onlyAccessed()`. |
| `options.sendFeatureFlagEvents?` | `boolean` | - |

###### Returns

`FeatureFlagValue` \| `undefined`

##### getFlagPayload()

> **getFlagPayload**(`key`): `JsonType` \| `undefined`

Get the payload associated with a feature flag. Does not count as an access
for `onlyAccessed()` and does not fire any event.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |

###### Returns

`JsonType` \| `undefined`

##### isEnabled()

> **isEnabled**(`key`, `options?`): `boolean`

Check whether a feature flag is enabled. Fires a `$feature_flag_called` event
on the first access per (distinctId, flag, value) tuple, deduped via the SDK's
existing cache, unless events are off for this read (see `options.sendFeatureFlagEvents`).

Flags that were not returned from the underlying evaluation resolve to
`options.defaultValue` (`false` unless overridden). A flag that has a value —
including a conclusive `false` result and variant strings — always wins over
`options.defaultValue`. Use `getFlag()` to distinguish an absent result from `false`.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature flag key |
| `options?` | \{ `defaultValue?`: `boolean`; `sendFeatureFlagEvents?`: `boolean`; \} | `defaultValue`: the result when the flag is not in the snapshot. `sendFeatureFlagEvents`: whether this read sends a `$feature_flag_called` event. Defaults to the client's `sendFeatureFlagEvent` option, which defaults to `true`. When `false`, the read sends nothing and does not mark the flag as reported, so a later read that sends events still reports it. The flag still counts as accessed for `onlyAccessed()`. |
| `options.defaultValue?` | `boolean` | - |
| `options.sendFeatureFlagEvents?` | `boolean` | - |

###### Returns

`boolean`

##### only()

> **only**(`keys`): `FeatureFlagEvaluations`

Return a filtered copy containing only flags with the given keys. Keys that
are not present in the evaluation are dropped and logged as a warning.

**Note:** like `onlyAccessed()`, the returned snapshot is intended for `capture()`.
Branching on a filtered key that was excluded from the slice is a no-op.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `keys` | `string`[] |

###### Returns

`FeatureFlagEvaluations`

##### onlyAccessed()

> **onlyAccessed**(): `FeatureFlagEvaluations`

Return a filtered copy containing only flags that have been accessed via
`isEnabled()` or `getFlag()` before this call, including reads that sent no
`$feature_flag_called` event.

Order-dependent: if nothing has been accessed yet, the returned snapshot is
empty. The method honors its name — pre-access if you want a populated result.

**Note:** the returned snapshot is intended for `capture()`, not for further
branching. Calling `isEnabled()` / `getFlag()` on it for a key that was filtered
out is a no-op (no event is fired) — the flag wasn't actually missing, it was
excluded from the slice.

###### Returns

`FeatureFlagEvaluations`

## Group identify

### `PostHog.groupIdentify`

> **groupIdentify**(`data`): `void`

Create or update a group and its properties.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `data` | `GroupIdentifyMessage` | The group identify data |

#### Returns

`void`

#### Examples

```ts
// Create a company group
client.groupIdentify({
  groupType: 'company',
  groupKey: 'acme-corp',
  properties: {
    name: 'Acme Corporation',
    industry: 'Technology',
    employee_count: 500
  },
  distinctId: 'user_123'
})
```

```ts
// Update organization properties
client.groupIdentify({
  groupType: 'organization',
  groupKey: 'org-456',
  properties: {
    plan: 'enterprise',
    region: 'US-West'
  }
})
```

### `PostHog.groupIdentifyImmediate`

> **groupIdentifyImmediate**(`data`): `Promise`\<`void`\>

Create or update a group and its properties immediately (synchronously).

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `data` | `GroupIdentifyMessage` | The group identify data |

#### Returns

`Promise`\<`void`\>

Promise that resolves when the group identify is processed

#### Example

```ts
// Immediately create or update a company group
await client.groupIdentifyImmediate({
  groupType: 'company',
  groupKey: 'acme-corp',
  properties: {
    name: 'Acme Corporation',
    industry: 'Technology',
    employee_count: 500
  }
})
```

## Is feature enabled

### `PostHog.isFeatureEnabled`

> **isFeatureEnabled**(`key`, `distinctId`, `options?`): `Promise`\<`boolean` \| `undefined`\>

Check if a feature flag is enabled for a specific user.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature flag key |
| `distinctId` | `string` | The user's distinct ID |
| `options?` | \{ `disableGeoip?`: `boolean`; `groupProperties?`: `Record`\<`string`, `Properties`\>; `groups?`: `Record`\<`string`, `string`\>; `onlyEvaluateLocally?`: `boolean`; `personProperties?`: `Properties`; `sendFeatureFlagEvents?`: `boolean`; \} | Optional configuration for flag evaluation |
| `options.disableGeoip?` | `boolean` | - |
| `options.groupProperties?` | `Record`\<`string`, `Properties`\> | - |
| `options.groups?` | `Record`\<`string`, `string`\> | - |
| `options.onlyEvaluateLocally?` | `boolean` | - |
| `options.personProperties?` | `Properties` | - |
| `options.sendFeatureFlagEvents?` | `boolean` | - |

#### Returns

`Promise`\<`boolean` \| `undefined`\>

Promise that resolves to true if the flag evaluates on, false if it conclusively evaluates off, or undefined when no evaluation is available

#### Examples

```ts
// Basic feature flag check
const isEnabled = await client.isFeatureEnabled('new-feature', 'user_123')
if (isEnabled) {
  // Feature is enabled
  console.log('New feature is active')
} else {
  // Flag evaluated off, or no value was returned
  console.log('New feature is not active')
}
```

```ts
// With groups and properties
const isEnabled = await client.isFeatureEnabled('org-feature', 'user_123', {
  groups: { organization: 'acme-corp' },
  personProperties: { plan: 'enterprise' }
})
```

#### Deprecated

Use evaluateFlags and call `flags.isEnabled(key)` on the returned snapshot.
  This consolidates flag evaluation into a single `/flags` request per incoming request.
  Will be removed in the next major version.

## Is opt out

### `PostHog.isDisabled`

> **get** **isDisabled**(): `boolean`

##### Returns

`boolean`

### `PostHog.optedOut`

> **get** **optedOut**(): `boolean`

##### Returns

`boolean`

## Opt in

### `PostHog.disable`

> **disable**(): `Promise`\<`void`\>

Disable the PostHog client (opt-out).

#### Returns

`Promise`\<`void`\>

Promise that resolves when the client is disabled

#### Example

```ts
// Disable client
await client.disable()
// Client is now disabled and will not capture events
```

### `PostHog.enable`

> **enable**(): `Promise`\<`void`\>

Enable the PostHog client (opt-in).

#### Returns

`Promise`\<`void`\>

Promise that resolves when the client is enabled

#### Example

```ts
// Enable client
await client.enable()
// Client is now enabled and will capture events
```

### `PostHog.optIn`

> **optIn**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### `PostHog.optOut`

> **optOut**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

## Register

### `PostHog.register`

> **register**(`properties`): `Promise`\<`void`\>

Register properties that every event sent by this client carries.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `properties` | `PostHogEventProperties` | The properties to add to every event |

#### Returns

`Promise`\<`void`\>

#### Remarks

Each event fills the keys it left unset in this order: the event's own values, then context
properties, then these, then the values the SDK adds (such as `$is_server` and
`$geoip_disable`). `before_send` sees the result and can change it.

#### Example

```ts
await client.register({ service: 'billing' })
```

## Reload feature flags

### `PostHog.reloadFeatureFlags`

> **reloadFeatureFlags**(): `Promise`\<`void`\>

Reload feature flag definitions from the configured cache provider or PostHog for local evaluation.

#### Returns

`Promise`\<`void`\>

Promise that resolves when flags are reloaded

#### Examples

```ts
// Force reload of feature flags
await client.reloadFeatureFlags()
console.log('Feature flags reloaded')
```

```ts
// Reload before checking a specific flag
await client.reloadFeatureFlags()
const flag = await client.getFeatureFlag('flag-key', 'user_123')
```

## Set person properties

### `PostHog.setPersonProperties`

> **setPersonProperties**(`data`): `void`

Set properties on a person profile.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `data` | `SetPersonPropertiesMessage` | The data containing distinctId and properties to set |

#### Returns

`void`

#### Example

```ts
client.setPersonProperties({
  distinctId: 'user_123',
  properties: { plan: 'premium' },
  propertiesOnce: { first_seen: '2026-06-15' }
})
```

### `PostHog.unsetPersonProperties`

> **unsetPersonProperties**(`data`): `void`

Remove properties from a person profile.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `data` | `UnsetPersonPropertiesMessage` | The data containing distinctId and property names to unset |

#### Returns

`void`

#### Example

```ts
client.unsetPersonProperties({
  distinctId: 'user_123',
  properties: ['plan', 'email']
})
```

## Shutdown

### `PostHog.shutdown`

> **shutdown**(`shutdownTimeoutMs?`): `Promise`\<`void`\>

Shuts down the PostHog instance and ensures all events are sent.

Call shutdown() once before the process exits to ensure that all events have been sent and all promises
have resolved. Do not use this function if you intend to keep using this PostHog instance after calling it.
Use flush() for per-request cleanup instead.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `shutdownTimeoutMs?` | `number` | Maximum time to wait for shutdown in milliseconds |

#### Returns

`Promise`\<`void`\>

A promise that resolves when shutdown is complete

#### Example

```js
// shutdown before process exit
process.on('SIGINT', async () => {
  await posthog.shutdown()
  process.exit(0)
})
```

## Unregister

### `PostHog.unregister`

> **unregister**(`property`): `Promise`\<`void`\>

Remove a property added with `register()`.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `property` | `string` | The property name to remove |

#### Returns

`Promise`\<`void`\>

## Flag definition loader

### `PostHog.isLocalEvaluationReady`

> **isLocalEvaluationReady**(): `boolean`

Check if local evaluation of feature flags is ready.

#### Returns

`boolean`

true if local evaluation is ready, false otherwise

#### Example

```ts
// Check if ready
if (client.isLocalEvaluationReady()) {
  // Local evaluation is ready, can evaluate flags locally
  const flag = await client.getFeatureFlag('flag-key', 'user_123')
} else {
  // Local evaluation not ready, will use remote evaluation
  const flag = await client.getFeatureFlag('flag-key', 'user_123')
}
```

### `PostHog.waitForLocalEvaluationReady`

> **waitForLocalEvaluationReady**(`timeoutMs?`): `Promise`\<`boolean`\>

Wait for local evaluation of feature flags to be ready.

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `timeoutMs?` | `number` | `THIRTY_SECONDS` | Timeout in milliseconds (default: 30000) |

#### Returns

`Promise`\<`boolean`\>

Promise that resolves to true if ready, false if timed out

#### Examples

```ts
// Wait for local evaluation
const isReady = await client.waitForLocalEvaluationReady()
if (isReady) {
  console.log('Local evaluation is ready')
} else {
  console.log('Local evaluation timed out')
}
```

```ts
// Wait with custom timeout
const isReady = await client.waitForLocalEvaluationReady(10000) // 10 seconds
```

## Remote config

### `PostHog.getRemoteConfigPayload`

> **getRemoteConfigPayload**(`flagKey`): `Promise`\<`JsonType` \| `undefined`\>

Get the remote config payload for a feature flag.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `flagKey` | `string` | The feature flag key |

#### Returns

`Promise`\<`JsonType` \| `undefined`\>

Promise that resolves to the remote config payload or undefined

#### Example

```ts
// Get remote config payload
const payload = await client.getRemoteConfigPayload('flag-key')
if (payload) {
  console.log('Remote config payload:', payload)
}
```

#### Throws

Error if personal API key is not provided

## SDK utils

### `PostHog.metrics`

> **get** **metrics**(): `Metrics`

The `posthog.metrics` API: a statsd-style pre-aggregating metrics client — alpha.
Samples are folded into per-series aggregates in memory and flushed
periodically as one OTLP data point per series per window, so recording
from hot paths is cheap. Configure via the `metrics` client option.

##### Example

```ts
client.metrics.count('jobs.processed', 1, { attributes: { queue: 'default' } })
client.metrics.gauge('queue.depth', 42)
client.metrics.histogram('job.duration', 187, { unit: 'ms' })
```

##### Returns

`Metrics`

#### Description

The `posthog.metrics` API: a statsd-style pre-aggregating metrics client (count,
gauge, histogram) — alpha. Samples are folded into per-series aggregates in memory and flushed
periodically. Configure via the `metrics` client option.

### `PostHog.enterContext`

> **enterContext**(`data`, `options?`): `void`

Set context without a callback wrapper.

Uses `AsyncLocalStorage.enterWith()` to attach context to the current
async execution context. The context lives until that async context ends.

Must be called in the same async scope that makes PostHog calls.
Calling this outside a request-scoped async context will leak context
across unrelated work. Prefer `withContext()` when you can wrap code
in a callback — it creates an isolated scope that cleans up automatically.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `data` | `Partial`\<`ContextData`\> | Context data to apply (distinctId, sessionId, properties, options) |
| `options?` | `ContextOptions` | Context options (fresh: true to start with clean context instead of inheriting) |

#### Returns

`void`

### `PostHog.getContext`

> **getContext**(): `ContextData` \| `undefined`

Get the current context data.

#### Returns

`ContextData` \| `undefined`

The current context data, or undefined if no context is set

#### Example

```ts
// Get current context within a withContext block
posthog.withContext({ distinctId: 'user_123' }, () => {
  const context = posthog.getContext()
  console.log(context?.distinctId) // 'user_123'
})
```

### `PostHog.getFeatureFlagEvaluationRuntime`

> **getFeatureFlagEvaluationRuntime**(`key`): `FeatureFlagEvaluationRuntime` \| `undefined`

Get where a locally loaded feature flag is meant to be evaluated.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature flag key |

#### Returns

`FeatureFlagEvaluationRuntime` \| `undefined`

The flag's evaluation runtime, or undefined when local evaluation has not loaded a
definition for this key

#### Remarks

Read from the definitions local evaluation already holds, so no request is made. A
definition that carries no runtime reports `all`, the default PostHog applies.

#### Example

```ts
const runtime = client.getFeatureFlagEvaluationRuntime('my-flag')
// Returns: 'client'
```

### `PostHog.getFeatureFlagKeysByEvaluationRuntime`

> **getFeatureFlagKeysByEvaluationRuntime**(`evaluationRuntime`): `string`[]

Get the keys of locally loaded flags that a runtime can evaluate.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `evaluationRuntime` | `FeatureFlagEvaluationRuntime` | The runtime to match |

#### Returns

`string`[]

The matching flag keys, in the order local evaluation loaded them. Empty when no
definitions are loaded

#### Remarks

A flag set to `all` suits either runtime, so it is returned for `client` and for `server`,
and asking for `all` returns every loaded flag. Use this to decide which flags to hand to a
browser when a backend serves flags to its own frontend.

#### Example

```ts
const clientKeys = client.getFeatureFlagKeysByEvaluationRuntime('client')
// Returns: ['web-banner', 'shared-copy']
```

### `PostHog.on`

> **on**(`event`, `cb`): () => `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | `string` |
| `cb` | (...`args`) => `void` |

#### Returns

() => `void`

### `PostHog.overrideFeatureFlags`

> **overrideFeatureFlags**(`overrides`): `void`

Override feature flags locally. Useful for testing and local development.
Overridden flags take precedence over both local evaluation and remote evaluation.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `overrides` | `OverrideFeatureFlagsOptions` | Flag overrides configuration |

#### Returns

`void`

#### Example

```ts
// Clear all overrides
client.overrideFeatureFlags(false)

// Enable a list of flags (sets them to true)
client.overrideFeatureFlags(['flag-a', 'flag-b'])

// Set specific flag values/variants
client.overrideFeatureFlags({ 'my-flag': 'variant-a', 'other-flag': true })

// Set both flags and payloads
client.overrideFeatureFlags({
  flags: { 'my-flag': 'variant-a' },
  payloads: { 'my-flag': { discount: 20 } }
})
```

### `PostHog.registerOptions`

> **registerOptions**(`options`): `Promise`\<`void`\>

Register options that every event sent by this client carries.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options` | `Record`\<`string`, `JsonType`\> | The options to add to every event |

#### Returns

`Promise`\<`void`\>

#### Remarks

Each event fills the options it left unset (missing or `null`) in this order: the event's own
`options`, then context options, then these, then the options the SDK adds (such as
`process_person_profile: false` for an event with no distinct id). `before_send` sees the
result and can change it. Values are sent to capture unchanged. Capture drops an event whose
option value it cannot read, so a bad value registered here drops every event. An option beats
its legacy property, such as `$process_person_profile`, wherever either one was set.

#### Example

```ts
await client.registerOptions({ cookieless_mode: true })
```

### `PostHog.unregisterOptions`

> **unregisterOptions**(`key`): `Promise`\<`void`\>

Remove an option added with `registerOptions()`.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The option name to remove |

#### Returns

`Promise`\<`void`\>

### `PostHog.withContext`

> **withContext**\<`T`\>(`data`, `fn`, `options?`): `T`

Run a function with specific context that will be applied to all events captured within that context.
It propagates the context to all subsequent calls down the call stack.
Context properties like tags and sessionId will be automatically attached to all events.
By default, nested contexts inherit from parent contexts. Use `{ fresh: true }` to start with a clean context.

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t"></a> `T` |

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `data` | `Partial`\<`ContextData`\> | Context data to apply (sessionId, distinctId, properties, options) |
| `fn` | () => `T` | Function to run with the context |
| `options?` | `ContextOptions` | Context options (fresh: true to start with clean context instead of inheriting) |

#### Returns

`T`

The return value of the function

#### Remarks

Context `properties` and `options` fill only what an event left unset: the event's own values
win, and context values beat `register()` and `registerOptions()` values and the values the SDK
adds. `before_send` sees the result and can change it.

#### Example

```ts
posthog.withContext({ distinctId: 'user_123' }, () => {
  posthog.capture({ event: 'button clicked' })
})
```

### `FeatureFlagError`

> `const` **FeatureFlagError**: `object`

Error type constants for the $feature_flag_error property.

These values are sent in analytics events to track flag evaluation failures.
They should not be changed without considering impact on existing dashboards
and queries that filter on these values.

Error values:
  ERRORS_WHILE_COMPUTING: Server returned errorsWhileComputingFlags=true
  FLAG_MISSING: Requested flag not in API response
  LOCAL_EVALUATION_INCONCLUSIVE: Flag has a loaded local definition but local evaluation could not resolve it
  QUOTA_LIMITED: Rate/quota limit exceeded
  TIMEOUT: Request timed out
  CONNECTION_ERROR: Network connection failed
  apiError: HTTP error with status code (e.g., api_error_500)

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-apierror"></a> `apiError()` | (`status`) => `string` |
| <a id="property-connection_error"></a> `CONNECTION_ERROR` | `"connection_error"` |
| <a id="property-errors_while_computing"></a> `ERRORS_WHILE_COMPUTING` | `"errors_while_computing_flags"` |
| <a id="property-flag_missing"></a> `FLAG_MISSING` | `"flag_missing"` |
| <a id="property-local_evaluation_inconclusive"></a> `LOCAL_EVALUATION_INCONCLUSIVE` | `"local_evaluation_inconclusive"` |
| <a id="property-quota_limited"></a> `QUOTA_LIMITED` | `"quota_limited"` |
| <a id="property-timeout"></a> `TIMEOUT` | `"timeout"` |
| <a id="property-unknown_error"></a> `UNKNOWN_ERROR` | `"unknown_error"` |

### `uuidv7`

> `const` **uuidv7**: () => `string`

Generates a UUIDv7 string.

#### Returns

`string`

The 8-4-4-4-12 canonical hexadecimal string representation
("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx").

### `cookieStateToProperties`

> **cookieStateToProperties**(`state`): `Record`\<`string`, `string`\> \| `undefined`

Converts cookie state into PostHog properties (e.g. `$session_id`, `$device_id`).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `state` | `PostHogCookieState` \| `null` |

#### Returns

`Record`\<`string`, `string`\> \| `undefined`

### `cookieStoreFromHeader`

> **cookieStoreFromHeader**(`cookieHeader`): `CookieStore`

Adapts a raw `Cookie` header string into a CookieStore.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `cookieHeader` | `string` |

#### Returns

`CookieStore`

### `createEventProcessor`

> **createEventProcessor**(`_posthog`, `options?`): (`event`) => `any`

Creates an event processor for the deprecated Sentry integration.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `_posthog` | `PostHogBackendClient` |
| `options?` | `SentryIntegrationOptions` |

#### Returns

(`event`) => `any`

#### Deprecated

This integration is deprecated and will be removed in a future major version. Use PostHog Error Tracking for Node instead:
https://posthog.com/docs/error-tracking/installation/node

### `getPostHogCookieName`

> **getPostHogCookieName**(`apiKey`): `string`

Returns the PostHog cookie name for the given API key.

PostHog-js stores state in a cookie named `ph_<sanitized_token>_posthog`.
The token is sanitized by replacing `+` with `PL`, `/` with `SL`, `=` with `EQ`.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `apiKey` | `string` | The PostHog project API key |

#### Returns

`string`

The cookie name string

### `parsePostHogCookie`

> **parsePostHogCookie**(`cookieValue`): `PostHogCookieState` \| `null`

Parses a PostHog cookie value and extracts identity information.

The cookie value is a JSON object containing `distinct_id` and `$user_state`.
A user is considered identified if `$user_state` is `'identified'`.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `cookieValue` | `string` | The raw cookie string value |

#### Returns

`PostHogCookieState` \| `null`

Parsed identity state, or null if the cookie is missing/invalid

### `readPostHogCookie`

> **readPostHogCookie**(`cookies`, `apiKey`): `PostHogCookieState` \| `null`

Reads and parses the PostHog cookie from a cookie store.

Compatible with Next.js `cookies()`, `request.cookies`, and any object
with a `get(name)` method that returns `{ value: string } | undefined`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `cookies` | `CookieStore` |
| `apiKey` | `string` |

#### Returns

`PostHogCookieState` \| `null`

### `serializePostHogCookie`

> **serializePostHogCookie**(`anonymousId`): `string`

Serializes an anonymous ID into the JSON format posthog-js expects.

When `distinct_id === $device_id`, posthog-js treats the user as anonymous.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `anonymousId` | `string` | The anonymous distinct ID to serialize |

#### Returns

`string`

JSON string suitable for the PostHog cookie value

### `setupExpressRequestContext`

> **setupExpressRequestContext**(`_posthog`, `app`): `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `_posthog` | `PostHogBackendClient` |
| `app` | \{ `use`: (`middleware`) => `unknown`; \} |
| `app.use` | (`middleware`) => `unknown` |

#### Returns

`void`

## Types

### `ActionStepStringMatching`

> **ActionStepStringMatching** = *typeof* `ActionStepStringMatching`\[keyof *typeof* `ActionStepStringMatching`\]

Sync with plugin-server/src/types.ts

### `ActionStepType`

> **ActionStepType** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="event"></a> `event?` | `string` | - |
| <a id="href"></a> `href?` | `string` | - |
| <a id="href_matching"></a> `href_matching?` | `ActionStepStringMatching` | **Default** `ActionStepStringMatching.Exact` |
| <a id="selector"></a> `selector?` | `string` | - |
| <a id="text"></a> `text?` | `string` | - |
| <a id="text_matching"></a> `text_matching?` | `ActionStepStringMatching` | **Default** `StringMatching.Exact` |
| <a id="url"></a> `url?` | `string` | - |
| <a id="url_matching"></a> `url_matching?` | `ActionStepStringMatching` | **Default** `StringMatching.Contains` |

### `AllFlagsOptions`

> **AllFlagsOptions** = `BaseFlagEvaluationOptions` & `object`

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `flagKeys?` | `string`[] | Restrict local evaluation, the `/flags` request, and the returned snapshot to these keys. An empty array returns an empty snapshot without evaluating flags; omitting this option evaluates all flags. `evaluateFlags()` falls back remotely when a requested key is missing from local definitions unless `onlyEvaluateLocally` is true. Remote evaluation responses are not cached, so a key missing both locally and remotely costs one `/flags` request per call. |

### `BaseFlagEvaluationOptions`

> **BaseFlagEvaluationOptions** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="disablegeoip"></a> `disableGeoip?` | `boolean` | - |
| <a id="groupproperties"></a> `groupProperties?` | `Record`\<`string`, `Properties`\> | - |
| <a id="groups"></a> `groups?` | `Record`\<`string`, `string`\> | - |
| <a id="onlyevaluatelocally"></a> `onlyEvaluateLocally?` | `boolean` | Skip remote fallback and omit flags that local definitions cannot resolve. |
| <a id="personproperties"></a> `personProperties?` | `Properties` | - |

### `BasicSurveyQuestion`

> **BasicSurveyQuestion** = `SurveyQuestionBase` & `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `type` | *typeof* `SurveyQuestionType.Open` |

### `BeforeSendFn`

> **BeforeSendFn** = (`event`) => `EventMessage` \| `null`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | `EventMessage` |

#### Returns

`EventMessage` \| `null`

### `BeforeSendFn`

> **BeforeSendFn** = (`event`) => `CaptureEvent` \| `null`

Function type for the `before_send` hook.
Receives an event and can return a modified event or null to drop the event.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | `CaptureEvent` |

#### Returns

`CaptureEvent` \| `null`

### `BeforeSendMetricFn`

> **BeforeSendMetricFn** = (`sample`) => `MetricSample` \| `null`

Pre-aggregation filter. Return the (possibly transformed) sample to keep
it; return `null` to drop it. Configure as a single function or an array
forming a left-to-right chain; a `null` from any link drops the sample and
a thrown error also drops it (the error is logged).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sample` | `MetricSample` |

#### Returns

`MetricSample` \| `null`

#### Example

**Drop debug metrics in production**

```ts
metrics: { beforeSend: (m) => (m.name.startsWith('debug_') ? null : m) }
```

### `BeforeSpanSendFn`

> **BeforeSpanSendFn** = (`span`) => `SpanRecord` \| `null`

**`Experimental`**

Inspects, edits or drops a finished span. Return `null` to drop it.

The hook runs synchronously as part of `end()`; a returned promise is not
awaited and the span is dropped.

 Subject to change in a minor release.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `span` | `SpanRecord` |

#### Returns

`SpanRecord` \| `null`

### `CaptureDroppedEvent`

A single event the server explicitly rejected (`drop`).

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-details"></a> `details?` | `string` |
| <a id="property-uuid"></a> `uuid` | `string` |

### `CaptureEndpoint`

> **CaptureEndpoint** = *typeof* `ANALYTICS_CAPTURE_ENDPOINT` \| *typeof* `AI_CAPTURE_ENDPOINT`

### `CaptureErrorParams`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-cause"></a> `cause?` | `unknown` | The underlying transport/HTTP/parse failure, when the whole batch failed. |
| <a id="property-drops"></a> `drops` | `CaptureDroppedEvent`[] | Events the server rejected outright (billing/validation). |
| <a id="property-endpoint"></a> `endpoint` | `CaptureEndpoint` | The capture lane the batch was sent to. |
| <a id="property-requestid"></a> `requestId` | `string` | - |
| <a id="property-retryexhausted"></a> `retryExhausted` | `string`[] | UUIDs of events still pending `retry` after the attempt budget was exhausted, or lost to a batch-level failure. |

### `CaptureEvent`

> **CaptureEvent** = `object`

Represents an event before it's sent to PostHog.
This is the interface exposed to the `before_send` hook, matching the web SDK's `CaptureResult`.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="set"></a> `$set?` | `PostHogEventProperties` | Properties to set on the person (overrides existing values) |
| <a id="set_once"></a> `$set_once?` | `PostHogEventProperties` | Properties to set on the person only once (does not override existing values) |
| <a id="event-1"></a> `event` | `string` | The name of the event |
| <a id="properties"></a> `properties?` | `PostHogEventProperties` | Properties associated with the event (optional to allow compatibility with Node SDK's EventMessage) |
| <a id="timestamp"></a> `timestamp?` | `Date` | Timestamp for the event |
| <a id="uuid"></a> `uuid?` | `string` | UUID for the event (optional to allow compatibility with Node SDK's EventMessage). Must be a valid UUID. |

### `CaptureExceptionOptions`

> **CaptureExceptionOptions** = `object`

Options for `captureException()` and `captureExceptionImmediate()`.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="distinctid"></a> `distinctId?` | `string` | The event's distinct id. Without one, the context distinct id is used, else a personless id. |
| <a id="flags"></a> `flags?` | `FeatureFlagEvaluations` | A `FeatureFlagEvaluations` snapshot to attach the same flag context as your other events. |
| <a id="level"></a> `level?` | `SeverityLevel` | The exception's severity, sent as `$exception_level`. An unknown value is ignored. **Default** `'error'` |
| <a id="options-1"></a> `options?` | `Record`\<`string`, `JsonType`\> | Per-event options, as in `capture()`. |
| <a id="properties"></a> `properties?` | `Record`\<`string` \| `number`, `any`\> | Properties to add to the event. Exception properties the SDK or PostHog owns, such as `$exception_list` and `$exception_level`, are ignored: use `level` to set the level. |
| <a id="uuid"></a> `uuid?` | `string` | Overrides the generated event UUID. Must be a valid UUID. |

### `CaptureMetricOptions`

Options accepted by `posthog.metrics.count/gauge/histogram`.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attributes"></a> `attributes?` | `MetricAttributes` | Low-cardinality dimensions to filter and group by (e.g. route, plan, region). Each distinct combination is its own series. |
| <a id="property-unit"></a> `unit?` | `string` | Unit of the value (e.g. 'ms', 'byte'). Displayed in the Metrics UI and part of the series identity — the same name with two units is two series. |

### `Compression`

| Enumeration Member | Value |
| ------ | ------ |
| <a id="enumeration-member-base64"></a> `Base64` | `"base64"` |
| <a id="enumeration-member-gzipjs"></a> `GZipJS` | `"gzip-js"` |

### `ContextData`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-distinctid"></a> `distinctId?` | `string` | - |
| <a id="property-options"></a> `options?` | `Record`\<`string`, `JsonType`\> | Options that fill the options an event left unset (missing or `null`). The event's own options win; these beat options from `registerOptions()`. |
| <a id="property-properties"></a> `properties?` | `Record`\<`string`, `any`\> | Properties that fill the keys an event left unset. The event's own values win. |
| <a id="property-sessionid"></a> `sessionId?` | `string` | - |

### `ContextOptions`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-fresh"></a> `fresh?` | `boolean` | If true, replaces the current context entirely. If false, merges with the existing context (new values override existing ones). **Default** `false` |
| <a id="property-signal"></a> `signal?` | `AbortSignal` | Ends this context and its inherited scopes when aborted, without cancelling the callback. An already aborted signal starts no active context. A fresh context has an independent lifetime. |

### `CookieStore`

Minimal cookie-reading interface compatible with Next.js `cookies()`,
`request.cookies`, and plain objects.

#### Methods

##### get()

> **get**(`name`): \{ `value`: `string`; \} \| `undefined`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

###### Returns

\{ `value`: `string`; \} \| `undefined`

### `EmailDeliveryStatus`

> **EmailDeliveryStatus** = `"queued"` \| `"sent"` \| `"failed"` \| `"delivered"` \| `"bounced"` \| `"complained"`

What happened to an email. Later SDK versions can see values this list does not have yet.

- `queued`: the email waits to go out.
- `sent`: PostHog handed the email to the email provider.
- `failed`: the email was not sent, and `reason` says why.
- `delivered`: the recipient's mail server accepted the email.
- `bounced` and `complained`: the recipient's mail provider reported them after delivery.

### `EmailErrorName`

> **EmailErrorName** = `"validation_error"` \| `"missing_api_key"` \| `"invalid_permission"` \| `"not_found"` \| `"concurrent_idempotent_requests"` \| `"invalid_idempotent_request"` \| `"rate_limit_exceeded"` \| `"monthly_quota_exceeded"` \| `"service_unavailable"` \| `"application_error"`

A coarse category of the failure, for code that branches on the kind of failure rather than the exact `code`.

### `EmailErrorParams`

| Property | Type |
| ------ | ------ |
| <a id="property-cause"></a> `cause?` | `unknown` |
| <a id="property-code"></a> `code` | `string` |
| <a id="property-docsurl"></a> `docsUrl?` | `string` |
| <a id="property-field"></a> `field?` | `string` |
| <a id="property-fix"></a> `fix?` | `string` |
| <a id="property-message"></a> `message` | `string` |
| <a id="property-retryafterms"></a> `retryAfterMs?` | `number` |
| <a id="property-statuscode"></a> `statusCode?` | `number` |
| <a id="property-why"></a> `why?` | `string` |

### `Emails`

The `posthog.emails` API: sends transactional email from PostHog email templates, and reads
the status of each email it sent.

#### Methods

##### get()

> **get**(`id`): `Promise`\<`GetEmailResponse`\>

Read the status of an email that `send()` queued, for 30 days after the send.

Resolves to `{ data, error }` and does not reject. The error code is `not_found` when no
email of this project has the ID, when the email is older than 30 days, or for a few
seconds after the send. Network errors, rate limits and an unavailable service are retried.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

###### Returns

`Promise`\<`GetEmailResponse`\>

##### send()

> **send**(`options`): `Promise`\<`SendEmailResponse`\>

Queue one email from a transactional email template.

Resolves to `{ data, error }` and does not reject. `data` means PostHog queued the email,
not that it was delivered. Network errors, rate limits, an in-flight idempotency key and
an unavailable service are retried with the same idempotency key.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `SendEmailOptions` |

###### Returns

`Promise`\<`SendEmailResponse`\>

### `EmailStatus`

The status of an email that `posthog.emails.send()` queued.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | When PostHog queued the email, as an ISO 8601 timestamp. |
| <a id="property-id"></a> `id` | `string` | The message ID that `send()` returned. |
| <a id="property-reason"></a> `reason` | `string` \| `null` | Why a failed email was not sent, such as `provider_error` or `recipient_suppressed`, or the bounce type of a bounced email: `hard`, `soft` or `unknown`. Null otherwise. |
| <a id="property-status"></a> `status` | `EmailDeliveryStatus` \| `string` & `object` | - |
| <a id="property-statusat"></a> `statusAt` | `string` | When the email reached its current status, as an ISO 8601 timestamp. |

### `EmailWarning`

A warning PostHog returned with a queued email.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-code"></a> `code` | `string` |
| <a id="property-fix"></a> `fix?` | `string` |
| <a id="property-message"></a> `message` | `string` |

### `EndBranching`

> **EndBranching** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="type"></a> `type` | *typeof* `SurveyQuestionBranchingType.End` |

### `EvaluationReason`

> **EvaluationReason** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="code"></a> `code` | `string` \| `undefined` |
| <a id="condition_index"></a> `condition_index` | `number` \| `undefined` |
| <a id="description"></a> `description` | `string` \| `undefined` |

### `EventMessage`

> **EventMessage** = `Omit`\<`IdentifyMessage`, `"distinctId"`\> & `object`

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `_originatedFromCaptureException?` | `boolean` | Internal flag set by captureException() to indicate this $exception event originated from the proper exception capture path. Used to warn users who call capture() with '$exception' directly. |
| `distinctId?` | `string` | The event's distinct id. When it is missing, empty or only whitespace, the context distinct id is used; without one, the event gets a generated id and `options.process_person_profile: false`. |
| `event` | `string` | - |
| `flags?` | `FeatureFlagEvaluations` | Attach feature flag values evaluated via `posthog.evaluateFlags()` to this event. Prefer this over `sendFeatureFlags` — it guarantees the event carries the exact values the code branched on and avoids a hidden `/flags` request on every capture. |
| `groups?` | `Record`\<`string`, `string` \| `number`\> | - |
| `sendFeatureFlags?` | `boolean` \| `SendFeatureFlagsOptions` | **Deprecated** Use the `flags` option with a `FeatureFlagEvaluations` object obtained from `posthog.evaluateFlags()` instead. `sendFeatureFlags` fires a separate `/flags` request on capture and may return different values than the ones the code branched on. |
| `timestamp?` | `Date` | If provided, overrides the auto-generated timestamp. UTC is preferred; non-UTC input is converted to UTC. |
| `uuid?` | `string` | If provided overrides the auto-generated event UUID. Must be a valid UUID. |

### `ExceptionRateLimiterConfig`

Shared configuration for the error tracking burst-protection rate limiter.

Burst protection is scoped **per exception type** — the limiter is keyed by exception type, so
each distinct `$exception` type gets its own token bucket and there is no aggregate cap across
all types. It applies only to autocaptured exceptions; manual `captureException` calls are
never rate limited. These options let customers with high-cardinality exception types tune the
per-type allowance, and are shared between the browser and Node SDKs.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-exceptionratelimiterbucketsize"></a> `exceptionRateLimiterBucketSize?` | `number` | ADVANCED: alters the bucket size for the error tracking rate limiter's token bucket. Normally only altered alongside PostHog support guidance. Accepts values between 0 and 100. **Default** `10` |
| <a id="property-exceptionratelimiterrefillrate"></a> `exceptionRateLimiterRefillRate?` | `number` | ADVANCED: alters the refill rate for the error tracking rate limiter's token bucket. Normally only altered alongside PostHog support guidance. Accepts values between 0 and 100. **Default** `1` |

### `ExpressErrorMiddleware`

> **ExpressErrorMiddleware** = (`error`, `req`, `res`, `next`) => `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `error` | `MiddlewareError` |
| `req` | `Request` |
| `res` | `Response` |
| `next` | (`error`) => `void` |

#### Returns

`void`

### `ExpressMiddleware`

> **ExpressMiddleware** = (`req`, `res`, `next`) => `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `req` | `Request` |
| `res` | `Response` |
| `next` | () => `void` |

#### Returns

`void`

### `FeatureFlagBucketingIdentifier`

> **FeatureFlagBucketingIdentifier** = `"distinct_id"` \| `"device_id"` \| `""` \| `null`

### `FeatureFlagCondition`

> **FeatureFlagCondition** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="aggregation_group_type_index"></a> `aggregation_group_type_index?` | `number` \| `null` |
| <a id="properties-1"></a> `properties` | `FlagProperty`[] |
| <a id="rollout_percentage"></a> `rollout_percentage?` | `number` |
| <a id="variant"></a> `variant?` | `string` |

### `FeatureFlagDetail`

> **FeatureFlagDetail** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="enabled"></a> `enabled` | `boolean` |
| <a id="failed"></a> `failed?` | `boolean` |
| <a id="key-1"></a> `key` | `string` |
| <a id="metadata"></a> `metadata` | `FeatureFlagMetadata` \| `undefined` |
| <a id="reason"></a> `reason` | `EvaluationReason` \| `undefined` |
| <a id="variant"></a> `variant` | `string` \| `undefined` |

### `FeatureFlagErrorType`

> **FeatureFlagErrorType** = *typeof* `FeatureFlagError`\[`Exclude`\<keyof *typeof* `FeatureFlagError`, `"apiError"`\>\] \| `ReturnType`\<*typeof* `apiError`\> \| `string`

### `FeatureFlagEvaluationRuntime`

> **FeatureFlagEvaluationRuntime** = `"all"` \| `"client"` \| `"server"`

Where a feature flag is meant to be evaluated. Set per flag in PostHog and carried on
every locally cached flag definition. `all` means the flag suits both client-side and
server-side evaluation, so it matches either runtime.

### `FeatureFlagMetadata`

> **FeatureFlagMetadata** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="description-1"></a> `description` | `string` \| `undefined` | - |
| <a id="has_experiment"></a> `has_experiment?` | `boolean` | Whether the flag is linked to an experiment. Absent when the server does not report it. |
| <a id="id"></a> `id` | `number` \| `undefined` | - |
| <a id="payload"></a> `payload` | `string` \| `undefined` | - |
| <a id="version"></a> `version` | `number` \| `undefined` | - |

### `FeatureFlagOverrideOptions`

> **FeatureFlagOverrideOptions** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="flags-1"></a> `flags?` | `false` \| `string`[] \| `Record`\<`string`, `FeatureFlagValue`\> | Flag overrides. Can be: - `false` to clear flag overrides - `string[]` to enable a list of flags - `Record<string, FeatureFlagValue>` to set specific values/variants |
| <a id="payloads"></a> `payloads?` | `false` \| `Record`\<`string`, `JsonType`\> | Payload overrides for flags. - `false` to clear payload overrides - `Record<string, JsonType>` to set specific payloads |

### `FeatureFlagResult`

> **FeatureFlagResult** = `object`

Result of evaluating a feature flag, including its value and payload.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="enabled"></a> `enabled` | `boolean` | Whether the returned feature flag evaluation is enabled. `false` is a conclusive off result. |
| <a id="key"></a> `key` | `string` | - |
| <a id="payload"></a> `payload` | `JsonType` \| `undefined` | - |
| <a id="reason"></a> `reason?` | `string` | PostHog's evaluation explanation, when available. |
| <a id="reasoncode"></a> `reasonCode?` | `string` | Stable evaluation reason code, when available (for example, `flag_disabled`). |
| <a id="variant-1"></a> `variant` | `string` \| `undefined` | - |

### `FeatureFlagValue`

> **FeatureFlagValue** = `string` \| `boolean`

### `FlagDefinitionCacheData`

Represents the complete set of feature flag data needed for local evaluation.

This includes flag definitions, group type mappings, and cohort property groups.
Newly published data includes snake_case keys and camelCase aliases so existing
providers and older Node SDKs can continue to read the same cache.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-cohorts"></a> `cohorts` | `Record`\<`string`, `PropertyGroup`\> | Cohort property groups for local evaluation |
| <a id="property-flags"></a> `flags` | `PostHogFeatureFlag`[] | Array of feature flag definitions |
| <a id="property-group_type_mapping"></a> `group_type_mapping?` | `Record`\<`string`, `string`\> | Mapping of group type index to group name, using the flag-definitions endpoint's field name. |
| <a id="property-grouptypemapping"></a> `groupTypeMapping` | `Record`\<`string`, `string`\> | Legacy alias for group_type_mapping, retained for existing providers and cache readers. |
| <a id="property-minimal_flag_called_events"></a> `minimal_flag_called_events?` | `boolean` | Server-controlled gate for minimal `$feature_flag_called` events, from the top-level `minimal_flag_called_events` field of the flag-definitions payload. If neither this field nor its legacy alias is present, full events are sent. |
| <a id="property-minimalflagcalledevents"></a> `minimalFlagCalledEvents?` | `boolean` | Legacy alias for minimal_flag_called_events. |
| <a id="property-property_matching_version"></a> `property_matching_version?` | `number` | Top-level definitions matching version; absent in older caches means legacy matching. |
| <a id="property-propertymatchingversion"></a> `propertyMatchingVersion?` | `number` | Legacy alias for property_matching_version. |

### `FlagDefinitionCacheInput`

> **FlagDefinitionCacheInput** = `FlagDefinitionCacheData` \| `Omit`\<`FlagDefinitionCacheData`, `"groupTypeMapping"`\> & `object`

Cache reads accept endpoint-shaped snake_case data or older camelCase data.
When both forms are present, snake_case takes precedence.

### `FlagDefinitionCacheProvider`

Provider interface for caching feature flag definitions.

Implementations can use this to control when flag definitions are fetched
and how they're cached (Redis, database, filesystem, etc.).

This interface is designed for server-side environments where multiple workers
need to share flag definitions and coordinate fetching to reduce API calls.
Without a secretKey or personalApiKey, instances are cache-only readers: each refresh
reads cached definitions without calling shouldFetchFlagDefinitions or publishing data.
Instances with a credential coordinate fetching and publish fresh definitions.

All methods may throw errors - the poller will catch and log them gracefully,
ensuring cache provider errors never break flag evaluation.

#### Example

```typescript
import type { FlagDefinitionCacheData, FlagDefinitionCacheInput, FlagDefinitionCacheProvider } from 'posthog-node'

class RedisFlagCache implements FlagDefinitionCacheProvider<FlagDefinitionCacheInput> {
  constructor(private redis: Redis, private teamKey: string) { }

  async getFlagDefinitions(): Promise<FlagDefinitionCacheInput | undefined> {
    const cached = await this.redis.get(`posthog:flags:${this.teamKey}`)
    return cached ? JSON.parse(cached) : undefined
  }

  async shouldFetchFlagDefinitions(): Promise<boolean> {
    // Acquire distributed lock - only one worker fetches
    const acquired = await this.redis.set(`posthog:flags:${this.teamKey}:lock`, '1', 'EX', 60, 'NX')
    return acquired === 'OK'
  }

  async onFlagDefinitionsReceived(data: FlagDefinitionCacheData): Promise<void> {
    await this.redis.set(`posthog:flags:${this.teamKey}`, JSON.stringify(data), 'EX', 300)
    await this.redis.del(`posthog:flags:${this.teamKey}:lock`)
  }

  async shutdown(): Promise<void> {
    await this.redis.del(`posthog:flags:${this.teamKey}:lock`)
  }
}
```

#### Type Parameters

| Type Parameter | Default type | Description |
| ------ | ------ | ------ |
| <a id="type-parameter-cachedata"></a> `CacheData` *extends* `FlagDefinitionCacheInput` | `FlagDefinitionCacheData` | The shape returned by cache reads. Use FlagDefinitionCacheInput to accept snake_case entries as well as legacy camelCase entries. |

#### Methods

##### getFlagDefinitions()

> **getFlagDefinitions**(): `CacheData` \| `Promise`\<`CacheData` \| `undefined`\> \| `undefined`

Retrieve cached flag definitions.

Called when the poller is refreshing in-memory flag definitions. If this returns undefined
(or throws an error), the poller will fetch fresh data from the PostHog API if no flag
definitions are in memory and a secretKey or personalApiKey is configured. Otherwise,
existing in-memory definitions are retained until the next refresh.

###### Returns

`CacheData` \| `Promise`\<`CacheData` \| `undefined`\> \| `undefined`

cached definitions if available, undefined if cache is empty

###### Throws

if an error occurs while accessing the cache (error will be logged)

##### onFlagDefinitionsReceived()

> **onFlagDefinitionsReceived**(`data`): `void` \| `Promise`\<`void`\>

Called after successfully receiving new flag definitions from PostHog.

Store the definitions in your cache backend here. This is called only
after a successful API response with valid flag data.

If this method throws, the error is logged but flag definitions are still
stored in memory, ensuring local evaluation can still be performed.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `data` | `FlagDefinitionCacheData` | The complete flag definition data from PostHog |

###### Returns

`void` \| `Promise`\<`void`\>

###### Throws

if storage backend is unavailable (error will be logged)

##### shouldFetchFlagDefinitions()

> **shouldFetchFlagDefinitions**(): `boolean` \| `Promise`\<`boolean`\>

Determines whether this instance should fetch new flag definitions.

Called only when a secretKey or personalApiKey is configured. Cache-only readers
skip this method and read cached definitions directly on each refresh.
Use this to implement distributed coordination (e.g., via distributed locks)
to ensure only one credentialed instance fetches at a time in a multi-worker setup.

When multiple workers share a cache, typically only one should fetch while
others use cached data. Implementations can use Redis locks, database locks,
or other coordination mechanisms.

###### Returns

`boolean` \| `Promise`\<`boolean`\>

true if this instance should fetch, false to skip and read cache

###### Throws

if coordination backend is unavailable (error will be logged, fetch continues)

##### shutdown()

> **shutdown**(): `void` \| `Promise`\<`void`\>

Called when the PostHog client shuts down.

Release any held locks, close connections, or clean up resources here.

Both sync and async cleanup are supported. Async cleanup has a timeout
(default 30s, configurable via client shutdown options) to prevent the
process shutdown from hanging indefinitely.

###### Returns

`void` \| `Promise`\<`void`\>

Promise that resolves when cleanup is complete, or void for sync cleanup

### `FlagEvaluationOptions`

> **FlagEvaluationOptions** = `BaseFlagEvaluationOptions` & `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `sendFeatureFlagEvents?` | `boolean` |

### `FlagProperty`

> **FlagProperty** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="dependency_chain"></a> `dependency_chain?` | `string`[] |
| <a id="key-1"></a> `key` | `string` |
| <a id="negation"></a> `negation?` | `boolean` |
| <a id="operator"></a> `operator?` | `string` |
| <a id="type"></a> `type?` | `string` |
| <a id="value"></a> `value` | `FlagPropertyValue` |

### `FlagPropertyValue`

> **FlagPropertyValue** = `string` \| `number` \| (`string` \| `number`)[] \| `boolean`

### `GetEmailResponse`

> **GetEmailResponse** = \{ `data`: `EmailStatus`; `error`: `null`; \} \| \{ `data`: `null`; `error`: `EmailError`; \}

What `posthog.emails.get()` resolves to. Exactly one of `data` and `error` is set.
The promise does not reject.

### `GroupIdentifyMessage`

> **GroupIdentifyMessage** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="disablegeoip-1"></a> `disableGeoip?` | `boolean` | - |
| <a id="distinctid-1"></a> `distinctId?` | `string` | The event's distinct id. When it is missing, empty or only whitespace, the context distinct id is used, then `$<groupType>_<groupKey>`. |
| <a id="groupkey"></a> `groupKey` | `string` | - |
| <a id="grouptype"></a> `groupType` | `string` | - |
| <a id="options-2"></a> `options?` | `Record`\<`string`, `JsonType`\> | Per-event options, sent to capture unchanged. Known keys today are `process_person_profile`, `cookieless_mode`, `disable_skew_correction` (legacy `$ignore_sent_at`) and `product_tour_id`; unknown keys pass through. A legacy property such as `$process_person_profile` fills an option left unset. Capture drops an event whose option value it cannot read (`invalid_options`), and the SDK reports the drop through the `'error'` event. |
| <a id="properties-2"></a> `properties?` | `Record`\<`string` \| `number`, `any`\> | - |

### `IdentifyMessage`

> **IdentifyMessage** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="disablegeoip-2"></a> `disableGeoip?` | `boolean` | - |
| <a id="distinctid-2"></a> `distinctId` | `string` | - |
| <a id="options-3"></a> `options?` | `Record`\<`string`, `JsonType`\> | Per-event options, sent to capture unchanged. Known keys today are `process_person_profile`, `cookieless_mode`, `disable_skew_correction` (legacy `$ignore_sent_at`) and `product_tour_id`; unknown keys pass through. A legacy property such as `$process_person_profile` fills an option left unset. Capture drops an event whose option value it cannot read (`invalid_options`), and the SDK reports the drop through the `'error'` event. |
| <a id="properties-3"></a> `properties?` | `Record`\<`string` \| `number`, `any`\> | - |

### `IPostHog`

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-emails"></a> `emails` | `readonly` | `Emails` | **Description** The `posthog.emails` API: sends transactional email from PostHog email templates. Needs `secretKey`, a project secret API key with the `hog_flow:write` scope. |
| <a id="property-metrics"></a> `metrics` | `readonly` | `Metrics` | **Description** The `posthog.metrics` API: a statsd-style pre-aggregating metrics client (count, gauge, histogram) — alpha. Samples are folded into per-series aggregates in memory and flushed periodically. Configure via the `metrics` client option. |

#### Methods

##### alias()

> **alias**(`data`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `data` | \{ `alias`: `string`; `disableGeoip?`: `boolean`; `distinctId`: `string`; `options?`: `Record`\<`string`, `JsonType`\>; \} |
| `data.alias` | `string` |
| `data.disableGeoip?` | `boolean` |
| `data.distinctId` | `string` |
| `data.options?` | `Record`\<`string`, `JsonType`\> |

###### Returns

`void`

###### Description

To marry up whatever a user does before they sign up or log in with what they do after you need to make an alias call.
This will allow you to answer questions like "Which marketing channels leads to users churning after a month?"
or "What do users do on our website before signing up?"
In a purely back-end implementation, this means whenever an anonymous user does something, you'll want to send a session ID with the capture call.
Then, when that users signs up, you want to do an alias call with the session ID and the newly created user ID.
The same concept applies for when a user logs in. If you're using PostHog in the front-end and back-end,
 doing the identify call in the frontend will be enough.:

##### aliasImmediate()

> **aliasImmediate**(`data`): `Promise`\<`void`\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `data` | \{ `alias`: `string`; `disableGeoip?`: `boolean`; `distinctId`: `string`; `options?`: `Record`\<`string`, `JsonType`\>; \} |
| `data.alias` | `string` |
| `data.disableGeoip?` | `boolean` |
| `data.distinctId` | `string` |
| `data.options?` | `Record`\<`string`, `JsonType`\> |

###### Returns

`Promise`\<`void`\>

###### Description

To marry up whatever a user does before they sign up or log in with what they do after you need to make an alias call.
Useful for edge environments where the usual queue-based sending is not preferable. Do not mix immediate and non-immediate calls.

##### capture()

> **capture**(`distinctId`): `void`

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `distinctId` | `EventMessage` | which uniquely identifies your user |

###### Returns

`void`

###### Description

Capture allows you to capture anything a user does within your system,
which you can later use in PostHog to find patterns in usage,
work out which features to improve or where people are giving up.
A capture call requires:

##### captureAi()

> **captureAi**(`distinctId`): `string` \| `undefined`

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `distinctId` | `EventMessage` | which uniquely identifies your user |

###### Returns

`string` \| `undefined`

The event UUID, or `undefined` when the client is disabled

###### Description

Capture an AI event on the dedicated AI capture endpoint.
Beta: the signature is stable; operational limits (per-event size cap, batching, endpoint) may change without notice. Delivery is async, and no redaction or truncation is applied to the payload.

##### captureAiImmediate()

> **captureAiImmediate**(`distinctId`): `Promise`\<`string` \| `undefined`\>

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `distinctId` | `EventMessage` | which uniquely identifies your user |

###### Returns

`Promise`\<`string` \| `undefined`\>

The event UUID, or `undefined` when the client is disabled

###### Description

Capture an AI event on the dedicated AI capture endpoint, resolving after the send completes. Use in short-lived processes (serverless) where the runtime may freeze before a background flush runs.

##### captureException()

> **captureException**(`error`, `options?`): `void`

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `error` | `unknown` | The error to capture. |
| `options?` | `CaptureExceptionOptions` | Optional distinct id, properties, options, uuid, flags snapshot and level. |

###### Returns

`void`

###### Description

Capture an exception as a $exception event.

##### captureExceptionImmediate()

> **captureExceptionImmediate**(`error`, `options?`): `Promise`\<`void`\>

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `error` | `unknown` | The error to capture. |
| `options?` | `CaptureExceptionOptions` | Optional distinct id, properties, options, uuid, flags snapshot and level. |

###### Returns

`Promise`\<`void`\>

###### Description

Capture an exception as a $exception event immediately.

##### captureImmediate()

> **captureImmediate**(`distinctId`): `Promise`\<`void`\>

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `distinctId` | `EventMessage` | which uniquely identifies your user |

###### Returns

`Promise`\<`void`\>

###### Description

Capture an event immediately. Useful for edge environments where the usual queue-based sending is not preferable. Do not mix immediate and non-immediate calls.

##### enterContext()

> **enterContext**(`data`, `options?`): `void`

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `data` | `Partial`\<`ContextData`\> | Context data to apply (distinctId, sessionId, properties, options) |
| `options?` | `ContextOptions` | Context options (fresh) |

###### Returns

`void`

###### Description

Set context without a callback wrapper. Must be called in the same
async scope that makes PostHog calls. Prefer `withContext()` when you can wrap
code in a callback.

##### evaluateFlags()

###### Call Signature

> **evaluateFlags**(`options?`): `Promise`\<`FeatureFlagEvaluations`\>

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options?` | `AllFlagsOptions` | Optional configuration for flag evaluation. `flagKeys` scopes local evaluation, the `/flags` request, and the returned snapshot. Missing local keys trigger fallback unless `onlyEvaluateLocally` is true. |

###### Returns

`Promise`\<`FeatureFlagEvaluations`\>

###### Description

Evaluate all feature flags for a user in a single call and return a
FeatureFlagEvaluations snapshot. Branch on `.isEnabled()` / `.getFlag()`,
then pass the same snapshot to `capture()` via the `flags` option so events carry
the exact flag values the code branched on.

Prefer this over calling `isFeatureEnabled()` / `getFeatureFlag()` repeatedly and
over `capture({ sendFeatureFlags: true })` — it avoids multiple `/flags` requests
per incoming request.

###### Example

```ts
const flags = await posthog.evaluateFlags('user_123', { personProperties: { plan: 'enterprise' } })
if (flags.isEnabled('new-dashboard')) {
  renderNewDashboard()
}
posthog.capture({ distinctId: 'user_123', event: 'page_viewed', flags })
```

Local evaluation resolves cached inactive definitions to `false`. Remote evaluation omits
globally inactive flags, so those keys are absent when no local definition is available.

###### Call Signature

> **evaluateFlags**(`distinctId`, `options?`): `Promise`\<`FeatureFlagEvaluations`\>

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `distinctId` | `string` | The user's distinct ID |
| `options?` | `AllFlagsOptions` | Optional configuration for flag evaluation. `flagKeys` scopes local evaluation, the `/flags` request, and the returned snapshot. Missing local keys trigger fallback unless `onlyEvaluateLocally` is true. |

###### Returns

`Promise`\<`FeatureFlagEvaluations`\>

###### Description

Evaluate all feature flags for a specific user.

##### getActiveSpan()

> **getActiveSpan**(): `Span` \| `null`

**`Experimental`**

###### Returns

`Span` \| `null`

###### Description

The span currently active on this async execution path, or null outside any
`withSpan` callback.
 Subject to change in a minor release.

##### getAllFlags()

###### Call Signature

> **getAllFlags**(`options?`): `Promise`\<`Record`\<`string`, `FeatureFlagValue`\>\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | `AllFlagsOptions` |

###### Returns

`Promise`\<`Record`\<`string`, `FeatureFlagValue`\>\>

###### Description

Get all feature flag values using distinctId from withContext().

###### Call Signature

> **getAllFlags**(`distinctId`, `options?`): `Promise`\<`Record`\<`string`, `FeatureFlagValue`\>\>

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `distinctId` | `string` | The user's distinct ID |
| `options?` | `AllFlagsOptions` | Optional configuration for flag evaluation |

###### Returns

`Promise`\<`Record`\<`string`, `FeatureFlagValue`\>\>

Promise that resolves to a record of flag keys and their values

###### Description

Get all feature flag values for a specific user.

##### getAllFlagsAndPayloads()

###### Call Signature

> **getAllFlagsAndPayloads**(`options?`): `Promise`\<`Partial`\<`Pick`\<`PostHogFlagsResponse`, `"featureFlags"` \| `"featureFlagPayloads"`\>\>\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | `AllFlagsOptions` |

###### Returns

`Promise`\<`Partial`\<`Pick`\<`PostHogFlagsResponse`, `"featureFlags"` \| `"featureFlagPayloads"`\>\>\>

###### Description

Get all feature flag values and payloads using distinctId from withContext().

###### Call Signature

> **getAllFlagsAndPayloads**(`distinctId`, `options?`): `Promise`\<`Partial`\<`Pick`\<`PostHogFlagsResponse`, `"featureFlags"` \| `"featureFlagPayloads"`\>\>\>

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `distinctId` | `string` | The user's distinct ID |
| `options?` | `AllFlagsOptions` | Optional configuration for flag evaluation |

###### Returns

`Promise`\<`Partial`\<`Pick`\<`PostHogFlagsResponse`, `"featureFlags"` \| `"featureFlagPayloads"`\>\>\>

Promise that resolves to flags and payloads

###### Description

Get all feature flag values and payloads for a specific user.

##### getContext()

> **getContext**(): `ContextData` \| `undefined`

###### Returns

`ContextData` \| `undefined`

The current context data, or undefined if no context is set

###### Description

Get the current context data.

##### ~~getFeatureFlag()~~

> **getFeatureFlag**(`key`, `distinctId`, `options?`): `Promise`\<`FeatureFlagValue` \| `undefined`\>

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | the unique key of your feature flag |
| `distinctId` | `string` | the current unique id |
| `options?` | \{ `groupProperties?`: `Record`\<`string`, `Properties`\>; `groups?`: `Record`\<`string`, `string`\>; `onlyEvaluateLocally?`: `boolean`; `personProperties?`: `Properties`; `sendFeatureFlagEvents?`: `boolean`; \} | - |
| `options.groupProperties?` | `Record`\<`string`, `Properties`\> | - |
| `options.groups?` | `Record`\<`string`, `string`\> | - |
| `options.onlyEvaluateLocally?` | `boolean` | - |
| `options.personProperties?` | `Properties` | - |
| `options.sendFeatureFlagEvents?` | `boolean` | - |

###### Returns

`Promise`\<`FeatureFlagValue` \| `undefined`\>

true or a variant string if the flag evaluates on, false if it conclusively evaluates off, or undefined if no result is available. Local evaluation resolves cached inactive definitions to false; remote evaluation omits globally inactive flags, leaving no result.

###### Description

PostHog feature flags (https://posthog.com/docs/features/feature-flags)
allow you to safely deploy and roll back new features. Once you've created a feature flag in PostHog,
you can use this method to check if the flag is on for a given user, allowing you to create logic to turn
features on and off for different user groups or individual users.

###### Deprecated

Use IPostHog.evaluateFlags and call `flags.getFlag(key)` on the
  returned snapshot. Will be removed in the next major version.

##### ~~getFeatureFlagPayload()~~

> **getFeatureFlagPayload**(`key`, `distinctId`, `matchValue?`, `options?`): `Promise`\<`JsonType` \| `undefined`\>

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | the unique key of your feature flag |
| `distinctId` | `string` | the current unique id |
| `matchValue?` | `FeatureFlagValue` | The flag value previously obtained from calling `getFeatureFlag()`. Can be a string or boolean. To avoid extra network calls, pass this parameter when you can. |
| `options?` | \{ `onlyEvaluateLocally?`: `boolean`; \} | - |
| `options.onlyEvaluateLocally?` | `boolean` | - |

###### Returns

`Promise`\<`JsonType` \| `undefined`\>

payload of a json type object

###### Description

Retrieves payload associated with the specified flag and matched value that is passed in.

IMPORTANT: The `matchValue` parameter should be the value you previously obtained from `getFeatureFlag()`.
If matchValue isn't passed (or is undefined), this method will automatically call `getFeatureFlag()`
internally to fetch the flag value, which could result in a network call to the PostHog server if this flag can
not be evaluated locally. This means that omitting `matchValue` will potentially:
- Bypass local evaluation
- Count as an additional flag evaluation against your quota
- Impact performance due to the extra network request

Example usage:
```js
const flagValue = await client.getFeatureFlag('my-flag', distinctId);
const payload = await client.getFeatureFlagPayload('my-flag', distinctId, flagValue);
```

###### Deprecated

Use IPostHog.evaluateFlags and call `flags.getFlagPayload(key)` on
  the returned snapshot. Will be removed in the next major version.

##### getFeatureFlagResult()

###### Call Signature

> **getFeatureFlagResult**(`key`, `options?`): `Promise`\<`FeatureFlagResult` \| `undefined`\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |
| `options?` | `FlagEvaluationOptions` |

###### Returns

`Promise`\<`FeatureFlagResult` \| `undefined`\>

###### Description

Get a feature flag result using distinctId from withContext().

###### Call Signature

> **getFeatureFlagResult**(`key`, `distinctId`, `options?`): `Promise`\<`FeatureFlagResult` \| `undefined`\>

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature flag key |
| `distinctId` | `string` | The user's distinct ID |
| `options?` | `FlagEvaluationOptions` | Optional configuration for flag evaluation |

###### Returns

`Promise`\<`FeatureFlagResult` \| `undefined`\>

Promise that resolves to the flag result or undefined

###### Description

Get the result of evaluating a feature flag, including its value and payload.
This is more efficient than calling getFeatureFlag and getFeatureFlagPayload separately when you need both.

###### Example

```ts
const result = await client.getFeatureFlagResult('my-flag', 'user_123')
if (result) {
  console.log('Flag enabled:', result.enabled)
  console.log('Variant:', result.variant)
  console.log('Payload:', result.payload)
}
```

##### groupIdentify()

> **groupIdentify**(`groupType`): `void`

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `groupType` | `GroupIdentifyMessage` | Type of group (ex: 'company'). Limited to 5 per project |

###### Returns

`void`

###### Description

Sets a groups properties, which allows asking questions like "Who are the most active companies"
using my product in PostHog.

##### groupIdentifyImmediate()

> **groupIdentifyImmediate**(`groupType`): `Promise`\<`void`\>

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `groupType` | `GroupIdentifyMessage` | Type of group (ex: 'company'). Limited to 5 per project |

###### Returns

`Promise`\<`void`\>

###### Description

Sets a group's properties immediately. Useful for edge environments where the usual queue-based
sending is not preferable. Do not mix immediate and non-immediate calls.

##### identify()

> **identify**(`distinctId`): `void`

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `distinctId` | `IdentifyMessage` | which uniquely identifies your user |

###### Returns

`void`

###### Description

Identify lets you add metadata on your users so you can more easily identify who they are in PostHog,
and even do things like segment users by these properties.
An identify call requires:

##### identifyImmediate()

> **identifyImmediate**(`distinctId`): `Promise`\<`void`\>

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `distinctId` | `IdentifyMessage` | which uniquely identifies your user |

###### Returns

`Promise`\<`void`\>

###### Description

Identify lets you add metadata on your users so you can more easily identify who they are in PostHog.
Useful for edge environments where the usual queue-based sending is not preferable. Do not mix immediate and non-immediate calls.

##### ~~isFeatureEnabled()~~

> **isFeatureEnabled**(`key`, `distinctId`, `options?`): `Promise`\<`boolean` \| `undefined`\>

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | the unique key of your feature flag |
| `distinctId` | `string` | the current unique id |
| `options?` | \{ `groupProperties?`: `Record`\<`string`, `Properties`\>; `groups?`: `Record`\<`string`, `string`\>; `onlyEvaluateLocally?`: `boolean`; `personProperties?`: `Properties`; `sendFeatureFlagEvents?`: `boolean`; \} | - |
| `options.groupProperties?` | `Record`\<`string`, `Properties`\> | - |
| `options.groups?` | `Record`\<`string`, `string`\> | - |
| `options.onlyEvaluateLocally?` | `boolean` | - |
| `options.personProperties?` | `Properties` | - |
| `options.sendFeatureFlagEvents?` | `boolean` | - |

###### Returns

`Promise`\<`boolean` \| `undefined`\>

true if the flag evaluates on, false if it conclusively evaluates off, or undefined if no result is available. Local evaluation resolves cached inactive definitions to false; remote evaluation omits globally inactive flags, leaving no result.

###### Description

PostHog feature flags (https://posthog.com/docs/features/feature-flags)
allow you to safely deploy and roll back new features. Once you've created a feature flag in PostHog,
you can use this method to check if the flag is on for a given user, allowing you to create logic to turn
features on and off for different user groups or individual users.

###### Deprecated

Use IPostHog.evaluateFlags and call `flags.isEnabled(key)` on the
  returned snapshot. Will be removed in the next major version.

##### isLocalEvaluationReady()

> **isLocalEvaluationReady**(): `boolean`

###### Returns

`boolean`

true if local evaluation is ready, false if it's not.

###### Description

Returns true if local evaluation is ready, false if it's not.

##### overrideFeatureFlags()

> **overrideFeatureFlags**(`overrides`): `void`

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `overrides` | `OverrideFeatureFlagsOptions` | Flag overrides configuration |

###### Returns

`void`

###### Description

Override feature flags locally. Useful for testing and local development.
Overridden flags take precedence over both local evaluation and remote evaluation.

###### Example

```ts
// Clear all overrides
posthog.overrideFeatureFlags(false)

// Enable a list of flags (sets them to true)
posthog.overrideFeatureFlags(['flag-a', 'flag-b'])

// Set specific flag values/variants
posthog.overrideFeatureFlags({ 'my-flag': 'variant-a', 'other-flag': true })

// Set both flags and payloads
posthog.overrideFeatureFlags({
  flags: { 'my-flag': 'variant-a' },
  payloads: { 'my-flag': { discount: 20 } }
})
```

##### reloadFeatureFlags()

> **reloadFeatureFlags**(): `Promise`\<`void`\>

###### Returns

`Promise`\<`void`\>

###### Description

Force an immediate reload of the polled feature flags. Please note that they are
already polled automatically at a regular interval.

##### setPersonProperties()

> **setPersonProperties**(`distinctId`): `void`

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `distinctId` | `SetPersonPropertiesMessage` | which uniquely identifies your user |

###### Returns

`void`

###### Description

Set properties on a person profile.

##### shutdown()

> **shutdown**(`shutdownTimeoutMs?`): `Promise`\<`void`\>

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `shutdownTimeoutMs?` | `number` | The shutdown timeout, in milliseconds. Defaults to 30000 (30s). |

###### Returns

`Promise`\<`void`\>

###### Description

Flushes the events still in the queue and clears the feature flags poller to allow for
a clean shutdown.

##### startSpan()

> **startSpan**(`name`, `options?`): `Span`

**`Experimental`**

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |
| `options?` | `StartSpanOptions` |

###### Returns

`Span`

###### Description

Starts a span without making it active, for work that can't wrap a callback.
Prefer `withSpan`. Always returns a handle — an inert one when tracing is off — so calling
code never has to branch.
 Subject to change in a minor release.

##### unsetPersonProperties()

> **unsetPersonProperties**(`distinctId`): `void`

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `distinctId` | `UnsetPersonPropertiesMessage` | which uniquely identifies your user |

###### Returns

`void`

###### Description

Remove properties from a person profile.

##### waitForLocalEvaluationReady()

> **waitForLocalEvaluationReady**(`timeoutMs?`): `Promise`\<`boolean`\>

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `timeoutMs?` | `number` | Maximum time to wait in milliseconds. Defaults to 30 seconds. |

###### Returns

`Promise`\<`boolean`\>

A promise that resolves to true if local evaluation is ready, false if the timeout was reached.

###### Description

Waits for local evaluation to be ready, with an optional timeout.

##### withContext()

> **withContext**\<`T`\>(`data`, `fn`, `options?`): `T`

###### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-3"></a> `T` |

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `data` | `Partial`\<`ContextData`\> | Context data to apply (sessionId, distinctId, properties, options) |
| `fn` | () => `T` | Function to run with the context |
| `options?` | `ContextOptions` | Context options (fresh) |

###### Returns

`T`

The return value of the function

###### Description

Run a function with specific context that will be applied to all events captured within that context.

##### withSpan()

###### Call Signature

> **withSpan**\<`T`\>(`name`, `fn`): `T`

**`Experimental`**

###### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-4"></a> `T` |

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |
| `fn` | (`span`) => `T` |

###### Returns

`T`

###### Description

Runs a callback with a span active for its duration and ends the span at return
(sync) or settle (async). Spans started inside nest automatically; a throw or rejection is
recorded on the span and rethrown unchanged.
 Subject to change in a minor release.

###### Call Signature

> **withSpan**\<`T`\>(`name`, `options`, `fn`): `T`

###### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-5"></a> `T` |

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |
| `options` | `StartSpanOptions` |
| `fn` | (`span`) => `T` |

###### Returns

`T`

### `JsonType`

> **JsonType** = `string` \| `number` \| `boolean` \| `null` \| \{\[`key`: `string`\]: `JsonType`; \} \| `JsonType`[] \| `JsonType`[]

### `LinkSurveyQuestion`

> **LinkSurveyQuestion** = `SurveyQuestionBase` & `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `link?` | `string` \| `null` |
| `type` | *typeof* `SurveyQuestionType.Link` |

### `MetricAttributes`

> **MetricAttributes** = `Record`\<`string`, `MetricAttributeValue`\>

### `MetricAttributeValue`

> **MetricAttributeValue** = `string` \| `number` \| `boolean`

Metric attribute values are restricted to scalars. Every distinct
attribute-value combination creates a new metric series, so high-cardinality
values (user IDs, request IDs, URLs) must not be used as attributes — put
those on logs or events instead.

### `Metrics`

The public `posthog.metrics` API.

#### Example

```ts
posthog.metrics.count('orders_created', 1)
posthog.metrics.gauge('active_connections', 42)
posthog.metrics.histogram('api_latency', 187, { unit: 'ms' })
```

#### Methods

##### count()

> **count**(`name`, `value?`, `options?`): `void`

Add to a counter — things that only go up (orders, clicks, API calls). Value defaults to 1.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |
| `value?` | `number` |
| `options?` | `CaptureMetricOptions` |

###### Returns

`void`

##### flush()

> **flush**(): `Promise`\<`void`\>

Send everything aggregated so far without waiting for the flush interval.

###### Returns

`Promise`\<`void`\>

##### gauge()

> **gauge**(`name`, `value`, `options?`): `void`

Record the current value of something that goes up and down (queue depth, connections).

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |
| `value` | `number` |
| `options?` | `CaptureMetricOptions` |

###### Returns

`void`

##### histogram()

> **histogram**(`name`, `value`, `options?`): `void`

Record one observation of a distribution (latency, payload size).

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |
| `value` | `number` |
| `options?` | `CaptureMetricOptions` |

###### Returns

`void`

### `MetricSample`

A captured metric as seen by `beforeSend`, before aggregation. Mutating
`name`, `value`, `unit`, or `attributes` changes what gets aggregated;
returning `null` drops the sample.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-attributes"></a> `attributes?` | `MetricAttributes` |
| <a id="property-name-2"></a> `name` | `string` |
| <a id="property-type-4"></a> `type` | `MetricType` |
| <a id="property-unit"></a> `unit?` | `string` |
| <a id="property-value-3"></a> `value` | `number` |

### `MetricsConfig`

Options for the posthog.metrics API (count, gauge, histogram).
Shared by every SDK; browser-only options live in `BrowserMetricsConfig`.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-beforesend"></a> `beforeSend?` | `BeforeSendMetricFn` \| `BeforeSendMetricFn`[] | Pre-aggregation filter for metric samples, as a single function or a left-to-right chain. Each function inspects, mutates, or drops a sample (return `null` to drop) before it is aggregated. |
| <a id="property-environment"></a> `environment?` | `string` | The deployment environment for metric series (e.g. 'production', 'staging'). Maps to the OTel resource attribute 'deployment.environment'. |
| <a id="property-flushintervalms"></a> `flushIntervalMs?` | `number` | How often the aggregated window is flushed, in milliseconds. Samples are folded into per-series aggregates in memory between flushes — one data point per series per window, no matter how many calls. **Default** `10000` |
| <a id="property-maxseriesperflush"></a> `maxSeriesPerFlush?` | `number` | Cardinality guardrail: maximum distinct series (name + type + unit + attribute combination) held per flush window. Samples for series beyond the cap are dropped with a single warning per window. **Default** `1000` |
| <a id="property-resourceattributes"></a> `resourceAttributes?` | `MetricAttributes` | Additional resource attributes applied to every metrics batch. These describe the service/deployment, not individual series. Named fields (serviceName, environment, serviceVersion) are set first; resourceAttributes can override them. **Example** `{ 'host.name': 'web-01', 'cloud.region': 'us-east-1' }` |
| <a id="property-servicename"></a> `serviceName?` | `string` | The service name for metric series. Maps to the OTel resource attribute 'service.name'. **Default** `'unknown_service'` |
| <a id="property-serviceversion"></a> `serviceVersion?` | `string` | The service version for metric series (e.g. '1.2.3'). Maps to the OTel resource attribute 'service.version'. |

### `MetricType`

> **MetricType** = `"count"` \| `"gauge"` \| `"histogram"`

### `MiddlewareError`

- `Error`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-output"></a> `output?` | `object` |
| `output.statusCode?` | `string` \| `number` |
| <a id="property-status"></a> `status?` | `string` \| `number` |
| <a id="property-status_code"></a> `status_code?` | `string` \| `number` |
| <a id="property-statuscode-1"></a> `statusCode?` | `string` \| `number` |

### `MultipleSurveyQuestion`

> **MultipleSurveyQuestion** = `SurveyQuestionBase` & `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `choices` | `string`[] |
| `hasOpenChoice?` | `boolean` |
| `shuffleOptions?` | `boolean` |
| `skipSubmitButton?` | `boolean` |
| `type` | *typeof* `SurveyQuestionType.SingleChoice` \| *typeof* `SurveyQuestionType.MultipleChoice` |

### `NextQuestionBranching`

> **NextQuestionBranching** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="type-2"></a> `type` | *typeof* `SurveyQuestionBranchingType.NextQuestion` |

### `OverrideFeatureFlagsOptions`

> **OverrideFeatureFlagsOptions** = `false` \| `string`[] \| `Record`\<`string`, `FeatureFlagValue`\> \| `FeatureFlagOverrideOptions`

Options for overriding feature flags.

Supports multiple formats:
- `false` - Clear all overrides
- `string[]` - Enable a list of flags (sets them to `true`)
- `Record<string, FeatureFlagValue>` - Set specific flag values/variants
- `FeatureFlagOverrideOptions` - Set both flag values and payloads

### `PostHogCookieState`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-deviceid"></a> `deviceId?` | `string` | - |
| <a id="property-distinctid"></a> `distinctId` | `string` | - |
| <a id="property-isidentified"></a> `isIdentified` | `boolean` | - |
| <a id="property-sessionid"></a> `sessionId?` | `string` | - |
| <a id="property-sessionlastactivitytimestamp"></a> `sessionLastActivityTimestamp?` | `number` | When the session last had activity (`$sesid[0]`), in milliseconds since the Unix epoch. |
| <a id="property-sessionstarttimestamp"></a> `sessionStartTimestamp?` | `number` | When the session started (`$sesid[2]`), in milliseconds since the Unix epoch. |

### `PostHogCoreOptions`

> **PostHogCoreOptions** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="addtracingheaders"></a> `addTracingHeaders?` | `string`[] | A list of hostnames for which to inject PostHog tracing headers (X-POSTHOG-DISTINCT-ID, X-POSTHOG-SESSION-ID) on outgoing `fetch` requests. Use this to link requests made from your app to session replays and LLM traces in PostHog. When set, the global `fetch` is patched on initialization and the headers are added to requests whose hostname matches one of the entries. Requires the SDK to wire up `patchFetchForTracingHeaders` against this option (currently supported in posthog-react-native). |
| <a id="before_send"></a> `before_send?` | `BeforeSendFn` \| `BeforeSendFn`[] | Allows modification or dropping of events before they're sent to PostHog. If an array is provided, the functions are run in order. If a function returns null, the event will be dropped. |
| <a id="bootstrap"></a> `bootstrap?` | `object` | Option to bootstrap the library with given distinctId and feature flags |
| `bootstrap.distinctId?` | `string` | - |
| `bootstrap.featureFlagPayloads?` | `Record`\<`string`, `JsonType`\> | - |
| `bootstrap.featureFlags?` | `Record`\<`string`, `FeatureFlagValue`\> | - |
| `bootstrap.isIdentifiedId?` | `boolean` | - |
| <a id="defaultoptin"></a> `defaultOptIn?` | `boolean` | If set to false the SDK will not track until the `optIn` function is called. **Default** `true` |
| <a id="disable_capture_url_hashes"></a> `disable_capture_url_hashes?` | `boolean` | Whether to strip URL fragments (`#...`) from automatically captured URL fields. Disabled by default for backwards compatibility. Set to `true` to strip hashes from: - `$current_url` on automatically captured browser events, including `$pageview` - `$initial_current_url` - `$session_entry_url` - `$elements[*].attr__href` and `$external_click_url` for autocapture and dead-click autocapture - Next.js Pages Router `$pageview` `$current_url` - web vitals `$current_url` - logs `url.full` - conversations `current_url` and `request_url` - session replay rrweb meta/custom-event `href` URLs - heatmap data URLs If your SPA relies on hash-based routes for analytics, enabling this is a breaking behavior change. If you want to capture hashes selectively, leave this as `false` and use `before_send` to remove sensitive hash values before events are sent. **Default** `false` |
| <a id="disablecompression"></a> `disableCompression?` | `boolean` | Whether to disable GZIP compression **Default** `false` |
| <a id="disabled"></a> `disabled?` | `boolean` | If set to true the SDK is essentially disabled (useful for local environments where you don't want to track anything) **Default** `false` |
| <a id="disablegeoip-1"></a> `disableGeoip?` | `boolean` | Whether to disable GeoIP lookups **Default** `false` |
| <a id="disableremoteconfig"></a> ~~`disableRemoteConfig?`~~ | `boolean` | Whether to load remote config when initialized or not **Deprecated** Remote config is now always loaded and this option is a no-op. It will be removed in a future version. **Default** `false` |
| <a id="disableremotefeatureflags"></a> `disableRemoteFeatureFlags?` | `boolean` | Advanced: whether to disable fetching and evaluating feature flags from PostHog entirely. When set to true, `reloadFeatureFlags()` and the reloads triggered by `identify()`, `group()`, `setPersonPropertiesForFlags()` and `reset()` become no-ops, and any request to the flags endpoint that still goes out (e.g. to fetch remote config or surveys) carries `disable_flags: true` so the server skips flag evaluation. Flag values must be supplied via the `bootstrap` option or `updateFlags()` instead; `getFeatureFlag()` and related methods keep working against those values. Until `updateFlags()` runs, reads return their not-loaded defaults, so use `bootstrap` for any flags needed at startup. Equivalent to the web SDK's `advanced_disable_feature_flags`. Note: surveys gated on feature flags will not evaluate unless the survey targeting flags are also provided via `updateFlags()`. This option cannot be toggled at runtime. `posthog-node` inherits this option but does not implement it (no-op). **Default** `false` |
| <a id="disablesurveys-2"></a> `disableSurveys?` | `boolean` | Whether to load surveys when initialized or not Requires the `PostHogSurveyProvider` to be used **Default** `false` |
| <a id="evaluationcontexts-1"></a> `evaluationContexts?` | readonly `string`[] | Evaluation contexts for feature flags. When set, only feature flags that have at least one matching evaluation tag will be evaluated for this SDK instance. Feature flags with no evaluation tags will always be evaluated. Examples: ['production', 'web', 'mobile'] **Default** `undefined` |
| <a id="evaluationenvironments"></a> ~~`evaluationEnvironments?`~~ | readonly `string`[] | Evaluation environments for feature flags. **Deprecated** Use evaluationContexts instead. This property will be removed in a future version. |
| <a id="featureflagsrequestmaxretries"></a> `featureFlagsRequestMaxRetries?` | `number` | How many times feature flag requests retry after a transient network error. Set to 0 to disable feature flag request retries. **Default** `1` |
| <a id="featureflagsrequesttimeoutms"></a> `featureFlagsRequestTimeoutMs?` | `number` | Timeout in milliseconds for feature flag calls **Default** `10000 for stateful clients, 3000 for stateless` |
| <a id="fetchretrycount"></a> `fetchRetryCount?` | `number` | How many times we will retry HTTP requests **Default** `3` |
| <a id="fetchretrydelay"></a> `fetchRetryDelay?` | `number` | The delay between HTTP request retries in milliseconds **Default** `3000` |
| <a id="flushat-2"></a> `flushAt?` | `number` | The number of events to queue before sending to PostHog (flushing) **Default** `20` |
| <a id="flushinterval"></a> `flushInterval?` | `number` | The interval in milliseconds between periodic flushes **Default** `10000` |
| <a id="historicalmigration"></a> `historicalMigration?` | `boolean` | Special flag to indicate ingested data is for a historical migration **Default** `false` |
| <a id="host-4"></a> `host?` | `string` | PostHog API host, usually 'https://us.i.posthog.com' or 'https://eu.i.posthog.com' **Default** `'https://us.i.posthog.com'` |
| <a id="maxbatchsize"></a> `maxBatchSize?` | `number` | The maximum number of queued messages to be flushed as part of a single batch (must be higher than `flushAt`) **Default** `100` |
| <a id="maxqueuesize"></a> `maxQueueSize?` | `number` | The maximum number of cached messages either in memory or on the local storage (must be higher than `flushAt`) **Default** `1000` |
| <a id="personprofiles"></a> `personProfiles?` | `"always"` \| `"identified_only"` \| `"never"` | Determines when to create Person Profiles for users. - 'always': Always create a person profile for every user (anonymous and identified). - 'identified_only': Only create a person profile when the user is identified via identify(), alias(), or group(). Events captured before identification will NOT have person profiles and will be anonymous events. - 'never': Never create person profiles. identify(), alias(), and group() will be no-ops. **Default** `'identified_only'` **Examples** `// Only create profiles when users are identified (recommended for most apps) const posthog = new PostHog('<api_key>', { personProfiles: 'identified_only', }) // Later when user logs in: posthog.identify('user-123', { email: 'user@example.com' })` `// Always create profiles (for apps where you want to track all users) const posthog = new PostHog('<api_key>', { personProfiles: 'always', })` `// Never create profiles (anonymous analytics only) const posthog = new PostHog('<api_key>', { personProfiles: 'never', })` |
| <a id="preloadfeatureflags-2"></a> `preloadFeatureFlags?` | `boolean` | Whether to load feature flags when initialized or not **Default** `true` |
| <a id="remoteconfigrequesttimeoutms"></a> `remoteConfigRequestTimeoutMs?` | `number` | Timeout in milliseconds for remote config calls **Default** `3000` |
| <a id="requesttimeout"></a> `requestTimeout?` | `number` | Timeout in milliseconds for any calls **Default** `10000` |
| <a id="sendfeatureflagevent"></a> `sendFeatureFlagEvent?` | `boolean` | Whether to track that `getFeatureFlag` was called (used by Experiments) In posthog-node this is also the default for reads from an `evaluateFlags()` snapshot (`isEnabled()` / `getFlag()`). Pass `sendFeatureFlagEvents` to one of those reads, or to a single-flag getter, to override it for that call. **Default** `true` |
| <a id="sessionexpirationtimeseconds"></a> `sessionExpirationTimeSeconds?` | `number` | For Session Analysis how long before we expire a session in seconds **Default** `1800` |

### `PostHogEventProperties`

> **PostHogEventProperties** = `object`

#### Index Signature

\[`key`: `string`\]: `JsonType`

### `PostHogFeatureFlag`

> **PostHogFeatureFlag** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="active"></a> `active` | `boolean` | - |
| <a id="bucketing_identifier"></a> `bucketing_identifier?` | `FeatureFlagBucketingIdentifier` | - |
| <a id="deleted"></a> `deleted` | `boolean` | - |
| <a id="ensure_experience_continuity"></a> `ensure_experience_continuity` | `boolean` | - |
| <a id="evaluation_contexts"></a> `evaluation_contexts?` | `string`[] | Evaluation context tags set on the flag. The local evaluation poller keeps a flag only when this list is empty or shares at least one entry with the SDK's `evaluationContexts`. Absent when the server does not report it. |
| <a id="evaluation_runtime"></a> `evaluation_runtime?` | `FeatureFlagEvaluationRuntime` \| `null` | Where the flag is meant to be evaluated. Absent or null on a flag that does not set a runtime, and on servers older than the field; both mean `all`, the default PostHog applies. |
| <a id="evaluation_tags"></a> `evaluation_tags?` | `string`[] | Legacy name for `evaluation_contexts`. Servers older than the field rename (PostHog, 2026-03-11) expose the same list under this key on `/flags/definitions`. Read as a fallback so local-evaluation context filtering still works against those servers. |
| <a id="experiment_set"></a> `experiment_set` | `number`[] | - |
| <a id="filters"></a> `filters?` | `object` | - |
| `filters.aggregation_group_type_index?` | `number` | - |
| `filters.early_exit?` | `boolean` | - |
| `filters.groups?` | `FeatureFlagCondition`[] | - |
| `filters.holdout?` | \{ `exclusion_percentage`: `number`; `id`: `number`; \} \| `null` | - |
| `filters.multivariate?` | `object` | - |
| `filters.multivariate.variants` | `object`[] | - |
| `filters.payloads?` | `Record`\<`string`, `string`\> | - |
| <a id="has_experiment"></a> `has_experiment?` | `boolean` | Whether the flag is linked to an experiment. Absent when the server does not report it. |
| <a id="id"></a> `id` | `number` | - |
| <a id="key-2"></a> `key` | `string` | - |
| <a id="name-3"></a> `name` | `string` | - |
| <a id="rollout_percentage-1"></a> `rollout_percentage` | `null` \| `number` | - |

### `PostHogFetchBodyBytes`

> **PostHogFetchBodyBytes** = `Uint8Array` & `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `buffer` | `ArrayBuffer` |

### `PostHogFetchOptions`

> **PostHogFetchOptions** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="body"></a> `body?` | `string` \| `Blob` \| `PostHogFetchBodyBytes` |
| <a id="credentials"></a> `credentials?` | `"omit"` |
| <a id="headers"></a> `headers` | `object` |
| <a id="method"></a> `method` | `"GET"` \| `"POST"` \| `"PUT"` \| `"PATCH"` |
| <a id="mode"></a> `mode?` | `"no-cors"` |
| <a id="redirect"></a> `redirect?` | `"follow"` \| `"manual"` \| `"error"` |
| <a id="signal"></a> `signal?` | `AbortSignal` |

### `PostHogFetchResponse`

> **PostHogFetchResponse** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="body-1"></a> `body?` | `ReadableStream`\<`Uint8Array`\> \| `null` |
| <a id="headers-1"></a> `headers?` | `object` |
| `headers.get` | (`name`) => `string` \| `null` |
| <a id="json"></a> `json` | () => `Promise`\<`any`\> |
| <a id="status"></a> `status` | `number` |
| <a id="text-1"></a> `text` | () => `Promise`\<`string`\> |

### `PostHogFlagsResponse`

> **PostHogFlagsResponse** = `Omit`\<`PostHogRemoteConfig`, `"hasFeatureFlags"`\> & `object`

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `errorsWhileComputingFlags` | `boolean` | - |
| `evaluatedAt?` | `number` | - |
| `featureFlagPayloads` | `object` | - |
| `featureFlags` | `object` | - |
| `flags` | `object` | - |
| `minimalFlagCalledEvents?` | `boolean` | Server-controlled gate for minimal `$feature_flag_called` events. `true` only when the project opted in; omitted otherwise. Absence always means full events. |
| `quotaLimited?` | `string`[] | - |
| `requestId?` | `string` | - |
| `sessionRecording?` | `boolean` \| \{\[`key`: `string`\]: `JsonType`; \} | - |

### `PostHogOptions`

> **PostHogOptions** = `Omit`\<`PostHogCoreOptions`, `"before_send"` \| `"disableGeoip"` \| `"flushInterval"` \| `"maxQueueSize"` \| `"fetchRetryCount"` \| `"fetchRetryDelay"` \| `"disableCompression"` \| `"requestTimeout"`\> & `object` & `ExceptionRateLimiterConfig`

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `__preview_capture_bot_pageviews?` | `boolean` | PREVIEW - MAY CHANGE WITHOUT WARNING - DO NOT USE IN PRODUCTION Enables collection of bot traffic as $bot_pageview events instead of dropping them. When enabled, events with a $raw_user_agent property that matches the bot detection list will have their $pageview event renamed to $bot_pageview. To use this feature, pass the user agent in event properties: `client.capture({ distinctId: 'user_123', event: '$pageview', properties: { $raw_user_agent: req.headers['user-agent'] } })` |
| `appHost?` | `string` | Your PostHog app host, such as `https://posthog.example.com`. `emails.send` sends there. Needed only when `host` is not PostHog Cloud, for example a reverse proxy, which must not receive the secret key. On PostHog Cloud, the client derives `https://us.posthog.com` or `https://eu.posthog.com` from `host`. |
| `before_send?` | `BeforeSendFn` \| `BeforeSendFn`[] | Allows modification or dropping of events before they're sent to PostHog. If an array is provided, the functions are run in order. If a function returns null, the event will be dropped. **Remarks** The hook gets a copy of the finished event: the event's own values, then the values filled from context, `register()` and `registerOptions()`, then the values the SDK adds (such as `$is_server`, `$geoip_disable`, feature flag properties and `options.process_person_profile`). It has the final say: it can change or remove any of them, and nothing is added after it. Set `$geoip_disable` in `properties` to change GeoIP; the `disableGeoip` and `groups` fields are already applied to the properties it sees. |
| `captureAiCompression?` | `"none"` \| `"gzip"` \| `"deflate"` \| `"zstd"` | How `captureAi` requests compress their body, with the same values as `captureCompression`. It does not read `captureCompression` or `disableCompression`. **Default** `'gzip'` |
| `captureAiMaxQueueSize?` | `number` | The maximum number of `captureAi` events held in memory waiting to be sent. When the queue is full, the oldest AI event is dropped and reported through the `'error'` event. **Default** `1000` |
| `captureAiRequestTimeoutMs?` | `number` | Timeout in milliseconds for each `captureAi` request. Analytics capture requests use `requestTimeout`. **Default** `30000` |
| `captureCompression?` | `"none"` \| `"gzip"` \| `"deflate"` \| `"zstd"` | How analytics capture requests compress their body. `'deflate'` is zlib-wrapped. `'zstd'` needs Node 22.15 or later and falls back to `'gzip'` elsewhere, including the edge build. When not set, `disableCompression: true` means `'none'`. **Default** `'gzip'` |
| `captureMaxRetries?` | `number` | How many times a capture request is retried after its first attempt, on both capture lanes. Waits start at 100 ms and double each retry, with jitter, up to 30 seconds; a `Retry-After` header can raise a wait. Only HTTP 404, 408, 429, 500, 502, 503 and 504 and network errors are retried. When not set, `fetchRetryCount` is used. **Default** `3` |
| `captureTracingHeaders?` | `boolean` | Whether the Express and NestJS integrations read the `X-POSTHOG-DISTINCT-ID` and `X-POSTHOG-SESSION-ID` request headers into the request context. A distinct id or session id you pass explicitly always wins over these headers, and they are never used for authentication. Turning it off does not turn off `readPostHogCookie`. To stop all request linking, set `captureTracingHeaders: false` and leave `readPostHogCookie` off (its default). **Default** `true` |
| `custom_blocked_useragents?` | `string`[] | Additional user agent strings to block from being tracked. These are combined with the default list of blocked user agents. **Default** `[]` |
| `disableCompression?` | `boolean` | Whether to disable GZIP compression. Analytics capture requests use `captureCompression` when it is set, and `captureAi` requests use `captureAiCompression`. **Default** `false` |
| `disableGeoip?` | `boolean` | Whether to disable GeoIP lookups for events and feature flag requests. When on, every event gets `$geoip_disable: true` unless the event, its context or `register()` sets `$geoip_disable`. A per-call `disableGeoip` argument sets it for that event, under the event's own `$geoip_disable` property. **Default** `true` |
| `emailRequestMaxRetries?` | `number` | Number of retries for an `emails.send` after a network error, a rate limit, or an unavailable service. Every retry sends the same idempotency key. Set to 0 when a job runner already retries the send. **Default** `2` |
| `emailRequestTimeoutMs?` | `number` | Timeout in milliseconds for each `emails.send` request. **Default** `15000` |
| `enableExceptionAutocapture?` | `boolean` | - |
| `enableFullAiCapture?` | `boolean` | Capture full AI content: PostHog AI wrapper events route through the dedicated AI capture endpoint, skip string truncation, and pass media (base64 / data URIs) through unredacted. Privacy mode always wins. Defaults to false. |
| `enableLocalEvaluation?` | `boolean` | - |
| `evaluationContexts?` | readonly `string`[] | Evaluation contexts for feature flags. When set, only feature flags that have at least one matching evaluation tag will be evaluated for this SDK instance. Feature flags with no evaluation tags will always be evaluated. Examples: ['production', 'backend', 'api'] **Default** `undefined` |
| `evaluationEnvironments?` | readonly `string`[] | Evaluation environments for feature flags. **Deprecated** Use evaluationContexts instead. This property will be removed in a future version. |
| `featureFlagsLogWarnings?` | `boolean` | Controls whether `FeatureFlagEvaluations` filter helpers (`onlyAccessed()` and `only()`) log warnings when their input is unexpected — for example, calling `onlyAccessed()` before accessing any flags, or passing unknown keys to `only()`. **Default** `true` |
| `featureFlagsPollingInterval?` | `number` \| `null` | The interval in milliseconds between polls for refreshing feature flag definitions. Defaults to 30 seconds. Set to null to disable automatic polling. Definitions are still loaded on initialization; call reloadFeatureFlags() to refresh them manually. Until refreshed, local evaluation uses the last loaded definitions. |
| `fetch()?` | (`url`, `options`) => `Promise`\<`PostHogFetchResponse`\> | - |
| `fetchRetryCount?` | `number` | How many times HTTP requests are retried. Capture requests use `captureMaxRetries` when it is set. **Default** `3` |
| `fetchRetryDelay?` | `number` | The delay between HTTP request retries in milliseconds. Capture requests do not use it: see `captureMaxRetries` for their retry waits. **Default** `3000` |
| `flagDefinitionCacheProvider?` | `FlagDefinitionCacheProvider`\<`FlagDefinitionCacheInput`\> | Optional cache provider for feature flag definitions. Allows custom caching strategies (Redis, database, etc.) for flag definitions in multi-worker environments. If not provided, defaults to in-memory cache. Without a secretKey or personalApiKey, this instance only reads cached definitions on each refresh; it does not call shouldFetchFlagDefinitions or publish definitions. With a credential, it uses the provider's fetch decision to coordinate fetching fresh definitions from PostHog and publishing them to the cache. This enables distributed coordination where only one worker fetches flags while others use cached data, reducing API calls and improving performance. **Example** `import type { FlagDefinitionCacheProvider } from 'posthog-node' class RedisCacheProvider implements FlagDefinitionCacheProvider { // ... implementation } const client = new PostHog('api-key', { flagDefinitionCacheProvider: new RedisCacheProvider(redis) })` |
| `flushInterval?` | `number` | The interval in milliseconds between periodic flushes **Default** `5000` |
| `isServer?` | `boolean` | Whether to attach the `$is_server: true` property to every captured event. **Remarks** Defaults to `true` because this SDK is intended for server-side use, where the property lets PostHog distinguish server events from browser and react-native events. Set this to `false` when running the SDK as a client/CLI so the event is attributed to the device OS normally instead of being marked as a server event. When `false`, the `$is_server` property is omitted entirely. A `$is_server` value set on the event, in context or with `register()` wins over this setting. **Default** `true` **Example** `// CLI usage: don't mark events as server-side new PostHog('key', { isServer: false })` |
| `maxCacheSize?` | `number` | - |
| `maxQueueSize?` | `number` | The maximum number of analytics events held in memory waiting to be sent (must be higher than `flushAt`). When the queue is full, the oldest event is dropped and reported through the `'error'` event. `captureAi` events have their own queue, sized by `captureAiMaxQueueSize`, and do not count toward this limit. **Default** `10000` |
| `metrics?` | `MetricsConfig` | Configuration for the `posthog.metrics` API (count, gauge, histogram). Set `serviceName` so series can be filtered per service in the Metrics UI. **Example** `const client = new PostHog('phc_...', { metrics: { serviceName: 'billing-worker' } }) client.metrics.count('invoices.processed')` |
| `persistence?` | `"memory"` | - |
| `personalApiKey?` | `string` | **Deprecated** Use `secretKey` instead. |
| `privacyMode?` | `boolean` | Redact prompts, outputs and error details from every event that the PostHog AI integrations (`@posthog/ai`) capture with this client. Per-call privacy settings can only add redaction. Defaults to false. |
| `readPostHogCookie?` | `boolean` \| \{ `optOutCapturingByDefault?`: `boolean`; `sessionIdleTimeoutSeconds?`: `number`; \} | Lets the Express and NestJS integrations read the session ID, and the distinct ID of an identified user, from the posthog-js cookie when a request has neither tracing header. Turn it on only when posthog-js stores opt-out consent in a cookie, or when you do not use opt-out: the server cannot read an opt-out that posthog-js keeps in localStorage (its default). It needs cookie-backed posthog-js persistence (the default `localStorage+cookie`, or `cookie`), the default cookie name (no `persistence_name`), and the default `__ph_opt_in_out_<token>` consent cookie name. Set `sessionIdleTimeoutSeconds` when posthog-js uses a custom `session_idle_timeout_seconds`, and set `optOutCapturingByDefault` when posthog-js uses `opt_out_capturing_by_default`, so a visitor with no consent cookie counts as opted out. A request sent right after `identify()` or `reset()` can still carry the previous identity, because posthog-js saves the cookie with a short delay. When `captureTracingHeaders` is `false`, the tracing headers are ignored and every request falls back to the cookie. To stop all request linking, also leave this option off. **Default** `false` |
| `requestTimeout?` | `number` | Timeout in milliseconds for any calls. `captureAi` requests use `captureAiRequestTimeoutMs`. **Default** `10000` |
| `secretKey?` | `string` | Credential for fetching local feature flag definitions, decrypting remote config and sending email. Accepts either a Personal API Key (`phx_...`) or a Project Secret API Key (`phs_...`). Local evaluation can also use definitions from `flagDefinitionCacheProvider` without this credential. Remote config payload decryption via `getRemoteConfigPayload` still requires it. `emails.send` needs a Project Secret API Key with the `hog_flow:write` scope; set `enableLocalEvaluation: false` when the key is only for email. Prefer this over the deprecated `personalApiKey` option; when both are set, `secretKey` takes precedence. **Example** `const client = new PostHog('phc_...', { secretKey: 'phs_...' })` |
| `strictLocalEvaluation?` | `boolean` | When enabled, all feature flag evaluations will use local evaluation only, never falling back to server-side evaluation. This prevents unexpected server requests and associated costs when using local evaluation. Flags that cannot be evaluated locally (e.g., those with experience continuity) will return `undefined` instead of making a server request. **Default** `false` |
| `traces?` | `TracesConfig` | **`Experimental`** Configuration for distributed tracing (`startSpan` / `withSpan`). Tracing is off until this is set; supplying it is all that's needed to turn it on. Set `serviceName` so spans can be attributed and grouped per service — the product aggregates operations by service and span name. `shutdown()` drains spans that have already ended, within the shutdown timeout; spans still open at that point are discarded. **Example** `const client = new PostHog('phc_...', { traces: { serviceName: 'checkout-api' } }) await client.withSpan('charge', () => stripe.charge(order))` Subject to change in a minor release. |
| `waitUntil()?` | (`promise`) => `void` | **`Experimental`** Provides the API to extend the lifetime of a serverless invocation until background work (like flushing analytics events) completes after the response is sent. Subject to change in a minor release. **Example** `// Vercel import { waitUntil } from '@vercel/functions' new PostHog('key', { waitUntil })` |
| `waitUntilDebounceMs?` | `number` | **`Experimental`** Debounce interval in milliseconds for the `waitUntil`-based flush. After the last event is enqueued, the SDK waits this long before flushing. Subject to change in a minor release. **Default** `50` |
| `waitUntilMaxWaitMs?` | `number` | **`Experimental`** Maximum time in milliseconds to debounce before forcing a flush. Prevents starvation from rapid concurrent captures. Subject to change in a minor release. **Default** `500` |

### `PostHogRemoteConfig`

> **PostHogRemoteConfig** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="captureperformance"></a> `capturePerformance?` | `boolean` \| \{\[`key`: `string`\]: `JsonType`; \} | Capture performance remote config. Either a boolean (false = disabled) or a map with configuration. When a map, `network_timing` (boolean) controls whether network timing capture is enabled remotely. |
| <a id="errortracking"></a> `errorTracking?` | `boolean` \| \{\[`key`: `string`\]: `JsonType`; \} | Error tracking remote config. Either a boolean (false = disabled) or a map with configuration. When a map, `autocaptureExceptions` (boolean) controls whether automatic exception capture is enabled remotely. |
| <a id="hasfeatureflags"></a> `hasFeatureFlags?` | `boolean` | Indicates if the team has any flags enabled (if not we don't need to load them) |
| <a id="logs"></a> `logs?` | `boolean` \| \{\[`key`: `string`\]: `JsonType`; \} | Logs feature remote config. When a map, `captureConsoleLogs` (boolean) is the local opt-in flag for `console.*` autocapture (read by the JS SDK's `PostHogLogs` extension to decide whether to load the autocapture bundle). |
| <a id="sessionrecording"></a> `sessionRecording?` | `boolean` \| \{\[`key`: `string`\]: `JsonType`; \} | - |
| <a id="supportedcompression"></a> `supportedCompression?` | `Compression`[] | Supported compression algorithms |
| <a id="surveys"></a> `surveys?` | `boolean` \| `Survey`[] | Whether surveys are enabled |

### `PreparedEventMessage`

> **PreparedEventMessage** = `object`

An event as `prepareEventMessage()` builds it: the shape of `EventMessage`, with the distinct id
resolved and the properties and options filled from every layer, after `before_send`.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="disablegeoip-3"></a> `disableGeoip?` | `boolean` | - |
| <a id="distinctid-3"></a> `distinctId` | `string` | - |
| <a id="event"></a> `event` | `string` | - |
| <a id="options-4"></a> `options?` | `Record`\<`string`, `JsonType`\> | The event's options, sent to capture unchanged. |
| <a id="properties-4"></a> `properties` | `PostHogEventProperties` | - |
| <a id="timestamp"></a> `timestamp?` | `Date` | - |
| <a id="uuid-1"></a> `uuid?` | `string` | - |

### `Properties`

> **Properties** = `Record`\<`string`, `Property`\>

### `Property`

> **Property** = `any`

Common types shared across PostHog SDKs

### `PropertyFilters`

> **PropertyFilters** = `Record`\<`string`, \{ `operator`: `PropertyOperator`; `values`: `string`[]; \}\>

### `PropertyGroup`

> **PropertyGroup** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="type-1"></a> `type` | `"AND"` \| `"OR"` |
| <a id="values"></a> `values` | `PropertyGroup`[] \| `FlagProperty`[] |

### `PropertyMatchType`

> **PropertyMatchType** = `SurveyMatchType`

### `PropertyOperator`

> **PropertyOperator** = `PropertyMatchType` \| `"gt"` \| `"lt"`

### `RatingSurveyQuestion`

> **RatingSurveyQuestion** = `SurveyQuestionBase` & `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `display` | `SurveyRatingDisplay` |
| `lowerBoundLabel` | `string` |
| `scale` | `2` \| `3` \| `5` \| `7` \| `10` |
| `skipSubmitButton?` | `boolean` |
| `type` | *typeof* `SurveyQuestionType.Rating` |
| `upperBoundLabel` | `string` |

### `ResponseBasedBranching`

> **ResponseBasedBranching** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="responsevalues"></a> `responseValues` | `Record`\<`string`, `any`\> |
| <a id="type-3"></a> `type` | *typeof* `SurveyQuestionBranchingType.ResponseBased` |

### `SendEmailOptions`

Options for `posthog.emails.send()`.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-distinctid-1"></a> `distinctId?` | `string` | The recipient's distinct ID in your product. The email's events go to this person. Without it, they go to a person whose distinct ID is the email address. |
| <a id="property-idempotencykey"></a> `idempotencyKey?` | `string` | 1 to 255 visible ASCII characters. A send with a key that PostHog has already accepted queues nothing and returns the first send's result. Without it, the client makes a UUID that covers its own retries. Pass a key derived from what the email is for, such as `welcome:user_123`, to cover retries outside this call too. |
| <a id="property-maxretries"></a> `maxRetries?` | `number` | Overrides the client's `emailRequestMaxRetries` for this send. `0` turns retries off. |
| <a id="property-templatedata"></a> `templateData?` | `Record`\<`string`, `unknown`\> | Values for the template's `{{ variables.* }}` placeholders. Sent as `message_data`. |
| <a id="property-templateid"></a> `templateId` | `string` | The UUID of an email template made transactional in PostHog. |
| <a id="property-to"></a> `to` | `string` | One recipient email address. |

### `SendEmailResponse`

> **SendEmailResponse** = \{ `data`: `SendEmailResult`; `error`: `null`; \} \| \{ `data`: `null`; `error`: `EmailError`; \}

What `posthog.emails.send()` resolves to. Exactly one of `data` and `error` is set.
The promise does not reject.

### `SendEmailResult`

The queued email. A result means PostHog queued the email, not that it was delivered.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-id-1"></a> `id` | `string` | The queued email's message ID. |
| <a id="property-replayed"></a> `replayed` | `boolean` | True when PostHog had already accepted this idempotency key and returned the first send's result. |
| <a id="property-warnings"></a> `warnings` | `EmailWarning`[] | - |

### `SendFeatureFlagsOptions`

> **SendFeatureFlagsOptions** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="flagkeys"></a> `flagKeys?` | `string`[] |
| <a id="groupproperties-1"></a> `groupProperties?` | `Record`\<`string`, `Properties`\> |
| <a id="onlyevaluatelocally-1"></a> `onlyEvaluateLocally?` | `boolean` |
| <a id="personproperties-1"></a> `personProperties?` | `Properties` |

### `SentryIntegrationOptions`

> **SentryIntegrationOptions** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="organization"></a> `organization?` | `string` |
| <a id="prefix"></a> `prefix?` | `string` |
| <a id="projectid"></a> `projectId?` | `number` |
| <a id="sendexceptionstoposthog"></a> `sendExceptionsToPostHog?` | `boolean` |
| <a id="severityallowlist"></a> `severityAllowList?` | `SeverityLevel`[] \| `"*"` |

### `SetPersonPropertiesMessage`

> **SetPersonPropertiesMessage** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="distinctid-4"></a> `distinctId` | `string` | - |
| <a id="options-5"></a> `options?` | `Record`\<`string`, `JsonType`\> | Per-event options, sent to capture unchanged. Known keys today are `process_person_profile`, `cookieless_mode`, `disable_skew_correction` (legacy `$ignore_sent_at`) and `product_tour_id`; unknown keys pass through. A legacy property such as `$process_person_profile` fills an option left unset. Capture drops an event whose option value it cannot read (`invalid_options`), and the SDK reports the drop through the `'error'` event. |
| <a id="properties-5"></a> `properties?` | `Record`\<`string` \| `number`, `any`\> | - |
| <a id="propertiesonce"></a> `propertiesOnce?` | `Record`\<`string` \| `number`, `any`\> | - |

### `SeverityLevel`

> **SeverityLevel** = *typeof* `severityLevels`\[`number`\]

### `Span`

**`Experimental`**

A handle to a span in progress.

Every method is safe to call at any time, including after `end()` and on
no-op handles, so calling code never has to branch on whether tracing is on.

 Subject to change in a minor release.

#### Methods

##### addEvent()

> **addEvent**(`name`, `attributes?`, `timestamp?`): `this`

**`Experimental`**

Record a timestamped event within the span, e.g. a cache miss or a retry.
Defaults to the current time.

One event carries at most 128 attributes; further keys are dropped and
counted on the exported event. Use `maxEventsPerSpan` to bound how many
events a span carries.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |
| `attributes?` | `SpanAttributes` |
| `timestamp?` | `SpanTimeInput` |

###### Returns

`this`

##### end()

> **end**(`endTime?`): `void`

**`Experimental`**

End the span and queue it for export. Idempotent — later calls no-op.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `endTime?` | `SpanTimeInput` | Override the recorded end. Invalid values fall back to the derived end time; an end before the start is corrected to the start. |

###### Returns

`void`

##### recordException()

> **recordException**(`error`): `this`

**`Experimental`**

Record an exception on the span: sets status `error` and attaches an
`exception` event carrying `exception.type`, `exception.message` and,
where the thrown value has one, `exception.stacktrace`. The stack is
truncated to `maxAttributeValueLength` like any other attribute value,
and `beforeSpanSend` sees it before it is exported. Does not end the span.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `error` | `unknown` |

###### Returns

`this`

##### setAttribute()

> **setAttribute**(`key`, `value`): `this`

**`Experimental`**

Set a single attribute. Ignored after `end()`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |
| `value` | `SpanAttributeValue` |

###### Returns

`this`

##### setAttributes()

> **setAttributes**(`attributes`): `this`

**`Experimental`**

Merge several attributes at once. Ignored after `end()`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `attributes` | `SpanAttributes` |

###### Returns

`this`

##### setStatus()

> **setStatus**(`status`, `message?`): `this`

**`Experimental`**

Set the span's outcome. Last write wins.

When a `withSpan` callback throws, the SDK sets `error` automatically —
unless the callback already set `ok`, which is treated as final.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `status` | `SpanStatusCode` |
| `message?` | `string` |

###### Returns

`this`

##### traceparent()

> **traceparent**(): `string` \| `null`

**`Experimental`**

This span's W3C `traceparent` header value (`00-<traceId>-<spanId>-<flags>`),
for propagating the trace to another service. A span continuing a remote
trace propagates the flags byte it was handed, so a downstream sampler
sees the decision the head sampler made; a trace started here is sampled.

When tracing is off, a span started with a `parent` header echoes that
header back — version and sampled flag included — so a service that
records nothing still keeps a distributed trace whole. With no `parent`
there is no context to carry and this returns `null`, so an id this SDK
never recorded cannot propagate.

###### Returns

`string` \| `null`

##### tracestate()

> **tracestate**(): `string` \| `null`

**`Experimental`**

This span's W3C `tracestate` value, or `null` when it has none.

###### Returns

`string` \| `null`

##### updateName()

> **updateName**(`name`): `this`

**`Experimental`**

Replace the span's name. Useful when the low-cardinality name is only
known after work begins — a route template resolving mid-request, say.

Span names should be low-cardinality operation names (`GET /users/:id`),
never interpolated with ids: PostHog aggregates operations by service and
name, so variable values belong in attributes.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

###### Returns

`this`

### `SpanAttributes`

> **SpanAttributes** = `Record`\<`string`, `SpanAttributeValue`\>

### `SpanAttributeValue`

> **SpanAttributeValue** = `string` \| `number` \| `boolean` \| `bigint` \| `SpanAttributeValue`[] \| \{\[`key`: `string`\]: `SpanAttributeValue`; \} \| `null` \| `undefined`

**`Experimental`**

A value that can be attached to a span, span event, or resource.

The ingestion service flattens attribute values to strings for storage, so
primitives are strongly preferred — nested arrays and objects survive only as
serialized strings and cannot be filtered on. `null` and `undefined` drop the key.

 Subject to change in a minor release.

### `SpanKind`

> **SpanKind** = `"internal"` \| `"server"` \| `"client"` \| `"producer"` \| `"consumer"`

**`Experimental`**

What kind of work a span represents. Mirrors the OpenTelemetry span kinds.

#### Default

```ts
'internal'

@experimental Subject to change in a minor release.
```

### `SpanRecord`

**`Experimental`**

A completed span as `beforeSpanSend` sees it: plain values, not the OTLP wire
encoding — `userId: 42` reads as `42`, not `{ intValue: "42" }`.

 Subject to change in a minor release.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-attributes-1"></a> `attributes` | `public` | `SpanAttributes` | **`Experimental`** Editable in place; this is where to redact. |
| <a id="property-endtime"></a> `endTime` | `public` | `number` | **`Experimental`** Millisecond epoch. |
| <a id="property-events"></a> `events` | `public` | `object`[] | **`Experimental`** |
| <a id="property-kind"></a> `kind` | `public` | `SpanKind` | **`Experimental`** |
| <a id="property-name"></a> `name` | `public` | `string` | **`Experimental`** |
| <a id="property-parentspanid"></a> `parentSpanId?` | `readonly` | `string` | **`Experimental`** Absent on a root span. |
| <a id="property-spanid"></a> `spanId` | `readonly` | `string` | **`Experimental`** |
| <a id="property-starttime"></a> `startTime` | `public` | `number` | **`Experimental`** Millisecond epoch. |
| <a id="property-status-1"></a> `status?` | `public` | `object` | **`Experimental`** |
| `status.code` | `public` | `SpanStatusCode` | - |
| `status.message?` | `public` | `string` | - |
| <a id="property-traceid"></a> `traceId` | `readonly` | `string` | **`Experimental`** Assignment to any of the three identity fields is ignored with a debug warning: rewriting ids orphans children that already shipped. |

### `SpanStatusCode`

> **SpanStatusCode** = `"ok"` \| `"error"`

**`Experimental`**

Outcome of the operation a span covers. A span that never has a status set is
exported as `unset`, which is not the same as `ok`.

 Subject to change in a minor release.

### `SpanTimeInput`

> **SpanTimeInput** = `number` \| `Date`

**`Experimental`**

A point in time, as a millisecond epoch number or a `Date`.

 Subject to change in a minor release.

### `SpecificQuestionBranching`

> **SpecificQuestionBranching** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="index"></a> `index` | `number` |
| <a id="type-4"></a> `type` | *typeof* `SurveyQuestionBranchingType.SpecificQuestion` |

### `StartSpanOptions`

**`Experimental`**

Options accepted by `startSpan` and `withSpan`.

 Subject to change in a minor release.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attributes-2"></a> `attributes?` | `SpanAttributes` | **`Experimental`** Attributes to set at span start. User-supplied keys win over the SDK's auto-attached context attributes. |
| <a id="property-kind-1"></a> `kind?` | `SpanKind` | **`Experimental`** What kind of work the span represents. **Default** `'internal'` |
| <a id="property-parent"></a> `parent?` | `string` \| `Span` | **`Experimental`** Parent of this span: either a span handle, or a raw W3C `traceparent` string to continue a trace started by another service. When omitted the parent is the currently active span, or none. Only handles returned by this SDK are honoured; any other `Span` yields an inert span. **Example** **Continue an inbound trace** `posthog.withSpan('POST /checkout', { parent: req.get('traceparent') }, handler)` |
| <a id="property-starttime-1"></a> `startTime?` | `SpanTimeInput` | **`Experimental`** Backdate the span's start. Values outside the representable range fall back to the current time; starts more than 24 hours old are warned about, because the server clamps them to receive time. |
| <a id="property-tracestate"></a> `tracestate?` | `string` | **`Experimental`** The W3C `tracestate` value accompanying a `traceparent`-string `parent`. Ignored when `parent` is a span handle — those inherit the parent's tracestate. Preserved opaquely and passed on to children. |

### `Survey`

> **Survey** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="appearance"></a> `appearance?` | `SurveyAppearance` |
| <a id="conditions"></a> `conditions?` | `object` |
| `conditions.actions?` | `object` |
| `conditions.actions.values` | `SurveyActionType`[] |
| `conditions.deviceTypes?` | `string`[] |
| `conditions.deviceTypesMatchType?` | `SurveyMatchType` |
| `conditions.events?` | `object` |
| `conditions.events.repeatedActivation?` | `boolean` |
| `conditions.events.values?` | `SurveyEventWithFilters`[] |
| `conditions.linkedFlagVariant?` | `string` |
| `conditions.seenSurveyWaitPeriodInDays?` | `number` |
| `conditions.selector?` | `string` |
| `conditions.url?` | `string` |
| `conditions.urlMatchType?` | `SurveyMatchType` |
| <a id="current_iteration"></a> `current_iteration?` | `number` \| `null` |
| <a id="current_iteration_start_date"></a> `current_iteration_start_date?` | `string` \| `null` |
| <a id="description-2"></a> `description?` | `string` |
| <a id="enable_partial_responses"></a> `enable_partial_responses?` | `boolean` \| `null` |
| <a id="end_date"></a> `end_date?` | `string` |
| <a id="feature_flag_keys"></a> `feature_flag_keys?` | `object`[] |
| <a id="id-1"></a> `id` | `string` |
| <a id="internal_targeting_flag_key"></a> `internal_targeting_flag_key?` | `string` |
| <a id="linked_flag_key"></a> `linked_flag_key?` | `string` |
| <a id="name"></a> `name` | `string` |
| <a id="questions"></a> `questions` | `SurveyQuestion`[] |
| <a id="schedule"></a> `schedule?` | `SurveySchedule` \| `null` |
| <a id="start_date"></a> `start_date?` | `string` |
| <a id="targeting_flag_key"></a> `targeting_flag_key?` | `string` |
| <a id="translations"></a> `translations?` | `Record`\<`string`, `SurveyTranslation`\> |
| <a id="type-5"></a> `type` | `SurveyType` |

### `SurveyActionType`

> **SurveyActionType** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="id-2"></a> `id` | `number` |
| <a id="name-1"></a> `name?` | `string` |
| <a id="steps"></a> `steps?` | `ActionStepType`[] |

### `SurveyAppearance`

> **SurveyAppearance** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="allowgoback"></a> `allowGoBack?` | `boolean` |
| <a id="autodisappear"></a> `autoDisappear?` | `boolean` |
| <a id="backbuttontext"></a> `backButtonText?` | `string` |
| <a id="backgroundcolor"></a> `backgroundColor?` | `string` |
| <a id="bordercolor"></a> `borderColor?` | `string` |
| <a id="displayintroscreen"></a> `displayIntroScreen?` | `boolean` |
| <a id="displaythankyoumessage"></a> `displayThankYouMessage?` | `boolean` |
| <a id="inputbackground"></a> `inputBackground?` | `string` |
| <a id="inputtextcolor"></a> `inputTextColor?` | `string` |
| <a id="introscreenbuttontext"></a> `introScreenButtonText?` | `string` |
| <a id="introscreendescription"></a> `introScreenDescription?` | `string` |
| <a id="introscreendescriptioncontenttype"></a> `introScreenDescriptionContentType?` | `SurveyQuestionDescriptionContentType` |
| <a id="introscreenheader"></a> `introScreenHeader?` | `string` |
| <a id="placeholder"></a> `placeholder?` | `string` |
| <a id="position"></a> `position?` | `SurveyPosition` |
| <a id="ratingbuttonactivecolor"></a> `ratingButtonActiveColor?` | `string` |
| <a id="ratingbuttoncolor"></a> `ratingButtonColor?` | `string` |
| <a id="shufflequestions"></a> `shuffleQuestions?` | `boolean` |
| <a id="submitbuttoncolor"></a> `submitButtonColor?` | `string` |
| <a id="submitbuttontext"></a> `submitButtonText?` | `string` |
| <a id="submitbuttontextcolor"></a> `submitButtonTextColor?` | `string` |
| <a id="surveypopupdelayseconds"></a> `surveyPopupDelaySeconds?` | `number` |
| <a id="textcolor"></a> `textColor?` | `string` |
| <a id="thankyoumessageclosebuttontext"></a> `thankYouMessageCloseButtonText?` | `string` |
| <a id="thankyoumessagedescription"></a> `thankYouMessageDescription?` | `string` |
| <a id="thankyoumessagedescriptioncontenttype"></a> `thankYouMessageDescriptionContentType?` | `SurveyQuestionDescriptionContentType` |
| <a id="thankyoumessageheader"></a> `thankYouMessageHeader?` | `string` |
| <a id="widgetcolor"></a> `widgetColor?` | `string` |
| <a id="widgetlabel"></a> `widgetLabel?` | `string` |
| <a id="widgetselector"></a> `widgetSelector?` | `string` |
| <a id="widgettype"></a> `widgetType?` | `SurveyWidgetType` |

### `SurveyEventWithFilters`

| Property | Type |
| ------ | ------ |
| <a id="property-name-6"></a> `name` | `string` |
| <a id="property-propertyfilters"></a> `propertyFilters?` | `PropertyFilters` |

### `SurveyMatchType`

> **SurveyMatchType** = *typeof* `SurveyMatchType`\[keyof *typeof* `SurveyMatchType`\]

### `SurveyPosition`

> **SurveyPosition** = *typeof* `SurveyPosition`\[keyof *typeof* `SurveyPosition`\]

### `SurveyQuestion`

> **SurveyQuestion** = `BasicSurveyQuestion` \| `LinkSurveyQuestion` \| `RatingSurveyQuestion` \| `MultipleSurveyQuestion`

### `SurveyQuestionBase`

> **SurveyQuestionBase** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="branching"></a> `branching?` | `NextQuestionBranching` \| `EndBranching` \| `ResponseBasedBranching` \| `SpecificQuestionBranching` |
| <a id="buttontext"></a> `buttonText?` | `string` |
| <a id="description-3"></a> `description?` | `string` \| `null` |
| <a id="descriptioncontenttype"></a> `descriptionContentType?` | `SurveyQuestionDescriptionContentType` |
| <a id="id-3"></a> `id` | `string` |
| <a id="optional"></a> `optional?` | `boolean` |
| <a id="originalquestionindex"></a> `originalQuestionIndex` | `number` |
| <a id="question"></a> `question` | `string` |
| <a id="translations-1"></a> `translations?` | `Record`\<`string`, `SurveyQuestionTranslation`\> |
| <a id="validation"></a> `validation?` | `SurveyValidationRule`[] |

### `SurveyQuestionDescriptionContentType`

> **SurveyQuestionDescriptionContentType** = *typeof* `SurveyQuestionDescriptionContentType`\[keyof *typeof* `SurveyQuestionDescriptionContentType`\]

### `SurveyQuestionTranslation`

| Property | Type |
| ------ | ------ |
| <a id="property-buttontext"></a> `buttonText?` | `string` |
| <a id="property-choices"></a> `choices?` | `string`[] |
| <a id="property-description"></a> `description?` | `string` \| `null` |
| <a id="property-link"></a> `link?` | `string` \| `null` |
| <a id="property-lowerboundlabel"></a> `lowerBoundLabel?` | `string` |
| <a id="property-question"></a> `question?` | `string` |
| <a id="property-upperboundlabel"></a> `upperBoundLabel?` | `string` |

### `SurveyRatingDisplay`

> **SurveyRatingDisplay** = *typeof* `SurveyRatingDisplay`\[keyof *typeof* `SurveyRatingDisplay`\]

### `SurveySchedule`

> **SurveySchedule** = *typeof* `SurveySchedule`\[keyof *typeof* `SurveySchedule`\]

### `SurveyTranslation`

| Property | Type |
| ------ | ------ |
| <a id="property-backbuttontext"></a> `backButtonText?` | `string` |
| <a id="property-introscreenbuttontext"></a> `introScreenButtonText?` | `string` |
| <a id="property-introscreendescription"></a> `introScreenDescription?` | `string` |
| <a id="property-introscreenheader"></a> `introScreenHeader?` | `string` |
| <a id="property-name-7"></a> `name?` | `string` |
| <a id="property-submitbuttontext"></a> `submitButtonText?` | `string` |
| <a id="property-thankyoumessageclosebuttontext"></a> `thankYouMessageCloseButtonText?` | `string` |
| <a id="property-thankyoumessagedescription"></a> `thankYouMessageDescription?` | `string` |
| <a id="property-thankyoumessageheader"></a> `thankYouMessageHeader?` | `string` |

### `SurveyType`

> **SurveyType** = *typeof* `SurveyType`\[keyof *typeof* `SurveyType`\]

### `SurveyValidationRule`

| Property | Type |
| ------ | ------ |
| <a id="property-errormessage"></a> `errorMessage?` | `string` |
| <a id="property-type-5"></a> `type` | `SurveyValidationType` |
| <a id="property-value-5"></a> `value?` | `number` |

### `SurveyValidationType`

> **SurveyValidationType** = *typeof* `SurveyValidationType`\[keyof *typeof* `SurveyValidationType`\]

### `SurveyWidgetType`

> **SurveyWidgetType** = *typeof* `SurveyWidgetType`\[keyof *typeof* `SurveyWidgetType`\]

### `TracesConfig`

**`Experimental`**

Configuration for distributed tracing, passed as the `traces` client option.
Tracing stays off until this object is supplied.

#### Example

```ts
const posthog = new PostHog('phc_...', { traces: { serviceName: 'checkout-api' } })
```

 Subject to change in a minor release.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-beforespansend"></a> `beforeSpanSend?` | `BeforeSpanSendFn` \| `BeforeSpanSendFn`[] | **`Experimental`** Runs on every finished span before it is queued. Edit the span in place, or return `null` to drop it. An array runs left to right, and the first hook to return `null` stops the chain. This is the place to scrub sensitive attributes, so a hook that throws drops the span rather than exporting an unscrubbed one. **Example** **Drop health checks and redact a header** `traces: { beforeSpanSend: (span) => { if (span.attributes['http.route'] === '/health') return null delete span.attributes['http.request.header.authorization'] return span }, }` |
| <a id="property-environment-1"></a> `environment?` | `string` | **`Experimental`** Deployment environment (e.g. `'production'`, `'staging'`), attached as OTLP `deployment.environment`. |
| <a id="property-flushintervalms-1"></a> `flushIntervalMs?` | `number` | **`Experimental`** How often queued spans are flushed, in milliseconds. Spans also flush when the queue reaches `maxExportBatchSize` and on `shutdown()`. **Default** `5000` |
| <a id="property-maxattributesperspan"></a> `maxAttributesPerSpan?` | `number` | **`Experimental`** Maximum user-supplied attributes on a single span. Attributes the SDK attaches itself — `posthogDistinctId`, `sessionId` and friends — are exempt and are never evicted, because they are what links a span to a person and a session. On overflow the earliest-set attributes are kept and later ones are dropped, with the number dropped reported on the exported span. **Default** `128` |
| <a id="property-maxattributevaluelength"></a> `maxAttributeValueLength?` | `number` | **`Experimental`** Maximum length of a string attribute value. Longer values are truncated, and the bound reaches every string the value contains, including the ones nested inside arrays and objects. It applies to span attributes, event attributes, span names, event names, status messages and resource attributes alike — including `exception.stacktrace`. The bound is what keeps one large value from making a span too large for the ingestion endpoint, which drops an oversized span whole. **Default** `8192` |
| <a id="property-maxeventsperspan"></a> `maxEventsPerSpan?` | `number` | **`Experimental`** Maximum events on a single span. On overflow the earliest events are kept and later ones are dropped, with the number dropped reported on the exported span. The cap is absolute: an `exception` event the SDK records on your behalf spends an ordinary slot like any other, so a span that fills its events and then throws keeps its `error` status but not the exception detail. Raise the cap on spans that record many events and can also fail. **Default** `128` |
| <a id="property-maxexportbatchsize"></a> `maxExportBatchSize?` | `number` | **`Experimental`** Maximum spans per outbound request, and the queue depth that triggers an immediate flush. On a 413 the SDK halves this, retries the same spans, then ramps back up. **Default** `512` |
| <a id="property-maxlivespans"></a> `maxLiveSpans?` | `number` | **`Experimental`** Bound on how many spans may be live (started but not ended) at once. At the bound `startSpan` returns an inert handle, so code that leaks spans cannot grow the SDK's bookkeeping without limit. The SDK tracks only an id and a timestamp per live span, never the span itself, so a high bound is inexpensive. **Default** `10000` |
| <a id="property-maxqueuesize"></a> `maxQueueSize?` | `number` | **`Experimental`** Bound on the in-memory export queue. When it is full the incoming span is dropped rather than evicting a queued one, whose children may already have been exported. Never lower than `maxExportBatchSize`. **Default** `2048` |
| <a id="property-maxspanagems"></a> `maxSpanAgeMs?` | `number` | **`Experimental`** Age at which a live span counts as leaked, in milliseconds. Checked only once `maxLiveSpans` is reached: spans this old are then evicted and never exported, and their slots are returned so one leak cannot disable tracing for the rest of the process. Below the bound, a long span that ends is exported as usual. Measured as monotonic elapsed time since `startSpan`, so a caller-supplied `startTime` neither ages a span early nor exempts it. **Default** `3600000` |
| <a id="property-resourceattributes-1"></a> `resourceAttributes?` | `SpanAttributes` | **`Experimental`** Extra OTLP resource attributes attached to every batch. A string `service.name`, `service.version` or `deployment.environment` here wins over the `serviceName` / `serviceVersion` / `environment` fields — set it either way. `telemetry.sdk.*` is SDK-controlled and always wins. |
| <a id="property-servicename-1"></a> `serviceName?` | `string` | **`Experimental`** Name of the service producing these spans, attached as the OTLP `service.name` resource attribute. PostHog groups operations by service and span name, so this is what makes spans attributable. **Default** `'unknown_service'` |
| <a id="property-serviceversion-1"></a> `serviceVersion?` | `string` | **`Experimental`** Service version, attached as OTLP `service.version`. |

### `UnresolvedFlagReason`

> **UnresolvedFlagReason** = `"experience_continuity"` \| `"unsupported_definition"` \| `"missing_context"` \| `"unresolved_dependency"`

Why local evaluation could not resolve a flag. `experience_continuity` and
`unsupported_definition` come from the flag's definition, `missing_context` from the
evaluation call, and `unresolved_dependency` from a flag the definition depends on.

### `UnsetPersonPropertiesMessage`

> **UnsetPersonPropertiesMessage** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="distinctid-5"></a> `distinctId` | `string` | - |
| <a id="options-6"></a> `options?` | `Record`\<`string`, `JsonType`\> | Per-event options, sent to capture unchanged. Known keys today are `process_person_profile`, `cookieless_mode`, `disable_skew_correction` (legacy `$ignore_sent_at`) and `product_tour_id`; unknown keys pass through. A legacy property such as `$process_person_profile` fills an option left unset. Capture drops an event whose option value it cannot read (`invalid_options`), and the SDK reports the drop through the `'error'` event. |
| <a id="properties-6"></a> `properties` | `string` \| `string`[] | - |
