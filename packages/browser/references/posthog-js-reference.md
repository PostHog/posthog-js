---
title: "PostHog JavaScript Web SDK"
sidebar: Docs
showTitle: true
contentMaxWidthClass: max-w-full
platformLogo: javascript
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
  - value: "Logs"
    url: logs
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
  - value: "Create person profile"
    url: create-person-profile
    depth: 0
  - value: "Debug"
    url: debug
    depth: 0
  - value: "Exception steps"
    url: exception-steps
    depth: 0
  - value: "Get distinct ID"
    url: get-distinct-id
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
  - value: "Get session ID"
    url: get-session-id
    depth: 0
  - value: "Group"
    url: group
    depth: 0
  - value: "Is feature enabled"
    url: is-feature-enabled
    depth: 0
  - value: "Is opt out"
    url: is-opt-out
    depth: 0
  - value: "Is session replay active"
    url: is-session-replay-active
    depth: 0
  - value: "On feature flags"
    url: on-feature-flags
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
  - value: "Reset"
    url: reset
    depth: 0
  - value: "Reset group properties for flags"
    url: reset-group-properties-for-flags
    depth: 0
  - value: "Reset person properties for flags"
    url: reset-person-properties-for-flags
    depth: 0
  - value: "Set group properties for flags"
    url: set-group-properties-for-flags
    depth: 0
  - value: "Set person properties"
    url: set-person-properties
    depth: 0
  - value: "Set person properties for flags"
    url: set-person-properties-for-flags
    depth: 0
  - value: "Shutdown"
    url: shutdown
    depth: 0
  - value: "Start session recording"
    url: start-session-recording
    depth: 0
  - value: "Stop session recording"
    url: stop-session-recording
    depth: 0
  - value: "Unregister"
    url: unregister
    depth: 0
  - value: "Consent gating"
    url: consent-gating
    depth: 0
  - value: "Surveys"
    url: surveys
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
npm install posthog-js
```

### Initialize

```ts
import posthog from 'posthog-js'

posthog.init('<ph_project_api_key>', { api_host: 'https://us.i.posthog.com' })
```

### Capture

```ts
posthog.capture('signed_up', { plan: 'pro' })
```

### Identify

```ts
posthog.identify('user_123', { email: 'user@example.com' })
```

## Setup

### `new PostHog(...)`

> **new PostHog**(): `PostHog`

Creates an uninitialized PostHog instance.

#### Returns

`PostHog`

#### Remarks

Most browser applications should use the default exported singleton and call `posthog.init()`.
Construct a new instance only when you need to manage a separate SDK instance manually.

#### Example

```js
const instance = new PostHog()
instance.init('<ph_project_api_key>', { api_host: 'https://us.i.posthog.com' })
```

### `PostHog.init`

> **init**(`token`, `config?`, `name?`): `PostHog`

Initializes a new instance of the PostHog capturing object.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `token` | `string` | Your PostHog API token |
| `config?` | `Partial`\<`PostHogConfig`\> | A dictionary of config options to override |
| `name?` | `string` | The name for the new posthog instance that you want created |

#### Returns

`PostHog`

The newly initialized PostHog instance

#### Remarks

All new instances are added to the main posthog object as sub properties (such as
`posthog.library_name`) and also returned by this function. [Learn more about configuration options](https://posthog.com/docs/libraries/js/config)

#### Examples

```js
// basic initialization
posthog.init('<ph_project_api_key>', {
    api_host: '<ph_client_api_host>'
})
```

```js
// multiple instances
posthog.init('<ph_project_api_key>', {}, 'project1')
posthog.init('<ph_project_api_key>', {}, 'project2')
```

### `PostHog.set_config`

> **set\_config**(`config`): `void`

Updates the configuration of the PostHog instance.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `config` | `Partial`\<`PostHogConfig`\> | A dictionary of new configuration values to update |

#### Returns

`void`



## Capture

### `PostHog.capture`

> **capture**(`event_name`, `properties?`, `options?`): `CaptureResult` \| `undefined`

Captures an event with optional properties and configuration.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `event_name` | `EventName` | The name of the event (e.g., 'Sign Up', 'Button Click', 'Purchase') |
| `properties?` | `Properties` \| `null` | Properties to include with the event describing the user or event details |
| `options?` | `CaptureOptions` | Optional configuration for the capture request |

#### Returns

`CaptureResult` \| `undefined`

The capture result containing event data, or undefined if capture failed

#### Remarks

You can capture arbitrary object-like values as events. [Learn about capture best practices](/docs/product-analytics/capture-events)

#### Example

```js
// basic event capture
posthog.capture('cta-button-clicked', {
    button_name: 'Get Started',
    page: 'homepage'
})
```



## Identify

### `PostHog.clearIdentity`

> **clearIdentity**(): `void`

Clear HMAC-based identity verification, reverting to anonymous mode.

#### Returns

`void`

#### Example

```js
posthog.clearIdentity()
```



### `PostHog.identify`

> **identify**(`new_distinct_id?`, `userPropertiesToSet?`, `userPropertiesToSetOnce?`): `void`

Associates a user with a unique identifier instead of an auto-generated ID.
Learn more about [identifying users](/docs/product-analytics/identify)

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `new_distinct_id?` | `string` | A non-empty string that uniquely identifies a user. |
| `userPropertiesToSet?` | `Properties` | Optional: An associative array of properties to store about the user. Note: For feature flag evaluations, if the same key is present in the userPropertiesToSetOnce, it will be overwritten by the value in userPropertiesToSet. |
| `userPropertiesToSetOnce?` | `Properties` | Optional: An associative array of properties to store about the user. If property is previously set, this does not override that value. |

#### Returns

`void`

#### Remarks

By default, PostHog assigns each user a randomly generated `distinct_id`. Use this method to
replace that ID with your own unique identifier (like a user ID from your database).

#### Examples

```js
// basic identification
posthog.identify('user_12345')
```

```js
// identify with user properties
posthog.identify('user_12345', {
    email: 'user@example.com',
    plan: 'premium'
})
```

```js
// identify with set and set_once properties
posthog.identify('user_12345',
    { last_login: new Date() },  // updates every time
    { signup_date: new Date() }  // sets only once
)
```



### `PostHog.setIdentity`

> **setIdentity**(`distinctId`, `hash`): `void`

Set HMAC-based identity verification.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `distinctId` | `string` | The verified user distinct_id |
| `hash` | `string` | HMAC-SHA256 of distinctId, signed with the Secret API key from Support settings |

#### Returns

`void`

#### Remarks

When set, products like conversations use server-verified identity
(distinct_id + HMAC hash) instead of anonymous session identifiers.
The hash should be computed server-side as HMAC-SHA256 of the
distinct_id, signed with the Secret API key from Support settings.
Project secret API keys (project settings) and personal API keys are rejected.
Any additional signed identity claims are cleared because they are
bound to the previously configured distinct_id.

#### Example

```js
posthog.setIdentity('user_123', 'a1b2c3d4e5f6...')
```



## Logs

### `PostHog.logger`

> **get** **logger**(): `Logger`

Logger with convenience methods for each severity level.

##### Example

```js
posthog.logger.info('checkout completed', { order_id: 'ord_789' })
posthog.logger.error('payment failed', { error_code: 'E001' })
```

##### Returns

`Logger`



### `PostHog.captureLog`

> **captureLog**(`options`): `void`

Capture a log entry and send it to the PostHog logs endpoint.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options` | `CaptureLogOptions` | The log entry options |

#### Returns

`void`

#### Example

```js
posthog.captureLog({
  body: 'checkout completed',
  level: 'info',
  attributes: { order_id: 'ord_789', amount_cents: 4999 },
})
```



## Alias

### `PostHog.alias`

> **alias**(`alias`, `original?`): `number` \| `void` \| `CaptureResult`

Creates an alias linking two distinct user identifiers. Learn more about [identifying users](/docs/product-analytics/identify)

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `alias` | `string` | A unique identifier that you want to use for this user in the future. |
| `original?` | `string` | The current identifier being used for this user. |

#### Returns

`number` \| `void` \| `CaptureResult`

The `$create_alias` capture result, `-1` if alias matches the current distinct ID, `-2` if aliasing would duplicate a People user, or void if person processing is disabled.

#### Remarks

PostHog will use this to link two distinct_ids going forward (not retroactively).
Call this when a user signs up to connect their anonymous session with their account.

#### Examples

```js
// link anonymous user to account on signup
posthog.alias('user_12345')
```

```js
// explicit alias with original ID
posthog.alias('user_12345', 'anonymous_abc123')
```



## Capture AI

### `PostHog.captureTraceFeedback`

> **captureTraceFeedback**(`traceId`, `userFeedback`): `void`

Capture written user feedback for a LLM trace. Numeric values are converted to strings.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `traceId` | `string` \| `number` | The trace ID to capture feedback for. |
| `userFeedback` | `string` | The feedback to capture. |

#### Returns

`void`



### `PostHog.captureTraceMetric`

> **captureTraceMetric**(`traceId`, `metricName`, `metricValue`): `void`

Capture a metric for a LLM trace. Numeric values are converted to strings.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `traceId` | `string` \| `number` | The trace ID to capture the metric for. |
| `metricName` | `string` | The name of the metric to capture. |
| `metricValue` | `string` \| `number` \| `boolean` | The value of the metric to capture. |

#### Returns

`void`



## Capture exception

### `PostHog.captureException`

> **captureException**(`error`, `additionalProperties?`): `CaptureResult` \| `undefined`

Capture a caught exception manually

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `error` | `unknown` | The error or exception-like value to capture. |
| `additionalProperties?` | `Properties` | Any additional properties to add to the error event. |

#### Returns

`CaptureResult` \| `undefined`

The result of the capture, or undefined if exception capture is unavailable.

#### Examples

```js
// Capture a caught exception
try {
  // something that might throw
} catch (error) {
  posthog.captureException(error)
}
```

```js
// With additional properties
posthog.captureException(error, {
  customProperty: 'value',
  anotherProperty: ['I', 'can be a list'],
  ...
})
```



### `PostHog.startExceptionAutocapture`

> **startExceptionAutocapture**(`config?`): `void`

turns exception autocapture on, and updates the config option `capture_exceptions` to the provided config (or `true`)

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `config?` | `ExceptionAutoCaptureConfig` | optional configuration option to control the exception autocapture behavior |

#### Returns

`void`

#### Examples

```js
// Start with default exception autocapture rules. No-op if already enabled
posthog.startExceptionAutocapture()
```

```js
// Start and override controls
posthog.startExceptionAutocapture({
  // you don't have to send all of these (unincluded values will use the default)
  capture_unhandled_errors: true || false,
  capture_unhandled_rejections: true || false,
  capture_console_errors: true || false
})
```



### `PostHog.stopExceptionAutocapture`

> **stopExceptionAutocapture**(): `void`

turns exception autocapture off by updating the config option `capture_exceptions` to `false`

#### Returns

`void`

#### Example

```js
// Stop capturing exceptions automatically
posthog.stopExceptionAutocapture()
```



## Create person profile

### `PostHog.createPersonProfile`

> **createPersonProfile**(): `void`

Creates a person profile for the current user, if they don't already have one and config.person_profiles is set
 to 'identified_only'. Produces a warning and does not create a profile if config.person_profiles is set to
 'never'. Learn more about [person profiles](/docs/product-analytics/identify)

#### Returns

`void`

#### Example

```js
posthog.createPersonProfile()
```



