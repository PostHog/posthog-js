---
title: "PostHog Node.js SDK 5.x"
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
| <a id="type-parameter-t-2"></a> `T` |

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
| <a id="type-parameter-t-3"></a> `T` |

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



## Alias

### `PostHog.alias`

> **alias**(`data`): `void`

Create an alias to link two distinct IDs together.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `data` | \{ `alias`: `string`; `disableGeoip?`: `boolean`; `distinctId`: `string`; \} | The alias data containing distinctId and alias |
| `data.alias` | `string` | - |
| `data.disableGeoip?` | `boolean` | - |
| `data.distinctId` | `string` | - |

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
| `data` | \{ `alias`: `string`; `disableGeoip?`: `boolean`; `distinctId`: `string`; \} | The alias data containing distinctId and alias |
| `data.alias` | `string` | - |
| `data.disableGeoip?` | `boolean` | - |
| `data.distinctId` | `string` | - |

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

> **captureException**(`error`, `distinctId?`, `additionalProperties?`, `uuid?`, `flags?`): `void`

Capture an error exception as an event.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `error` | `unknown` | The error to capture |
| `distinctId?` | `string` | Optional user distinct ID |
| `additionalProperties?` | `Record`\<`string` \| `number`, `any`\> | Optional additional properties to include |
| `uuid?` | `string` | Optional event UUID |
| `flags?` | `FeatureFlagEvaluations` | Optional `FeatureFlagEvaluations` snapshot to attach the same flag context as your other events |

#### Returns

`void`

#### Examples

```ts
// Capture an error with user ID
try {
  // Some risky operation
  riskyOperation()
} catch (error) {
  client.captureException(error, 'user_123')
}
```

```ts
// Capture with additional properties
try {
  apiCall()
} catch (error) {
  client.captureException(error, 'user_123', {
    endpoint: '/api/users',
    method: 'POST',
    status_code: 500
  })
}
```



### `PostHog.captureExceptionImmediate`

> **captureExceptionImmediate**(`error`, `distinctId?`, `additionalProperties?`, `flags?`): `Promise`\<`void`\>

Capture an error exception as an event immediately (synchronously).

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `error` | `unknown` | The error to capture |
| `distinctId?` | `string` | Optional user distinct ID |
| `additionalProperties?` | `Record`\<`string` \| `number`, `any`\> | Optional additional properties to include |
| `flags?` | `FeatureFlagEvaluations` | Optional `FeatureFlagEvaluations` snapshot to attach the same flag context as your other events |

#### Returns

`Promise`\<`void`\>

Promise that resolves when the error is captured

#### Examples

```ts
// Capture an error immediately with user ID
try {
  // Some risky operation
  riskyOperation()
} catch (error) {
  await client.captureExceptionImmediate(error, 'user_123')
}
```

```ts
// Capture with additional properties
try {
  apiCall()
} catch (error) {
  await client.captureExceptionImmediate(error, 'user_123', {
    endpoint: '/api/users',
    method: 'POST',
    status_code: 500
  })
}
```



## Debug

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

Needs `secretKey`, a project secret API key with the `transactional_email:write` scope (the
"Send transactional email" preset). A key with only `transactional_email:read` can read
statuses but not send. Keys made with `hog_flow:write` still work. Requests go to `appHost`,
or to the PostHog Cloud app host of `host`. `send` and `get` resolve to `{ data, error }` and
do not reject.
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



## Flush

### `PostHog.flush`

> **flush**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>



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



## Opt in

### `PostHog.optIn`

> **optIn**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>



## Register

### `PostHog.register`

> **register**(`properties`): `Promise`\<`void`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `properties` | `PostHogEventProperties` |

#### Returns

`Promise`\<`void`\>



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

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `property` | `string` |

#### Returns

`Promise`\<`void`\>



## SDK utils

### `PostHog.enableFullAiCapture`

> `readonly` **enableFullAiCapture**: `boolean`

Whether this client captures full AI content: see `enableFullAiCapture` in `PostHogOptions`.



### `PostHog.privacyMode`

> `readonly` **privacyMode**: `boolean`

Whether PostHog AI integrations redact content: see `privacyMode` in `PostHogOptions`.



### `PostHog.apiKey`

> **get** **apiKey**(): `string`

The project token the client was created with. Same value as `projectToken`.

##### Returns

`string`