## Debug

### `PostHog.debug`

> **debug**(`debug?`): `void`

Enables or disables debug mode for detailed logging.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `debug?` | `boolean` | If true, will enable debug mode. |

#### Returns

`void`

#### Remarks

Debug mode logs all PostHog calls to the browser console for troubleshooting.
Can also be enabled by adding `?__posthog_debug=true` to the URL.

#### Examples

```js
// enable debug mode
posthog.debug(true)
```

```js
// disable debug mode
posthog.debug(false)
```



## Exception steps

### `PostHog.addExceptionStep`

> **addExceptionStep**(`message`, `properties?`): `void`

Add a breadcrumb-like step that will be attached to the next captured exception.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `message` | `string` | The step message. |
| `properties?` | `Properties` | Additional context for this step. |

#### Returns

`void`

#### Example

```js
posthog.addExceptionStep('Checkout button clicked', {
  checkout_id: 'ch_123',
})
```



## Get distinct ID

### `PostHog.get_distinct_id`

> **get\_distinct\_id**(): `string`

Returns the current distinct ID for the user.

#### Returns

`string`

The current distinct ID

#### Remarks

This is either the auto-generated ID or the ID set via `identify()`.
The distinct ID is used to associate events with users in PostHog.

#### Examples

```js
// get the current user ID
const userId = posthog.get_distinct_id()
console.log('Current user:', userId)
```

```js
// use in loaded callback
posthog.init('token', {
    loaded: (posthog) => {
        const id = posthog.get_distinct_id()
        // use the ID
    }
})
```



## Get feature flag

### `PostHog.getFeatureFlag`

> **getFeatureFlag**(`key`, `options?`): `string` \| `boolean` \| `undefined`

Gets the value of a feature flag for the current user.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | Key of the feature flag. |
| `options?` | `FeatureFlagOptions` | Optional lookup settings. If `{ send_event: false }`, we won't send a `$feature_flag_called` event to PostHog. If `{ fresh: true }`, we won't return cached values from localStorage - only values loaded from the server. |

#### Returns

`string` \| `boolean` \| `undefined`

The feature flag value, or undefined if the flag is unavailable.

#### Remarks

Returns the feature flag value which can be a boolean, string, or undefined.
Supports multivariate flags that can return custom string values. An evaluated boolean flag
returns `true` or `false`; `undefined` means no current evaluation is available for the key.
Globally inactive flags are omitted from the remote `/flags` response, so after that response
loads they are unavailable rather than represented by a `false` result.

#### Examples

```js
// check boolean flag
if (posthog.getFeatureFlag('new-feature')) {
    // show new feature
}
```

```js
// check multivariate flag
const variant = posthog.getFeatureFlag('button-color')
if (variant === 'red') {
    // show red button
}
```



## Get feature flag payload

### `PostHog.getFeatureFlagPayload`

> **getFeatureFlagPayload**(`key`): `JsonType`

Get feature flag payload value matching key for user (supports multivariate flags).

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | Key of the feature flag. |

#### Returns

`JsonType`

The feature flag payload.

#### Example

```js
const betaFeature = posthog.getFeatureFlagResult('beta-feature')
if (betaFeature?.variant === 'some-value') {
     const someValue = betaFeature?.payload
     // do something
}
```

#### Deprecated

Use `getFeatureFlagResult()` instead



## Get feature flag result

### `PostHog.getFeatureFlagResult`

> **getFeatureFlagResult**(`key`, `options?`): `FeatureFlagResult` \| `undefined`

Get a feature flag evaluation result including both the flag value and payload.

A result with `enabled: false` is a conclusive off evaluation. `undefined` means no current
evaluation is available for the key. This includes globally inactive flags, which are omitted
from the remote `/flags` response.

By default, this method emits the `$feature_flag_called` event.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | Key of the feature flag. |
| `options?` | `FeatureFlagOptions` | Options for the feature flag lookup. |

#### Returns

`FeatureFlagResult` \| `undefined`

The feature flag result including key, enabled, variant, and payload.

#### Examples

```js
const result = posthog.getFeatureFlagResult('my-flag')
if (result?.enabled) {
    console.log('Flag is enabled with payload:', result.payload)
}
```

```js
// multivariate flag
const result = posthog.getFeatureFlagResult('button-color')
if (result?.variant === 'red') {
    showRedButton(result.payload)
}
```



## Get feature flags

### `PostHog.getAllFeatureFlags`

> **getAllFeatureFlags**(): `FeatureFlagResult`[]

Returns all currently cached feature flags as `FeatureFlagResult`s. This is a synchronous read of
the flags from the last load (no network request); call `reloadFeatureFlags()` first to refresh.
Conclusive off evaluations are included with `enabled: false`; keys omitted from the response,
including globally inactive flags, are absent. Unlike `getFeatureFlag()`, this method does not
send a `$feature_flag_called` event.

#### Returns

`FeatureFlagResult`[]

All loaded flags, or an empty array if none are loaded.

## Get session ID

### `PostHog.get_session_id`

> **get\_session\_id**(): `string`

Returns the current session_id.

#### Returns

`string`

The stored session ID for the current session. This may be an empty string if the client is not yet fully initialized.

#### Remarks

This should only be used for informative purposes.
Any actual internal use case for the session_id should be handled by the sessionManager.



### `PostHog.onSessionId`

> **onSessionId**(`callback?`): () => `void`

Register an event listener that runs whenever the session id or window id change.
If there is already a session id, the listener is called immediately in addition to being called on future changes.

Can be used, for example, to sync the PostHog session id with a backend session.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `callback?` | `SessionIdChangedCallback` | The callback function will be called once a session id is present or when it or the window id are updated. |

#### Returns

A function that can be called to unsubscribe the listener. E.g. Used by `useEffect` when the component unmounts.

() => `void`

#### Example

```js
posthog.onSessionId(function(sessionId, windowId) { // do something })
```



## Group

### `PostHog.getGroups`

> **getGroups**(): `Record`\<`string`, `any`\>

Returns the current groups.

#### Returns

`Record`\<`string`, `any`\>

The current groups



### `PostHog.group`

> **group**(`groupType`, `groupKey`, `groupPropertiesToSet?`): `void`

Associates the user with a group for group-based analytics.
Learn more about [groups](/docs/product-analytics/group-analytics)

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `groupType` | `string` | Group type (example: 'organization') |
| `groupKey` | `string` | Group key (example: 'org::5') |
| `groupPropertiesToSet?` | `Properties` | Optional properties to set for group |

#### Returns

`void`

#### Remarks

Groups allow you to analyze users collectively (e.g., by organization, team, or account).
This sets the group association for all subsequent events and reloads feature flags.

#### Examples

```js
// associate user with an organization
posthog.group('organization', 'org_12345', {
    name: 'Acme Corp',
    plan: 'enterprise'
})
```

```js
// associate with multiple group types
posthog.group('organization', 'org_12345')
posthog.group('team', 'team_67890')
```



### `PostHog.resetGroups`

> **resetGroups**(): `void`

Resets only the group properties of the user currently logged in.
Learn more about [groups](/docs/product-analytics/group-analytics)

#### Returns

`void`

#### Example

```js
posthog.resetGroups()
```



## Is feature enabled

### `PostHog.isFeatureEnabled`

> **isFeatureEnabled**(`key`, `options?`): `boolean`

Checks if a feature flag is enabled for the current user.

##### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | Key of the feature flag. |
| `options?` | `FeatureFlagOptions` & `object` & `object` | Optional lookup settings. If `{ send_event: false }`, we won't send a `$feature_flag_called` event to PostHog. If `{ fresh: true }`, we won't return cached values from localStorage - only values loaded from the server. If `{ defaultValue: false }`, we return that value instead of undefined when the flag has no value. |

##### Returns

`boolean`

Whether the feature flag is enabled; when the flag has no value, defaultValue if given, otherwise undefined.

##### Remarks

Returns `true` or `false` when the flag has an evaluation value. A `false` result means the
value evaluated off; it does not mean the SDK observed the flag's global active setting.
Returns `undefined` when no current evaluation is available, unless `defaultValue` is given.
Globally inactive flags are omitted from the remote `/flags` response and therefore have no
value. This is a convenience method that treats any truthy value as enabled.

##### Examples

```js
// simple feature flag check
if (posthog.isFeatureEnabled('new-checkout')) {
    showNewCheckout()
}
```

```js
// disable event tracking
if (posthog.isFeatureEnabled('feature', { send_event: false })) {
    // flag checked without sending $feature_flag_called event
}
```

#### Call Signature

> **isFeatureEnabled**(`key`, `options?`): `boolean` \| `undefined`

Checks if a feature flag is enabled for the current user.

##### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | Key of the feature flag. |
| `options?` | `IsFeatureEnabledOptions` | Optional lookup settings. If `{ send_event: false }`, we won't send a `$feature_flag_called` event to PostHog. If `{ fresh: true }`, we won't return cached values from localStorage - only values loaded from the server. If `{ defaultValue: false }`, we return that value instead of undefined when the flag has no value. |

##### Returns

`boolean` \| `undefined`

Whether the feature flag is enabled; when the flag has no value, defaultValue if given, otherwise undefined.

##### Remarks

Returns `true` or `false` when the flag has an evaluation value. A `false` result means the
value evaluated off; it does not mean the SDK observed the flag's global active setting.
Returns `undefined` when no current evaluation is available, unless `defaultValue` is given.
Globally inactive flags are omitted from the remote `/flags` response and therefore have no
value. This is a convenience method that treats any truthy value as enabled.

##### Examples

```js
// simple feature flag check
if (posthog.isFeatureEnabled('new-checkout')) {
    showNewCheckout()
}
```

```js
// disable event tracking
if (posthog.isFeatureEnabled('feature', { send_event: false })) {
    // flag checked without sending $feature_flag_called event
}
```



## Is opt out

### `PostHog.has_opted_in_capturing`

> **has\_opted\_in\_capturing**(): `boolean`

Checks if the user has opted into data capturing.

#### Returns

`boolean`

current opt-in status

#### Remarks

Returns the current consent status for event tracking and data persistence.

#### Example

```js
if (posthog.has_opted_in_capturing()) {
    // show analytics features
}
```



### `PostHog.has_opted_out_capturing`

> **has\_opted\_out\_capturing**(): `boolean`

Checks if the user has opted out of data capturing.

#### Returns

`boolean`

current opt-out status

#### Remarks

Returns the current consent status for event tracking and data persistence.

In cookieless `'always'` mode this returns `true`, because the SDK does not store data for the user. Events are
still captured in this mode. To check if the SDK captures events, use `is_capturing()`.

#### Example

```js
if (posthog.has_opted_out_capturing()) {
    // disable analytics features
}
```



### `PostHog.is_capturing`

> **is\_capturing**(): `boolean`

Checks whether the PostHog library is currently capturing events.

Usually this means that the user has not opted out of capturing, but the exact behaviour can be controlled by
some config options.

Additionally, if the cookieless_mode is set to `'on_reject'`, we will capture events in cookieless mode if the
user has opted out or been defaulted to opt-out.

#### Returns

`boolean`

whether the posthog library is capturing events

#### See

 - 
 - 
 -

## Is session replay active

### `PostHog.sessionRecordingStarted`

> **sessionRecordingStarted**(): `boolean`

returns a boolean indicating whether session recording
is currently running

#### Returns

`boolean`

Whether session recording is currently running.

#### Example

```js
// Stop session recording if it's running
if (posthog.sessionRecordingStarted()) {
  posthog.stopSessionRecording()
}
```



## On feature flags

### `PostHog.onFeatureFlags`

> **onFeatureFlags**(`callback`): () => `void`

Register an event listener that runs when feature flags become available or when they change.
If there are flags, the listener is called immediately in addition to being called on future changes.
Note that this is not called only when we fetch feature flags from the server, but also when they change in the browser,
including when another open tab of your site stores new flags.
Do not call `reloadFeatureFlags()` inside this callback: each reload in one tab triggers the callback in the other tabs,
which can send flag requests in a loop.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `callback` | `FeatureFlagsCallback` | The callback function will be called once the feature flags are ready or when they are updated. It'll return a list of feature flags enabled for the user, the variants, and also a context object indicating whether we succeeded to fetch the flags or not. |

#### Returns

A function that can be called to unsubscribe the listener. Used by `useEffect` when the component unmounts.

() => `void`

#### Example

```js
posthog.onFeatureFlags(function(featureFlags, featureFlagsVariants, { errorsLoading }) {
    // do something
})
```



## Opt in

### `PostHog.clear_opt_in_out_capturing`

> **clear\_opt\_in\_out\_capturing**(): `void`

Clear the user's opt in/out status of data capturing and cookies/localstorage for this PostHog instance

#### Returns

`void`



### `PostHog.opt_in_capturing`

> **opt\_in\_capturing**(`options?`): `void`

Opts the user into data capturing and persistence.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options?` | \{ `captureEventName?`: `false` \| `EventName` \| `null`; `captureProperties?`: `Properties`; \} | A dictionary of opt-in options. |
| `options.captureEventName?` | `false` \| `EventName` \| `null` | Event name to use for capturing the opt-in action. Set to `null` or `false` to skip capturing the opt-in event. Defaults to `$opt_in`. |
| `options.captureProperties?` | `Properties` | Set of properties to capture along with the opt-in action. |

#### Returns

`void`

#### Remarks

Enables event tracking and data persistence (cookies/localStorage) for this PostHog instance.
By default, captures an `$opt_in` event unless disabled. The event is only captured when the user was not
already opted in, so calling this on every page load (for example from a consent tool callback that re-applies
stored consent) sends it once per user rather than once per page.

#### Examples

```js
// simple opt-in
posthog.opt_in_capturing()
```

```js
// opt-in with custom event and properties
posthog.opt_in_capturing({
    captureEventName: 'Privacy Accepted',
    captureProperties: { source: 'banner' }
})
```

```js
// opt-in without capturing event
posthog.opt_in_capturing({
    captureEventName: false
})
```



### `PostHog.opt_out_capturing`

> **opt\_out\_capturing**(): `void`

Opts the user out of data capturing and persistence.

#### Returns

`void`

#### Remarks

Disables event tracking and data persistence (cookies/localStorage) for this PostHog instance.
If `opt_out_persistence_by_default` is true, SDK persistence will also be disabled.

#### Example

```js
// opt user out (e.g., on privacy settings page)
posthog.opt_out_capturing()
```



## Register

### `PostHog.get_property`

> **get\_property**(`property_name`): `any`

Returns the value of a super property. Returns undefined if the property doesn't exist.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `property_name` | `string` | The name of the super property you want to retrieve |

#### Returns

`any`

The stored property value, or undefined if it is not set.

#### Remarks

get_property() can only be called after the PostHog library has finished loading.
init() has a loaded function available to handle this automatically.

#### Example

```js
// grab value for '$user_id' after the posthog library has loaded
posthog.init('<YOUR PROJECT TOKEN>', {
    loaded: function(posthog) {
        user_id = posthog.get_property('$user_id');
    }
});
```



### `PostHog.getSessionProperty`

> **getSessionProperty**(`property_name`): `any`

Returns the value of the session super property named property_name. If no such
property is set, getSessionProperty() will return the undefined value.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `property_name` | `string` | The name of the session super property you want to retrieve |

#### Returns

`any`

The stored session property value, or undefined if it is not set.

#### Remarks

This is based on browser-level `sessionStorage`, NOT the PostHog session.
getSessionProperty() can only be called after the PostHog library has finished loading.
init() has a loaded function available to handle this automatically.

#### Example

```js
// grab value for 'user_id' after the posthog library has loaded
posthog.init('YOUR PROJECT TOKEN', {
    loaded: function(posthog) {
        user_id = posthog.getSessionProperty('user_id');
    }
});
```



### `PostHog.register`

> **register**(`properties`, `days?`): `void`

Registers super properties that are included with all events.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `properties` | `Properties` | properties to store about the user |
| `days?` | `number` | How many days since the user's last visit to store the super properties |

#### Returns

`void`

#### Remarks

Super properties are stored in persistence and automatically added to every event you capture.
These values will overwrite any existing super properties with the same keys.

#### Examples

```js
// register a single property
posthog.register({ plan: 'premium' })
```

```js
// register multiple properties
posthog.register({
    email: 'user@example.com',
    account_type: 'business',
    signup_date: '2023-01-15'
})
```

```js
// register with custom expiration
posthog.register({ campaign: 'summer_sale' }, 7) // expires in 7 days
```



### `PostHog.register_for_session`

> **register\_for\_session**(`properties`): `void`

Registers super properties for the current session only.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `properties` | `Properties` | An associative array of properties to store about the user |

#### Returns

`void`

#### Remarks

Session super properties are automatically added to all events during the current browser session.
Unlike regular super properties, these are cleared when the session ends and are stored in sessionStorage.

#### Examples

```js
// register session-specific properties
posthog.register_for_session({
    current_page_type: 'checkout',
    ab_test_variant: 'control'
})
```

```js
// register properties for user flow tracking
posthog.register_for_session({
    selected_plan: 'pro',
    completed_steps: 3,
    flow_id: 'signup_flow_v2'
})
```



### `PostHog.register_once`

> **register\_once**(`properties`, `default_value?`, `days?`): `void`

Registers super properties only if they haven't been set before.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `properties` | `Properties` | An associative array of properties to store about the user |
| `default_value?` | `any` | Value to override if already set in super properties (ex: 'False') Default: 'None' |
| `days?` | `number` | How many days since the users last visit to store the super properties |

#### Returns

`void`

#### Remarks

Unlike `register()`, this method will not overwrite existing super properties.
Use this for properties that should only be set once, like signup date or initial referrer.

#### Examples

```js
// register once-only properties
posthog.register_once({
    first_login_date: new Date().toISOString(),
    initial_referrer: document.referrer
})
```

```js
// override existing value if it matches default
posthog.register_once(
    { user_type: 'premium' },
    'unknown'  // overwrite if current value is 'unknown'
)
```



## Reload feature flags

### `PostHog.reloadFeatureFlags`

> **reloadFeatureFlags**(): `void`

Feature flag values are cached. If something has changed with your user and you'd like to refetch their flag values, call this method.

#### Returns

`void`

#### Example

```js
posthog.reloadFeatureFlags()
```



## Reset

### `PostHog.reset`

> **reset**(`options?`): `void`

Resets all user data and starts a fresh session.

⚠️ **Warning**: Only call this when a user logs out. Calling at the wrong time can cause split sessions.

This clears:
- Session ID and super properties
- User identification (sets new random distinct_id)
- Cached data and consent settings

⚠️ **Warning**: because consent is cleared, `reset()` returns the instance to the default
consent state. With `opt_out_capturing_by_default` that default is opted out,
so calling `reset()` *after* `opt_in_capturing()` silently stops capturing.
Always `reset()` first, then opt in.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options?` | `boolean` \| `ResetOptions` | Boolean to reset the device ID (legacy), or reset options including bootstrap values. |

#### Returns

`void`

#### Examples

```js
// reset on user logout
function logout() {
    posthog.reset()
    // redirect to login page
}
```

```js
// reset and generate new device ID
posthog.reset(true)  // also resets device_id
```

```js
// reset with a custom anonymous ID and bootstrapped feature flags
posthog.reset({
    bootstrap: {
        distinctID: myAnonymousID,
        isIdentifiedID: false,
        featureFlags: { 'my-flag': true },
    }
})
```

```js
// with opt_out_capturing_by_default, reset() before opting in, never after
posthog.reset()
posthog.opt_in_capturing()
```



## Reset group properties for flags

### `PostHog.resetGroupPropertiesForFlags`

> **resetGroupPropertiesForFlags**(`group_type?`): `void`

Resets the group properties for feature flags.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `group_type?` | `string` | Optional group type to reset. If omitted, all group properties are reset. |

#### Returns

`void`

#### Example

```js
posthog.resetGroupPropertiesForFlags()
```



## Reset person properties for flags

### `PostHog.resetPersonPropertiesForFlags`

> **resetPersonPropertiesForFlags**(`reloadFeatureFlags?`): `void`

Resets the person properties for feature flags.

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `reloadFeatureFlags?` | `boolean` | `true` | Whether to reload feature flags. |

#### Returns

`void`

#### Examples

```js
posthog.resetPersonPropertiesForFlags()
```

```js
// Reset properties without reloading
posthog.resetPersonPropertiesForFlags(false)
```



## Set group properties for flags

### `PostHog.setGroupPropertiesForFlags`

> **setGroupPropertiesForFlags**(`properties`, `reloadFeatureFlags?`): `void`

Set override group properties for feature flags.
This is used when dealing with new groups / where you don't want to wait for ingestion
to update properties.
Takes in an object, the key of which is the group type.

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `properties` | \{\[`type`: `string`\]: `Properties`; \} | `undefined` | The properties to override, the key of which is the group type. |
| `reloadFeatureFlags?` | `boolean` | `true` | Whether to reload feature flags. |

#### Returns

`void`

#### Examples

```js
// Set properties with reload
posthog.setGroupPropertiesForFlags({'organization': { name: 'CYZ', employees: '11' } })
```

```js
// Set properties without reload
posthog.setGroupPropertiesForFlags({'organization': { name: 'CYZ', employees: '11' } }, false)
```



## Set person properties

### `PostHog.setInternalOrTestUser`

> **setInternalOrTestUser**(): `void`

Marks the current user as a test user by setting the `$internal_or_test_user` person property to `true`.
This also enables person processing for the current user.

This is useful for using in a cohort your internal/test filters for your posthog org.

#### Returns

`void`

#### See

https://posthog.com/tutorials/filter-internal-users
Create a cohort with `$internal_or_test_user` IS SET, and set your internal test filters to be NOT IN that cohort.

#### Example

```js
// Manually mark as test user
posthog.setInternalOrTestUser()

// Or use internal_or_test_user_hostname config for automatic detection
posthog.init('token', { internal_or_test_user_hostname: 'localhost' })
```



### `PostHog.setPersonProperties`

> **setPersonProperties**(`userPropertiesToSet?`, `userPropertiesToSetOnce?`): `void`

Sets properties on the person profile associated with the current `distinct_id`.
Learn more about [identifying users](/docs/product-analytics/identify)

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `userPropertiesToSet?` | `Properties` | Optional: An associative array of properties to store about the user. Note: For feature flag evaluations, if the same key is present in the userPropertiesToSetOnce, it will be overwritten by the value in userPropertiesToSet. |
| `userPropertiesToSetOnce?` | `Properties` | Optional: An associative array of properties to store about the user. If property is previously set, this does not override that value. |

#### Returns

`void`

#### Remarks