### `PostHog.isDebug`

> **get** **isDebug**(): `boolean`

##### Returns

`boolean`



### `PostHog.isDisabled`

> **get** **isDisabled**(): `boolean`

##### Returns

`boolean`



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



### `PostHog.optedOut`

> **get** **optedOut**(): `boolean`

##### Returns

`boolean`



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
| `data` | `Partial`\<`ContextData`\> | Context data to apply (distinctId, sessionId, properties) |
| `options?` | `ContextOptions` | Context options (fresh: true to start with clean context instead of inheriting) |

#### Returns

`void`



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



### `PostHog.getCustomUserAgent`

> **getCustomUserAgent**(): `string`

Get the custom user agent string for this client.

#### Returns

`string`

The formatted user agent string

#### Example

```ts
// Get user agent
const userAgent = client.getCustomUserAgent()
// Returns: "posthog-node/5.7.0"
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



### `PostHog.getLibraryId`

> **getLibraryId**(): `string`

#### Returns

`string`



### `PostHog.getLibraryVersion`

> **getLibraryVersion**(): `string`

Get the library version from package.json.

#### Returns

`string`

The current library version string

#### Example

```ts
// Get version
const version = client.getLibraryVersion()
console.log(`Using PostHog SDK version: ${version}`)
```



### `PostHog.getPersistedProperty`

> **getPersistedProperty**(`key`): `any`

Get a persisted property value from memory storage.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `PostHogPersistedProperty` | The property key to retrieve |

#### Returns

`any`

The stored property value or undefined if not found

#### Examples

```ts
// Get user ID
const userId = client.getPersistedProperty('userId')
```

```ts
// Get session ID
const sessionId = client.getPersistedProperty('sessionId')
```



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



### `PostHog.getSurveysStateless`

> **getSurveysStateless**(): `Promise`\<`Survey`[]\>

** SURVEYS
*

#### Returns

`Promise`\<`Survey`[]\>



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



### `PostHog.on`

> **on**(`event`, `cb`): () => `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | `string` |
| `cb` | (...`args`) => `void` |

#### Returns

() => `void`



### `PostHog.optOut`

> **optOut**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>



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



### `PostHog.prepareEventMessage`

> **prepareEventMessage**(`props`): `Promise`\<\{ `distinctId`: `string`; `event`: `string`; `options`: `PostHogCaptureOptions`; `properties`: `PostHogEventProperties`; \}\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `props` | `EventMessage` |

#### Returns

`Promise`\<\{ `distinctId`: `string`; `event`: `string`; `options`: `PostHogCaptureOptions`; `properties`: `PostHogEventProperties`; \}\>



### `PostHog.setPersistedProperty`

> **setPersistedProperty**(`key`, `value`): `void`

Set a persisted property value in memory storage.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `PostHogPersistedProperty` | The property key to set |
| `value` | `any` | The value to store (null to remove) |

#### Returns

`void`

#### Examples

```ts
// Set user ID
client.setPersistedProperty('userId', 'user_123')
```