Updates user properties that are stored with the person profile in PostHog.
If `person_profiles` is set to `identified_only` and no profile exists, this will create one.

#### Examples

```js
// set user properties
posthog.setPersonProperties({
    email: 'user@example.com',
    plan: 'premium'
})
```

```js
// set properties
posthog.setPersonProperties(
    { name: 'Max Hedgehog' },  // $set properties
    { initial_url: '/blog' }   // $set_once properties
)
```



### `PostHog.unsetPersonProperties`

> **unsetPersonProperties**(`propertyNames`): `void`

Removes properties from the person profile associated with the current `distinct_id`.
Learn more about [identifying users](/docs/product-analytics/identify)

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `propertyNames` | `string` \| `string`[] | The name (or names) of the person properties to remove. |

#### Returns

`void`

#### Remarks

Deletes the given person properties from the person profile in PostHog. This is the
counterpart to setPersonProperties — instead of hand-passing `$unset` inside a
`capture()` call, you can remove properties with a dedicated method.
If `person_profiles` is set to `never`, this call is ignored.

`$fbc` and `$fbp` read by the SDK are unset for this call only. `save_campaign_params: false` stops the reads.

#### Examples

```js
// remove a single property
posthog.unsetPersonProperties('plan')
```

```js
// remove multiple properties
posthog.unsetPersonProperties(['plan', 'email'])
```



## Set person properties for flags

### `PostHog.setPersonPropertiesForFlags`

> **setPersonPropertiesForFlags**(`properties`, `reloadFeatureFlags?`): `void`

Sometimes, you might want to evaluate feature flags using properties that haven't been ingested yet,
or were set incorrectly earlier. You can do so by setting properties the flag depends on with these calls:

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `properties` | `Properties` | `undefined` | The properties to override. |
| `reloadFeatureFlags?` | `boolean` | `true` | Whether to reload feature flags. |

#### Returns

`void`

#### Examples

```js
// Set properties
posthog.setPersonPropertiesForFlags({'property1': 'value', property2: 'value2'})
```

```js
// Set properties without reloading
posthog.setPersonPropertiesForFlags({'property1': 'value', property2: 'value2'}, false)
```



## Shutdown

### `PostHog.shutdown`

> **shutdown**(`_shutdownTimeoutMs?`): `Promise`\<`void`\>

Flushes any queued events and resolves once teardown is complete.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `_shutdownTimeoutMs?` | `number` | Retained for parity with the Node.js SDK; ignored in browsers. |

#### Returns

`Promise`\<`void`\>

A promise that resolves once best-effort cleanup and queue flushing complete.

#### Remarks

This exists primarily for parity with the server-side
[Node.js SDK](/docs/libraries/node), whose `shutdown()` you call once before a
process exits. In the browser there is no process to exit, so this method
performs synchronous best-effort extension cleanup, flushes the request
queues, and always resolves.

It is safe to call in isomorphic teardown code (for example a Nuxt/Next module
that calls `shutdown()` on both the server and the client) so the same
symmetric cleanup works in either environment without throwing.

#### Example

```js
// symmetric teardown that runs on both server and client
await posthog.shutdown()
```



## Start session recording

### `PostHog.startSessionRecording`

> **startSessionRecording**(`override?`): `void`

turns session recording on, and updates the config option `disable_session_recording` to false

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `override?` | `true` \| \{ `event_trigger?`: `true`; `linked_flag?`: `boolean`; `sampling?`: `boolean`; `url_trigger?`: `true`; \} | optional boolean to override the default sampling behavior - ensures the next session recording to start will not be skipped by sampling or linked_flag config. `true` is shorthand for { sampling: true, linked_flag: true } |

#### Returns

`void`

#### Examples

```js
// Start and ignore controls
posthog.startSessionRecording(true)
```

```js
// Start and override controls
posthog.startSessionRecording({
  // you don't have to send all of these
  sampling: true || false,
  linked_flag: true || false,
  url_trigger: true || false,
  event_trigger: true || false
})
```



## Stop session recording

### `PostHog.stopSessionRecording`

> **stopSessionRecording**(): `void`

turns session recording off, and updates the config option
disable_session_recording to true

#### Returns

`void`

#### Example

```js
// Stop session recording
posthog.stopSessionRecording()
```



## Unregister

### `PostHog.unregister`

> **unregister**(`property`): `void`

Removes a super property from persistent storage.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `property` | `string` | The name of the super property to remove |

#### Returns

`void`

#### Remarks

This will stop the property from being automatically included in future events.
The property will be permanently removed from the user's profile.

#### Example

```js
// remove a super property
posthog.unregister('plan_type')
```



### `PostHog.unregister_for_session`

> **unregister\_for\_session**(`property`): `void`

Removes a session super property from the current session.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `property` | `string` | The name of the session super property to remove |

#### Returns

`void`

#### Remarks

This will stop the property from being automatically included in future events for this session.
The property is removed from sessionStorage.

#### Example

```js
// remove a session property
posthog.unregister_for_session('current_flow')
```



## Consent gating

### `PostHog.get_explicit_consent_status`

> **get\_explicit\_consent\_status**(): `"pending"` \| `"granted"` \| `"denied"`

Returns the explicit consent status of the user.

#### Returns

`"pending"` \| `"granted"` \| `"denied"`

The current explicit consent status.

#### Remarks

This can be used to check if the user has explicitly opted in or out of data capturing, or neither. This does not
take the default config options into account, only whether the user has made an explicit choice, so this can be
used to determine whether to show an initial cookie banner or not.

#### Example

```js
const consentStatus = posthog.get_explicit_consent_status()
if (consentStatus === "granted") {
    // user has explicitly opted in
} else if (consentStatus === "denied") {
    // user has explicitly opted out
} else if (consentStatus === "pending"){
    // user has not made a choice, show consent banner
}
```



## Surveys

### `PostHog.cancelPendingSurvey`

> **cancelPendingSurvey**(`surveyId`): `void`

Cancels a pending survey that is waiting to be displayed (e.g., due to a popup delay).

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `surveyId` | `string` | The survey ID whose pending display should be cancelled. |

#### Returns

`void`

### `PostHog.canRenderSurvey`

> **canRenderSurvey**(`surveyId`): `SurveyRenderReason` \| `null`

Checks the feature flags associated with this Survey to see if the survey can be rendered.
This method is deprecated because it's synchronous and won't return the correct result if surveys are not loaded.
Use `canRenderSurveyAsync` instead.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `surveyId` | `string` | The ID of the survey to check. |

#### Returns

`SurveyRenderReason` \| `null`

A SurveyRenderReason object indicating if the survey can be rendered.

#### Deprecated



### `PostHog.canRenderSurveyAsync`

> **canRenderSurveyAsync**(`surveyId`, `forceReload?`): `Promise`\<`SurveyRenderReason`\>

Checks the feature flags associated with this Survey to see if the survey can be rendered.

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `surveyId` | `string` | `undefined` | The ID of the survey to check. |
| `forceReload?` | `boolean` | `false` | If true, the survey will be reloaded from the server, Default: false |

#### Returns

`Promise`\<`SurveyRenderReason`\>

A SurveyRenderReason object indicating if the survey can be rendered.

#### Example

```js
posthog.canRenderSurveyAsync(surveyId).then((result) => {
    if (result.visible) {
        // Survey can be rendered
        console.log('Survey can be rendered')
    } else {
        // Survey cannot be rendered
        console.log('Survey cannot be rendered:', result.disabledReason)
    }
})
```



### `PostHog.displaySurvey`

> **displaySurvey**(`surveyId`, `options?`): `void`

Display a survey programmatically as either a popover or inline element.

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `surveyId` | `string` | `undefined` | The survey ID to display. |
| `options?` | `DisplaySurveyOptions` | `DEFAULT_DISPLAY_SURVEY_OPTIONS` | Display configuration. Defaults to a popover that respects dashboard conditions and delays. |

#### Returns

`void`

#### Examples

```js
// Display as popover (respects all conditions defined in the dashboard)
posthog.displaySurvey('survey-id-123')
```

```js
// Display inline in a specific element
posthog.displaySurvey('survey-id-123', {
  displayType: DisplaySurveyType.Inline,
  ignoreConditions: false,
  ignoreDelay: false,
  selector: '#survey-container'
})
```

```js
// Force display ignoring conditions and delays
posthog.displaySurvey('survey-id-123', {
  displayType: DisplaySurveyType.Popover,
  ignoreConditions: true,
  ignoreDelay: true
})
```

### `PostHog.getActiveMatchingSurveys`

> **getActiveMatchingSurveys**(`callback`, `forceReload?`): `void`