```ts
// Set session ID
client.setPersistedProperty('sessionId', 'session_456')
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



### `PostHog.withContext`

> **withContext**\<`T`\>(`data`, `fn`, `options?`): `T`

Run a function with specific context that will be applied to all events captured within that context.
It propagates the context to all subsequent calls down the call stack.
Context properties like tags and sessionId will be automatically attached to all events.
By default, nested contexts inherit from parent contexts. Use `{ fresh: true }` to start with a clean context.

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-1"></a> `T` |

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `data` | `Partial`\<`ContextData`\> | Context data to apply (sessionId, distinctId, properties, enableExceptionAutocapture) |
| `fn` | () => `T` | Function to run with the context |
| `options?` | `ContextOptions` | Context options (fresh: true to start with clean context instead of inheriting) |

#### Returns

`T`

The return value of the function

#### Example

```ts
posthog.withContext({ distinctId: 'user_123' }, () => {
  posthog.capture({ event: 'button clicked' })
})
```



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

> **createEventProcessor**(`_posthog`, `__namedParameters?`): (`event`) => `any`

Creates an event processor for the deprecated Sentry integration.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `_posthog` | `PostHogBackendClient` |
| `__namedParameters?` | `SentryIntegrationOptions` |

#### Returns

(`event`) => `any`

#### Deprecated

This integration is deprecated and will be removed in a future major version. Use PostHog Error Tracking for Node instead:
https://posthog.com/docs/error-tracking/installation/node

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

### `BeforeSendFn`

> **BeforeSendFn** = (`event`) => `EventMessage` \| `null`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | `EventMessage` |

#### Returns

`EventMessage` \| `null`

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

### `CaptureMetricOptions`

Options accepted by `posthog.metrics.count/gauge/histogram`.

#### Extended by

- `HistogramOptions`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attributes"></a> `attributes?` | `MetricAttributes` | Low-cardinality dimensions to filter and group by (e.g. route, plan, region). Each distinct combination is its own series. |
| <a id="property-unit"></a> `unit?` | `string` | Unit of the value (e.g. 'ms', 'byte'). Displayed in the Metrics UI and part of the series identity — the same name with two units is two series. |

### `CodeEmailForm`

> **CodeEmailForm** = `CodeEmailFields` & (\{ `html`: `string`; `text?`: `string`; \} \| \{ `html?`: `string`; `text`: `string`; \})

Email content your code rendered, such as React Email output, named by a key. PostHog sends it
as is and never stores it. Needs `html`, `text` or both. PostHog derives a missing `text` from
the `html`.

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
| <a id="name"></a> `name` | `public` | `EmailErrorName` | - | `Error.name` |
| <a id="retryafterms"></a> `retryAfterMs?` | `readonly` | `number` | How long PostHog asked the client to wait before it sends again, in milliseconds. | - |
| <a id="statuscode"></a> `statusCode?` | `readonly` | `number` | The HTTP status, when PostHog answered. | - |
| <a id="why"></a> `why?` | `readonly` | `string` | - | - |

### `EmailErrorName`

> **EmailErrorName** = `"validation_error"` \| `"missing_api_key"` \| `"invalid_permission"` \| `"not_found"` \| `"concurrent_idempotent_requests"` \| `"invalid_idempotent_request"` \| `"rate_limit_exceeded"` \| `"monthly_quota_exceeded"` \| `"service_unavailable"` \| `"application_error"`

A coarse category of the failure, for code that branches on the kind of failure rather than the exact `code`.

### `Emails`

The `posthog.emails` API: sends transactional email from PostHog email templates or from
content your code rendered, and reads the status of each email it sent.

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

Queue one email, from a transactional email template or from content your code rendered.

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

### `EventMessage`

> **EventMessage** = `Omit`\<`IdentifyMessage`, `"distinctId"`\> & `object`

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `_originatedFromCaptureException?` | `boolean` | Internal flag set by captureException() to indicate this $exception event originated from the proper exception capture path. Used to warn users who call capture() with '$exception' directly. |
| `distinctId?` | `string` | - |
| `event` | `string` | - |
| `flags?` | `FeatureFlagEvaluations` | Attach feature flag values evaluated via `posthog.evaluateFlags()` to this event. Prefer this over `sendFeatureFlags` — it guarantees the event carries the exact values the code branched on and avoids a hidden `/flags` request on every capture. |
| `groups?` | `Record`\<`string`, `string` \| `number`\> | - |
| `sendFeatureFlags?` | `boolean` \| `SendFeatureFlagsOptions` | **Deprecated** Use the `flags` option with a `FeatureFlagEvaluations` object obtained from `posthog.evaluateFlags()` instead. `sendFeatureFlags` fires a separate `/flags` request on capture and may return different values than the ones the code branched on. |
| `timestamp?` | `Date` | If provided, overrides the auto-generated timestamp. UTC is preferred; non-UTC input is converted to UTC. |
| `uuid?` | `string` | If provided overrides the auto-generated event UUID. Must be a valid UUID. |

### `FeatureFlagBucketingIdentifier`

> **FeatureFlagBucketingIdentifier** = `"distinct_id"` \| `"device_id"` \| `""` \| `null`

### `FeatureFlagCondition`

> **FeatureFlagCondition** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="aggregation_group_type_index"></a> `aggregation_group_type_index?` | `number` \| `null` |
| <a id="properties"></a> `properties` | `FlagProperty`[] |
| <a id="rollout_percentage"></a> `rollout_percentage?` | `number` |
| <a id="variant"></a> `variant?` | `string` |

### `FeatureFlagEvaluationRuntime`

> **FeatureFlagEvaluationRuntime** = `"all"` \| `"client"` \| `"server"`

Where a feature flag is meant to be evaluated. Set per flag in PostHog and carried on
every locally cached flag definition. `all` means the flag suits both client-side and
server-side evaluation, so it matches either runtime.

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

#### Constructors

##### Constructor

> **new FeatureFlagEvaluations**(`init`): `FeatureFlagEvaluations`

**`Internal`**

— instances are created by the SDK via `posthog.evaluateFlags()`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `init` | \{ `accessed?`: `Set`\<`string`\>; `disableGeoip?`: `boolean`; `distinctId`: `string`; `errorsWhileComputing?`: `boolean`; `evaluatedAt?`: `number`; `flagDefinitionsLoadedAt?`: `number`; `flags`: `Record`\<`string`, `EvaluatedFlagRecord`\>; `groups?`: `Record`\<`string`, `string` \| `number`\>; `host`: `FeatureFlagEvaluationsHost`; `isSlice?`: `boolean`; `quotaLimited?`: `boolean`; `requestId?`: `string`; `unresolvedFlags?`: `Record`\<`string`, `UnresolvedFlagReason`\>; \} |
| `init.accessed?` | `Set`\<`string`\> |
| `init.disableGeoip?` | `boolean` |
| `init.distinctId` | `string` |
| `init.errorsWhileComputing?` | `boolean` |
| `init.evaluatedAt?` | `number` |
| `init.flagDefinitionsLoadedAt?` | `number` |
| `init.flags` | `Record`\<`string`, `EvaluatedFlagRecord`\> |
| `init.groups?` | `Record`\<`string`, `string` \| `number`\> |
| `init.host` | `FeatureFlagEvaluationsHost` |
| `init.isSlice?` | `boolean` |
| `init.quotaLimited?` | `boolean` |
| `init.requestId?` | `string` |
| `init.unresolvedFlags?` | `Record`\<`string`, `UnresolvedFlagReason`\> |

###### Returns

`FeatureFlagEvaluations`

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

##### \_getEventProperties()

> **\_getEventProperties**(): `Record`\<`string`, `any`\>

**`Internal`**

Build the `$feature/*` and `$active_feature_flags` event properties derived
from the current flag set. Called by `capture()` when an event is captured
with `flags: ...`.

###### Returns

`Record`\<`string`, `any`\>

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

### `FeatureFlagOverrideOptions`

> **FeatureFlagOverrideOptions** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="flags"></a> `flags?` | `false` \| `string`[] \| `Record`\<`string`, `FeatureFlagValue`\> | Flag overrides. Can be: - `false` to clear flag overrides - `string[]` to enable a list of flags - `Record<string, FeatureFlagValue>` to set specific values/variants |
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

| Property | Type |
| ------ | ------ |
| <a id="disablegeoip-1"></a> `disableGeoip?` | `boolean` |
| <a id="distinctid"></a> `distinctId?` | `string` |
| <a id="groupkey"></a> `groupKey` | `string` |
| <a id="grouptype"></a> `groupType` | `string` |
| <a id="properties-1"></a> `properties?` | `Record`\<`string` \| `number`, `any`\> |

### `HistogramOptions`

Options accepted by `posthog.metrics.histogram`.

#### Extends

- `CaptureMetricOptions`

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-attributes-1"></a> `attributes?` | `MetricAttributes` | Low-cardinality dimensions to filter and group by (e.g. route, plan, region). Each distinct combination is its own series. | `CaptureMetricOptions`.`attributes` |
| <a id="property-bounds"></a> `bounds?` | `number`[] | Upper bucket boundaries, finite and strictly increasing. A value lands in the first bucket whose boundary is greater than or equal to it, and values above the last boundary land in an overflow bucket. Defaults to the OpenTelemetry defaults `[0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000]`. The first sample of a histogram (name and unit) fixes its bounds until the client resets. A later sample that passes different bounds is recorded in the fixed buckets and logs a warning, once per flush window. A sample with invalid bounds is dropped with a warning. The client fixes the bounds of at most `maxSeriesPerFlush` histograms. Past that limit, the client drops samples of a new histogram that pass bounds other than the defaults, and logs one warning. Each client fixes bounds on its own. PostHog stores one set of bounds per histogram series and reads every client's counts against it. Every client must therefore pass the same bounds for the same histogram. | - |
| <a id="property-unit-1"></a> `unit?` | `string` | Unit of the value (e.g. 'ms', 'byte'). Displayed in the Metrics UI and part of the series identity — the same name with two units is two series. | `CaptureMetricOptions`.`unit` |

### `IdentifyMessage`

> **IdentifyMessage** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="disablegeoip-2"></a> `disableGeoip?` | `boolean` |
| <a id="distinctid-1"></a> `distinctId` | `string` |
| <a id="properties-2"></a> `properties?` | `Record`\<`string` \| `number`, `any`\> |

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
| `options?` | `HistogramOptions` |

###### Returns

`void`

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
| <a id="name-2"></a> `name` | `string` | - |
| <a id="rollout_percentage-1"></a> `rollout_percentage` | `null` \| `number` | - |

### `PostHogOptions`

> **PostHogOptions** = `Omit`\<`PostHogCoreOptions`, `"before_send"` \| `"flushInterval"` \| `"maxQueueSize"`\> & `object` & `ExceptionRateLimiterConfig`

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `__preview_capture_bot_pageviews?` | `boolean` | PREVIEW - MAY CHANGE WITHOUT WARNING - DO NOT USE IN PRODUCTION Enables collection of bot traffic as $bot_pageview events instead of dropping them. When enabled, events with a $raw_user_agent property that matches the bot detection list will have their $pageview event renamed to $bot_pageview. To use this feature, pass the user agent in event properties: `client.capture({ distinctId: 'user_123', event: '$pageview', properties: { $raw_user_agent: req.headers['user-agent'] } })` |
| `appHost?` | `string` | Your PostHog app host, such as `https://posthog.example.com`. `emails.send` sends there. Needed only when `host` is not PostHog Cloud, for example a reverse proxy, which must not receive the secret key. On PostHog Cloud, the client derives `https://us.posthog.com` or `https://eu.posthog.com` from `host`. |
| `before_send?` | `BeforeSendFn` \| `BeforeSendFn`[] | Allows modification or dropping of events before they're sent to PostHog. If an array is provided, the functions are run in order. If a function returns null, the event will be dropped. |
| `custom_blocked_useragents?` | `string`[] | Additional user agent strings to block from being tracked. These are combined with the default list of blocked user agents. **Default** `[]` |
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
| `flagDefinitionCacheProvider?` | `FlagDefinitionCacheProvider`\<`FlagDefinitionCacheInput`\> | Optional cache provider for feature flag definitions. Allows custom caching strategies (Redis, database, etc.) for flag definitions in multi-worker environments. If not provided, defaults to in-memory cache. Without a secretKey or personalApiKey, this instance only reads cached definitions on each refresh; it does not call shouldFetchFlagDefinitions or publish definitions. With a credential, it uses the provider's fetch decision to coordinate fetching fresh definitions from PostHog and publishing them to the cache. This enables distributed coordination where only one worker fetches flags while others use cached data, reducing API calls and improving performance. **Example** `import type { FlagDefinitionCacheProvider } from 'posthog-node' class RedisCacheProvider implements FlagDefinitionCacheProvider { // ... implementation } const client = new PostHog('api-key', { flagDefinitionCacheProvider: new RedisCacheProvider(redis) })` |
| `flushInterval?` | `number` | The interval in milliseconds between periodic flushes **Default** `5000` |
| `isServer?` | `boolean` | Whether to attach the `$is_server: true` property to every captured event. **Remarks** Defaults to `true` because this SDK is intended for server-side use, where the property lets PostHog distinguish server events from browser and react-native events. Set this to `false` when running the SDK as a client/CLI so the event is attributed to the device OS normally instead of being marked as a server event. When `false`, the `$is_server` property is omitted entirely. **Default** `true` **Example** `// CLI usage: don't mark events as server-side new PostHog('key', { isServer: false })` |
| `maxCacheSize?` | `number` | - |
| `maxQueueSize?` | `number` | The maximum number of cached messages either in memory or on the local storage (must be higher than `flushAt`) **Default** `10000` |
| `metrics?` | `MetricsConfig` | Configuration for the `posthog.metrics` API (count, gauge, histogram). Set `serviceName` so series can be filtered per service in the Metrics UI. **Example** `const client = new PostHog('phc_...', { metrics: { serviceName: 'billing-worker' } }) client.metrics.count('invoices.processed')` |
| `migratedFrom?` | `string` | The provider your email moved from, such as `'resend'`. Sent with every `posthog.emails` request. |
| `persistence?` | `"memory"` | - |
| `personalApiKey?` | `string` | **Deprecated** Use `secretKey` instead. |
| `privacyMode?` | `boolean` | Redact prompts, outputs and error details from every event that the PostHog AI integrations (`@posthog/ai`) capture with this client. Per-call privacy settings can only add redaction. Defaults to false. |
| `readPostHogCookie?` | `boolean` \| \{ `optOutCapturingByDefault?`: `boolean`; `sessionIdleTimeoutSeconds?`: `number`; \} | Lets the Express and NestJS integrations read the session ID, and the distinct ID of an identified user, from the posthog-js cookie when a request has neither tracing header. Turn it on only when posthog-js stores opt-out consent in a cookie, or when you do not use opt-out: the server cannot read an opt-out that posthog-js keeps in localStorage (its default). It needs cookie-backed posthog-js persistence (the default `localStorage+cookie`, or `cookie`), the default cookie name (no `persistence_name`), and the default `__ph_opt_in_out_<token>` consent cookie name. Set `sessionIdleTimeoutSeconds` when posthog-js uses a custom `session_idle_timeout_seconds`, and set `optOutCapturingByDefault` when posthog-js uses `opt_out_capturing_by_default`, so a visitor with no consent cookie counts as opted out. A request sent right after `identify()` or `reset()` can still carry the previous identity, because posthog-js saves the cookie with a short delay. **Default** `false` |
| `secretKey?` | `string` | Credential for fetching local feature flag definitions, decrypting remote config and sending email. Accepts either a Personal API Key (`phx_...`) or a Project Secret API Key (`phs_...`). Local evaluation can also use definitions from `flagDefinitionCacheProvider` without this credential. Remote config payload decryption via `getRemoteConfigPayload` still requires it. `emails.send` needs a Project Secret API Key with the `transactional_email:write` scope; set `enableLocalEvaluation: false` when the key is only for email. Prefer this over the deprecated `personalApiKey` option; when both are set, `secretKey` takes precedence. **Example** `const client = new PostHog('phc_...', { secretKey: 'phs_...' })` |
| `strictLocalEvaluation?` | `boolean` | When enabled, all feature flag evaluations will use local evaluation only, never falling back to server-side evaluation. This prevents unexpected server requests and associated costs when using local evaluation. Flags that cannot be evaluated locally (e.g., those with experience continuity) will return `undefined` instead of making a server request. **Default** `false` |
| `traces?` | `TracesConfig` | **`Experimental`** Configuration for distributed tracing (`startSpan` / `withSpan`). Tracing is off until this is set; supplying it is all that's needed to turn it on. Set `serviceName` so spans can be attributed and grouped per service — the product aggregates operations by service and span name. `shutdown()` drains spans that have already ended, within the shutdown timeout; spans still open at that point are discarded. **Example** `const client = new PostHog('phc_...', { traces: { serviceName: 'checkout-api' } }) await client.withSpan('charge', () => stripe.charge(order))` Subject to change in a minor release. |
| `waitUntil()?` | (`promise`) => `void` | **`Experimental`** Provides the API to extend the lifetime of a serverless invocation until background work (like flushing analytics events) completes after the response is sent. Subject to change in a minor release. **Example** `// Vercel import { waitUntil } from '@vercel/functions' new PostHog('key', { waitUntil })` |
| `waitUntilDebounceMs?` | `number` | **`Experimental`** Debounce interval in milliseconds for the `waitUntil`-based flush. After the last event is enqueued, the SDK waits this long before flushing. Subject to change in a minor release. **Default** `50` |
| `waitUntilMaxWaitMs?` | `number` | **`Experimental`** Maximum time in milliseconds to debounce before forcing a flush. Prevents starvation from rapid concurrent captures. Subject to change in a minor release. **Default** `500` |

### `PropertyGroup`

> **PropertyGroup** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="type-1"></a> `type` | `"AND"` \| `"OR"` |
| <a id="values"></a> `values` | `PropertyGroup`[] \| `FlagProperty`[] |

### `SendCodeEmailOptions`

> **SendCodeEmailOptions** = `SendEmailBase` & `CodeEmailForm` & `Without`\<`TemplateEmailForm`\>

### `SendEmailBase`

What every send takes, whatever its form.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-distinctid-1"></a> `distinctId?` | `string` | The recipient's distinct ID in your product. The email's events go to this person. Without it, they go to a person whose distinct ID is the email address. |
| <a id="property-idempotencykey"></a> `idempotencyKey?` | `string` | 1 to 255 visible ASCII characters. A send with a key that PostHog has already accepted queues nothing and returns the first send's result. The same key with other options sends nothing and returns an error with code `idempotency_key_reused`. Without it, the client makes a UUID that covers its own retries. Pass a key derived from what the email is for, such as `welcome:user_123`, to cover retries outside this call too. |
| <a id="property-maxretries"></a> `maxRetries?` | `number` | Overrides the client's `emailRequestMaxRetries` for this send. `0` turns retries off. |
| <a id="property-to"></a> `to` | `string` | One recipient email address. |

### `SendEmailOptions`

> **SendEmailOptions** = `SendTemplateEmailOptions` \| `SendCodeEmailOptions`

Options for `posthog.emails.send()`: a template made in PostHog, or content from your code.

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

### `SendTemplateEmailOptions`

> **SendTemplateEmailOptions** = `SendEmailBase` & `TemplateEmailForm` & `Without`\<`CodeEmailFields` & `object`\>

### `SentryIntegrationOptions`

> **SentryIntegrationOptions** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="organization"></a> `organization?` | `string` |
| <a id="prefix"></a> `prefix?` | `string` |
| <a id="projectid"></a> `projectId?` | `number` |
| <a id="sendexceptionstoposthog"></a> `sendExceptionsToPostHog?` | `boolean` |
| <a id="severityallowlist"></a> `severityAllowList?` | `CoreErrorTracking.SeverityLevel`[] \| `"*"` |

### `SetPersonPropertiesMessage`

> **SetPersonPropertiesMessage** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="distinctid-2"></a> `distinctId` | `string` |
| <a id="properties-3"></a> `properties?` | `Record`\<`string` \| `number`, `any`\> |
| <a id="propertiesonce"></a> `propertiesOnce?` | `Record`\<`string` \| `number`, `any`\> |

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
| <a id="property-attributes-2"></a> `attributes` | `public` | `SpanAttributes` | **`Experimental`** Editable in place; this is where to redact. |
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

### `StartSpanOptions`

**`Experimental`**

Options accepted by `startSpan` and `withSpan`.

 Subject to change in a minor release.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attributes-3"></a> `attributes?` | `SpanAttributes` | **`Experimental`** Attributes to set at span start. User-supplied keys win over the SDK's auto-attached context attributes. |
| <a id="property-kind-1"></a> `kind?` | `SpanKind` | **`Experimental`** What kind of work the span represents. **Default** `'internal'` |
| <a id="property-parent"></a> `parent?` | `string` \| `Span` | **`Experimental`** Parent of this span: either a span handle, or a raw W3C `traceparent` string to continue a trace started by another service. When omitted the parent is the currently active span, or none. Only handles returned by this SDK are honoured; any other `Span` yields an inert span. **Example** **Continue an inbound trace** `posthog.withSpan('POST /checkout', { parent: req.get('traceparent') }, handler)` |
| <a id="property-starttime-1"></a> `startTime?` | `SpanTimeInput` | **`Experimental`** Backdate the span's start. Values outside the representable range fall back to the current time; starts more than 24 hours old are warned about, because the server clamps them to receive time. |
| <a id="property-tracestate"></a> `tracestate?` | `string` | **`Experimental`** The W3C `tracestate` value accompanying a `traceparent`-string `parent`. Ignored when `parent` is a span handle — those inherit the parent's tracestate. Preserved opaquely and passed on to children. |

### `TemplateEmailForm`

A template made transactional in PostHog, sent by its ID.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-templatedata"></a> `templateData?` | `Record`\<`string`, `unknown`\> | Values for the template's `{{ variables.* }}` placeholders. Sent as `message_data`. |
| <a id="property-templateid"></a> `templateId` | `string` | The UUID of an email template made transactional in PostHog. |

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

| Property | Type |
| ------ | ------ |
| <a id="distinctid-3"></a> `distinctId` | `string` |
| <a id="properties-4"></a> `properties` | `string` \| `string`[] |