Get surveys that should be enabled for the current user. See [fetching surveys documentation](/docs/surveys/implementing-custom-surveys#fetching-surveys-manually) for more details.

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `callback` | `SurveyCallback` | `undefined` | The callback function will be called when the surveys are loaded or updated. |
| `forceReload?` | `boolean` | `false` | Whether to force a reload of the surveys. |

#### Returns

`void`

#### Example

```js
posthog.getActiveMatchingSurveys((surveys) => {
     // do something
})
```



### `PostHog.getSurveys`

> **getSurveys**(`callback`, `forceReload?`): `void`

Get list of all surveys.

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `callback` | `SurveyCallback` | `undefined` | Function that receives the array of surveys. |
| `forceReload?` | `boolean` | `false` | Optional boolean to force an API call for updated surveys. |

#### Returns

`void`

#### Example

```js
function callback(surveys, context) {
  // do something
}

posthog.getSurveys(callback, false)
```



### `PostHog.onActiveMatchingSurveysChanged`

> **onActiveMatchingSurveysChanged**(`callback`): () => `void`

Register an event listener that runs when the set of active matching surveys changes.
The listener receives the initial matching set and updates after event/action triggers,
cancellation, consumption, session expiry, definitions refresh, captured pageviews,
feature-flag updates, marking a survey as seen, and reset. Unchanged results are suppressed.

URL conditions are re-evaluated on captured `$pageview` events, including automatic SPA
pageviews when `capture_pageview` is `'history_change'`. With automatic pageviews disabled,
capture `$pageview` after navigation. This does not observe arbitrary DOM mutations or time
passing; selector, device and wait-period conditions are checked on the supported updates.

The optional callback context distinguishes load errors from a successfully loaded empty
result. New subscribers receive the current snapshot without replaying earlier errors:
a settled unavailable state is `([], { isLoaded: false })`, while usable cached definitions
are evaluated normally. An initial load already in progress delivers when it resolves.
Recoverable load failures keep the subscription alive. Unsubscribing prevents any
further delivery, including callbacks from an outstanding initial request.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `callback` | `SurveyCallback` | The callback to call with active matching surveys. |

#### Returns

A function that can be called to unsubscribe the listener.

() => `void`

#### Example

```js
const unsubscribe = posthog.onActiveMatchingSurveysChanged((surveys) => {
    // respond to changes in currently matching surveys
})
```



### `PostHog.onSurveysLoaded`

> **onSurveysLoaded**(`callback`): () => `void`

Register an event listener that runs when surveys are loaded.

Callback parameters:
- surveys: Survey[]: An array containing all survey objects fetched from PostHog using the getSurveys method
- context: { isLoaded: boolean, error?: string }: An object indicating if the surveys were loaded successfully

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `callback` | `SurveyCallback` | The callback function will be called when surveys are loaded or updated. |

#### Returns

A function that can be called to unsubscribe the listener.

() => `void`

#### Example

```js
posthog.onSurveysLoaded((surveys, context) => { // do something })
```

### `PostHog.renderSurvey`

> **renderSurvey**(`surveyId`, `selector`): `void`

Although we recommend using popover surveys and display conditions,
if you want to show surveys programmatically without setting up all
the extra logic needed for API surveys, you can render surveys
programmatically with the renderSurvey method.

This takes a survey ID and an HTML selector to render an unstyled survey.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `surveyId` | `string` | The ID of the survey to render. |
| `selector` | `string` | The selector of the HTML element to render the survey on. |

#### Returns

`void`

#### Example

```js
posthog.renderSurvey(coolSurveyID, '#survey-container')
```

#### Deprecated

Use displaySurvey instead - it's more complete and also supports popover surveys.



## SDK utils

### `PostHog.featureFlags`

> **featureFlags**: `TreeShakeable`\<`PostHogFeatureFlags`\>

The feature flags instance. Provides access to feature flag override methods.



### `PostHog.version`

> **version**: `string` = `Config.LIB_VERSION`

The library version.



### `PostHog.flagsEndpointWasHit`

> **get** **flagsEndpointWasHit**(): `boolean`

Whether feature flags have been initialized for this instance.

##### Remarks

Despite the name, this is a proxy for processed feature flag values. It may be true for
bootstrapped flags before a network request completes.

##### Returns

`boolean`

True once the SDK has processed feature flag values.



### `PostHog.get_session_replay_url`

> **get\_session\_replay\_url**(`options?`): `string`

Returns the Replay url for the current session.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options?` | \{ `timestampLookBack?`: `number`; `withTimestamp?`: `boolean`; \} | Options for the URL. |
| `options.timestampLookBack?` | `number` | How many seconds to look back for the timestamp. |
| `options.withTimestamp?` | `boolean` | Whether to include the timestamp in the URL. |

#### Returns

`string`

The URL for the current session replay, or an empty string if sessions are unavailable.

#### Examples

```js
// basic usage
posthog.get_session_replay_url()
```

```js
// timestamp
posthog.get_session_replay_url({ withTimestamp: true })
```

```js
// timestamp and lookback
posthog.get_session_replay_url({
  withTimestamp: true,
  timestampLookBack: 30 // look back 30 seconds
})
```



### `PostHog.getEarlyAccessFeatures`

> **getEarlyAccessFeatures**(`callback`, `force_reload?`, `stages?`): `void`

Get the list of early access features. To check enrollment status, use `isFeatureEnabled`. [Learn more in the docs](/docs/feature-flags/early-access-feature-management#option-2-custom-implementation)

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `callback` | `EarlyAccessFeatureCallback` | `undefined` | The callback function will be called when the early access features are loaded. |
| `force_reload?` | `boolean` | `false` | Whether to force a reload of the early access features. |
| `stages?` | `EarlyAccessFeatureStage`[] | `undefined` | The stages of the early access features to load. |

#### Returns

`void`

#### Example

```js
const posthog = usePostHog()
const activeFlags = useActiveFeatureFlags()

const [activeBetas, setActiveBetas] = useState([])
const [inactiveBetas, setInactiveBetas] = useState([])
const [comingSoonFeatures, setComingSoonFeatures] = useState([])

useEffect(() => {
  posthog.getEarlyAccessFeatures((features) => {
    // Filter features by stage
    const betaFeatures = features.filter(feature => feature.stage === 'beta')
    const conceptFeatures = features.filter(feature => feature.stage === 'concept')

    setComingSoonFeatures(conceptFeatures)

    if (!activeFlags || activeFlags.length === 0) {
      setInactiveBetas(betaFeatures)
      return
    }

    const activeBetas = betaFeatures.filter(
            beta => activeFlags.includes(beta.flagKey)
        );
    const inactiveBetas = betaFeatures.filter(
            beta => !activeFlags.includes(beta.flagKey)
        );
    setActiveBetas(activeBetas)
    setInactiveBetas(inactiveBetas)
  }, true, ['concept', 'beta'])
}, [activeFlags])
```



### `PostHog.getPageViewId`

> **getPageViewId**(): `string` \| `undefined`

Returns the current page view ID.

#### Returns

`string` \| `undefined`

The current page view ID, or undefined if no page view has been captured.



### `PostHog.loadToolbar`

> **loadToolbar**(`params`): `boolean`

returns a boolean indicating whether the [toolbar](/docs/toolbar) loaded

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `params` | `ToolbarParams` | Toolbar parameters. |

#### Returns

`boolean`

Whether the toolbar loaded.



### `PostHog.on`

> **on**(`event`, `cb`): () => `void`

Exposes a set of events that PostHog will emit.
e.g. `eventCaptured` is emitted immediately before trying to send an event

Unlike  `onFeatureFlags` and `onSessionId` these are not called when the
listener is registered, the first callback will be the next event
_after_ registering a listener

Available events:
- `eventCaptured`: Emitted immediately before trying to send an event
- `featureFlagsReloading`: Emitted when feature flags are being reloaded (e.g. after `identify()`, `group()`, or `reloadFeatureFlags()`)

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `event` | `"eventCaptured"` \| `"featureFlagsReloading"` | The event to listen for. |
| `cb` | (...`args`) => `void` | The callback function to call when the event is emitted. |

#### Returns

A function that can be called to unsubscribe the listener.

() => `void`

#### Examples

```js
posthog.on('eventCaptured', (event) => {
  console.log(event)
})
```

```js
// Track when feature flags are reloading to show a loading state
posthog.on('featureFlagsReloading', () => {
  console.log('Feature flags are being reloaded...')
})
```



### `PostHog.updateEarlyAccessFeatureEnrollment`

> **updateEarlyAccessFeatureEnrollment**(`key`, `isEnrolled`, `stage?`): `void`

Opt the user in or out of an early access feature. [Learn more in the docs](/docs/feature-flags/early-access-feature-management#option-2-custom-implementation)

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The key of the feature flag to update. |
| `isEnrolled` | `boolean` | Whether the user is enrolled in the feature. |
| `stage?` | `string` | The stage of the feature flag to update. |

#### Returns

`void`

#### Example

```js
const toggleBeta = (betaKey) => {
  if (activeBetas.some(
    beta => beta.flagKey === betaKey
  )) {
    posthog.updateEarlyAccessFeatureEnrollment(
      betaKey,
      false
    )
    setActiveBetas(
      prevActiveBetas => prevActiveBetas.filter(
        item => item.flagKey !== betaKey
      )
    );
    return
  }

  posthog.updateEarlyAccessFeatureEnrollment(
    betaKey,
    true
  )
  setInactiveBetas(
    prevInactiveBetas => prevInactiveBetas.filter(
      item => item.flagKey !== betaKey
    )
  );
}

const registerInterest = (featureKey) => {
  posthog.updateEarlyAccessFeatureEnrollment(
    featureKey,
    true
  )
  // Update UI to show user has registered
}
```



### `PostHog.updateFlags`

> **updateFlags**(`flags`, `payloads?`, `options?`): `void`

Manually update feature flag values without making a network request.

This is useful when you have feature flag values from an external source
(e.g., server-side evaluation, edge middleware) and want to inject them
into the client SDK.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `flags` | `Record`\<`string`, `boolean` \| `string`\> | An object mapping flag keys to their values (boolean or string variant) |
| `payloads?` | `Record`\<`string`, `JsonType`\> | Optional object mapping flag keys to their JSON payloads |
| `options?` | \{ `merge?`: `boolean`; \} | Optional settings. Use `{ merge: true }` to merge with existing flags instead of replacing. |
| `options.merge?` | `boolean` | - |

#### Returns

`void`

#### Example

```js
// Replace all flags with server-evaluated values
posthog.updateFlags({
  'my-flag': true,
  'my-experiment': 'variant-a'
})

// Merge with existing flags (update only specified flags)
posthog.updateFlags(
  { 'my-flag': true },
  undefined,
  { merge: true }
)

// With payloads
posthog.updateFlags(
  { 'my-flag': true },
  { 'my-flag': { some: 'data' } }
)
```



## Types

### `ActionStepStringMatching`

> **ActionStepStringMatching** = `"contains"` \| `"exact"` \| `"regex"`

Sync with plugin-server/src/types.ts.

### `ActionStepType`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-event"></a> `event?` | `string` \| `null` | - |
| <a id="property-href"></a> `href?` | `string` \| `null` | - |
| <a id="property-href_matching"></a> `href_matching?` | `ActionStepStringMatching` \| `null` | **Default** `StringMatching.Exact` |
| <a id="property-properties"></a> `properties?` | `object`[] | Property filters for action step matching. |
| <a id="property-selector"></a> `selector?` | `string` \| `null` | - |
| <a id="property-selector_regex"></a> `selector_regex?` | `string` \| `null` | Pre-compiled regex pattern for matching selector against `$elements_chain`. |
| <a id="property-tag_name"></a> ~~`tag_name?`~~ | `string` | **Deprecated** Only `selector` should be used now. |
| <a id="property-text"></a> `text?` | `string` \| `null` | - |
| <a id="property-text_matching"></a> `text_matching?` | `ActionStepStringMatching` \| `null` | **Default** `StringMatching.Exact` |
| <a id="property-url"></a> `url?` | `string` \| `null` | - |
| <a id="property-url_matching"></a> `url_matching?` | `ActionStepStringMatching` \| `null` | **Default** `StringMatching.Contains` |

### `BasicSurveyQuestion`

- `SurveyQuestionBase`

#### Properties

| Property | Type | Inherited from |
| ------ | ------ | ------ |
| <a id="property-branching"></a> `branching?` | `NextQuestionBranching` \| `EndBranching` \| `ResponseBasedBranching` \| `SpecificQuestionBranching` | `SurveyQuestionBase.branching` |
| <a id="property-buttontext"></a> `buttonText?` | `string` | `SurveyQuestionBase.buttonText` |
| <a id="property-description"></a> `description?` | `string` \| `null` | `SurveyQuestionBase.description` |
| <a id="property-descriptioncontenttype"></a> `descriptionContentType?` | `SurveyQuestionDescriptionContentType` | `SurveyQuestionBase.descriptionContentType` |
| <a id="property-id"></a> `id?` | `string` | `SurveyQuestionBase.id` |
| <a id="property-optional"></a> `optional?` | `boolean` | `SurveyQuestionBase.optional` |
| <a id="property-question"></a> `question` | `string` | `SurveyQuestionBase.question` |
| <a id="property-translations"></a> `translations?` | `Record`\<`string`, `SurveyQuestionTranslation`\> | `SurveyQuestionBase.translations` |
| <a id="property-type"></a> `type` | `"open"` | - |
| <a id="property-validation"></a> `validation?` | `SurveyValidationRule`[] | `SurveyQuestionBase.validation` |

### `BootstrapConfig`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-distinctid"></a> `distinctID?` | `string` \| `null` | Distinct ID to use before the SDK has loaded persisted identity. |
| <a id="property-featureflagpayloads"></a> `featureFlagPayloads?` | `Record`\<`string`, `JsonType`\> \| `null` | Feature flag payloads to use together with bootstrapped `featureFlags`. |
| <a id="property-featureflags"></a> `featureFlags?` | `Record`\<`string`, `string` \| `boolean`\> \| `null` | Feature flag values to use immediately until the SDK fetches fresh values. |
| <a id="property-isidentifiedid"></a> `isIdentifiedID?` | `boolean` \| `null` | Whether `distinctID` already identifies a known person profile. |
| <a id="property-sessionid"></a> `sessionID?` | `string` \| `null` | Optionally provide a sessionID, this is so that you can provide an existing sessionID here to continue a user's session across a domain or device. It MUST be: - unique to this user - a valid UUID v7 - the timestamp part must be <= the timestamp of the first event in the session - the timestamp of the last event in the session must be < the timestamp part + 24 hours |

### `CaptureLogOptions`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attributes"></a> `attributes?` | `LogAttributes` | Per-log attributes (request-specific context like order_id, duration_ms) |
| <a id="property-body"></a> `body` | `string` | The log message body (required) |
| <a id="property-level"></a> `level?` | `LogSeverityLevel` | Log severity level (default: 'info') |
| <a id="property-span_id"></a> `span_id?` | `string` | Span ID for correlation — 16 hex chars |
| <a id="property-trace_flags"></a> `trace_flags?` | `number` | W3C trace flags (default: 0) |
| <a id="property-trace_id"></a> `trace_id?` | `string` | Trace ID for correlation — 32 hex chars |

### `CaptureOptions`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-_batchkey"></a> `_batchKey?` | `string` | **`Internal`** key of queue, e.g. 'sessionRecording' vs 'event' |
| <a id="property-_notruncate"></a> `_noTruncate?` | `boolean` | **`Internal`** If set, overrides and disables config.properties_string_max_length |
| <a id="property-_originatedfromcaptureexception"></a> `_originatedFromCaptureException?` | `boolean` | **`Internal`** Internal flag set by captureException() / sendExceptionEvent() to indicate this $exception event originated from the proper exception capture path. Used to warn users who call capture('$exception') directly. |
| <a id="property-_url"></a> `_url?` | `string` | **`Internal`** Used to override the desired endpoint for the captured event |
| <a id="property-set"></a> `$set?` | `Properties` | Used when `$identify` is called Will set person properties overriding previous values |
| <a id="property-set_once"></a> `$set_once?` | `Properties` | Used when `$identify` is called Will set person properties but only once, it will NOT override previous values |
| <a id="property-unset"></a> `$unset?` | `string`[] | Used to unset person properties |
| <a id="property-send_instantly"></a> `send_instantly?` | `boolean` | If set, sends the event immediately instead of adding it to the batched queue. The batched queue drains with `sendBeacon` when the page hides, and an immediate send does not use that queue. On an active page, the SDK keeps its normal transport so failed requests can be retried. By default this is `fetch`, which keeps small requests alive across a navigation, or XHR when `fetch` is unavailable. Once PostHog's own `pagehide` handler (or `unload` fallback) marks the page as unloading, the SDK prefers `sendBeacon`, unless an explicit transport, a required response, or `request_headers` prevent it. Captures from `beforeunload` or `pagehide` listeners that run before PostHog's handler still use their normal transport. This is best effort, not a guarantee: XHR and requests too large for `fetch` keepalive can be cancelled by navigation. To always use a beacon, set `{ transport: 'sendBeacon' }`, but note that accepted beacons cannot report server failures to the SDK for retries. |
| <a id="property-skip_client_rate_limiting"></a> `skip_client_rate_limiting?` | `boolean` | If set, skips the client side rate limiting |
| <a id="property-timestamp"></a> `timestamp?` | `Date` | If set, overrides the current timestamp. UTC is preferred; non-UTC input is converted to UTC. |
| <a id="property-transport"></a> `transport?` | `"XHR"` \| `"fetch"` \| `"sendBeacon"` | If set, overrides the desired transport method |
| <a id="property-uuid"></a> `uuid?` | `string` | If set, overrides the auto-generated event uuid. The value must be a valid UUID; invalid values are ignored and a new UUID is generated. Useful for cross-source idempotency (e.g. a server webhook and a browser success page both firing for the same business transaction): emit both events with the same deterministic uuid so storage can eventually deduplicate them. Capture itself does not deduplicate resent events, and PostHog does not guarantee strict immediate deduplication. |

### `CaptureResult`

| Property | Type |
| ------ | ------ |
| <a id="property-set-1"></a> `$set?` | `Properties` |
| <a id="property-set_once-1"></a> `$set_once?` | `Properties` |
| <a id="property-unset-1"></a> `$unset?` | `string`[] |
| <a id="property-event-1"></a> `event` | `EventName` |
| <a id="property-properties-1"></a> `properties` | `Properties` |
| <a id="property-timestamp-1"></a> `timestamp?` | `Date` |
| <a id="property-uuid-1"></a> `uuid` | `string` |

### `DisplaySurveyOptions`

> **DisplaySurveyOptions** = `DisplaySurveyPopoverOptions` \| `DisplaySurveyInlineOptions`

Options for `posthog.displaySurvey()`.

### `DisplaySurveyPopoverOptions`

Options for displaying a survey as a popover.

#### Extends

- `DisplaySurveyOptionsBase`

#### Properties

| Property | Type | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-displaytype"></a> `displayType` | `"popover"` | How the survey should be displayed. **Default** `DisplaySurveyType.Popover` | `DisplaySurveyOptionsBase.displayType` | - |
| <a id="property-ignoreconditions"></a> `ignoreConditions` | `boolean` | Whether to bypass the survey's targeting and display conditions. **Default** `false` | - | `DisplaySurveyOptionsBase.ignoreConditions` |
| <a id="property-ignoredelay"></a> `ignoreDelay` | `boolean` | Whether to bypass the survey's configured popup delay. **Default** `false` | - | `DisplaySurveyOptionsBase.ignoreDelay` |
| <a id="property-initialresponses"></a> `initialResponses?` | `Record`\<`number`, `SurveyResponseValue`\> | Pre-filled responses by question index (0-based). Only supported for popover surveys. | - | `DisplaySurveyOptionsBase.initialResponses` |
| <a id="property-position"></a> `position?` | `SurveyPosition` | Override the survey's configured position. | - | - |
| <a id="property-properties-2"></a> `properties?` | `Properties` | Additional properties to include in all survey events (shown, sent, dismissed). | - | `DisplaySurveyOptionsBase.properties` |
| <a id="property-selector-1"></a> `selector?` | `string` | CSS selector for the element to position the survey next to (when position is NextToTrigger). | - | - |
| <a id="property-skipshownevent"></a> `skipShownEvent?` | `boolean` | When true, `survey shown` events will not be emitted automatically. | - | - |

### `EarlyAccessFeature`

A feature that isn't publicly available yet.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-description-1"></a> `description` | `string` |
| <a id="property-documentationurl"></a> `documentationUrl` | `string` \| `null` |
| <a id="property-flagkey"></a> `flagKey` | `string` \| `null` |
| <a id="property-name-1"></a> `name` | `string` |
| <a id="property-payload"></a> `payload` | `JsonType` |
| <a id="property-stage"></a> `stage` | `"concept"` \| `"alpha"` \| `"beta"` |

### `EarlyAccessFeatureCallback`

> **EarlyAccessFeatureCallback** = (`earlyAccessFeatures`) => `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `earlyAccessFeatures` | `EarlyAccessFeature`[] |

#### Returns

`void`

### `EarlyAccessFeatureStage`

> **EarlyAccessFeatureStage** = `"concept"` \| `"alpha"` \| `"beta"` \| `"general-availability"`

### `EventName`

> **EventName** = `KnownUnsafeEditableEvent` \| `KnownEventName` \| `string` & `object`

### `ExceptionAutoCaptureConfig`

> **ExceptionAutoCaptureConfig** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="capture_console_errors"></a> `capture_console_errors?` | `boolean` | Determines whether PostHog should capture console errors. **Default** `false` |
| <a id="capture_unhandled_errors"></a> `capture_unhandled_errors?` | `boolean` | Determines whether PostHog should capture unhandled errors. **Default** `true` |
| <a id="capture_unhandled_rejections"></a> `capture_unhandled_rejections?` | `boolean` | Determines whether PostHog should capture unhandled promise rejections. **Default** `true` |

### `FeatureFlagOptions`

> **FeatureFlagOptions** = `object`

Options for feature flag lookup methods (getFeatureFlag, isFeatureEnabled, getFeatureFlagResult).

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="fresh"></a> `fresh?` | `boolean` | If true, only return values loaded from the server, not cached localStorage values. Returns undefined if flags haven't been loaded from the server yet. Defaults to false. |
| <a id="send_event"></a> `send_event?` | `boolean` | Whether to send a $feature_flag_called event. Defaults to true. |

### `FeatureFlagResult`

> **FeatureFlagResult** = `object`

Result of evaluating a feature flag, including both the flag value and its payload.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="enabled-2"></a> `enabled` | `readonly` | `boolean` | Whether the returned feature flag evaluation is enabled. `false` is a conclusive off result. |
| <a id="key-1"></a> `key` | `readonly` | `string` | The key of the feature flag |
| <a id="payload-1"></a> `payload` | `readonly` | `JsonType` \| `undefined` | The JSON payload associated with this flag, if any |
| <a id="variant-1"></a> `variant` | `readonly` | `string` \| `undefined` | The variant key if this is a multivariate flag, undefined for boolean flags |

### `FeatureFlagsCallback`

> **FeatureFlagsCallback** = (`flags`, `variants`, `context?`) => `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `flags` | `string`[] |
| `variants` | `Record`\<`string`, `string` \| `boolean`\> |
| `context?` | \{ `errorsLoading?`: `boolean`; \} |
| `context.errorsLoading?` | `boolean` |

#### Returns

`void`

### `IsFeatureEnabledOptions`

> **IsFeatureEnabledOptions** = `FeatureFlagOptions` & `object`

Options for isFeatureEnabled.

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `defaultValue?` | `boolean` | Value to return when the flag has no value, e.g. flags have not loaded yet or no flag with that key exists. |

### `JsonRecord`

> **JsonRecord** = `object`

#### Index Signature

\[`key`: `string`\]: `JsonType`

### `JsonType`

> **JsonType** = `string` \| `number` \| `boolean` \| `null` \| `undefined` \| `JsonRecord` \| `JsonType`[]

### `KnownEventName`

> **KnownEventName** = `"$heatmaps_data"` \| `"$opt_in"` \| `"$exception"` \| `"$$heatmap"` \| `"$web_vitals"` \| `"$dead_click"` \| `"$dead_swipe"` \| `"$autocapture"` \| `"$copy_autocapture"` \| `"$rageclick"`

These are known events PostHog events that can be processed by the `beforeCapture` function
That means PostHog functionality does not rely on receiving 100% of these for calculations
So, it is safe to sample them to reduce the volume of events sent to PostHog

### `LinkSurveyQuestion`

- `SurveyQuestionBase`

#### Properties

| Property | Type | Inherited from |
| ------ | ------ | ------ |
| <a id="property-branching-1"></a> `branching?` | `NextQuestionBranching` \| `EndBranching` \| `ResponseBasedBranching` \| `SpecificQuestionBranching` | `SurveyQuestionBase.branching` |
| <a id="property-buttontext-1"></a> `buttonText?` | `string` | `SurveyQuestionBase.buttonText` |
| <a id="property-description-2"></a> `description?` | `string` \| `null` | `SurveyQuestionBase.description` |
| <a id="property-descriptioncontenttype-1"></a> `descriptionContentType?` | `SurveyQuestionDescriptionContentType` | `SurveyQuestionBase.descriptionContentType` |
| <a id="property-id-1"></a> `id?` | `string` | `SurveyQuestionBase.id` |
| <a id="property-link"></a> `link?` | `string` \| `null` | - |
| <a id="property-optional-1"></a> `optional?` | `boolean` | `SurveyQuestionBase.optional` |
| <a id="property-question-1"></a> `question` | `string` | `SurveyQuestionBase.question` |
| <a id="property-translations-1"></a> `translations?` | `Record`\<`string`, `SurveyQuestionTranslation`\> | `SurveyQuestionBase.translations` |
| <a id="property-type-5"></a> `type` | `"link"` | - |
| <a id="property-validation-1"></a> `validation?` | `SurveyValidationRule`[] | `SurveyQuestionBase.validation` |

### `LogAttributes`

> **LogAttributes** = `Record`\<`string`, `LogAttributeValue`\>

### `LogAttributeValue`

> **LogAttributeValue** = `string` \| `number` \| `boolean` \| `null` \| `undefined` \| `unknown`[] \| `Record`\<`string`, `unknown`\>

### `Logger`

Per-level convenience logger. Each method captures a structured log record
at the corresponding severity, equivalent to
`posthog.captureLog({ body, level, attributes })`.

#### Example

```ts
posthog.logger.info('checkout completed', { order_id: 'ord_789' })
posthog.logger.error('payment failed', { code: 'E001' })
```

#### Methods

##### debug()

> **debug**(`body`, `attributes?`): `void`

Debug-level detail. Verbose, only useful while diagnosing.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `body` | `string` |
| `attributes?` | `LogAttributes` |

###### Returns

`void`

##### error()

> **error**(`body`, `attributes?`): `void`

Error. Operation failed; the app may continue.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `body` | `string` |
| `attributes?` | `LogAttributes` |

###### Returns

`void`

##### fatal()

> **fatal**(`body`, `attributes?`): `void`

Fatal. Operation failed; the app likely cannot continue.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `body` | `string` |
| `attributes?` | `LogAttributes` |

###### Returns

`void`

##### info()

> **info**(`body`, `attributes?`): `void`

Informational. Normal app events worth recording.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `body` | `string` |
| `attributes?` | `LogAttributes` |

###### Returns

`void`

##### trace()

> **trace**(`body`, `attributes?`): `void`

Lowest severity. Trace-level diagnostic detail.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `body` | `string` |
| `attributes?` | `LogAttributes` |

###### Returns

`void`

##### warn()

> **warn**(`body`, `attributes?`): `void`

Warning. Something unexpected but non-fatal.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `body` | `string` |
| `attributes?` | `LogAttributes` |

###### Returns

`void`

### `LogSeverityLevel`

> **LogSeverityLevel** = `"trace"` \| `"debug"` \| `"info"` \| `"warn"` \| `"error"` \| `"fatal"`

Log capture types

### `MultipleSurveyQuestion`

- `SurveyQuestionBase`

#### Properties

| Property | Type | Inherited from |
| ------ | ------ | ------ |
| <a id="property-branching-2"></a> `branching?` | `NextQuestionBranching` \| `EndBranching` \| `ResponseBasedBranching` \| `SpecificQuestionBranching` | `SurveyQuestionBase.branching` |
| <a id="property-buttontext-2"></a> `buttonText?` | `string` | `SurveyQuestionBase.buttonText` |
| <a id="property-choices"></a> `choices` | `string`[] | - |
| <a id="property-description-3"></a> `description?` | `string` \| `null` | `SurveyQuestionBase.description` |
| <a id="property-descriptioncontenttype-2"></a> `descriptionContentType?` | `SurveyQuestionDescriptionContentType` | `SurveyQuestionBase.descriptionContentType` |
| <a id="property-hasopenchoice"></a> `hasOpenChoice?` | `boolean` | - |
| <a id="property-id-3"></a> `id?` | `string` | `SurveyQuestionBase.id` |
| <a id="property-optional-2"></a> `optional?` | `boolean` | `SurveyQuestionBase.optional` |
| <a id="property-question-2"></a> `question` | `string` | `SurveyQuestionBase.question` |
| <a id="property-shuffleoptions"></a> `shuffleOptions?` | `boolean` | - |
| <a id="property-skipsubmitbutton"></a> `skipSubmitButton?` | `boolean` | - |
| <a id="property-translations-2"></a> `translations?` | `Record`\<`string`, `SurveyQuestionTranslation`\> | `SurveyQuestionBase.translations` |
| <a id="property-type-7"></a> `type` | `"multiple_choice"` \| `"single_choice"` | - |
| <a id="property-validation-2"></a> `validation?` | `SurveyValidationRule`[] | `SurveyQuestionBase.validation` |

### `PostHogConfig`

> **PostHogConfig** = `Omit`\<`BasePostHogConfig`, `"loaded"`\> & `object`

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `__extensionClasses?` | `object` | **`Internal`** Internal: Extension class overrides for tree-shaking support. When provided, these classes are used instead of the default imports. This enables entrypoints to control which extensions are bundled. |
| `__extensionClasses.autocapture?` | `ExtensionConstructor`\<`Autocapture`\> | - |
| `__extensionClasses.conversations?` | `ExtensionConstructor`\<`PostHogConversations`\> | - |
| `__extensionClasses.deadClicksAutocapture?` | `ExtensionConstructor`\<`DeadClicksAutocapture`\> | - |
| `__extensionClasses.exceptionObserver?` | `ExtensionConstructor`\<`ExceptionObserver`\> | - |
| `__extensionClasses.exceptions?` | `ExtensionConstructor`\<`PostHogExceptions`\> | - |
| `__extensionClasses.experiments?` | `ExtensionConstructor`\<`WebExperiments`\> | - |
| `__extensionClasses.featureFlags?` | `ExtensionConstructor`\<`PostHogFeatureFlags`\> | - |
| `__extensionClasses.heatmaps?` | `ExtensionConstructor`\<`Heatmaps`\> | - |
| `__extensionClasses.historyAutocapture?` | `ExtensionConstructor`\<`HistoryAutocapture`\> | - |
| `__extensionClasses.logs?` | `ExtensionConstructor`\<`PostHogLogs`\> | - |
| `__extensionClasses.metrics?` | `ExtensionConstructor`\<`PostHogMetrics`\> | - |
| `__extensionClasses.productTours?` | `ExtensionConstructor`\<`PostHogProductTours`\> | - |
| `__extensionClasses.sessionRecording?` | `ExtensionConstructor`\<`SessionRecording`\> | - |
| `__extensionClasses.siteApps?` | `ExtensionConstructor`\<`SiteApps`\> | - |
| `__extensionClasses.surveys?` | `ExtensionConstructor`\<`BrowserSurveys`\> | - |
| `__extensionClasses.toolbar?` | `ExtensionConstructor`\<`Toolbar`\> | - |
| `__extensionClasses.tracingHeaders?` | `ExtensionConstructor`\<`TracingHeaders`\> | - |
| `__extensionClasses.webMCP?` | `ExtensionConstructor`\<`WebMCP`\> | - |
| `__extensionClasses.webVitalsAutocapture?` | `ExtensionConstructor`\<`WebVitalsAutocapture`\> | - |
| `disableDeviceModel?` | `boolean` | Disables capturing the `$device_model` super-property. When capturing is enabled (the default), PostHog resolves the hardware model once during init via `navigator.userAgentData.getHighEntropyValues(['model'])` and registers it as the raw OEM code (e.g. `Pixel 7`). This is Chromium-only and only meaningful on Android — it resolves to `undefined` on Safari/Firefox and to an empty string on desktop, in which cases nothing is registered. This opt-out is offered because `getHighEntropyValues` is still experimental and Chromium-only (not yet a cross-browser standard); set it to `true` to skip the call entirely. **Default** `false` |
| `loaded()` | (`posthog`) => `void` | - |

### `PostHogInterface`

> **PostHogInterface** = `Omit`\<`BasePostHogInterface`, `"config"` \| `"init"` \| `"set_config"`\> & `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `config` | `PostHogConfig` |
| `set_config()` | (`config`) => `void` |

### `Properties`

> **Properties** = `Record`\<`string`, `Property`\>

### `Property`

> **Property** = `any`

Common types shared across PostHog SDKs

### `PropertyFilters`

> **PropertyFilters** = `Record`\<`string`, \{ `operator`: `PropertyOperator`; `values`: `string`[]; \}\>

### `PropertyMatchType`

> **PropertyMatchType** = `SurveyMatchType`

### `PropertyOperator`

> **PropertyOperator** = `PropertyMatchType` \| `"gt"` \| `"lt"`

### `RatingSurveyQuestion`

- `SurveyQuestionBase`

#### Properties

| Property | Type | Inherited from |
| ------ | ------ | ------ |
| <a id="property-branching-3"></a> `branching?` | `NextQuestionBranching` \| `EndBranching` \| `ResponseBasedBranching` \| `SpecificQuestionBranching` | `SurveyQuestionBase.branching` |
| <a id="property-buttontext-3"></a> `buttonText?` | `string` | `SurveyQuestionBase.buttonText` |
| <a id="property-description-5"></a> `description?` | `string` \| `null` | `SurveyQuestionBase.description` |
| <a id="property-descriptioncontenttype-3"></a> `descriptionContentType?` | `SurveyQuestionDescriptionContentType` | `SurveyQuestionBase.descriptionContentType` |
| <a id="property-display-1"></a> `display` | `"number"` \| `"emoji"` | - |
| <a id="property-id-6"></a> `id?` | `string` | `SurveyQuestionBase.id` |
| <a id="property-lowerboundlabel-1"></a> `lowerBoundLabel` | `string` | - |
| <a id="property-optional-3"></a> `optional?` | `boolean` | `SurveyQuestionBase.optional` |
| <a id="property-question-3"></a> `question` | `string` | `SurveyQuestionBase.question` |
| <a id="property-scale-1"></a> `scale` | `2` \| `3` \| `5` \| `7` \| `10` | - |
| <a id="property-skipsubmitbutton-1"></a> `skipSubmitButton?` | `boolean` | - |
| <a id="property-translations-4"></a> `translations?` | `Record`\<`string`, `SurveyQuestionTranslation`\> | `SurveyQuestionBase.translations` |
| <a id="property-type-10"></a> `type` | `"rating"` | - |
| <a id="property-upperboundlabel-1"></a> `upperBoundLabel` | `string` | - |
| <a id="property-validation-3"></a> `validation?` | `SurveyValidationRule`[] | `SurveyQuestionBase.validation` |

### `ResetOptions`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bootstrap"></a> `bootstrap?` | `BootstrapConfig` | Identity, feature flag, and session values to apply after resetting. |
| <a id="property-resetdeviceid"></a> `resetDeviceID?` | `boolean` | Whether to generate a new device ID as well as a new distinct ID. **Default** `false` |

### `SessionIdChangedCallback`

> **SessionIdChangedCallback** = (`sessionId`, `windowId`, `changeReason?`) => `void`

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `sessionId` | `string` | - |
| `windowId` | `string` \| `null` \| `undefined` | - |
| `changeReason?` | \{ `activityTimeout`: `boolean`; `crossTabAdoption?`: `boolean`; `noSessionId`: `boolean`; `sessionPastMaximumLength`: `boolean`; \} | - |
| `changeReason.activityTimeout` | `boolean` | - |
| `changeReason.crossTabAdoption?` | `boolean` | This tab picked up a session rotation another tab had already written to storage, instead of minting its own. |
| `changeReason.noSessionId` | `boolean` | - |
| `changeReason.sessionPastMaximumLength` | `boolean` | - |

#### Returns

`void`

### `Survey`

A survey definition returned as part of browser remote config.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-appearance-1"></a> `appearance` | `SurveyAppearance` \| `null` |
| <a id="property-conditions-2"></a> `conditions` | \{ `actions`: \{ `values`: `SurveyActionType`[]; \} \| `null`; `cancelEvents`: \{ `values`: `SurveyEventWithFilters`[]; \} \| `null`; `deviceTypes?`: `string`[]; `deviceTypesMatchType?`: `SurveyMatchType`; `events`: \{ `repeatedActivation?`: `boolean`; `values`: `SurveyEventWithFilters`[]; \} \| `null`; `linkedFlagVariant?`: `string`; `seenSurveyWaitPeriodInDays?`: `number`; `selector?`: `string`; `url?`: `string`; `urlMatchType?`: `SurveyMatchType`; \} \| `null` |
| <a id="property-current_iteration-1"></a> `current_iteration` | `number` \| `null` |
| <a id="property-current_iteration_start_date"></a> `current_iteration_start_date` | `string` \| `null` |
| <a id="property-description-6"></a> `description?` | `string` |
| <a id="property-enable_partial_responses"></a> `enable_partial_responses?` | `boolean` \| `null` |
| <a id="property-end_date-1"></a> `end_date` | `string` \| `null` |
| <a id="property-feature_flag_keys"></a> `feature_flag_keys` | `object`[] \| `null` |
| <a id="property-id-8"></a> `id` | `string` |
| <a id="property-internal_targeting_flag_key-1"></a> `internal_targeting_flag_key` | `string` \| `null` |
| <a id="property-linked_flag_key-1"></a> `linked_flag_key` | `string` \| `null` |
| <a id="property-name-7"></a> `name` | `string` |
| <a id="property-questions"></a> `questions` | `SurveyQuestion`[] |
| <a id="property-schedule"></a> `schedule?` | `SurveySchedule` \| `null` |
| <a id="property-start_date-1"></a> `start_date` | `string` \| `null` |
| <a id="property-targeting_flag_key"></a> `targeting_flag_key` | `string` \| `null` |
| <a id="property-translations-5"></a> `translations?` | `Record`\<`string`, `SurveyTranslation`\> |
| <a id="property-type-12"></a> `type` | `SurveyType` |

### `SurveyActionType`

| Property | Type |
| ------ | ------ |
| <a id="property-id-9"></a> `id` | `number` |
| <a id="property-name-8"></a> `name` | `string` \| `null` |
| <a id="property-steps-1"></a> `steps?` | `ActionStepType`[] |

### `SurveyAppearance`

Browser survey appearance, including browser-only placement and rendering options.

#### Extends

- `Omit`\<`CoreSurveyAppearance`, `"position"` \| `"widgetType"`\>

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-allowgoback"></a> `allowGoBack?` | `boolean` | - | `Omit.allowGoBack` |
| <a id="property-autodisappear"></a> `autoDisappear?` | `boolean` | - | `Omit.autoDisappear` |
| <a id="property-backbuttontext-1"></a> `backButtonText?` | `string` | - | `Omit.backButtonText` |
| <a id="property-backgroundcolor-1"></a> `backgroundColor?` | `string` | - | `Omit.backgroundColor` |
| <a id="property-bordercolor-1"></a> `borderColor?` | `string` | - | `Omit.borderColor` |
| <a id="property-boxpadding"></a> `boxPadding?` | `string` | - | - |
| <a id="property-descriptiontextcolor"></a> ~~`descriptionTextColor?`~~ | `string` | **Deprecated** Not currently used. | - |
| <a id="property-disableautofocus"></a> `disableAutofocus?` | `boolean` | - | - |
| <a id="property-disabledbuttonopacity"></a> `disabledButtonOpacity?` | `string` | - | - |
| <a id="property-displayintroscreen"></a> `displayIntroScreen?` | `boolean` | - | `Omit.displayIntroScreen` |
| <a id="property-displaythankyoumessage"></a> `displayThankYouMessage?` | `boolean` | - | `Omit.displayThankYouMessage` |
| <a id="property-fontfamily-2"></a> `fontFamily?` | `string` | - | - |
| <a id="property-hidecancelbutton"></a> `hideCancelButton?` | `boolean` | - | - |
| <a id="property-inputbackground"></a> `inputBackground?` | `string` | - | `Omit.inputBackground` |
| <a id="property-inputbackgroundcolor"></a> ~~`inputBackgroundColor?`~~ | `string` | **Deprecated** Use `inputBackground` instead. | - |
| <a id="property-inputtextcolor"></a> `inputTextColor?` | `string` | - | `Omit.inputTextColor` |
| <a id="property-introscreenbuttontext"></a> `introScreenButtonText?` | `string` | - | `Omit.introScreenButtonText` |
| <a id="property-introscreendescription"></a> `introScreenDescription?` | `string` | - | `Omit.introScreenDescription` |
| <a id="property-introscreendescriptioncontenttype"></a> `introScreenDescriptionContentType?` | `SurveyQuestionDescriptionContentType` | - | `Omit.introScreenDescriptionContentType` |
| <a id="property-introscreenheader"></a> `introScreenHeader?` | `string` | - | `Omit.introScreenHeader` |
| <a id="property-maxwidth-1"></a> `maxWidth?` | `string` | - | - |
| <a id="property-placeholder"></a> `placeholder?` | `string` | - | `Omit.placeholder` |
| <a id="property-position-1"></a> `position?` | `SurveyPosition` | - | - |
| <a id="property-ratingbuttonactivecolor"></a> `ratingButtonActiveColor?` | `string` | - | `Omit.ratingButtonActiveColor` |
| <a id="property-ratingbuttoncolor"></a> `ratingButtonColor?` | `string` | - | `Omit.ratingButtonColor` |
| <a id="property-ratingbuttonhovercolor"></a> `ratingButtonHoverColor?` | `string` | - | - |
| <a id="property-shufflequestions"></a> `shuffleQuestions?` | `boolean` | - | `Omit.shuffleQuestions` |
| <a id="property-submitbuttoncolor"></a> `submitButtonColor?` | `string` | - | `Omit.submitButtonColor` |
| <a id="property-submitbuttontext-1"></a> `submitButtonText?` | `string` | - | `Omit.submitButtonText` |
| <a id="property-submitbuttontextcolor"></a> `submitButtonTextColor?` | `string` | - | `Omit.submitButtonTextColor` |
| <a id="property-surveypopupdelayseconds"></a> `surveyPopupDelaySeconds?` | `number` | - | `Omit.surveyPopupDelaySeconds` |
| <a id="property-tabposition"></a> `tabPosition?` | `SurveyTabPosition` | - | - |
| <a id="property-textcolor-1"></a> `textColor?` | `string` | - | `Omit.textColor` |
| <a id="property-thankyoumessageclosebuttontext"></a> `thankYouMessageCloseButtonText?` | `string` | - | `Omit.thankYouMessageCloseButtonText` |
| <a id="property-thankyoumessagedescription"></a> `thankYouMessageDescription?` | `string` | - | `Omit.thankYouMessageDescription` |
| <a id="property-thankyoumessagedescriptioncontenttype"></a> `thankYouMessageDescriptionContentType?` | `SurveyQuestionDescriptionContentType` | - | `Omit.thankYouMessageDescriptionContentType` |
| <a id="property-thankyoumessageheader"></a> `thankYouMessageHeader?` | `string` | - | `Omit.thankYouMessageHeader` |
| <a id="property-whitelabel-1"></a> `whiteLabel?` | `boolean` | - | - |
| <a id="property-widgetcolor"></a> `widgetColor?` | `string` | - | `Omit.widgetColor` |
| <a id="property-widgetlabel"></a> `widgetLabel?` | `string` | - | `Omit.widgetLabel` |
| <a id="property-widgetselector"></a> `widgetSelector?` | `string` | - | `Omit.widgetSelector` |
| <a id="property-widgettype"></a> `widgetType?` | `SurveyWidgetType` | - | - |
| <a id="property-zindex-1"></a> `zIndex?` | `string` | - | - |

### `SurveyCallback`

> **SurveyCallback** = (`surveys`, `context?`) => `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `surveys` | `Survey`[] |
| `context?` | \{ `error?`: `string`; `isLoaded`: `boolean`; \} |
| `context.error?` | `string` |
| `context.isLoaded` | `boolean` |

#### Returns

`void`

### `SurveyEventWithFilters`

| Property | Type |
| ------ | ------ |
| <a id="property-name-9"></a> `name` | `string` |
| <a id="property-propertyfilters"></a> `propertyFilters?` | `PropertyFilters` |

### `SurveyPosition`

> **SurveyPosition** = *typeof* `SurveyPosition`\keyof *typeof* [`SurveyPosition`\]

### `SurveyQuestion`

> **SurveyQuestion** = `BasicSurveyQuestion` \| `LinkSurveyQuestion` \| `RatingSurveyQuestion` \| `MultipleSurveyQuestion`

### `SurveyQuestionDescriptionContentType`

> **SurveyQuestionDescriptionContentType** = `"html"` \| `"text"`

### `SurveyRenderReason`

Represents the result of checking if a survey can be rendered.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-disabledreason"></a> `disabledReason?` | `string` | The reason why the survey cannot be rendered, if applicable |
| <a id="property-visible"></a> `visible` | `boolean` | Whether the survey is visible/can be rendered |

### `SurveySchedule`

> **SurveySchedule** = *typeof* `SurveySchedule`\keyof *typeof* [`SurveySchedule`\]

### `SurveyTabPosition`

> **SurveyTabPosition** = *typeof* `SurveyTabPosition`\keyof *typeof* [`SurveyTabPosition`\]

### `SurveyType`

> **SurveyType** = *typeof* `SurveyType`\keyof *typeof* [`SurveyType`\]

### `SurveyWidgetType`

> **SurveyWidgetType** = *typeof* `SurveyWidgetType`\keyof *typeof* [`SurveyWidgetType`\]

### `ToolbarParams`

Parameters for loading the PostHog toolbar

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actionid"></a> `actionId?` | `number` | Action ID to edit |
| <a id="property-dataattributes"></a> `dataAttributes?` | `string`[] | Data attributes to capture |
| <a id="property-distinctid-2"></a> `distinctId?` | `string` | Distinct ID of the user |
| <a id="property-featureflags-2"></a> `featureFlags?` | `Record`\<`string`, `string` \| `boolean`\> | Feature flags |
| <a id="property-instrument"></a> `instrument?` | `boolean` | Whether to instrument |
| <a id="property-source"></a> `source?` | `ToolbarSource` | Source of the toolbar params |
| <a id="property-temporarytoken"></a> `temporaryToken?` | `string` | Private temporary user token |
| <a id="property-token-1"></a> `token?` | `string` | Public posthog-js token |
| <a id="property-toolbarversion-2"></a> `toolbarVersion?` | `"toolbar"` | Toolbar version |
| <a id="property-useremail"></a> `userEmail?` | `string` | Email of the user |
| <a id="property-userintent"></a> `userIntent?` | `ToolbarUserIntent` | User intent for the toolbar |

### `ToolbarSource`

> **ToolbarSource** = `"url"` \| `"localstorage"`

### `ToolbarUserIntent`

> **ToolbarUserIntent** = `"add-action"` \| `"edit-action"`

Toolbar types
