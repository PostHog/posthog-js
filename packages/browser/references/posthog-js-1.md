---
title: "PostHog JavaScript Web SDK 1.x"
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

### `posthog`

> `const` **posthog**: `PostHog`

The default PostHog JavaScript Web SDK singleton instance.

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

### `DisplaySurveyType`

> `const` **DisplaySurveyType**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-inline"></a> `Inline` | `"inline"` |
| <a id="property-popover"></a> `Popover` | `"popover"` |

### `SurveyEventName`

> `const` **SurveyEventName**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-abandoned"></a> `ABANDONED` | `"survey abandoned"` |
| <a id="property-dismissed-1"></a> `DISMISSED` | `"survey dismissed"` |
| <a id="property-sent"></a> `SENT` | `"survey sent"` |
| <a id="property-shown-1"></a> `SHOWN` | `"survey shown"` |

### `SurveyEventProperties`

> `const` **SurveyEventProperties**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-product_tour_id"></a> `PRODUCT_TOUR_ID` | `"$product_tour_id"` |
| <a id="property-survey_completed"></a> `SURVEY_COMPLETED` | `"$survey_completed"` |
| <a id="property-survey_id"></a> `SURVEY_ID` | `"$survey_id"` |
| <a id="property-survey_iteration"></a> `SURVEY_ITERATION` | `"$survey_iteration"` |
| <a id="property-survey_iteration_start_date"></a> `SURVEY_ITERATION_START_DATE` | `"$survey_iteration_start_date"` |
| <a id="property-survey_language"></a> `SURVEY_LANGUAGE` | `"$survey_language"` |
| <a id="property-survey_last_seen_date"></a> `SURVEY_LAST_SEEN_DATE` | `"$survey_last_seen_date"` |
| <a id="property-survey_name"></a> `SURVEY_NAME` | `"$survey_name"` |
| <a id="property-survey_partially_completed"></a> `SURVEY_PARTIALLY_COMPLETED` | `"$survey_partially_completed"` |
| <a id="property-survey_questions"></a> `SURVEY_QUESTIONS` | `"$survey_questions"` |
| <a id="property-survey_response"></a> `SURVEY_RESPONSE` | `"$survey_response"` |
| <a id="property-survey_submission_id"></a> `SURVEY_SUBMISSION_ID` | `"$survey_submission_id"` |

### `SurveyEventType`

> `const` **SurveyEventType**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-activation"></a> `Activation` | `"events"` |
| <a id="property-cancellation"></a> `Cancellation` | `"cancelEvents"` |

### `SurveyPosition`

> `const` **SurveyPosition**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-center"></a> `Center` | `"center"` |
| <a id="property-left"></a> `Left` | `"left"` |
| <a id="property-middlecenter"></a> `MiddleCenter` | `"middle_center"` |
| <a id="property-middleleft"></a> `MiddleLeft` | `"middle_left"` |
| <a id="property-middleright"></a> `MiddleRight` | `"middle_right"` |
| <a id="property-nexttotrigger"></a> `NextToTrigger` | `"next_to_trigger"` |
| <a id="property-right"></a> `Right` | `"right"` |
| <a id="property-topcenter"></a> `TopCenter` | `"top_center"` |
| <a id="property-topleft"></a> `TopLeft` | `"top_left"` |
| <a id="property-topright"></a> `TopRight` | `"top_right"` |

### `SurveyQuestionBranchingType`

> `const` **SurveyQuestionBranchingType**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-end"></a> `End` | `"end"` |
| <a id="property-nextquestion"></a> `NextQuestion` | `"next_question"` |
| <a id="property-responsebased"></a> `ResponseBased` | `"response_based"` |
| <a id="property-specificquestion"></a> `SpecificQuestion` | `"specific_question"` |

### `SurveyQuestionType`

> `const` **SurveyQuestionType**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-link-2"></a> `Link` | `"link"` |
| <a id="property-multiplechoice"></a> `MultipleChoice` | `"multiple_choice"` |
| <a id="property-open"></a> `Open` | `"open"` |
| <a id="property-rating"></a> `Rating` | `"rating"` |
| <a id="property-singlechoice"></a> `SingleChoice` | `"single_choice"` |

### `SurveySchedule`

> `const` **SurveySchedule**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-always"></a> `Always` | `"always"` |
| <a id="property-once"></a> `Once` | `"once"` |
| <a id="property-recurring"></a> `Recurring` | `"recurring"` |

### `SurveyTabPosition`

> `const` **SurveyTabPosition**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-bottom"></a> `Bottom` | `"bottom"` |
| <a id="property-left-1"></a> `Left` | `"left"` |
| <a id="property-right-1"></a> `Right` | `"right"` |
| <a id="property-top"></a> `Top` | `"top"` |

### `SurveyType`

> `const` **SurveyType**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-api"></a> `API` | `"api"` |
| <a id="property-externalsurvey"></a> `ExternalSurvey` | `"external_survey"` |
| <a id="property-popover-1"></a> `Popover` | `"popover"` |
| <a id="property-widget"></a> `Widget` | `"widget"` |

### `SurveyWidgetType`

> `const` **SurveyWidgetType**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-button"></a> `Button` | `"button"` |
| <a id="property-selector-5"></a> `Selector` | `"selector"` |
| <a id="property-tab"></a> `Tab` | `"tab"` |

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

### `Compression`

> `const` **Compression**: `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| <a id="property-base64"></a> `Base64` | `"base64"` |
| <a id="property-gzipjs"></a> `GZipJS` | `"gzip-js"` |

### `DEFAULT_PRODUCT_TOUR_APPEARANCE`

> `const` **DEFAULT\_PRODUCT\_TOUR\_APPEARANCE**: `Required`\<`ProductTourAppearance`\>

### `ProductTourEventName`

> `const` **ProductTourEventName**: `object`

#### Type Declaration

| Name | Type | Default value |
| ------ | ------ | ------ |
| <a id="property-banner_action_clicked"></a> `BANNER_ACTION_CLICKED` | `"product tour banner action clicked"` | `'product tour banner action clicked'` |
| <a id="property-banner_container_selector_failed"></a> `BANNER_CONTAINER_SELECTOR_FAILED` | `"product tour banner container selector failed"` | `'product tour banner container selector failed'` |
| <a id="property-button_clicked"></a> `BUTTON_CLICKED` | `"product tour button clicked"` | `'product tour button clicked'` |
| <a id="property-completed"></a> `COMPLETED` | `"product tour completed"` | `'product tour completed'` |
| <a id="property-dismissed"></a> `DISMISSED` | `"product tour dismissed"` | `'product tour dismissed'` |
| <a id="property-shown"></a> `SHOWN` | `"product tour shown"` | `'product tour shown'` |
| <a id="property-step_completed"></a> `STEP_COMPLETED` | `"product tour step completed"` | `'product tour step completed'` |
| <a id="property-step_selector_failed"></a> `STEP_SELECTOR_FAILED` | `"product tour step selector failed"` | `'product tour step selector failed'` |
| <a id="property-step_shown"></a> `STEP_SHOWN` | `"product tour step shown"` | `'product tour step shown'` |

### `ProductTourEventProperties`

> `const` **ProductTourEventProperties**: `object`

#### Type Declaration

| Name | Type | Default value |
| ------ | ------ | ------ |
| <a id="property-inference_data_present"></a> `INFERENCE_DATA_PRESENT` | `"$inference_data_present"` | `'$inference_data_present'` |
| <a id="property-tour_banner_selector"></a> `TOUR_BANNER_SELECTOR` | `"$product_tour_banner_selector"` | `'$product_tour_banner_selector'` |
| <a id="property-tour_button_action"></a> `TOUR_BUTTON_ACTION` | `"$product_tour_button_action"` | `'$product_tour_button_action'` |
| <a id="property-tour_button_link"></a> `TOUR_BUTTON_LINK` | `"$product_tour_button_link"` | `'$product_tour_button_link'` |
| <a id="property-tour_button_text"></a> `TOUR_BUTTON_TEXT` | `"$product_tour_button_text"` | `'$product_tour_button_text'` |
| <a id="property-tour_button_tour_id"></a> `TOUR_BUTTON_TOUR_ID` | `"$product_tour_button_tour_id"` | `'$product_tour_button_tour_id'` |
| <a id="property-tour_dismiss_reason"></a> `TOUR_DISMISS_REASON` | `"$product_tour_dismiss_reason"` | `'$product_tour_dismiss_reason'` |
| <a id="property-tour_error"></a> `TOUR_ERROR` | `"$product_tour_error"` | `'$product_tour_error'` |
| <a id="property-tour_failure_phase"></a> `TOUR_FAILURE_PHASE` | `"$product_tour_failure_phase"` | `'$product_tour_failure_phase'` |
| <a id="property-tour_id"></a> `TOUR_ID` | `"$product_tour_id"` | `'$product_tour_id'` |
| <a id="property-tour_iteration"></a> `TOUR_ITERATION` | `"$product_tour_iteration"` | `'$product_tour_iteration'` |
| <a id="property-tour_last_seen_date"></a> `TOUR_LAST_SEEN_DATE` | `"$product_tour_last_seen_date"` | `'$product_tour_last_seen_date'` |
| <a id="property-tour_linked_survey_id"></a> `TOUR_LINKED_SURVEY_ID` | `"$product_tour_linked_survey_id"` | `'$product_tour_linked_survey_id'` |
| <a id="property-tour_matches_count"></a> `TOUR_MATCHES_COUNT` | `"$product_tour_matches_count"` | `'$product_tour_matches_count'` |
| <a id="property-tour_name"></a> `TOUR_NAME` | `"$product_tour_name"` | `'$product_tour_name'` |
| <a id="property-tour_render_reason"></a> `TOUR_RENDER_REASON` | `"$product_tour_render_reason"` | `'$product_tour_render_reason'` |
| <a id="property-tour_step_element_classes"></a> `TOUR_STEP_ELEMENT_CLASSES` | `"$product_tour_step_element_classes"` | `'$product_tour_step_element_classes'` |
| <a id="property-tour_step_element_id"></a> `TOUR_STEP_ELEMENT_ID` | `"$product_tour_step_element_id"` | `'$product_tour_step_element_id'` |
| <a id="property-tour_step_element_tag"></a> `TOUR_STEP_ELEMENT_TAG` | `"$product_tour_step_element_tag"` | `'$product_tour_step_element_tag'` |
| <a id="property-tour_step_element_text"></a> `TOUR_STEP_ELEMENT_TEXT` | `"$product_tour_step_element_text"` | `'$product_tour_step_element_text'` |
| <a id="property-tour_step_id"></a> `TOUR_STEP_ID` | `"$product_tour_step_id"` | `'$product_tour_step_id'` |
| <a id="property-tour_step_order"></a> `TOUR_STEP_ORDER` | `"$product_tour_step_order"` | `'$product_tour_step_order'` |
| <a id="property-tour_step_selector"></a> `TOUR_STEP_SELECTOR` | `"$product_tour_step_selector"` | `'$product_tour_step_selector'` |
| <a id="property-tour_step_selector_found"></a> `TOUR_STEP_SELECTOR_FOUND` | `"$product_tour_step_selector_found"` | `'$product_tour_step_selector_found'` |
| <a id="property-tour_step_type"></a> `TOUR_STEP_TYPE` | `"$product_tour_step_type"` | `'$product_tour_step_type'` |
| <a id="property-tour_steps_count"></a> `TOUR_STEPS_COUNT` | `"$product_tour_steps_count"` | `'$product_tour_steps_count'` |
| <a id="property-tour_type-1"></a> `TOUR_TYPE` | `"$product_tour_type"` | `'$product_tour_type'` |
| <a id="property-tour_wait_duration_ms"></a> `TOUR_WAIT_DURATION_MS` | `"$product_tour_wait_duration_ms"` | `'$product_tour_wait_duration_ms'` |
| <a id="property-tour_waited_for_element"></a> `TOUR_WAITED_FOR_ELEMENT` | `"$product_tour_waited_for_element"` | `'$product_tour_waited_for_element'` |
| <a id="property-use_manual_selector"></a> `USE_MANUAL_SELECTOR` | `"$use_manual_selector"` | `'$use_manual_selector'` |

### `severityLevels`

> `const` **severityLevels**: readonly \[`"fatal"`, `"error"`, `"warning"`, `"log"`, `"info"`, `"debug"`\]

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

### `ApiResponse`

A minimal response from Client.sendRequest.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-error"></a> `error?` | `unknown` | The transport error when the request failed before receiving an HTTP response. |
| <a id="property-json"></a> `json?` | `unknown` | The response body parsed as JSON when available. |
| <a id="property-statuscode"></a> `statusCode` | `number` | The HTTP status code returned by the transport, or a client-defined best-effort status for sendBeacon sends. |
| <a id="property-text"></a> `text?` | `string` | The response body as text when available. |

### `AutocaptureCompatibleElement`

> **AutocaptureCompatibleElement** = `"a"` \| `"button"` \| `"form"` \| `"input"` \| `"select"` \| `"textarea"` \| `"label"`

### `AutocaptureConfig`

If an array is passed for an allowlist, autocapture events will only be sent for elements matching
at least one of the elements in the array. Multiple allowlists can be used

#### Extended by

- `AutocaptureConfig`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-capture_copied_text"></a> `capture_copied_text?` | `boolean` | When true, autocapture captures cut, copy, and paste interactions. Paste events do not contain pasted text. |
| <a id="property-capture_value_css_selector_allowlist"></a> `capture_value_css_selector_allowlist?` | `string`[] \| ((`element`) => `boolean`) | CSS selectors or a predicate opting individual native fields into value capture on change events. Selectors match the field itself, not its ancestors. An empty array disables value capture. String values are sent in $input_value and may be edited in before_send. Values are not automatically redacted; only opt in fields whose contents you intend to collect. Password fields, no-capture markers, sensitive-field exclusions, and mask_all_text still apply. **Default** `['[data-ph-capture-value]']` |
| <a id="property-css_selector_allowlist"></a> `css_selector_allowlist?` | `string`[] | List of CSS selectors to allow autocapture on e.g. ['[ph-capture]'] we consider the tree of elements from the root to the target element of the click event so for the tree div > div > button > svg and allow list config `['[id]']` we will capture the click if the click-target or its parents has any id Everything is allowed when there's no allowlist |
| <a id="property-css_selector_ignorelist"></a> `css_selector_ignorelist?` | `string`[] | List of CSS selectors to ignore autocapture on e.g. ['[data-ph-no-autocapture]'] we consider the tree of elements from the root to the target element of the click event so for the tree div > div > button > svg and ignore list config `['[id]']` we will ignore the click if the click-target or its parents has any id Nothing is ignored when there's an empty ignorelist, e.g. [] If no ignorelist is set, we default to ignoring .ph-no-autocapture and [data-ph-no-autocapture] Note: providing any custom list fully replaces the defaults — include .ph-no-autocapture and [data-ph-no-autocapture] explicitly if you still want them honoured. |
| <a id="property-dom_event_allowlist"></a> `dom_event_allowlist?` | `DomAutocaptureEvents`[] | List of DOM events to allow autocapture on e.g. ['click', 'change', 'submit'] |
| <a id="property-element_allowlist"></a> `element_allowlist?` | `AutocaptureCompatibleElement`[] | List of DOM elements to allow autocapture on e.g. ['a', 'button', 'form', 'input', 'select', 'textarea', 'label'] We consider the tree of elements from the root to the target element of the click event so for the tree `div > div > button > svg` if the allowlist has `button` then we allow the capture when the `button` or the `svg` is the click target but not if either of the `div`s are detected as the click target |
| <a id="property-element_attribute_ignorelist"></a> `element_attribute_ignorelist?` | `string`[] | Exclude certain element attributes from autocapture E.g. ['aria-label'] or [data-attr-pii] |
| <a id="property-url_allowlist"></a> `url_allowlist?` | (`string` \| `RegExp`)[] | List of URLs to allow autocapture on, can be strings to match or regexes e.g. ['https://example.com', 'test.com/.*'] this is useful when you want to autocapture on specific pages only if you set both url_allowlist and url_ignorelist, we check the allowlist first and then the ignorelist. the ignorelist can override the allowlist |
| <a id="property-url_ignorelist"></a> `url_ignorelist?` | (`string` \| `RegExp`)[] | List of URLs to not allow autocapture on, can be strings to match or regexes e.g. ['https://example.com', 'test.com/.*'] this is useful when you want to autocapture on most pages but not some specific ones if you set both url_allowlist and url_ignorelist, we check the allowlist first and then the ignorelist. the ignorelist can override the allowlist |

### `BasicSurveyQuestion`

- `SurveyQuestionBase`

#### Properties

| Property | Type | Inherited from |
| ------ | ------ | ------ |
| <a id="property-branching"></a> `branching?` | `NextQuestionBranching` \| `EndBranching` \| `ResponseBasedBranching` \| `SpecificQuestionBranching` | `SurveyQuestionBase`.`branching` |
| <a id="property-buttontext"></a> `buttonText?` | `string` | `SurveyQuestionBase`.`buttonText` |
| <a id="property-description"></a> `description?` | `string` \| `null` | `SurveyQuestionBase`.`description` |
| <a id="property-descriptioncontenttype"></a> `descriptionContentType?` | `SurveyQuestionDescriptionContentType` | `SurveyQuestionBase`.`descriptionContentType` |
| <a id="property-id"></a> `id?` | `string` | `SurveyQuestionBase`.`id` |
| <a id="property-optional"></a> `optional?` | `boolean` | `SurveyQuestionBase`.`optional` |
| <a id="property-question"></a> `question` | `string` | `SurveyQuestionBase`.`question` |
| <a id="property-translations"></a> `translations?` | `Record`\<`string`, `SurveyQuestionTranslation`\> | `SurveyQuestionBase`.`translations` |
| <a id="property-type"></a> `type` | `"open"` | - |
| <a id="property-validation"></a> `validation?` | `SurveyValidationRule`[] | `SurveyQuestionBase`.`validation` |

### `BeforeSendFn`

> **BeforeSendFn** = (`cr`) => `CaptureResult` \| `null`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `cr` | `CaptureResult` |

#### Returns

`CaptureResult` \| `null`

### `BeforeSendLogFn`

> **BeforeSendLogFn** = (`record`) => `CaptureLogOptions` \| `null`

Pre-send filter. Inspect, mutate, or drop a captured log record before it
enters the rate cap or the buffer. Return the (possibly transformed) record
to keep it; return `null` to drop it.

Configure as a single function or an array. Arrays form a left-to-right
chain: each function receives the previous function's return value, and a
`null` from any link short-circuits the chain and drops the record. A
function that throws also drops the record (the error is logged).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `record` | `CaptureLogOptions` |

#### Returns

`CaptureLogOptions` \| `null`

#### Example

**Redact secrets from log bodies**

```ts
logs: { beforeSend: (record) => ({ ...record, body: record.body.replace(/token=\S+/g, 'token=[REDACTED]') }) }
```

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

### `BootstrapConfig`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-distinctid"></a> `distinctID?` | `string` \| `null` | Distinct ID to use before the SDK has loaded persisted identity. |
| <a id="property-featureflagpayloads"></a> `featureFlagPayloads?` | `Record`\<`string`, `JsonType`\> \| `null` | Feature flag payloads to use together with bootstrapped `featureFlags`. |
| <a id="property-featureflags"></a> `featureFlags?` | `Record`\<`string`, `string` \| `boolean`\> \| `null` | Feature flag values to use immediately until the SDK fetches fresh values. |
| <a id="property-isidentifiedid"></a> `isIdentifiedID?` | `boolean` \| `null` | Whether `distinctID` already identifies a known person profile. |
| <a id="property-sessionid"></a> `sessionID?` | `string` \| `null` | Optionally provide a sessionID, this is so that you can provide an existing sessionID here to continue a user's session across a domain or device. It MUST be: - unique to this user - a valid UUID v7 - the timestamp part must be <= the timestamp of the first event in the session - the timestamp of the last event in the session must be < the timestamp part + 24 hours |

### `BrowserMetricsConfig`

Metrics configuration options for the browser SDK. Adds the options that
only the browser SDK implements to the shared metrics options.

#### Extends

- `MetricsConfig`

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-beforesend"></a> `beforeSend?` | `BeforeSendMetricFn` \| `BeforeSendMetricFn`[] | Pre-aggregation filter for metric samples, as a single function or a left-to-right chain. Each function inspects, mutates, or drops a sample (return `null` to drop) before it is aggregated. | `MetricsConfig`.`beforeSend` |
| <a id="property-environment"></a> `environment?` | `string` | The deployment environment for metric series (e.g. 'production', 'staging'). Maps to the OTel resource attribute 'deployment.environment'. | `MetricsConfig`.`environment` |
| <a id="property-flags"></a> `flags?` | `boolean` | **`Experimental`** EXPERIMENTAL: Record the round trip of every `/flags` HTTP attempt as the histogram `posthog.flags.request.duration`, in milliseconds. Each retry is a separate sample. The timer starts when the SDK hands the request to the transport, so the duration includes compressing the request body. Samples carry the server host, the response status or error type, and the browser's IANA timezone as `client.timezone`. Requests that the SDK drops before they reach the network are not recorded. This option, the metric name, and its attributes may change or be removed in any release. **Default** `undefined @experimental` | - |
| <a id="property-flushintervalms"></a> `flushIntervalMs?` | `number` | How often the aggregated window is flushed, in milliseconds. Samples are folded into per-series aggregates in memory between flushes — one data point per series per window, no matter how many calls. **Default** `10000` | `MetricsConfig`.`flushIntervalMs` |
| <a id="property-maxseriesperflush"></a> `maxSeriesPerFlush?` | `number` | Cardinality guardrail: maximum distinct series (name + type + unit + attribute combination) held per flush window. Samples for series beyond the cap are dropped with a single warning per window. **Default** `1000` | `MetricsConfig`.`maxSeriesPerFlush` |
| <a id="property-network"></a> `network?` | `boolean` \| `NetworkMetricsConfig` | Record the duration of every HTTP or HTTPS `fetch` and `XMLHttpRequest` as a histogram. `true` uses the defaults. Requests to PostHog itself and URLs with other protocols are not recorded. Each transport is measured to the boundary its API exposes: a `fetch` to its response headers, an `XMLHttpRequest` to the end of its response body. **Default** `undefined` | - |
| <a id="property-resourceattributes"></a> `resourceAttributes?` | `MetricAttributes` | Additional resource attributes applied to every metrics batch. These describe the service/deployment, not individual series. Named fields (serviceName, environment, serviceVersion) are set first; resourceAttributes can override them. **Example** `{ 'host.name': 'web-01', 'cloud.region': 'us-east-1' }` | `MetricsConfig`.`resourceAttributes` |
| <a id="property-servicename"></a> `serviceName?` | `string` | The service name for metric series. Maps to the OTel resource attribute 'service.name'. **Default** `'unknown_service'` | `MetricsConfig`.`serviceName` |
| <a id="property-serviceversion"></a> `serviceVersion?` | `string` | The service version for metric series (e.g. '1.2.3'). Maps to the OTel resource attribute 'service.version'. | `MetricsConfig`.`serviceVersion` |

### `CanvasMaskRegion`

> **CanvasMaskRegion** = `object`

A rectangle to paint over a recorded canvas frame, in CSS pixels relative
to the canvas element.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="height"></a> `height` | `number` |
| <a id="width"></a> `width` | `number` |
| <a id="x"></a> `x` | `number` |
| <a id="y"></a> `y` | `number` |

### `CapturedEventInfo`

A captured event, as observed by `onEvent`.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-event"></a> `event` | `readonly` | `string` | The finalized captured event name. |
| <a id="property-properties"></a> `properties` | `readonly` | `object` | The final event properties after client defaults and dynamic properties are applied. |

### `CapturedNetworkRequest`

> **CapturedNetworkRequest** = `Writable`\<`Omit`\<`PerformanceEntry`, `"toJSON"`\>\> & `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `endTime?` | `number` |
| `initiatorType?` | `InitiatorType` |
| `isInitial?` | `boolean` |
| `method?` | `string` |
| `requestBody?` | `string` \| `null` |
| `requestHeaders?` | `Headers` |
| `responseBody?` | `string` \| `null` |
| `responseHeaders?` | `Headers` |
| `startTime?` | `number` |
| `status?` | `number` |
| `timeOrigin?` | `number` |
| `timestamp?` | `number` |

### `CaptureLogOptions`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attributes"></a> `attributes?` | `LogAttributes` | Per-log attributes (request-specific context like order_id, duration_ms) |
| <a id="property-body"></a> `body` | `string` | The log message body (required) |
| <a id="property-level"></a> `level?` | `LogSeverityLevel` | Log severity level (default: 'info') |
| <a id="property-span_id"></a> `span_id?` | `string` | Span ID for correlation — 16 hex chars |
| <a id="property-trace_flags"></a> `trace_flags?` | `number` | W3C trace flags (default: 0) |
| <a id="property-trace_id"></a> `trace_id?` | `string` | Trace ID for correlation — 32 hex chars |

### `CaptureMetricOptions`

Options accepted by `posthog.metrics.count/gauge/histogram`.

#### Extended by

- `HistogramOptions`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attributes-1"></a> `attributes?` | `MetricAttributes` | Low-cardinality dimensions to filter and group by (e.g. route, plan, region). Each distinct combination is its own series. |
| <a id="property-unit"></a> `unit?` | `string` | Unit of the value (e.g. 'ms', 'byte'). Displayed in the Metrics UI and part of the series identity — the same name with two units is two series. |

### `CaptureOptions`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-set"></a> `$set?` | `Properties` | Used when `$identify` is called Will set person properties overriding previous values |
| <a id="property-set_once"></a> `$set_once?` | `Properties` | Used when `$identify` is called Will set person properties but only once, it will NOT override previous values |
| <a id="property-unset"></a> `$unset?` | `string`[] | Used to unset person properties |
| <a id="property-send_instantly"></a> `send_instantly?` | `boolean` | If set, sends the event immediately instead of adding it to the batched queue. The batched queue drains with `sendBeacon` when the page hides, and an immediate send does not use that queue. On an active page, the SDK keeps its normal transport so failed requests can be retried. By default this is `fetch`, which keeps small requests alive across a navigation, or XHR when `fetch` is unavailable. Once PostHog's own `pagehide` handler (or `unload` fallback) marks the page as unloading, the SDK prefers `sendBeacon`, unless an explicit transport, a required response, or `request_headers` prevent it. Captures from `beforeunload` or `pagehide` listeners that run before PostHog's handler still use their normal transport. This is best effort, not a guarantee: XHR and requests too large for `fetch` keepalive can be cancelled by navigation. To always use a beacon, set `{ transport: 'sendBeacon' }`, but note that accepted beacons cannot report server failures to the SDK for retries. |
| <a id="property-skip_client_rate_limiting"></a> `skip_client_rate_limiting?` | `boolean` | If set, skips the client side rate limiting |
| <a id="property-timestamp"></a> `timestamp?` | `Date` | If set, overrides the current timestamp. UTC is preferred; non-UTC input is converted to UTC. |
| <a id="property-transport"></a> `transport?` | `"XHR"` \| `"fetch"` \| `"sendBeacon"` | If set, overrides the desired transport method |
| <a id="property-uuid"></a> `uuid?` | `string` | If set, overrides the auto-generated event uuid. The value must be a valid UUID; invalid values are ignored and a new UUID is generated. Useful for cross-source idempotency (e.g. a server webhook and a browser success page both firing for the same business transaction): emit both events with the same deterministic uuid so storage can eventually deduplicate them. Capture itself does not deduplicate resent events, and PostHog does not guarantee strict immediate deduplication. |

### `CaptureOptions`

Per-call capture overrides, mirroring the client's public capture options.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-delivery"></a> `delivery?` | `"unload"` | Send immediately without batching, using best-effort unload-safe delivery. |
| <a id="property-set"></a> `set?` | `Record`\<`string`, `unknown`\> | Person properties to set, emitted as `$set`. |
| <a id="property-setonce"></a> `setOnce?` | `Record`\<`string`, `unknown`\> | Person properties to set if unset, emitted as `$set_once`. |
| <a id="property-timestamp"></a> `timestamp?` | `Date` | Override the event timestamp sent to PostHog. UTC is preferred; non-UTC input is converted to UTC. |
| <a id="property-uuid"></a> `uuid?` | `string` | Override the event UUID used for de-duplication. |

### `CapturePageviewOptions`

Selects which same-page URL changes automatically capture a `$pageview`.
Each option defaults to `false` when omitted.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-hash"></a> `hash?` | `boolean` | Capture a pageview when `location.hash` changes, unless `disable_capture_url_hashes` is enabled. |
| <a id="property-path"></a> `path?` | `boolean` | Capture a pageview when `location.pathname` changes. |
| <a id="property-search"></a> `search?` | `boolean` | Capture a pageview when `location.search` changes. |

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

### `Client`

The host SDK surface handed to an extension in `setup`. A conforming host
provides it as an adapter over its own analytics, transport, persistence,
event, and remote-config internals.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-anonymousid"></a> `anonymousId` | `readonly` | `string` | The anonymous device id carried across identify calls. |
| <a id="property-cancapture"></a> `canCapture` | `readonly` | `boolean` | Whether the host currently permits data capture. |
| <a id="property-deviceid"></a> `deviceId` | `readonly` | `string` \| `undefined` | The actual persisted device id, absent in cookieless contexts. |
| <a id="property-distinctid"></a> `distinctId` | `readonly` | `string` | The id events are currently attributed to. |
| <a id="property-groups"></a> `groups` | `readonly` | `object` | Active group memberships attached to events as `$groups`. |
| <a id="property-initialpersonproperties"></a> `initialPersonProperties` | `readonly` | `object` | Initial person properties used for feature evaluation. |
| <a id="property-isoptedout"></a> `isOptedOut` | `readonly` | `boolean` | Effective consent opt-out state. Cookieless capture may still be permitted while opted out. |
| <a id="property-isratelimited"></a> `isRateLimited?` | `readonly` | `boolean` | Whether the client rate limit drops an event captured now. Reading it must not use a token. |
| <a id="property-kv"></a> `kv` | `readonly` | `KeyValueStore` | Initializable, synchronously buffered key-value storage backed by the host client's persistence. |
| <a id="property-library"></a> `library` | `readonly` | `object` | Live host SDK metadata. |
| `library.name` | `readonly` | `string` | - |
| `library.version` | `readonly` | `string` | - |
| <a id="property-logger"></a> `logger` | `readonly` | `Logger` | Logger that follows the host client's debug/noise policy. |
| <a id="property-onevent"></a> `onEvent` | `readonly` | `Listener`\<`CapturedEventInfo`\> | Fires for every captured event through a deeply readonly view. |
| <a id="property-onremoteconfig"></a> `onRemoteConfig` | `readonly` | `Listener`\<\{ `config`: \{ `analytics?`: \{ `endpoint?`: `string`; \}; `autocapture_opt_out?`: `boolean`; `autocaptureExceptions?`: `boolean` \| \{ `endpoint?`: `string`; \}; `captureDeadClicks?`: `boolean`; `capturePerformance?`: `boolean` \| \{ `__preview_web_vitals_soft_navs?`: `boolean`; `__web_vitals_max_value?`: `number`; `network_timing?`: `boolean`; `web_vitals?`: `boolean`; `web_vitals_allowed_metrics?`: readonly `SupportedWebVitalsMetrics`[]; `web_vitals_attribution?`: `boolean` \| readonly `SupportedWebVitalsMetrics`[]; `web_vitals_delayed_flush_ms?`: `number`; \}; `conversations?`: `boolean` \| \{ `collectName?`: `boolean`; `color?`: `string`; `domains?`: readonly `string`[]; `enabled`: `boolean`; `greetingText?`: `string`; `identificationFormDescription?`: `string`; `identificationFormTitle?`: `string`; `placeholderText?`: `string`; `requireEmail?`: `boolean`; `token`: `string`; `widgetEnabled?`: `boolean`; `widgetPosition?`: `WidgetPosition`; \}; `defaultIdentifiedOnly?`: `boolean`; `editorParams?`: \{ `actionId?`: `number`; `dataAttributes?`: readonly `string`[]; `distinctId?`: `string`; `featureFlags?`: \{\[`key`: `string`\]: `string` \| `boolean`; \}; `instrument?`: `boolean`; `source?`: `ToolbarSource`; `temporaryToken?`: `string`; `token?`: `string`; `toolbarVersion?`: `"toolbar"`; `userEmail?`: `string`; `userIntent?`: `ToolbarUserIntent`; \}; `elementsChainAsString?`: `boolean`; `errorTracking?`: \{ `autocaptureExceptions?`: `boolean`; `captureExtensionExceptions?`: `boolean`; `suppressionRules?`: readonly `object`[]; \}; `hasFeatureFlags?`: `boolean`; `heatmaps?`: `boolean`; `isAuthenticated`: `boolean`; `logs?`: \{ `captureConsoleLogs?`: `boolean`; \}; `productTours?`: `boolean`; `sessionRecording?`: `false` \| \{ `canvasFps?`: `number` \| `null`; `canvasQuality?`: `string` \| `null`; `consoleLogRecordingEnabled?`: `boolean`; `endpoint?`: `string`; `eventTriggers?`: readonly `string`[]; `linkedFlag?`: `string` \| \{ `flag`: `string`; `variant`: `string`; \} \| `null`; `masking?`: \{ `blockSelector?`: `string` \| `null`; `maskAllElementAttributes?`: `boolean`; `maskAllInputs?`: `boolean`; `maskTextSelector?`: `string` \| `null`; \}; `minimumDurationMilliseconds?`: `number`; `networkPayloadCapture?`: \{ `recordBody?`: `boolean` \| readonly `string`[] \| \{ `request`: ... \| ... \| ...; `response`: ... \| ... \| ...; \}; `recordHeaders?`: `boolean` \| \{ `request`: `boolean`; `response`: `boolean`; \}; \}; `recordCanvas?`: `boolean` \| `null`; `sampleRate?`: `string` \| `null`; `scriptConfig?`: \{ `script?`: `string`; \}; `triggerGroups?`: readonly `object`[]; `triggerMatchType?`: `"all"` \| `"any"`; `urlBlocklist?`: readonly `object`[]; `urlTriggers?`: readonly `object`[]; `version?`: `1` \| `2`; \}; `siteApps`: readonly `object`[]; `supportedCompression`: readonly `Compression`[]; `surveys?`: `boolean` \| readonly `object`[]; `toolbarParams`: \{ `actionId?`: `number`; `dataAttributes?`: readonly `string`[]; `distinctId?`: `string`; `featureFlags?`: \{\[`key`: `string`\]: `string` \| `boolean`; \}; `instrument?`: `boolean`; `source?`: `ToolbarSource`; `temporaryToken?`: `string`; `token?`: `string`; `toolbarVersion?`: `"toolbar"`; `userEmail?`: `string`; `userIntent?`: `ToolbarUserIntent`; \}; `toolbarVersion`: `"toolbar"`; \}; `ok`: `true`; \} \| \{ `ok`: `false`; \}\> | Replays the latest available remote-config outcome and fires subsequent outcomes when the host makes them available. |
| <a id="property-onsession"></a> `onSession` | `readonly` | `Listener`\<`string`\> | Observes session IDs through the host's session notifications, without creating a session. May replay an existing session on subscription. |
| <a id="property-projecttoken"></a> `projectToken` | `readonly` | `string` | Public project token used to authenticate endpoint-specific requests. |
| <a id="property-session"></a> `session` | `readonly` | `SessionContext` \| `undefined` | The current session, if one exists. Reading it need not create one. |

#### Methods

##### capture()

> **capture**(`event`, `properties?`, `options?`): `boolean`

Synchronously admits an analytics event to the client's normal pipeline.
Returns `false` when the client rate limit dropped the event, so the caller can send it again later.
An event that is dropped for another reason, for example by `before_send`, returns `true`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | `string` |
| `properties?` | `Properties` \| `null` |
| `options?` | `CaptureOptions` |

###### Returns

`boolean`

##### getExtension()

###### Call Signature

> **getExtension**\<`T`\>(`token`): `T` \| `undefined`

Returns the extension registered under a typed stable name, or `undefined` when it is not installed.

###### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-4"></a> `T` *extends* `Extension` |

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `token` | `ExtensionToken`\<`T`\> |

###### Returns

`T` \| `undefined`

###### Call Signature

> **getExtension**\<`T`\>(`name`): `T` \| `undefined`

Returns the extension registered under a stable name, or `undefined` when it is not installed.

###### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| <a id="type-parameter-t-5"></a> `T` *extends* `Extension` | `Extension` |

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |

###### Returns

`T` \| `undefined`

##### registerDynamicEventProperties()

> **registerDynamicEventProperties**(`producer`): `Disposable`

Registers a synchronous producer of properties merged into every captured event.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `producer` | () => `Record`\<`string`, `unknown`\> |

###### Returns

`Disposable`

##### sendRequest()

> **sendRequest**(`path`, `init?`): `Promise`\<`ApiResponse`\>

Sends a request through the host SDK's transport.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `path` | `string` |
| `init?` | `SendRequestInit` |

###### Returns

`Promise`\<`ApiResponse`\>

### `Compression`

> **Compression** = *typeof* `Compression`\[keyof *typeof* `Compression`\]

### `ConfigDefaults`

> **ConfigDefaults** = `"latest"` \| *typeof* `CONFIG_DEFAULTS_DATES`\[`number`\] \| `"unset"`

Configuration defaults snapshot used by `PostHogConfig.defaults`.
Later dates include all earlier default changes. `latest` includes all changes in the loaded SDK version.

### `ConversationsConfig`

Conversations configuration options

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-theme"></a> `theme?` | `ConversationsTheme` | Theme of the support widget. Change it after init with `posthog.conversations.setTheme()`. **Example** `posthog.init('phc_...', { conversations: { theme: { colorScheme: 'auto', primary: '#111827', dark: { primary: '#f9fafb' } }, }, })` |

### `ConversationsRemoteConfig`

Remote configuration for conversations from the PostHog server.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-collectname"></a> `collectName?` | `boolean` | Whether to show the name field in the identification form. |
| <a id="property-color"></a> `color?` | `string` | Primary color for the widget UI. |
| <a id="property-domains"></a> `domains?` | `string`[] | Domains where the widget may be shown. |
| <a id="property-enabled"></a> `enabled` | `boolean` | Whether conversations are enabled for this team. |
| <a id="property-greetingtext"></a> `greetingText?` | `string` | Greeting text to show when the widget is first opened. |
| <a id="property-identificationformdescription"></a> `identificationFormDescription?` | `string` | Description for the identification form. |
| <a id="property-identificationformtitle"></a> `identificationFormTitle?` | `string` | Title for the identification form. |
| <a id="property-placeholdertext"></a> `placeholderText?` | `string` | Placeholder text for the message input. |
| <a id="property-requireemail"></a> `requireEmail?` | `boolean` | Whether to require an email address before starting a conversation. |
| <a id="property-token"></a> `token` | `string` | Public token for authenticating conversations API requests. |
| <a id="property-widgetenabled"></a> `widgetEnabled?` | `boolean` | Whether the widget UI should be shown. |
| <a id="property-widgetposition"></a> `widgetPosition?` | `WidgetPosition` | Position of the widget on the screen. |

### `ConversationsTheme`

Theme of the conversations widget. The top-level colors are the light colors; `dark` holds the dark ones.

Values are applied as `--ph-conv-*` CSS custom properties (`--ph-conv-primary`, `--ph-conv-on-primary`,
`--ph-conv-bg`, `--ph-conv-surface`, `--ph-conv-text`, `--ph-conv-muted`, `--ph-conv-border`,
`--ph-conv-agent-bubble`, `--ph-conv-font`, `--ph-conv-radius`, `--ph-conv-launcher-shadow`,
`--ph-conv-window-shadow`). Rules in your own stylesheet that set them on
`#ph-conversations-widget-container` take precedence over the theme.

#### Extends

- `ConversationsThemeColors`

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-agentbubble"></a> `agentBubble?` | `string` | Background of messages from your team. | `ConversationsThemeColors`.`agentBubble` |
| <a id="property-background"></a> `background?` | `string` | Window, message list and input background. | `ConversationsThemeColors`.`background` |
| <a id="property-border"></a> `border?` | `string` | Borders and dividers. | `ConversationsThemeColors`.`border` |
| <a id="property-borderradius"></a> `borderRadius?` | `string` | Corner radius of the chat window, e.g. `'16px'`. | - |
| <a id="property-colorscheme"></a> `colorScheme?` | `"auto"` \| `"light"` \| `"dark"` | Which colors to use. `'auto'` follows the visitor's `prefers-color-scheme`. **Default** `'light'` | - |
| <a id="property-dark"></a> `dark?` | `ConversationsThemeColors` | Colors used when the dark scheme is active. Unset values fall back to built-in dark colors, except `primary` and `primaryText`, which fall back to the light ones. | - |
| <a id="property-fontfamily"></a> `fontFamily?` | `string` | Font family of the widget. | - |
| <a id="property-launchershadow"></a> `launcherShadow?` | `string` | CSS `filter` applied to the launcher button, e.g. `'none'` or `'drop-shadow(0 2px 8px rgba(0,0,0,0.2))'`. | - |
| <a id="property-mutedtext"></a> `mutedText?` | `string` | Secondary text: timestamps, author names, descriptions. | `ConversationsThemeColors`.`mutedText` |
| <a id="property-primary"></a> `primary?` | `string` | Launcher, header, customer messages and buttons. Overrides the color set in project settings. | `ConversationsThemeColors`.`primary` |
| <a id="property-primarytext"></a> `primaryText?` | `string` | Text and icons drawn on `primary`. Computed from `primary` when it is a hex color and this is unset. | `ConversationsThemeColors`.`primaryText` |
| <a id="property-surface"></a> `surface?` | `string` | Secondary background: identification form, unread tickets, code blocks. | `ConversationsThemeColors`.`surface` |
| <a id="property-text-1"></a> `text?` | `string` | Main text color. | `ConversationsThemeColors`.`text` |
| <a id="property-windowshadow"></a> `windowShadow?` | `string` | CSS `box-shadow` of the chat window. | - |

### `ConversationsThemeColors`

Colors of the conversations widget. Any CSS color value is accepted.

#### Extended by

- `ConversationsTheme`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-agentbubble-1"></a> `agentBubble?` | `string` | Background of messages from your team. |
| <a id="property-background-1"></a> `background?` | `string` | Window, message list and input background. |
| <a id="property-border-1"></a> `border?` | `string` | Borders and dividers. |
| <a id="property-mutedtext-1"></a> `mutedText?` | `string` | Secondary text: timestamps, author names, descriptions. |
| <a id="property-primary-1"></a> `primary?` | `string` | Launcher, header, customer messages and buttons. Overrides the color set in project settings. |
| <a id="property-primarytext-1"></a> `primaryText?` | `string` | Text and icons drawn on `primary`. Computed from `primary` when it is a hex color and this is unset. |
| <a id="property-surface-1"></a> `surface?` | `string` | Secondary background: identification form, unread tickets, code blocks. |
| <a id="property-text-2"></a> `text?` | `string` | Main text color. |

### `ConversationsTraits`

User traits to send with messages

#### Indexable

> \[`key`: `string`\]: `string` \| `number` \| `boolean` \| `null` \| `undefined`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-email"></a> `email?` | `string` \| `null` |
| <a id="property-name"></a> `name?` | `string` \| `null` |

### `ConversationsUnavailableReason`

> **ConversationsUnavailableReason** = `"disabled_by_config"` \| `"consent_opted_out"` \| `"disabled_for_toolbar"` \| `"remote_config_pending"` \| `"remote_config_failed"` \| `"disabled_in_project"` \| `"missing_token"` \| `"extensions_unavailable"` \| `"load_failed"` \| `"initializing"` \| `"not_loaded"`

### `ConversationsWidgetState`

> **ConversationsWidgetState** = `"open"` \| `"closed"`

Visual state of the conversations widget

### `DeadClickCandidate`

| Property | Type |
| ------ | ------ |
| <a id="property-absolutedelayms"></a> `absoluteDelayMs?` | `number` |
| <a id="property-focuschangeddelayms"></a> `focusChangedDelayMs?` | `number` |
| <a id="property-mutationdelayms"></a> `mutationDelayMs?` | `number` |
| <a id="property-node"></a> `node` | `Element` |
| <a id="property-originalevent"></a> `originalEvent` | `MouseEvent` \| `TouchEvent` |
| <a id="property-scrolldelayms"></a> `scrollDelayMs?` | `number` |
| <a id="property-selectionchangeddelayms"></a> `selectionChangedDelayMs?` | `number` |
| <a id="property-swipedirection"></a> `swipeDirection?` | `"left"` \| `"right"` \| `"up"` \| `"down"` |
| <a id="property-swipedistancepx"></a> `swipeDistancePx?` | `number` |
| <a id="property-timestamp-2"></a> `timestamp` | `number` |
| <a id="property-type-1"></a> `type?` | `"click"` \| `"swipe"` |
| <a id="property-visibilitychangeddelayms"></a> `visibilityChangedDelayMs?` | `number` |

### `DeadClicksAutoCaptureConfig`

> **DeadClicksAutoCaptureConfig** = `object` & `Pick`\<`AutocaptureConfig`, `"element_attribute_ignorelist"`\>

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `__onCapture()?` | (`click`, `properties`) => `void` | Allows setting behavior for when a dead click is captured. For e.g. to support capture to heatmaps If not provided the default behavior is to auto-capture dead click events Only intended to be provided by our own SDK |
| `capture_clicks_with_modifier_keys?` | `boolean` | By default, clicks with modifier keys (ctrl, shift, alt, meta/cmd) held down are not considered dead clicks, since these typically indicate intentional actions like "open in new tab". Set this to true to capture dead clicks even when modifier keys are held. **Default** `false` |
| `capture_dead_swipes?` | `boolean` | Determines whether PostHog should also detect "dead swipes" — touch swipe gestures (typically on mobile/touch devices) that produce no observable screen change (no scroll, mutation or selection change while the gesture is in progress, and no scroll, mutation, selection or visibility change afterwards). These usually indicate a failed navigation, e.g. swiping to go back or to move a carousel with nothing happening. Dead swipes are captured as `$dead_swipe` events. This only applies to the dead-click autocapture path, not the heatmaps path. Swipes over surfaces whose response cannot be observed — canvas, video and other media/plugin elements under the finger — are never captured, and capture is limited per page load (see `max_dead_swipes_per_page_load`). **Default** `true` |
| `css_selector_ignorelist?` | `string`[] | List of CSS selectors to ignore dead clicks on e.g. ['.my-download-link'] we consider the tree of elements from the root to the target element of the click event so for the tree div > div > a > svg and ignore list config `['[download]']` we will ignore the dead click if the click-target or its parents has any download attribute Nothing is ignored when there's an empty ignorelist, e.g. [] If no ignorelist is set, we default to ignoring .ph-no-deadclick and .ph-no-capture A custom ignorelist fully replaces the default — include .ph-no-capture if you want it to suppress dead-click capture as well |
| `max_dead_swipes_per_page_load?` | `number` | The maximum number of dead swipes captured per page load. Swipe gestures are plentiful on touch devices, so a page whose responses the detector cannot see is capped rather than allowed to flood events. Only used when `capture_dead_swipes` is enabled. **Default** `10` |
| `mutation_threshold_ms?` | `number` | We'll not consider a click to be a dead click, if it's followed by a mutation within `mutation_threshold_ms` milliseconds **Default** `2500` |
| `scroll_threshold_ms?` | `number` | We'll not consider a click to be a dead click, if it's followed by a scroll within `scroll_threshold_ms` milliseconds **Default** `100` |
| `selection_change_threshold_ms?` | `number` | We'll not consider a click to be a dead click if it selects/unselects text or moves a caret in editable content during its mouse gesture, regardless of how long the button is held. Selection changes outside a matching gesture suppress the click when they occur within `selection_change_threshold_ms` milliseconds immediately before or after it. When a closed shadow root hides whether a caret belongs to editable content, only the timed window applies. A value of 0 disables selection-based suppression. **Default** `100` |
| `swipe_threshold_px?` | `number` | The minimum straight-line distance in CSS pixels between where a touch gesture starts and ends for it to be considered a swipe (rather than a tap). Only used when `capture_dead_swipes` is enabled. **Default** `30` |

### `DisplaySurveyInlineOptions`

- `DisplaySurveyOptionsBase`

#### Properties

| Property | Type | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-displaytype"></a> `displayType` | `"inline"` | How the survey should be displayed. **Default** `DisplaySurveyType.Popover` | `DisplaySurveyOptionsBase`.`displayType` | - |
| <a id="property-ignoreconditions"></a> `ignoreConditions` | `boolean` | Whether to bypass the survey's targeting and display conditions. **Default** `false` | - | `DisplaySurveyOptionsBase`.`ignoreConditions` |
| <a id="property-ignoredelay"></a> `ignoreDelay` | `boolean` | Whether to bypass the survey's configured popup delay. **Default** `false` | - | `DisplaySurveyOptionsBase`.`ignoreDelay` |
| <a id="property-initialresponses"></a> `initialResponses?` | `Record`\<`number`, `SurveyResponseValue`\> | Pre-filled responses by question index (0-based). Only supported for popover surveys. | - | `DisplaySurveyOptionsBase`.`initialResponses` |
| <a id="property-properties-1"></a> `properties?` | `Properties` | Additional properties to include in all survey events (shown, sent, dismissed). | - | `DisplaySurveyOptionsBase`.`properties` |
| <a id="property-selector"></a> `selector` | `string` | CSS selector for the element where the inline survey should render. | - | - |

### `DisplaySurveyOptions`

> **DisplaySurveyOptions** = `DisplaySurveyPopoverOptions` \| `DisplaySurveyInlineOptions`

Options for `posthog.displaySurvey()`.

### `DisplaySurveyOptionsBase`

- `DisplaySurveyPopoverOptions`
- `DisplaySurveyInlineOptions`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-displaytype-1"></a> `displayType` | `DisplaySurveyType` | How the survey should be displayed. **Default** `DisplaySurveyType.Popover` |
| <a id="property-ignoreconditions-1"></a> `ignoreConditions` | `boolean` | Whether to bypass the survey's targeting and display conditions. **Default** `false` |
| <a id="property-ignoredelay-1"></a> `ignoreDelay` | `boolean` | Whether to bypass the survey's configured popup delay. **Default** `false` |
| <a id="property-initialresponses-1"></a> `initialResponses?` | `Record`\<`number`, `SurveyResponseValue`\> | Pre-filled responses by question index (0-based). Only supported for popover surveys. |
| <a id="property-properties-2"></a> `properties?` | `Properties` | Additional properties to include in all survey events (shown, sent, dismissed). |

### `DisplaySurveyPopoverOptions`

Options for displaying a survey as a popover.

#### Extends

- `DisplaySurveyOptionsBase`

#### Properties

| Property | Type | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-displaytype"></a> `displayType` | `"popover"` | How the survey should be displayed. **Default** `DisplaySurveyType.Popover` | `DisplaySurveyOptionsBase`.`displayType` | - |
| <a id="property-ignoreconditions"></a> `ignoreConditions` | `boolean` | Whether to bypass the survey's targeting and display conditions. **Default** `false` | - | `DisplaySurveyOptionsBase`.`ignoreConditions` |
| <a id="property-ignoredelay"></a> `ignoreDelay` | `boolean` | Whether to bypass the survey's configured popup delay. **Default** `false` | - | `DisplaySurveyOptionsBase`.`ignoreDelay` |
| <a id="property-initialresponses"></a> `initialResponses?` | `Record`\<`number`, `SurveyResponseValue`\> | Pre-filled responses by question index (0-based). Only supported for popover surveys. | - | `DisplaySurveyOptionsBase`.`initialResponses` |
| <a id="property-position"></a> `position?` | `SurveyPosition` | Override the survey's configured position. | - | - |
| <a id="property-properties-2"></a> `properties?` | `Properties` | Additional properties to include in all survey events (shown, sent, dismissed). | - | `DisplaySurveyOptionsBase`.`properties` |
| <a id="property-selector-1"></a> `selector?` | `string` | CSS selector for the element to position the survey next to (when position is NextToTrigger). | - | - |
| <a id="property-skipshownevent"></a> `skipShownEvent?` | `boolean` | When true, `survey shown` events will not be emitted automatically. | - | - |

### `DisplaySurveyType`

> **DisplaySurveyType** = *typeof* `DisplaySurveyType`\[keyof *typeof* `DisplaySurveyType`\]

### `Disposable`

A resource handle with idempotent, best-effort cleanup.

#### Methods

##### dispose()

> **dispose**(): `void`

Release resources owned by this object.

###### Returns

`void`

### `DomAutocaptureEvents`

> **DomAutocaptureEvents** = `"click"` \| `"change"` \| `"submit"`

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

### `EarlyAccessFeatureResponse`

| Property | Type |
| ------ | ------ |
| <a id="property-earlyaccessfeatures"></a> `earlyAccessFeatures` | `EarlyAccessFeature`[] |

### `EarlyAccessFeatureStage`

> **EarlyAccessFeatureStage** = `"concept"` \| `"alpha"` \| `"beta"` \| `"general-availability"`

### `EndBranching`

| Property | Type |
| ------ | ------ |
| <a id="property-type-1"></a> `type` | `"end"` |

### `ErrorEventArgs`

> **ErrorEventArgs** = \[`event`: `string` \| `Event`, `source?`: `string` \| `undefined`, `lineno?`: `number` \| `undefined`, `colno?`: `number` \| `undefined`, `error?`: `Error` \| `undefined`\]

### `ErrorTrackingOptions`

Shared configuration for the error tracking burst-protection rate limiter.

Burst protection is scoped **per exception type** — the limiter is keyed by exception type, so
each distinct `$exception` type gets its own token bucket and there is no aggregate cap across
all types. It applies only to autocaptured exceptions; manual `captureException` calls are
never rate limited. These options let customers with high-cardinality exception types tune the
per-type allowance, and are shared between the browser and Node SDKs.

#### Extends

- `ExceptionRateLimiterConfig`

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-__captureposthogexceptions"></a> `__capturePostHogExceptions?` | `boolean` | UNSTABLE: determines whether exception caused by the PostHog SDK will be captured **Default** `false` | - |
| <a id="property-__exceptionratelimiterbucketsize"></a> ~~`__exceptionRateLimiterBucketSize?`~~ | `number` | **Deprecated** Use ExceptionRateLimiterConfig.exceptionRateLimiterBucketSize instead. Still honoured as a fallback, but will be removed in a future major version. | - |
| <a id="property-__exceptionratelimiterrefillrate"></a> ~~`__exceptionRateLimiterRefillRate?`~~ | `number` | **Deprecated** Use ExceptionRateLimiterConfig.exceptionRateLimiterRefillRate instead. Still honoured as a fallback, but will be removed in a future major version. | - |
| <a id="property-captureextensionexceptions"></a> `captureExtensionExceptions?` | `boolean` | Decide whether exceptions thrown by browser extensions or by scripts injected by the browser itself (for example Firefox for iOS and Chrome for iOS user scripts) should be captured. When false, both categories are dropped before capture. **Default** `false` | - |
| <a id="property-exception_steps"></a> `exception_steps?` | `ExceptionStepsConfig` | Controls buffering and payload limits for exception steps added via `addExceptionStep`. | - |
| <a id="property-exceptionratelimiterbucketsize"></a> `exceptionRateLimiterBucketSize?` | `number` | ADVANCED: alters the bucket size for the error tracking rate limiter's token bucket. Normally only altered alongside PostHog support guidance. Accepts values between 0 and 100. **Default** `10` | `ExceptionRateLimiterConfig`.`exceptionRateLimiterBucketSize` |
| <a id="property-exceptionratelimiterrefillrate"></a> `exceptionRateLimiterRefillRate?` | `number` | ADVANCED: alters the refill rate for the error tracking rate limiter's token bucket. Normally only altered alongside PostHog support guidance. Accepts values between 0 and 100. **Default** `1` | `ExceptionRateLimiterConfig`.`exceptionRateLimiterRefillRate` |

### `ErrorTrackingSuppressionRule`

| Property | Type |
| ------ | ------ |
| <a id="property-type-2"></a> `type` | `"AND"` \| `"OR"` |
| <a id="property-values"></a> `values` | `ErrorTrackingSuppressionRuleValue`[] |

### `ErrorTrackingSuppressionRuleValue`

| Property | Type |
| ------ | ------ |
| <a id="property-key"></a> `key` | `"$exception_types"` \| `"$exception_values"` |
| <a id="property-operator"></a> `operator` | `SurveyMatchType` |
| <a id="property-type-3"></a> `type` | `string` |
| <a id="property-value"></a> `value` | `string` \| `string`[] |

### `EvaluationReason`

> **EvaluationReason** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="code"></a> `code` | `string` |
| <a id="condition_index"></a> `condition_index` | `number` \| `undefined` |
| <a id="description"></a> `description` | `string` \| `undefined` |

### `EventHandler`

> **EventHandler** = (`event`) => `boolean` \| `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | `Event` |

#### Returns

`boolean` \| `void`

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

### `ExceptionRateLimiterConfig`

Shared configuration for the error tracking burst-protection rate limiter.

Burst protection is scoped **per exception type** — the limiter is keyed by exception type, so
each distinct `$exception` type gets its own token bucket and there is no aggregate cap across
all types. It applies only to autocaptured exceptions; manual `captureException` calls are
never rate limited. These options let customers with high-cardinality exception types tune the
per-type allowance, and are shared between the browser and Node SDKs.

#### Extended by

- `ErrorTrackingOptions`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-exceptionratelimiterbucketsize"></a> `exceptionRateLimiterBucketSize?` | `number` | ADVANCED: alters the bucket size for the error tracking rate limiter's token bucket. Normally only altered alongside PostHog support guidance. Accepts values between 0 and 100. **Default** `10` |
| <a id="property-exceptionratelimiterrefillrate"></a> `exceptionRateLimiterRefillRate?` | `number` | ADVANCED: alters the refill rate for the error tracking rate limiter's token bucket. Normally only altered alongside PostHog support guidance. Accepts values between 0 and 100. **Default** `1` |

### `ExceptionStepsConfig`

> **ExceptionStepsConfig** = `object`

Controls buffering and payload limits for exception steps added via `addExceptionStep`.

NOTE: This type is also defined in `@posthog/core` (exception-steps.ts). Keep both in sync.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="enabled"></a> `enabled?` | `boolean` | Determines whether PostHog should collect exception steps and attach them to the next captured exception. **Default** `true` |
| <a id="max_bytes"></a> `max_bytes?` | `number` | The maximum UTF-8 byte budget for exception steps buffered in memory. Oldest steps are evicted when the budget is exceeded. **Default** `32768 (~32KB)` |

### `Extension`

A shared browser extension. The client calls `setup(client)` once to start it
and optional `dispose()` once for final best-effort resource cleanup.
Everything an extension consumes flows through Client.

`setup` may be async so an extension can read async KV state or remote config
before it is ready. Async extensions must guard work after each `await` so
cleanup cannot be followed by late listener, timer, or patch installation.
The disposables an extension creates in setup are its own to release.

An extension that exposes app-facing controls extends `Extension` with named
methods that share its state, e.g.:

```ts
interface SessionReplayExtension extends Extension {
    startRecording(): void
    stopRecording(): void
    isActive(): boolean
}
```

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-bindings"></a> `bindings?` | `readonly` | `Readonly`\<`Record`\<`string`, `Extension`\>\> | Additional lookup targets whose lifecycle belongs to this extension. |
| <a id="property-name-2"></a> `name` | `readonly` | `string` | Stable extension name used for diagnostics and de-duplication within a client instance. |

#### Methods

##### dispose()?

> `optional` **dispose**(): `void`

Release final resources synchronously. Feature-level start/stop remains extension-owned.

###### Returns

`void`

##### flush()?

> `optional` **flush**(`reason?`): `Promise`\<`void`\>

Flush buffered work. Shutdown awaits this within the host's timeout before disposal.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `reason?` | `"shutdown"` \| `"flush"` |

###### Returns

`Promise`\<`void`\>

##### setup()

> **setup**(`client`): `void` \| `Promise`\<`void`\>

Start the extension with the host client's capability surface. Called once
after construction; return a promise when setup needs asynchronous state.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `Client` |

###### Returns

`void` \| `Promise`\<`void`\>

### `ExtensionToken`

> **ExtensionToken**\<`T`\> = `string` & `object`

A typed stable name for resolving an installed extension.

Tokens are plain strings at runtime, so independently compiled scripts can
share them without a registry or object-identity contract. The generic brand
lets `Client.getExtension` infer the extension type. A token's string
value must match an installed extension's stable `name` or one of its `bindings` keys.

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-15"></a> `T` |

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `[extensionTokenType]` | `T` |

### `ExternalIntegrationKind`

> **ExternalIntegrationKind** = `"intercom"` \| `"crispChat"`

### `FeatureFlagDetail`

> **FeatureFlagDetail** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="enabled-1"></a> `enabled` | `boolean` |
| <a id="failed"></a> `failed?` | `boolean` |
| <a id="key"></a> `key` | `string` |
| <a id="metadata"></a> `metadata` | `FeatureFlagMetadata` \| `undefined` |
| <a id="original_enabled"></a> `original_enabled?` | `boolean` |
| <a id="original_variant"></a> `original_variant?` | `string` |
| <a id="reason"></a> `reason` | `EvaluationReason` \| `undefined` |
| <a id="variant"></a> `variant` | `string` \| `undefined` |

### `FeatureFlagMetadata`

> **FeatureFlagMetadata** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="description-1"></a> `description` | `string` \| `undefined` | - |
| <a id="has_experiment"></a> `has_experiment?` | `boolean` | Whether the flag is linked to an experiment. Absent when the server does not report it. |
| <a id="id"></a> `id` | `number` | - |
| <a id="original_payload"></a> `original_payload?` | `JsonType` | - |
| <a id="payload"></a> `payload` | `JsonType` \| `undefined` | - |
| <a id="version-1"></a> `version` | `number` \| `undefined` | - |

### `FeatureFlagOptions`

> **FeatureFlagOptions** = `object`

Options for feature flag lookup methods (getFeatureFlag, isFeatureEnabled, getFeatureFlagResult).

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="fresh"></a> `fresh?` | `boolean` | If true, only return values loaded from the server, not cached localStorage values. Returns undefined if flags haven't been loaded from the server yet. Defaults to false. |
| <a id="send_event"></a> `send_event?` | `boolean` | Whether to send a $feature_flag_called event. Defaults to true. |

### `FeatureFlagOverrideOptions`

> **FeatureFlagOverrideOptions** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="flags"></a> `flags?` | `boolean` \| `string`[] \| `FeatureFlagOverrides` |
| <a id="payloads"></a> `payloads?` | `FeatureFlagPayloadOverrides` |
| <a id="suppresswarning"></a> `suppressWarning?` | `boolean` |

### `FeatureFlagOverrides`

> **FeatureFlagOverrides** = `object`

#### Index Signature

\[`flagName`: `string`\]: `string` \| `boolean`

### `FeatureFlagPayloadOverrides`

> **FeatureFlagPayloadOverrides** = `object`

#### Index Signature

\[`flagName`: `string`\]: `JsonType`

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

### `FeatureFlagsConfig`

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-bootstrap"></a> `bootstrap` | `readonly` | `object` |
| `bootstrap.featureFlagPayloads?` | `readonly` | `Readonly`\<`Record`\<`string`, `JsonType`\>\> |
| `bootstrap.featureFlags?` | `readonly` | `Readonly`\<`Record`\<`string`, `string` \| `boolean`\>\> |
| <a id="property-cachettlms"></a> `cacheTtlMs?` | `readonly` | `number` |
| <a id="property-compression"></a> `compression?` | `readonly` | `Compression` \| `"best-available"` |
| <a id="property-deduplicatecallspersession"></a> `deduplicateCallsPerSession` | `readonly` | `boolean` |
| <a id="property-evaluationcontexts"></a> `evaluationContexts` | `readonly` | readonly `string`[] |
| <a id="property-featureflagsdisabled"></a> `featureFlagsDisabled` | `readonly` | `boolean` |
| <a id="property-flagkeys"></a> `flagKeys?` | `readonly` | readonly `string`[] |
| <a id="property-idlerefreshbackoff"></a> `idleRefreshBackoff` | `readonly` | `boolean` |
| <a id="property-onlyevaluatesurveyfeatureflags"></a> `onlyEvaluateSurveyFeatureFlags` | `readonly` | `boolean` |
| <a id="property-refreshintervalms"></a> `refreshIntervalMs?` | `readonly` | `number` |
| <a id="property-remoterequestsdisabled-1"></a> `remoteRequestsDisabled` | `readonly` | `boolean` |
| <a id="property-requestmaxretries"></a> `requestMaxRetries?` | `readonly` | `number` |
| <a id="property-requesttimeoutms"></a> `requestTimeoutMs` | `readonly` | `number` |

### `FeatureFlagsConfigSource`

##### get()

> **get**(): `Readonly`\<`FeatureFlagsConfig`\>

###### Returns

`Readonly`\<`FeatureFlagsConfig`\>

### `FeatureFlagsReloadResult`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-status"></a> `status` | `"loaded"` \| `"error"` \| `"skipped"` \| `"cancelled"` | loaded: evaluation completed; error: request/evaluation failed; skipped: evaluation unavailable; cancelled: reset/disposal. |

### `FlagsResponse`

Flags returns feature flags and their payloads

#### Extends

- `RemoteConfig`

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-analytics"></a> `analytics?` | `object` | Custom endpoint configuration for analytics events. | `RemoteConfig`.`analytics` |
| `analytics.endpoint?` | `string` | - | - |
| <a id="property-autocapture_opt_out"></a> `autocapture_opt_out?` | `boolean` | If true, disables autocapture. When absent or not a boolean, the SDK keeps the last known server value; a visitor with no stored value keeps autocapture off until a response containing the field arrives. | `RemoteConfig`.`autocapture_opt_out` |
| <a id="property-autocaptureexceptions"></a> `autocaptureExceptions?` | `boolean` \| \{ `endpoint?`: `string`; \} | Exception autocapture configuration. | `RemoteConfig`.`autocaptureExceptions` |
| <a id="property-capturedeadclicks"></a> `captureDeadClicks?` | `boolean` | Whether to capture dead clicks. | `RemoteConfig`.`captureDeadClicks` |
| <a id="property-captureperformance"></a> `capturePerformance?` | `boolean` \| `PerformanceCaptureConfig` | Performance capture configuration shared by replay and web vitals. | `RemoteConfig`.`capturePerformance` |
| <a id="property-conversations"></a> `conversations?` | `boolean` \| `ConversationsRemoteConfig` | Conversations widget configuration. | `RemoteConfig`.`conversations` |
| <a id="property-defaultidentifiedonly"></a> `defaultIdentifiedOnly?` | `boolean` | Whether to capture only identified users by default. | `RemoteConfig`.`defaultIdentifiedOnly` |
| <a id="property-editorparams"></a> ~~`editorParams?`~~ | `ToolbarParams` | **Deprecated** Renamed to `toolbarParams`; still present on older API responses. | `RemoteConfig`.`editorParams` |
| <a id="property-elementschainasstring"></a> `elementsChainAsString?` | `boolean` | Whether `$elements_chain` is sent as a string rather than an array. | `RemoteConfig`.`elementsChainAsString` |
| <a id="property-errorswhilecomputingflags"></a> `errorsWhileComputingFlags` | `boolean` | - | - |
| <a id="property-errortracking"></a> `errorTracking?` | `object` | Error tracking configuration. | `RemoteConfig`.`errorTracking` |
| `errorTracking.autocaptureExceptions?` | `boolean` | - | - |
| `errorTracking.captureExtensionExceptions?` | `boolean` | - | - |
| `errorTracking.suppressionRules?` | `ErrorTrackingSuppressionRule`[] | - | - |
| <a id="property-evaluatedat"></a> `evaluatedAt?` | `number` | - | - |
| <a id="property-featureflagpayloads-1"></a> `featureFlagPayloads` | `Record`\<`string`, `JsonType`\> | - | - |
| <a id="property-featureflags-1"></a> `featureFlags` | `Record`\<`string`, `string` \| `boolean`\> | - | - |
| <a id="property-flags-1"></a> `flags` | `Record`\<`string`, `FeatureFlagDetail`\> | - | - |
| <a id="property-hasfeatureflags"></a> `hasFeatureFlags?` | `boolean` | Whether the team has any feature flags enabled. | `RemoteConfig`.`hasFeatureFlags` |
| <a id="property-heatmaps"></a> `heatmaps?` | `boolean` | Whether heatmaps are enabled. | `RemoteConfig`.`heatmaps` |
| <a id="property-isauthenticated"></a> `isAuthenticated` | `boolean` | Whether the current user is authenticated. | `RemoteConfig`.`isAuthenticated` |
| <a id="property-logs"></a> `logs?` | `object` | Log capture configuration. | `RemoteConfig`.`logs` |
| `logs.captureConsoleLogs?` | `boolean` | - | - |
| <a id="property-minimalflagcalledevents"></a> `minimalFlagCalledEvents?` | `boolean` | Server-controlled gate for minimal `$feature_flag_called` events. `true` only when the project opted in; omitted otherwise. Absence always means full events. | - |
| <a id="property-producttours"></a> `productTours?` | `boolean` | Whether product tours are enabled. | `RemoteConfig`.`productTours` |
| <a id="property-requestid"></a> `requestId?` | `string` | - | - |
| <a id="property-sessionrecording"></a> `sessionRecording?` | `false` \| `SessionRecordingRemoteConfig` | Session recording configuration. | `RemoteConfig`.`sessionRecording` |
| <a id="property-siteapps"></a> `siteApps` | `object`[] | Site apps available to the client. | `RemoteConfig`.`siteApps` |
| <a id="property-supportedcompression"></a> `supportedCompression` | `Compression`[] | Supported compression algorithms. | `RemoteConfig`.`supportedCompression` |
| <a id="property-surveys"></a> `surveys?` | `boolean` \| `Survey`[] | Whether surveys are enabled, optionally including their definitions. | `RemoteConfig`.`surveys` |
| <a id="property-toolbarparams"></a> `toolbarParams` | `ToolbarParams` | Parameters for the toolbar. | `RemoteConfig`.`toolbarParams` |
| <a id="property-toolbarversion"></a> ~~`toolbarVersion`~~ | `"toolbar"` | **Deprecated** Moved to `toolbarParams`. | `RemoteConfig`.`toolbarVersion` |

### `FlagVariant`

> **FlagVariant** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="flag"></a> `flag` | `string` |
| <a id="variant-2"></a> `variant` | `string` |

### `GetMessagesResponse`

Response from fetching messages

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-has_more"></a> `has_more` | `boolean` | Whether there are more messages to fetch |
| <a id="property-messages"></a> `messages` | `Message`[] | Array of messages |
| <a id="property-ticket_id"></a> `ticket_id` | `string` | ID of the ticket |
| <a id="property-ticket_status"></a> `ticket_status` | `TicketStatus` | Current status of the ticket |
| <a id="property-unread_count"></a> `unread_count` | `number` | Number of unread messages from the team |

### `GetTicketsOptions`

Options for fetching tickets list

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-limit"></a> `limit?` | `number` | Number of tickets to return (default: 20) |
| <a id="property-offset"></a> `offset?` | `number` | Pagination offset (default: 0) |
| <a id="property-status"></a> `status?` | `string` | Filter by ticket status (e.g., 'open', 'closed') |

### `GetTicketsResponse`

Response from fetching tickets list

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-count"></a> `count` | `number` | Total count of tickets |
| <a id="property-results"></a> `results` | `Ticket`[] | Array of tickets |

### `Headers`

> **Headers** = `Record`\<`string`, `string`\>

Request-related types

### `HeatmapConfig`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-flush_interval_milliseconds"></a> `flush_interval_milliseconds` | `number` | How often to send batched data in `$heatmap_data` events If set to 0 or not set, sends using the default interval of 1 second **Default** `1000` |

### `HistogramOptions`

Options accepted by `posthog.metrics.histogram`.

#### Extends

- `CaptureMetricOptions`

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-attributes-2"></a> `attributes?` | `MetricAttributes` | Low-cardinality dimensions to filter and group by (e.g. route, plan, region). Each distinct combination is its own series. | `CaptureMetricOptions`.`attributes` |
| <a id="property-bounds"></a> `bounds?` | `number`[] | Upper bucket boundaries, finite and strictly increasing. A value lands in the first bucket whose boundary is greater than or equal to it, and values above the last boundary land in an overflow bucket. Defaults to the OpenTelemetry defaults `[0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000]`. The first sample of a histogram (name and unit) fixes its bounds until the client resets. A later sample that passes different bounds is recorded in the fixed buckets and logs a warning, once per flush window. A sample with invalid bounds is dropped with a warning. The client fixes the bounds of at most `maxSeriesPerFlush` histograms. Past that limit, the client drops samples of a new histogram that pass bounds other than the defaults, and logs one warning. Each client fixes bounds on its own. PostHog stores one set of bounds per histogram series and reads every client's counts against it. Every client must therefore pass the same bounds for the same histogram. | - |
| <a id="property-unit-1"></a> `unit?` | `string` | Unit of the value (e.g. 'ms', 'byte'). Displayed in the Metrics UI and part of the series identity — the same name with two units is two series. | `CaptureMetricOptions`.`unit` |

### `InferredSelector`

| Property | Type |
| ------ | ------ |
| <a id="property-autodata"></a> `autoData` | `string` |
| <a id="property-excludetext"></a> `excludeText?` | `boolean` |
| <a id="property-precision"></a> `precision?` | `number` |
| <a id="property-text-1"></a> `text` | `string` \| `null` |

### `InitiatorType`

> **InitiatorType** = `"audio"` \| `"beacon"` \| `"body"` \| `"css"` \| `"early-hint"` \| `"embed"` \| `"fetch"` \| `"frame"` \| `"iframe"` \| `"icon"` \| `"image"` \| `"img"` \| `"input"` \| `"link"` \| `"navigation"` \| `"object"` \| `"ping"` \| `"script"` \| `"track"` \| `"video"` \| `"xmlhttprequest"`

### `IsFeatureEnabledOptions`

> **IsFeatureEnabledOptions** = `FeatureFlagOptions` & `object`

Options for isFeatureEnabled.

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `defaultValue?` | `boolean` | Value to return when the flag has no value, e.g. flags have not loaded yet or no flag with that key exists. |

### `JSONContent`

| Property | Type |
| ------ | ------ |
| <a id="property-attrs"></a> `attrs?` | `Record`\<`string`, `any`\> |
| <a id="property-content"></a> `content?` | `JSONContent`[] |
| <a id="property-marks"></a> `marks?` | `object`[] |
| <a id="property-text-3"></a> `text?` | `string` |
| <a id="property-type-4"></a> `type?` | `string` |

### `JsonRecord`

> **JsonRecord** = `object`

#### Index Signature

\[`key`: `string`\]: `JsonType`

### `JsonType`

> **JsonType** = `string` \| `number` \| `boolean` \| `null` \| `undefined` \| `JsonRecord` \| `JsonType`[]

### `KeyValueStore`

Key-value store for small extension state. A host may initialize an asynchronous
backend before exposing synchronous operations over its in-memory buffer. Writes
must update that buffer before returning; ordered durable flushing remains the
host's responsibility. Reads treat `undefined` values as absent.

Keys map verbatim to the host client's shared persistence. In browser-v1,
unknown keys are normally included as event properties, collisions overwrite
host/core state, and reset clears them. Every SDK-owned key therefore needs an
explicit event/hidden/derived exposure policy in each host, and sensitive data
must not be stored unless its transmission is approved. Values must be
JSON-serializable.

#### Methods

##### get()

###### Call Signature

> **get**\<`T`\>(`keys`): `Partial`\<`T`\>

Read several initialized values in one operation. Missing keys are omitted.

###### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-7"></a> `T` *extends* `object` |

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `keys` | readonly (keyof `T` & `string`)[] |

###### Returns

`Partial`\<`T`\>

###### Call Signature

> **get**\<`T`\>(`key`): `T` \| `undefined`

Read one initialized value by key, returning `undefined` when it is missing.

###### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| <a id="type-parameter-t-8"></a> `T` | `unknown` |

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |

###### Returns

`T` \| `undefined`

##### initialize()

> **initialize**(): `void` \| `Promise`\<`void`\>

Populate the in-memory buffer from durable storage. Calls are idempotent.

###### Returns

`void` \| `Promise`\<`void`\>

##### remove()

> **remove**(`keyOrKeys`): `void`

Remove one or several values from the initialized buffer in one operation.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `keyOrKeys` | `string` \| readonly `string`[] |

###### Returns

`void`

##### set()

###### Call Signature

> **set**(`key`, `value`): `void`

Immediately update the initialized buffer. `null` is durable; `undefined` is
accepted for compatibility but treated as absent by reads and is not portable.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |
| `value` | `unknown` |

###### Returns

`void`

###### Call Signature

> **set**(`values`): `void`

Coherently update several related values in the initialized buffer.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `values` | `Record`\<`string`, `unknown`\> |

###### Returns

`void`

### `KnownEventName`

> **KnownEventName** = `"$heatmaps_data"` \| `"$opt_in"` \| `"$exception"` \| `"$$heatmap"` \| `"$web_vitals"` \| `"$dead_click"` \| `"$dead_swipe"` \| `"$autocapture"` \| `"$copy_autocapture"` \| `"$rageclick"`

These are known events PostHog events that can be processed by the `beforeCapture` function
That means PostHog functionality does not rely on receiving 100% of these for calculations
So, it is safe to sample them to reduce the volume of events sent to PostHog

### `KnownUnsafeEditableEvent`

> **KnownUnsafeEditableEvent** = *typeof* `knownUnsafeEditableEvent`\[`number`\]

These events can be processed by the `beforeCapture` function
but can cause unexpected confusion in data.

Some features of PostHog rely on receiving 100% of these events

### `KnownUnsafeEditableEvent`

> **KnownUnsafeEditableEvent** = `"$set"` \| `"$pageview"` \| `"$pageleave"` \| `"$identify"` \| `"$groupidentify"` \| `"$create_alias"` \| `"$feature_flag_called"`

Known events that can be safely edited in beforeCapture without breaking PostHog functionality

### `LinkSurveyQuestion`

- `SurveyQuestionBase`

#### Properties

| Property | Type | Inherited from |
| ------ | ------ | ------ |
| <a id="property-branching-1"></a> `branching?` | `NextQuestionBranching` \| `EndBranching` \| `ResponseBasedBranching` \| `SpecificQuestionBranching` | `SurveyQuestionBase`.`branching` |
| <a id="property-buttontext-1"></a> `buttonText?` | `string` | `SurveyQuestionBase`.`buttonText` |
| <a id="property-description-2"></a> `description?` | `string` \| `null` | `SurveyQuestionBase`.`description` |
| <a id="property-descriptioncontenttype-1"></a> `descriptionContentType?` | `SurveyQuestionDescriptionContentType` | `SurveyQuestionBase`.`descriptionContentType` |
| <a id="property-id-1"></a> `id?` | `string` | `SurveyQuestionBase`.`id` |
| <a id="property-link"></a> `link?` | `string` \| `null` | - |
| <a id="property-optional-1"></a> `optional?` | `boolean` | `SurveyQuestionBase`.`optional` |
| <a id="property-question-1"></a> `question` | `string` | `SurveyQuestionBase`.`question` |
| <a id="property-translations-1"></a> `translations?` | `Record`\<`string`, `SurveyQuestionTranslation`\> | `SurveyQuestionBase`.`translations` |
| <a id="property-type-5"></a> `type` | `"link"` | - |
| <a id="property-validation-1"></a> `validation?` | `SurveyValidationRule`[] | `SurveyQuestionBase`.`validation` |

### `Listener`

> **Listener**\<`T`\> = (`handler`) => `Disposable`

Call it with a handler to start listening; dispose the returned
Disposable to stop. There is one `Listener` per event type, so every
event carries its own payload type. The handler is called synchronously, and
stateful listeners may replay their current value during registration when
documented. The returned disposable unregisters it from future payloads.

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-16"></a> `T` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `handler` | (`payload`) => `void` |

#### Returns

`Disposable`

### `LogAttributes`

> **LogAttributes** = `Record`\<`string`, `LogAttributeValue`\>

### `LogAttributeValue`

> **LogAttributeValue** = `string` \| `number` \| `boolean` \| `null` \| `undefined` \| `unknown`[] \| `Record`\<`string`, `unknown`\>

### `LogCaptureOptions`

Options for the captureLog API and posthog.logger convenience methods.

#### Extended by

- `LogsConfig`
- `BrowserLogsConfig`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-beforesend-1"></a> `beforeSend?` | `BeforeSendLogFn` \| `BeforeSendLogFn`[] | Pre-send filter for log records, as a single function or a left-to-right chain. Each function inspects, mutates, or drops a record (return `null` to drop) before it enters the rate cap or the buffer. |
| <a id="property-environment-1"></a> `environment?` | `string` | The deployment environment for log records (e.g. 'production', 'staging'). Maps to the OTel resource attribute 'deployment.environment'. |
| <a id="property-flushintervalms-1"></a> `flushIntervalMs?` | `number` | Flush interval in milliseconds for batched log records. **Default** `3000` |
| <a id="property-maxbuffersize-1"></a> `maxBufferSize?` | `number` | Maximum number of log records to buffer before forcing a flush. The queue may grow beyond this while a flush is in flight (e.g. during a synchronous burst) and is bounded separately by the per-interval rate cap. **Default** `100` |
| <a id="property-maxlogsperinterval-1"></a> `maxLogsPerInterval?` | `number` | Maximum number of log records accepted per flush interval. Subsequent calls within the same window are dropped with a single warning, protecting against runaway loggers flooding the network. Also sizes the in-memory buffer's eviction backstop, so a window's worth of records is held while a flush is in flight; raising it raises the worst-case in-memory footprint. **Default** `1000` |
| <a id="property-resourceattributes-1"></a> `resourceAttributes?` | `LogAttributes` | Additional resource attributes applied to all log records. These describe the service/deployment, not individual log entries. Named fields (serviceName, environment, serviceVersion) are set first; resourceAttributes can override them. **Example** `{ 'host.name': 'web-01', 'cloud.region': 'us-east-1' }` |
| <a id="property-servicename-1"></a> `serviceName?` | `string` | The service name for log records. Maps to the OTel resource attribute 'service.name'. **Default** `'unknown_service'` |
| <a id="property-serviceversion-1"></a> `serviceVersion?` | `string` | The service version for log records (e.g. '1.2.3'). Maps to the OTel resource attribute 'service.version'. |

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

### `Logger`

> **Logger** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="createlogger"></a> `createLogger` | (`prefix`) => `Logger` |
| <a id="critical"></a> `critical` | (...`args`) => `void` |
| <a id="debug-1"></a> `debug` | (...`args`) => `void` |
| <a id="error"></a> `error` | (...`args`) => `void` |
| <a id="info"></a> `info` | (...`args`) => `void` |
| <a id="warn"></a> `warn` | (...`args`) => `void` |

### `LogsConfig`

Logs configuration options

#### Extends

- `LogCaptureOptions`

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-beforesend-2"></a> `beforeSend?` | `BeforeSendLogFn` \| `BeforeSendLogFn`[] | Pre-send filter for log records, as a single function or a left-to-right chain. Each function inspects, mutates, or drops a record (return `null` to drop) before it enters the rate cap or the buffer. | `LogCaptureOptions`.`beforeSend` |
| <a id="property-captureconsolelogs-1"></a> `captureConsoleLogs?` | `boolean` | Automatically capture `console.*` calls as structured log records. Review console output before enabling, as messages can include sensitive values written by your code or by third-party libraries. **Default** `undefined` | - |
| <a id="property-environment-2"></a> `environment?` | `string` | The deployment environment for log records (e.g. 'production', 'staging'). Maps to the OTel resource attribute 'deployment.environment'. | `LogCaptureOptions`.`environment` |
| <a id="property-flushintervalms-2"></a> `flushIntervalMs?` | `number` | Flush interval in milliseconds for batched log records. **Default** `3000` | `LogCaptureOptions`.`flushIntervalMs` |
| <a id="property-maxbuffersize-2"></a> `maxBufferSize?` | `number` | Maximum number of log records to buffer before forcing a flush. The queue may grow beyond this while a flush is in flight (e.g. during a synchronous burst) and is bounded separately by the per-interval rate cap. **Default** `100` | `LogCaptureOptions`.`maxBufferSize` |
| <a id="property-maxlogsperinterval-2"></a> `maxLogsPerInterval?` | `number` | Maximum number of log records accepted per flush interval. Subsequent calls within the same window are dropped with a single warning, protecting against runaway loggers flooding the network. Also sizes the in-memory buffer's eviction backstop, so a window's worth of records is held while a flush is in flight; raising it raises the worst-case in-memory footprint. **Default** `1000` | `LogCaptureOptions`.`maxLogsPerInterval` |
| <a id="property-resourceattributes-2"></a> `resourceAttributes?` | `LogAttributes` | Additional resource attributes applied to all log records. These describe the service/deployment, not individual log entries. Named fields (serviceName, environment, serviceVersion) are set first; resourceAttributes can override them. **Example** `{ 'host.name': 'web-01', 'cloud.region': 'us-east-1' }` | `LogCaptureOptions`.`resourceAttributes` |
| <a id="property-servicename-2"></a> `serviceName?` | `string` | The service name for log records. Maps to the OTel resource attribute 'service.name'. **Default** `'unknown_service'` | `LogCaptureOptions`.`serviceName` |
| <a id="property-serviceversion-2"></a> `serviceVersion?` | `string` | The service version for log records (e.g. '1.2.3'). Maps to the OTel resource attribute 'service.version'. | `LogCaptureOptions`.`serviceVersion` |

### `LogSdkContext`

SDK-internal context the host SDK passes to `buildOtlpLogRecord` at capture
time. Each SDK populates the fields that apply to it: browser fills
`currentUrl`, mobile fills `screenName` / `appState`. Missing fields are
omitted from the OTLP record (no stray attributes).

Internal to `@posthog/core` — customers don't see this in autocomplete.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-activefeatureflags"></a> `activeFeatureFlags?` | `string`[] | - |
| <a id="property-appstate"></a> `appState?` | `"foreground"` \| `"background"` | Mobile-only — app foreground/background state at capture time |
| <a id="property-currenturl"></a> `currentUrl?` | `string` | Web-only — current page URL |
| <a id="property-distinctid-1"></a> `distinctId?` | `string` | - |
| <a id="property-lastactivitytimestamp"></a> `lastActivityTimestamp?` | `number` | Web-only — ms epoch of the most recent session activity |
| <a id="property-screenname"></a> `screenName?` | `string` | Mobile-only — current screen / view name |
| <a id="property-sessionid-1"></a> `sessionId?` | `string` | - |
| <a id="property-sessionstarttimestamp"></a> `sessionStartTimestamp?` | `number` | Web-only — ms epoch when the current session started |
| <a id="property-windowid"></a> `windowId?` | `string` | Web-only — current window id |

### `LogSeverityLevel`

> **LogSeverityLevel** = `"trace"` \| `"debug"` \| `"info"` \| `"warn"` \| `"error"` \| `"fatal"`

Log capture types

### `MarkAsReadResponse`

Response from marking messages as read

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-success"></a> `success` | `boolean` | Whether the operation was successful |
| <a id="property-unread_count-1"></a> `unread_count` | `number` | Number of unread messages (should be 0 after marking as read) |

### `MaskInputOptions`

Mask input options for session recording

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-color-1"></a> `color?` | `boolean` |
| <a id="property-date"></a> `date?` | `boolean` |
| <a id="property-datetime-local"></a> `datetime-local?` | `boolean` |
| <a id="property-email-1"></a> `email?` | `boolean` |
| <a id="property-hidden"></a> `hidden?` | `boolean` |
| <a id="property-month"></a> `month?` | `boolean` |
| <a id="property-number"></a> `number?` | `boolean` |
| <a id="property-password"></a> `password?` | `boolean` |
| <a id="property-range"></a> `range?` | `boolean` |
| <a id="property-search-1"></a> `search?` | `boolean` |
| <a id="property-select"></a> `select?` | `boolean` |
| <a id="property-tel"></a> `tel?` | `boolean` |
| <a id="property-text-4"></a> `text?` | `boolean` |
| <a id="property-textarea"></a> `textarea?` | `boolean` |
| <a id="property-time"></a> `time?` | `boolean` |
| <a id="property-url-1"></a> `url?` | `boolean` |
| <a id="property-week"></a> `week?` | `boolean` |

### `Message`

A message in a conversation

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-author_name"></a> `author_name?` | `string` | Display name of the message author |
| <a id="property-author_type"></a> `author_type` | `MessageAuthorType` | Type of the message author |
| <a id="property-content-1"></a> `content` | `string` | The message content as plain text (fallback) |
| <a id="property-created_at"></a> `created_at` | `string` | ISO timestamp when the message was created |
| <a id="property-id-2"></a> `id` | `string` | Unique identifier for the message |
| <a id="property-is_private"></a> `is_private` | `boolean` | Whether this is an internal note (not shown to customer) |
| <a id="property-rich_content"></a> `rich_content?` | `TipTapDoc` | Rich content in TipTap JSON format (preferred for rendering) Falls back to `content` if missing or invalid |

### `MessageAuthorType`

> **MessageAuthorType** = `"customer"` \| `"AI"` \| `"human"`

Author types for messages in a conversation

### `MetricAttributes`

> **MetricAttributes** = `Record`\<`string`, `MetricAttributeValue`\>

### `MetricAttributeValue`

> **MetricAttributeValue** = `string` \| `number` \| `boolean`

Metric attribute values are restricted to scalars. Every distinct
attribute-value combination creates a new metric series, so high-cardinality
values (user IDs, request IDs, URLs) must not be used as attributes — put
those on logs or events instead.

### `MetricSample`

A captured metric as seen by `beforeSend`, before aggregation. Mutating
`name`, `value`, `unit`, `attributes`, or `bounds` changes what gets aggregated;
returning `null` drops the sample.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attributes-3"></a> `attributes?` | `MetricAttributes` | - |
| <a id="property-bounds-1"></a> `bounds?` | `number`[] | Histogram bucket boundaries. See HistogramOptions.bounds. Only histograms use them. |
| <a id="property-name-2"></a> `name` | `string` | - |
| <a id="property-type-6"></a> `type` | `MetricType` | - |
| <a id="property-unit-2"></a> `unit?` | `string` | - |
| <a id="property-value-1"></a> `value` | `number` | - |

### `MetricsConfig`

Options for the posthog.metrics API (count, gauge, histogram).
Shared by every SDK; browser-only options live in `BrowserMetricsConfig`.

#### Extended by

- `BrowserMetricsConfig`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-beforesend-1"></a> `beforeSend?` | `BeforeSendMetricFn` \| `BeforeSendMetricFn`[] | Pre-aggregation filter for metric samples, as a single function or a left-to-right chain. Each function inspects, mutates, or drops a sample (return `null` to drop) before it is aggregated. |
| <a id="property-environment-1"></a> `environment?` | `string` | The deployment environment for metric series (e.g. 'production', 'staging'). Maps to the OTel resource attribute 'deployment.environment'. |
| <a id="property-flushintervalms-1"></a> `flushIntervalMs?` | `number` | How often the aggregated window is flushed, in milliseconds. Samples are folded into per-series aggregates in memory between flushes — one data point per series per window, no matter how many calls. **Default** `10000` |
| <a id="property-maxseriesperflush-1"></a> `maxSeriesPerFlush?` | `number` | Cardinality guardrail: maximum distinct series (name + type + unit + attribute combination) held per flush window. Samples for series beyond the cap are dropped with a single warning per window. **Default** `1000` |
| <a id="property-resourceattributes-1"></a> `resourceAttributes?` | `MetricAttributes` | Additional resource attributes applied to every metrics batch. These describe the service/deployment, not individual series. Named fields (serviceName, environment, serviceVersion) are set first; resourceAttributes can override them. **Example** `{ 'host.name': 'web-01', 'cloud.region': 'us-east-1' }` |
| <a id="property-servicename-1"></a> `serviceName?` | `string` | The service name for metric series. Maps to the OTel resource attribute 'service.name'. **Default** `'unknown_service'` |
| <a id="property-serviceversion-1"></a> `serviceVersion?` | `string` | The service version for metric series (e.g. '1.2.3'). Maps to the OTel resource attribute 'service.version'. |

### `MetricType`

> **MetricType** = `"count"` \| `"gauge"` \| `"histogram"`

### `MultipleSurveyQuestion`

- `SurveyQuestionBase`

#### Properties

| Property | Type | Inherited from |
| ------ | ------ | ------ |
| <a id="property-branching-2"></a> `branching?` | `NextQuestionBranching` \| `EndBranching` \| `ResponseBasedBranching` \| `SpecificQuestionBranching` | `SurveyQuestionBase`.`branching` |
| <a id="property-buttontext-2"></a> `buttonText?` | `string` | `SurveyQuestionBase`.`buttonText` |
| <a id="property-choices"></a> `choices` | `string`[] | - |
| <a id="property-description-3"></a> `description?` | `string` \| `null` | `SurveyQuestionBase`.`description` |
| <a id="property-descriptioncontenttype-2"></a> `descriptionContentType?` | `SurveyQuestionDescriptionContentType` | `SurveyQuestionBase`.`descriptionContentType` |
| <a id="property-hasopenchoice"></a> `hasOpenChoice?` | `boolean` | - |
| <a id="property-id-3"></a> `id?` | `string` | `SurveyQuestionBase`.`id` |
| <a id="property-optional-2"></a> `optional?` | `boolean` | `SurveyQuestionBase`.`optional` |
| <a id="property-question-2"></a> `question` | `string` | `SurveyQuestionBase`.`question` |
| <a id="property-shuffleoptions"></a> `shuffleOptions?` | `boolean` | - |
| <a id="property-skipsubmitbutton"></a> `skipSubmitButton?` | `boolean` | - |
| <a id="property-translations-2"></a> `translations?` | `Record`\<`string`, `SurveyQuestionTranslation`\> | `SurveyQuestionBase`.`translations` |
| <a id="property-type-7"></a> `type` | `"multiple_choice"` \| `"single_choice"` | - |
| <a id="property-validation-2"></a> `validation?` | `SurveyValidationRule`[] | `SurveyQuestionBase`.`validation` |

### `NetworkMetricsConfig`

Options for automatic HTTP and HTTPS `fetch` and `XMLHttpRequest` duration
metrics. Recording never changes the request or its settlement. Fetch returns
a derived promise so rejected requests remain observable to the caller.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attributes-4"></a> `attributes?` | (`request`, `response`) => `MetricAttributes` \| `undefined` | Adds attributes to each recorded request. The result is merged over the default attributes, so it can also replace them, e.g. to set `url.template` to a route template. Keep attribute values low-cardinality. The default attributes follow the OTel HTTP client semantic conventions: `http.request.method`, `server.address`, `server.port`, `url.scheme`, `url.template`, `http.response.status_code` and `error.type`. The default `url.template` replaces each all-digit or uuid-like path segment with `:id`. Ids that carry a prefix or suffix, such as `order-123` or `38217.pdf`, are kept as they are, so return your own `url.template` for those routes. `http.response.status_code` is only set when a response arrived. `error.type` is the status code for a 4xx or 5xx response, the error name (e.g. `TypeError`) for a rejected fetch, or `_OTHER` when no response arrived and there is no error. |
| <a id="property-name-3"></a> `name?` | `string` \| ((`request`) => `string` \| `null` \| `undefined`) | The metric name. A string is used for every request. A function is called once per request; return a falsy value to skip that request. **Default** `'http.client.request.duration'` |

### `NetworkMetricsRequest`

The request a network metric describes.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-method"></a> `method` | `string` | The HTTP method in upper case, e.g. 'GET'. |
| <a id="property-url-2"></a> `url` | `string` | The full request URL, including the query string. |

### `NetworkMetricsResponse`

How a network request ended.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-durationms"></a> `durationMs` | `number` | How long the request took, in milliseconds. The end boundary follows the transport: a `fetch` is measured to its response headers, an `XMLHttpRequest` to the end of its response body. |
| <a id="property-status-1"></a> `status` | `number` \| `undefined` | The HTTP status code. `undefined` when the request failed before a response arrived. |

### `NetworkRecordOptions`

> **NetworkRecordOptions** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="initiatortypes"></a> `initiatorTypes?` | `InitiatorType`[] | - |
| <a id="maskrequestfn"></a> `maskRequestFn?` | (`data`) => `CapturedNetworkRequest` \| `undefined` | - |
| <a id="payloadhostdenylist"></a> `payloadHostDenyList?` | `string`[] | some domains we should never record the payload for example other companies session replay ingestion payloads aren't super useful but are gigantic if this isn't provided we use a default list if this is provided - we add the provided list to the default list i.e. we never record the payloads on the default deny list |
| <a id="payloadsizelimitbytes"></a> `payloadSizeLimitBytes` | `number` | the maximum size of the request/response body to record NB this will be at most 1MB even if set larger |
| <a id="performanceentrytypetoobserve"></a> `performanceEntryTypeToObserve` | `string`[] | the PerformanceObserver will only observe these entry types |
| <a id="recordbody"></a> `recordBody?` | `boolean` \| `string`[] \| \{ `request`: `boolean` \| `string`[]; `response`: `boolean` \| `string`[]; \} | - |
| <a id="recordheaders"></a> `recordHeaders?` | `boolean` \| \{ `request`: `boolean`; `response`: `boolean`; \} | - |
| <a id="recordinitialrequests"></a> `recordInitialRequests?` | `boolean` | - |
| <a id="recordperformance"></a> `recordPerformance?` | `boolean` | whether to record PerformanceEntry events for network requests |
| <a id="streamnetworkbody"></a> `streamNetworkBody?` | `boolean` | when true, read bodies through a streaming reader that stops at payloadSizeLimitBytes instead of buffering the whole body and then enforcing the limit. Reads only a clone of the body, so it never consumes the stream the page itself reads. **Default** `false` |

### `NetworkRequest`

> **NetworkRequest** = `object`

#### Deprecated

- use CapturedNetworkRequest instead

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="url"></a> ~~`url`~~ | `string` |

### `NextOptions`

> **NextOptions** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="revalidate-1"></a> `revalidate` | `false` \| `0` \| `number` |
| <a id="tags-1"></a> `tags` | `string`[] |

### `NextOptions`

> **NextOptions** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="revalidate"></a> `revalidate` | `false` \| `0` \| `number` |
| <a id="tags"></a> `tags` | `string`[] |

### `NextQuestionBranching`

| Property | Type |
| ------ | ------ |
| <a id="property-type-5"></a> `type` | `"next_question"` |

### `OtlpAnyValue`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-arrayvalue"></a> `arrayValue?` | `object` | - |
| `arrayValue.values` | `OtlpAnyValue`[] | - |
| <a id="property-boolvalue"></a> `boolValue?` | `boolean` | - |
| <a id="property-doublevalue"></a> `doubleValue?` | `number` | - |
| <a id="property-intvalue"></a> `intValue?` | `string` \| `number` | proto3 JSON maps int64 to a string, which is the form the SDK emits. `number` stays valid because encoded records persist in the logs queue: one written by an earlier version rehydrates in the numeric form and is re-sent unchanged. The wire format accepts both. |
| <a id="property-kvlistvalue"></a> `kvlistValue?` | `object` | - |
| `kvlistValue.values` | `OtlpKeyValue`[] | - |
| <a id="property-stringvalue"></a> `stringValue?` | `string` | - |

### `OtlpExemplar`

A sampled measurement linked to the span it was recorded in. IDs are lowercase hex.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-asdouble"></a> `asDouble` | `number` |
| <a id="property-filteredattributes"></a> `filteredAttributes` | `OtlpKeyValue`[] |
| <a id="property-spanid"></a> `spanId` | `string` |
| <a id="property-timeunixnano"></a> `timeUnixNano` | `string` |
| <a id="property-traceid"></a> `traceId` | `string` |

### `OtlpHistogramDataPoint`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attributes"></a> `attributes` | `OtlpKeyValue`[] | - |
| <a id="property-bucketcounts"></a> `bucketCounts` | `number`[] | - |
| <a id="property-count"></a> `count` | `number` | Plain JSON numbers, not strings — see the ingest's u64 handling. |
| <a id="property-exemplars"></a> `exemplars?` | `OtlpExemplar`[] | - |
| <a id="property-explicitbounds"></a> `explicitBounds` | `number`[] | - |
| <a id="property-max"></a> `max` | `number` | - |
| <a id="property-min"></a> `min` | `number` | - |
| <a id="property-starttimeunixnano"></a> `startTimeUnixNano` | `string` | - |
| <a id="property-sum"></a> `sum` | `number` | - |
| <a id="property-timeunixnano-1"></a> `timeUnixNano` | `string` | - |

### `OtlpKeyValue`

| Property | Type |
| ------ | ------ |
| <a id="property-key-1"></a> `key` | `string` |
| <a id="property-value-2"></a> `value` | `OtlpAnyValue` |

### `OtlpLogRecord`

| Property | Type |
| ------ | ------ |
| <a id="property-attributes-5"></a> `attributes` | `OtlpKeyValue`[] |
| <a id="property-body-1"></a> `body` | `object` |
| `body.stringValue` | `string` |
| <a id="property-flags-2"></a> `flags?` | `number` |
| <a id="property-observedtimeunixnano"></a> `observedTimeUnixNano` | `string` |
| <a id="property-severitynumber"></a> `severityNumber` | `number` |
| <a id="property-severitytext"></a> `severityText` | `OtlpSeverityText` |
| <a id="property-spanid"></a> `spanId?` | `string` |
| <a id="property-timeunixnano"></a> `timeUnixNano` | `string` |
| <a id="property-traceid"></a> `traceId?` | `string` |

### `OtlpLogsPayload`

| Property | Type |
| ------ | ------ |
| <a id="property-resourcelogs"></a> `resourceLogs` | `object`[] |

### `OtlpMetric`

| Property | Type |
| ------ | ------ |
| <a id="property-gauge"></a> `gauge?` | `object` |
| `gauge.dataPoints` | `OtlpNumberDataPoint`[] |
| <a id="property-histogram"></a> `histogram?` | `object` |
| `histogram.aggregationTemporality` | `number` |
| `histogram.dataPoints` | `OtlpHistogramDataPoint`[] |
| <a id="property-name-3"></a> `name` | `string` |
| <a id="property-sum-1"></a> `sum?` | `object` |
| `sum.aggregationTemporality` | `number` |
| `sum.dataPoints` | `OtlpNumberDataPoint`[] |
| `sum.isMonotonic` | `boolean` |
| <a id="property-unit"></a> `unit?` | `string` |

### `OtlpMetricsPayload`

| Property | Type |
| ------ | ------ |
| <a id="property-resourcemetrics"></a> `resourceMetrics` | `object`[] |

### `OtlpNumberDataPoint`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-asdouble-1"></a> `asDouble` | `number` | - |
| <a id="property-attributes-1"></a> `attributes` | `OtlpKeyValue`[] | - |
| <a id="property-exemplars-1"></a> `exemplars?` | `OtlpExemplar`[] | - |
| <a id="property-starttimeunixnano-1"></a> `startTimeUnixNano?` | `string` | - |
| <a id="property-timeunixnano-2"></a> `timeUnixNano` | `string` | Unix nanos as a decimal string (uint64 doesn't fit in JS Number). |

### `OtlpSeverityEntry`

| Property | Type |
| ------ | ------ |
| <a id="property-number-1"></a> `number` | `number` |
| <a id="property-text-5"></a> `text` | `OtlpSeverityText` |

### `OtlpSeverityText`

> **OtlpSeverityText** = `"TRACE"` \| `"DEBUG"` \| `"INFO"` \| `"WARN"` \| `"ERROR"` \| `"FATAL"`

### `OverrideConfig`

> **OverrideConfig** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="event_trigger"></a> `event_trigger` | `boolean` |
| <a id="linked_flag"></a> `linked_flag` | `boolean` |
| <a id="sampling"></a> `sampling` | `boolean` |
| <a id="url_trigger"></a> `url_trigger` | `boolean` |

### `OverrideFeatureFlagsOptions`

> **OverrideFeatureFlagsOptions** = `boolean` \| `string`[] \| `FeatureFlagOverrides` \| `FeatureFlagOverrideOptions`

Options for overriding feature flags on the client-side.

Can be:
- `false` to clear all overrides
- `string[]` to enable a list of flags
- `FeatureFlagOverrides` to set variants directly
- `FeatureFlagOverrideOptions` for granular control over flags and payloads

### `PerformanceCaptureConfig`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-__preview_web_vitals_soft_navs"></a> `__preview_web_vitals_soft_navs?` | `boolean` | Scope web vitals metrics to the browser's Soft Navigation entries, so that client-side route changes in single-page apps each start a fresh measurement window instead of accumulating against the original hard-navigation timestamp. Without this, an SPA's LCP observer keeps treating the "largest paint so far" as belonging to the initial page load across every subsequent route change, which inflates LCP (and the other metrics) by the time spent on the app. This is a preview option (opt-in) because it relies on Chrome's Soft Navigation Detection API, which is still experimental. When enabled, PostHog loads a pinned stable web-vitals 6.x bundle and passes `reportSoftNavs` to the observers. The default path remains on the existing web-vitals 5.x bundle. In browsers without soft-nav support, metrics fall back to their existing hard-navigation behavior. **Default** `false` |
| <a id="property-__web_vitals_max_value"></a> `__web_vitals_max_value?` | `number` | We observe very large values reported by the Chrome web vitals library These outliers are likely not real, useful values, and we exclude them You can set this to 0 in order to include all values, NB this is not recommended **Default** `15 * 60 * 1000 (15 minutes)` |
| <a id="property-network_timing"></a> `network_timing?` | `boolean` | Works with session replay to use the browser's native performance observer to capture performance metrics |
| <a id="property-web_vitals"></a> `web_vitals?` | `boolean` | Use chrome's web vitals library to wrap fetch and capture web vitals When `cookieless_mode` is active, there is no client-side SessionIdManager; vitals are still captured. Nested `$web_vitals_*_event` payloads omit `$session_id` / `$window_id`; PostHog ingestion assigns `$session_id` server-side for cookieless traffic when project cookieless settings are enabled (same as other events). |
| <a id="property-web_vitals_allowed_metrics"></a> `web_vitals_allowed_metrics?` | `SupportedWebVitalsMetrics`[] | By default all 4 metrics are captured You can set this config to restrict which metrics are captured e.g. ['CLS', 'FCP'] to only capture those two metrics NB setting this does not override whether the capture is enabled **Default** `['LCP', 'CLS', 'FCP', 'INP']` |
| <a id="property-web_vitals_attribution"></a> `web_vitals_attribution?` | `boolean` \| `SupportedWebVitalsMetrics`[] | Which web vitals metrics include attribution data. Attribution names the cause of a metric, such as the slow interaction target for INP or the load-phase breakdown for LCP, which is what makes a slow number diagnosable. Pass `true` to attribute all metrics, `false` for none, or an array to name them. The default attributes INP and LCP only. CLS is excluded by default because its attribution holds detached DOM nodes and can leak memory in single-page apps. **Default** `['INP', 'LCP']` |
| <a id="property-web_vitals_delayed_flush_ms"></a> `web_vitals_delayed_flush_ms?` | `number` | We delay flushing web vitals metrics to reduce the number of events we send This is the maximum time we will wait before sending the metrics **Default** `5000` |

### `PersistentStore`

| Property | Type |
| ------ | ------ |
| <a id="property-_error"></a> `_error` | (`error`) => `void` |
| <a id="property-_get"></a> `_get` | (`name`) => `any` |
| <a id="property-_is_supported"></a> `_is_supported` | () => `boolean` |
| <a id="property-_parse"></a> `_parse` | (`name`) => `any` |
| <a id="property-_rawtext"></a> `_rawText?` | (`name`) => `string` |
| <a id="property-_remove"></a> `_remove` | (`name`, `cross_subdomain?`) => `void` |
| <a id="property-_set"></a> `_set` | (`name`, `value`, `expire_days?`, `cross_subdomain?`, `secure?`, `debug?`) => `boolean` |

### `PostHog`

The PostHog instance interface.

This can be used to type `window.posthog` when loading PostHog via a `<script>` tag.

#### Example

```typescript
import type { PostHog } from '@posthog/types'

declare global {
    interface Window {
        posthog?: PostHog
    }
}

// Now you can use window.posthog with type safety
window.posthog?.capture('my_event', { property: 'value' })
```

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-__loaded"></a> `__loaded` | `boolean` | Whether the PostHog instance has been loaded. |
| <a id="property-config"></a> `config` | `PostHogConfig` | The current configuration of the PostHog instance. |
| <a id="property-decideendpointwashit"></a> ~~`decideEndpointWasHit`~~ | `boolean` | **Deprecated** Use `flagsEndpointWasHit` instead |
| <a id="property-featureflags"></a> `featureFlags` | `TreeShakeable`\<\{ `override`(`flags`, `suppressWarning?`): `void`; `overrideFeatureFlags`(`overrideOptions`): `void`; \}\> | The feature flags instance. Provides access to feature flag override methods. |
| <a id="property-flagsendpointwashit"></a> `flagsEndpointWasHit` | `boolean` | Whether the flags endpoint has been hit. |
| <a id="property-logger-1"></a> `logger` | `Logger` | Logger with convenience methods for each severity level. **Example** `posthog.logger.info('checkout completed', { order_id: 'ord_789' }) posthog.logger.error('payment failed', { error_code: 'E001' })` |
| <a id="property-people"></a> ~~`people`~~ | `object` | **Deprecated** Use `setPersonProperties` instead |
| `people.set` | (`prop`, `to?`, `callback?`) => `void` | - |
| `people.set_once` | (`prop`, `to?`, `callback?`) => `void` | - |
| <a id="property-sessionmanager"></a> `sessionManager?` | `object` | The session manager instance. May be undefined in cookieless mode. |
| `sessionManager.resetSessionId` | () => `void` | Reset the session ID, creating a new session |
| <a id="property-sessionrecording"></a> `sessionRecording?` | `object` | The session recording instance. May be undefined if session recording is not initialized. |
| `sessionRecording._forceAllowLocalhostNetworkCapture` | `boolean` | Force allow network capture on localhost (for debugging) |
| <a id="property-version"></a> `version` | `string` | The library version. |

#### Methods

##### addExceptionStep()

> **addExceptionStep**(`message`, `properties?`): `void`

Adds a breadcrumb-like step that will be attached to the next captured exception as `$exception_steps`.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `message` | `string` | The step message |
| `properties?` | `Properties` | Additional context for this step |

###### Returns

`void`

##### alias()

> **alias**(`alias`, `original?`): `number` \| `void` \| `CaptureResult`

Create an alias for the current user.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `alias` | `string` | The alias to create |
| `original?` | `string` | The original distinct ID (defaults to current distinct ID) |

###### Returns

`number` \| `void` \| `CaptureResult`

##### canRenderSurvey()

> **canRenderSurvey**(`surveyId`): `SurveyRenderReason` \| `null`

Check if a survey can be rendered.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `surveyId` | `string` | The survey ID |

###### Returns

`SurveyRenderReason` \| `null`

The render reason or null if can't render

##### canRenderSurveyAsync()

> **canRenderSurveyAsync**(`surveyId`, `forceReload?`): `Promise`\<`SurveyRenderReason`\>

Check if a survey can be rendered (async version).

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `surveyId` | `string` | The survey ID |
| `forceReload?` | `boolean` | Whether to force a reload from the server |

###### Returns

`Promise`\<`SurveyRenderReason`\>

A promise that resolves to the render reason

##### capture()

> **capture**(`event_name`, `properties?`, `options?`): `CaptureResult` \| `undefined`

Capture an event.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `event_name` | `string` | The name of the event |
| `properties?` | `Properties` \| `null` | A set of properties to include with the event |
| `options?` | `CaptureOptions` | Additional options for the capture |

###### Returns

`CaptureResult` \| `undefined`

The capture result

##### captureException()

> **captureException**(`error`, `additionalProperties?`): `CaptureResult` \| `undefined`

Capture an exception.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `error` | `unknown` | The error to capture |
| `additionalProperties?` | `Properties` | Additional properties to include with the event |

###### Returns

`CaptureResult` \| `undefined`

The capture result

##### captureLog()

> **captureLog**(`options`): `void`

Capture a log entry and send it to the PostHog logs endpoint.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options` | `CaptureLogOptions` | The log entry options (body, level, attributes, etc.) |

###### Returns

`void`

##### captureTraceFeedback()

> **captureTraceFeedback**(`traceId`, `userFeedback`): `void`

Capture written user feedback for a LLM trace.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `traceId` | `string` \| `number` | The trace ID to capture feedback for |
| `userFeedback` | `string` | The feedback to capture |

###### Returns

`void`

##### captureTraceMetric()

> **captureTraceMetric**(`traceId`, `metricName`, `metricValue`): `void`

Capture a metric for a LLM trace.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `traceId` | `string` \| `number` | The trace ID to capture the metric for |
| `metricName` | `string` | The name of the metric to capture |
| `metricValue` | `string` \| `number` \| `boolean` | The value of the metric to capture |

###### Returns

`void`

##### clear\_opt\_in\_out\_capturing()

> **clear\_opt\_in\_out\_capturing**(): `void`

Clear the opt-in/out status.

###### Returns

`void`

##### clearIdentity()

> **clearIdentity**(): `void`

Clear HMAC-based identity verification, reverting to anonymous mode.

###### Returns

`void`

##### createPersonProfile()

> **createPersonProfile**(): `void`

Create a person profile for the current user.

###### Returns

`void`

##### debug()

> **debug**(`debug?`): `void`

Enable or disable debug mode.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `debug?` | `boolean` | Whether to enable debug mode (defaults to true) |

###### Returns

`void`

##### get\_distinct\_id()

> **get\_distinct\_id**(): `string`

Get the current distinct ID.

###### Returns

`string`

The current distinct ID

##### get\_explicit\_consent\_status()

> **get\_explicit\_consent\_status**(): `"pending"` \| `"granted"` \| `"denied"`

Get the explicit consent status.

###### Returns

`"pending"` \| `"granted"` \| `"denied"`

The consent status

##### get\_property()

> **get\_property**(`property_name`): `any`

Get a property value from persistence.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `property_name` | `string` | The property name |

###### Returns

`any`

The property value

##### get\_session\_id()

> **get\_session\_id**(): `string`

Get the current session ID.

###### Returns

`string`

The current session ID

##### get\_session\_replay\_url()

> **get\_session\_replay\_url**(`options?`): `string`

Get the URL to view the current session recording.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options?` | \{ `timestampLookBack?`: `number`; `withTimestamp?`: `boolean`; \} | Options for the URL |
| `options.timestampLookBack?` | `number` | How many seconds to look back for the timestamp |
| `options.withTimestamp?` | `boolean` | Whether to include the timestamp in the URL |

###### Returns

`string`

The session replay URL

##### getActiveMatchingSurveys()

> **getActiveMatchingSurveys**(`callback`, `forceReload?`): `void`

Get active surveys that match the current user.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `callback` | (`surveys`) => `void` | Callback to receive the surveys |
| `forceReload?` | `boolean` | Whether to force a reload from the server |

###### Returns

`void`

##### getEarlyAccessFeatures()

> **getEarlyAccessFeatures**(`callback`, `forceReload?`, `stages?`): `void`

Get the list of early access features.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `callback` | `EarlyAccessFeatureCallback` | Callback to receive the features |
| `forceReload?` | `boolean` | Whether to force a reload from the server |
| `stages?` | `EarlyAccessFeatureStage`[] | The stages of the early access features to load |

###### Returns

`void`

##### getFeatureFlag()

> **getFeatureFlag**(`key`, `options?`): `string` \| `boolean` \| `undefined`

Get the value of a feature flag.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature flag key |
| `options?` | `FeatureFlagOptions` | Options for the feature flag lookup |

###### Returns

`string` \| `boolean` \| `undefined`

The feature flag value (boolean for simple flags, string for multivariate)

##### ~~getFeatureFlagPayload()~~

> **getFeatureFlagPayload**(`key`): `JsonType`

Get the payload of a feature flag.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature flag key |

###### Returns

`JsonType`

The feature flag payload

###### Deprecated

Use `getFeatureFlagResult()` instead which properly tracks the feature flag call.

##### getFeatureFlagResult()

> **getFeatureFlagResult**(`key`, `options?`): `FeatureFlagResult` \| `undefined`

Get a feature flag evaluation result including both the flag value and payload.

By default, this method emits the `$feature_flag_called` event.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature flag key |
| `options?` | `FeatureFlagOptions` | Options for the feature flag lookup |

###### Returns

`FeatureFlagResult` \| `undefined`

The feature flag result including key, enabled, variant, and payload, or undefined if not loaded

##### getGroups()

> **getGroups**(): `Record`\<`string`, `any`\>

Get the current groups.

###### Returns

`Record`\<`string`, `any`\>

A record of group types to group keys

##### getPageViewId()

> **getPageViewId**(): `string` \| `undefined`

Get the current page view ID.

###### Returns

`string` \| `undefined`

The current page view ID

##### getSessionProperty()

> **getSessionProperty**(`property_name`): `any`

Get a session property value.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `property_name` | `string` | The property name |

###### Returns

`any`

The property value

##### getSurveys()

> **getSurveys**(`callback`, `forceReload?`): `void`

Get the list of surveys.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `callback` | (`surveys`) => `void` | Callback to receive the surveys |
| `forceReload?` | `boolean` | Whether to force a reload from the server |

###### Returns

`void`

##### group()

> **group**(`groupType`, `groupKey`, `groupPropertiesToSet?`): `void`

Associate the user with a group.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `groupType` | `string` | The type of group (e.g., 'company', 'project') |
| `groupKey` | `string` | The unique identifier for the group |
| `groupPropertiesToSet?` | `Properties` | Properties to set on the group |

###### Returns

`void`

##### has\_opted\_in\_capturing()

> **has\_opted\_in\_capturing**(): `boolean`

Check if the user has opted in to capturing.

###### Returns

`boolean`

Whether the user has opted in

##### has\_opted\_out\_capturing()

> **has\_opted\_out\_capturing**(): `boolean`

Check if the user has opted out of capturing.

###### Returns

`boolean`

Whether the user has opted out

##### identify()

> **identify**(`new_distinct_id`, `userPropertiesToSet?`, `userPropertiesToSetOnce?`): `void`

Identify a user with a distinct ID and optionally set person properties.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `new_distinct_id` | `string` | A non-empty distinct ID for the user |
| `userPropertiesToSet?` | `Properties` | Properties to set on the user (using $set) |
| `userPropertiesToSetOnce?` | `Properties` | Properties to set once on the user (using $set_once) |

###### Returns

`void`

##### init()

> **init**(`token`, `config?`, `name?`): `PostHog`

Initializes a new instance of the PostHog capturing object.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `token` | `string` | Your PostHog API token |
| `config?` | `Partial`\<`PostHogConfig`\> | A dictionary of config options to override |
| `name?` | `string` | The name for the new posthog instance that you want created |

###### Returns

`PostHog`

The newly initialized PostHog instance

##### isFeatureEnabled()

###### Call Signature

> **isFeatureEnabled**(`key`, `options`): `boolean`

Check if a feature flag is enabled.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature flag key |
| `options` | `FeatureFlagOptions` & `object` & `object` | Options for the feature flag lookup |

###### Returns

`boolean`

Whether the feature flag is enabled

###### Call Signature

> **isFeatureEnabled**(`key`, `options?`): `boolean` \| `undefined`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |
| `options?` | `IsFeatureEnabledOptions` |

###### Returns

`boolean` \| `undefined`

##### loadToolbar()

> **loadToolbar**(`params`): `boolean`

Load the PostHog toolbar.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `params` | `ToolbarParams` | Toolbar parameters |

###### Returns

`boolean`

Whether the toolbar was loaded

##### on()

> **on**(`event`, `cb`): () => `void`

Register an event listener.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `event` | `"eventCaptured"` \| `"featureFlagsReloading"` | The event name to listen for |
| `cb` | (...`args`) => `void` | The callback to call |

###### Returns

A function to unsubscribe

() => `void`

##### onActiveMatchingSurveysChanged()

> **onActiveMatchingSurveysChanged**(`callback`): () => `void`

Observe the initial matching surveys and updates after event/action and survey lifecycle
changes, definitions refreshes, captured pageviews, feature-flag updates, and reset.
URL changes require a captured pageview; arbitrary DOM mutations and elapsed time
are not observed. Unchanged results are suppressed. Recoverable load errors are
reported through the optional context without ending the subscription.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `callback` | (`surveys`, `context?`) => `void` | Callback to receive the active matching surveys |

###### Returns

A function to unsubscribe

() => `void`

##### onFeatureFlags()

> **onFeatureFlags**(`callback`): () => `void`

Register a callback to be called when feature flags are loaded.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `callback` | `FeatureFlagsCallback` | The callback to call |

###### Returns

A function to unsubscribe

() => `void`

##### onSessionId()

> **onSessionId**(`callback`): () => `void`

Register a callback to be called when the session ID changes.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `callback` | `SessionIdChangedCallback` | The callback to call |

###### Returns

A function to unsubscribe

() => `void`

##### opt\_in\_capturing()

> **opt\_in\_capturing**(): `void`

Opt the user into capturing.

###### Returns

`void`

##### opt\_out\_capturing()

> **opt\_out\_capturing**(): `void`

Opt the user out of capturing.

###### Returns

`void`

##### register()

> **register**(`properties`, `days?`): `void`

Register properties to be sent with every event.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `properties` | `Properties` | The properties to register |
| `days?` | `number` | Number of days to persist the properties |

###### Returns

`void`

##### register\_for\_session()

> **register\_for\_session**(`properties`): `void`

Register properties for the current session only.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `properties` | `Properties` | The properties to register |

###### Returns

`void`

##### register\_once()

> **register\_once**(`properties`, `default_value?`, `days?`): `void`

Register properties to be sent with every event, but only if they haven't been set before.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `properties` | `Properties` | The properties to register |
| `default_value?` | `any` | Default value for the property |
| `days?` | `number` | Number of days to persist the properties |

###### Returns

`void`

##### reloadFeatureFlags()

> **reloadFeatureFlags**(): `void`

Reload feature flags from the server.

###### Returns

`void`

##### renderSurvey()

> **renderSurvey**(`surveyId`, `selector`): `void`

Render a survey in a specific container.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `surveyId` | `string` | The survey ID |
| `selector` | `string` | CSS selector for the container |

###### Returns

`void`

##### reset()

> **reset**(`options?`): `void`

Reset the user's identity and start a new session.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options?` | `boolean` \| `ResetOptions` | Boolean to reset the device ID (legacy), or reset options including bootstrap values. |

###### Returns

`void`

###### Remarks

This also clears the stored consent, so with `opt_out_capturing_by_default` the instance
is opted out again afterwards — call `reset()` before `opt_in_capturing()`, not after.

##### resetGroupPropertiesForFlags()

> **resetGroupPropertiesForFlags**(`group_type?`): `void`

Reset group properties used for feature flag evaluation.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `group_type?` | `string` | Optional group type to reset (resets all if not provided) |

###### Returns

`void`

##### resetGroups()

> **resetGroups**(): `void`

Reset all groups for the current user.

###### Returns

`void`

##### resetPersonPropertiesForFlags()

> **resetPersonPropertiesForFlags**(`reloadFeatureFlags?`): `void`

Reset person properties used for feature flag evaluation.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `reloadFeatureFlags?` | `boolean` | Whether to reload feature flags after resetting |

###### Returns

`void`

##### sessionRecordingStarted()

> **sessionRecordingStarted**(): `boolean`

Check if session recording has started.

###### Returns

`boolean`

Whether session recording has started

##### set\_config()

> **set\_config**(`config`): `void`

Update the configuration.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `config` | `Partial`\<`PostHogConfig`\> | The configuration to merge |

###### Returns

`void`

##### setGroupPropertiesForFlags()

> **setGroupPropertiesForFlags**(`properties`, `reloadFeatureFlags?`): `void`

Set group properties to be used for feature flag evaluation.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `properties` | \{\[`type`: `string`\]: `Properties`; \} | The properties to set (keyed by group type) |
| `reloadFeatureFlags?` | `boolean` | Whether to reload feature flags after setting |

###### Returns

`void`

##### setIdentity()

> **setIdentity**(`distinctId`, `hash`): `void`

Set HMAC-based identity verification.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `distinctId` | `string` | The verified user distinct_id |
| `hash` | `string` | HMAC-SHA256 of distinctId, signed with the Secret API key from Support settings |

###### Returns

`void`

##### setInternalOrTestUser()

> **setInternalOrTestUser**(): `void`

Marks the current user as a test user by setting the `$internal_or_test_user` person property to `true`.
This also enables person processing for the current user.

This is useful for using in a cohort your internal/test filters for your posthog org.

###### Returns

`void`

###### See

https://posthog.com/tutorials/filter-internal-users
Create a cohort with `$internal_or_test_user` IS SET, and set your internal test filters to be NOT IN that cohort.

###### Example

```js
// Manually mark as test user
posthog.setInternalOrTestUser()

// Or use internal_or_test_user_hostname config for automatic detection
posthog.init('token', { internal_or_test_user_hostname: 'localhost' })
```

##### setPersonProperties()

> **setPersonProperties**(`userPropertiesToSet?`, `userPropertiesToSetOnce?`): `void`

Set properties on the current user.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `userPropertiesToSet?` | `Properties` | Properties to set on the user (using $set) |
| `userPropertiesToSetOnce?` | `Properties` | Properties to set once on the user (using $set_once) |

###### Returns

`void`

##### setPersonPropertiesForFlags()

> **setPersonPropertiesForFlags**(`properties`, `reloadFeatureFlags?`): `void`

Set person properties to be used for feature flag evaluation.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `properties` | `Properties` | The properties to set |
| `reloadFeatureFlags?` | `boolean` | Whether to reload feature flags after setting |

###### Returns

`void`

##### shutdown()

> **shutdown**(`shutdownTimeoutMs?`): `Promise`\<`void`\>

Flush any queued events and gracefully tear down the SDK.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `shutdownTimeoutMs?` | `number` | Accepted for parity with the Node.js SDK; unused in the browser. |

###### Returns

`Promise`\<`void`\>

Resolves once teardown is complete.

###### Remarks

Provided for parity with the server-side Node.js SDK. In the browser the SDK
already flushes on page unload, so this best-effort flushes queued events and
always resolves — it never throws — which makes isomorphic teardown safe.

##### startExceptionAutocapture()

> **startExceptionAutocapture**(`config?`): `void`

Start automatic exception capture.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `config?` | `ExceptionAutoCaptureConfig` | Optional configuration for exception autocapture |

###### Returns

`void`

##### startSessionRecording()

> **startSessionRecording**(`override?`): `void`

Start session recording (if not already started).

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `override?` | `true` \| \{ `event_trigger?`: `true`; `linked_flag?`: `boolean`; `sampling?`: `boolean`; `url_trigger?`: `true`; \} | Options to override default behavior, or `true` to override all controls |

###### Returns

`void`

##### stopExceptionAutocapture()

> **stopExceptionAutocapture**(): `void`

Stop automatic exception capture.

###### Returns

`void`

##### stopSessionRecording()

> **stopSessionRecording**(): `void`

Stop session recording.

###### Returns

`void`

##### unregister()

> **unregister**(`property`): `void`

Unregister a property so it is no longer sent with events.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `property` | `string` | The property name to unregister |

###### Returns

`void`

##### unregister\_for\_session()

> **unregister\_for\_session**(`property`): `void`

Unregister a session property.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `property` | `string` | The property name to unregister |

###### Returns

`void`

##### unsetPersonProperties()

> **unsetPersonProperties**(`propertyNames`): `void`

Remove properties from the current user.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `propertyNames` | `string` \| `string`[] | The name (or names) of the person properties to remove (using $unset) |

###### Returns

`void`

##### updateEarlyAccessFeatureEnrollment()

> **updateEarlyAccessFeatureEnrollment**(`key`, `isEnrolled`, `stage?`): `void`

Update enrollment in an early access feature.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature key |
| `isEnrolled` | `boolean` | Whether the user is enrolled |
| `stage?` | `EarlyAccessFeatureStage` | The stage of the feature |

###### Returns

`void`

##### updateFlags()

> **updateFlags**(`flags`, `payloads?`, `options?`): `void`

Manually update feature flag values without making a network request.

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `flags` | `Record`\<`string`, `boolean` \| `string`\> | An object mapping flag keys to their values (boolean or string variant) |
| `payloads?` | `Record`\<`string`, `JsonType`\> | Optional object mapping flag keys to their JSON payloads |
| `options?` | \{ `merge?`: `boolean`; \} | Optional settings. Use `{ merge: true }` to merge with existing flags instead of replacing. |
| `options.merge?` | `boolean` | - |

###### Returns

`void`

### `PostHogConfig`

> **PostHogConfig** = `Omit`\<`PostHogConfig`, `"loaded"`\> & `object`

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `disableDeviceModel?` | `boolean` | Disables capturing the `$device_model` super-property. When capturing is enabled (the default), PostHog resolves the hardware model once during init via `navigator.userAgentData.getHighEntropyValues(['model'])` and registers it as the raw OEM code (e.g. `Pixel 7`). This is Chromium-only and only meaningful on Android — it resolves to `undefined` on Safari/Firefox and to an empty string on desktop, in which cases nothing is registered. This opt-out is offered because `getHighEntropyValues` is still experimental and Chromium-only (not yet a cross-browser standard); set it to `true` to skip the call entirely. **Default** `false` |
| `loaded()` | (`posthog`) => `void` | - |

### `PostHogConfig`

Configuration options for the PostHog JavaScript SDK.

#### See

https://posthog.com/docs/libraries/js#config

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-__add_tracing_headers"></a> ~~`__add_tracing_headers?`~~ | `string`[] | **Deprecated** Use tracing\_headers instead. Kept for backwards compatibility. |
| <a id="property-__preview_capture_bot_pageviews"></a> `__preview_capture_bot_pageviews?` | `boolean` | PREVIEW - MAY CHANGE WITHOUT WARNING - DO NOT USE IN PRODUCTION Enables collection of bot traffic as $bot_pageview events with detailed bot detection properties instead of dropping them entirely. Use it alongside opt_out_useragent_filter |
| <a id="property-__preview_cookie_wins_on_conflict"></a> ~~`__preview_cookie_wins_on_conflict`~~ | `boolean` | **Deprecated** Use `cookieWinsOnConflict` instead. |
| <a id="property-__preview_deferred_init_extensions"></a> `__preview_deferred_init_extensions` | `boolean` | **`Experimental`** EXPERIMENTAL: Defers initialization of non-critical extensions (autocapture, session recording, etc.) to the next event loop tick using setTimeout. This reduces main thread blocking during SDK initialization for better page load performance, while keeping critical functionality (persistence, sessions, capture) available immediately. When enabled: - Persistence, sessions, and basic capture work immediately - Extensions (autocapture, recording, heatmaps, etc.) start after yielding back to the browser **Default** `false (will be true for defaults >= '2025-11-06' in the future) @experimental` |
| <a id="property-__preview_disable_beacon"></a> ~~`__preview_disable_beacon?`~~ | `boolean` | **Deprecated** Use `disable_beacon` instead. |
| <a id="property-__preview_disable_xhr_credentials"></a> ~~`__preview_disable_xhr_credentials?`~~ | `boolean` | **Deprecated** This option is a no-op. The browser SDK no longer sets `XMLHttpRequest.withCredentials`. |
| <a id="property-__preview_eager_load_replay"></a> ~~`__preview_eager_load_replay?`~~ | `boolean` | **Deprecated** This option is a no-op. Session replay is lazy-loaded by default. |
| <a id="property-__preview_external_dependency_versioned_paths"></a> ~~`__preview_external_dependency_versioned_paths?`~~ | `string` \| `boolean` | **Deprecated** Use strict\_script\_versioning and asset\_host instead. When set to true, this is equivalent to strict_script_versioning: true. When set to a string, this is equivalent to strict_script_versioning: true and asset_host set to that string. |
| <a id="property-__preview_flags_v2"></a> ~~`__preview_flags_v2?`~~ | `boolean` | **Deprecated** This option is a no-op. The browser SDK already uses the `/flags/?v=2` endpoint. |
| <a id="property-__preview_lazy_load_replay"></a> ~~`__preview_lazy_load_replay?`~~ | `boolean` | **Deprecated** - does nothing was present only for PostHog testing of replay lazy loading |
| <a id="property-__preview_replay_sync_fetch"></a> `__preview_replay_sync_fetch?` | `boolean` | Private preview: invoke recorded fetch requests synchronously to preserve application error stacks. Enabled by default in new cores; set to `false` to retain legacy fetch ordering. An old core without this option also retains legacy ordering when it loads a new recorder. Applied when the recorder installs its network observers, not a live remote kill switch. **Default** `true` |
| <a id="property-_oncapture"></a> ~~`_onCapture`~~ | (`eventName`, `eventData`) => `void` | **Deprecated** - use `before_send` instead |
| <a id="property-addtracingheaders"></a> ~~`addTracingHeaders?`~~ | `string`[] | **Deprecated** Use tracing\_headers instead. Kept for backwards compatibility. |
| <a id="property-advanced_disable_decide"></a> ~~`advanced_disable_decide?`~~ | `boolean` | **Deprecated** Use `advanced_disable_flags` instead. This will be removed in a future major version. One of the very first things the PostHog library does when init() is called is make a request to the /decide endpoint on PostHog's backend. This endpoint contains information on how to run the PostHog library so events are properly received in the backend. This endpoint is required to run most features of the library. However, if you're not using any of the described features, you may wish to turn off the call completely to avoid an extra request and reduce resource usage on both the client and the server. **Default** `false` |
| <a id="property-advanced_disable_feature_flags"></a> `advanced_disable_feature_flags` | `boolean` | Will keep /flags running, but without evaluating any feature flags. Useful for when you need to load the config data associated with the flags endpoint (e.g. /flags?v=2&config=true) without evaluating any feature flags. Most folks use this to save money on feature flag evaluation (by bootstrapping feature flags on the server side). This also stops surveys from displaying. PostHog creates an internal targeting flag for almost every survey, and every flag evaluates to false while flags are disabled. If you use surveys, set `advanced_only_evaluate_survey_feature_flags` instead, which evaluates survey flags only. **Default** `false` |
| <a id="property-advanced_disable_feature_flags_on_first_load"></a> `advanced_disable_feature_flags_on_first_load` | `boolean` | Stops from firing feature flag requests on first page load. Only requests feature flags when user identity or properties are updated, or you manually request for flags to be loaded. **Default** `false` |
| <a id="property-advanced_disable_flags"></a> `advanced_disable_flags?` | `boolean` | One of the very first things the PostHog library does when init() is called is make a request to the /flags endpoint on PostHog's backend. This endpoint contains information on how to run the PostHog library so events are properly received in the backend, and it also contains feature flag evaluation information for the current user. This endpoint is required to run most features of this library. However, if you're not using any of the described features, you may wish to turn off the call completely to avoid an extra request and reduce resource usage on both the client and the server. WARNING: Disabling this will also prevent remote configuration from loading, which could mean features like web vitals, surveys, and other features configured in PostHog settings are disabled unless explicitly enabled via client-side config. When setting this to true, make sure to explicitly configure any features you want to use (e.g., capture_performance, autocapture, etc.) in your SDK's init config. **Default** `false` |
| <a id="property-advanced_disable_toolbar_metrics"></a> `advanced_disable_toolbar_metrics` | `boolean` | Determines whether PostHog should disable toolbar metrics. This is our internal instrumentation for our toolbar in your website. **Default** `false` |
| <a id="property-advanced_enable_surveys"></a> `advanced_enable_surveys` | `boolean` | When this is enabled, surveys will always be initialized, regardless of the /flags response or remote config settings. This is useful if you want to use surveys but disable all other flag-dependent functionality. Used internally for displaying external surveys without making a /flags request. **Default** `false` |
| <a id="property-advanced_feature_flags_dedup_per_session"></a> `advanced_feature_flags_dedup_per_session` | `boolean` | When enabled, `$feature_flag_called` event deduplication is scoped to the current session. By default, the SDK deduplicates `$feature_flag_called` events globally and only re-emits them when `identify` (with a new distinct ID) or `reset` is called. This can be problematic for experiments: if a flag is checked before an experiment starts, the event is cached and won't fire again for that user until identify/reset, meaning the experiment never sees the event. When this option is `true`, the deduplication cache is keyed on the session ID, so each new session will re-emit `$feature_flag_called` for every flag that is checked. **Default** `false` |
| <a id="property-advanced_only_evaluate_survey_feature_flags"></a> `advanced_only_evaluate_survey_feature_flags` | `boolean` | Determines whether PostHog should only evaluate feature flags for surveys. Useful for when you want to use this library to evaluate feature flags for surveys only but you have additional feature flags that you evaluate on the server side. **Default** `false` |
| <a id="property-api_host"></a> `api_host` | `string` | URL of your PostHog instance. **Default** `'https://us.i.posthog.com'` |
| <a id="property-api_method"></a> ~~`api_method?`~~ | `string` | **Deprecated** - NOT USED ANYMORE, kept here for backwards compatibility reasons |
| <a id="property-api_transport"></a> `api_transport?` | `"XHR"` \| `"fetch"` | The transport method to use for API requests. **Default** `'fetch'` |
| <a id="property-asset_host"></a> `asset_host` | `string` \| `null` | Optional host override for static assets loaded by PostHog, such as recorder.js, surveys.js, or toolbar.js. Only applies to /static/* asset paths; dynamic assets like remote config continue to use the regular asset host derived from api_host. **Default** `null` |
| <a id="property-autocapture"></a> `autocapture` | `boolean` \| `AutocaptureConfig` | Determines whether PostHog should autocapture events. This setting does not affect capturing pageview events (see `capture_pageview`). by default autocapture is ignored on elements that match a `ph-no-capture` css class on the element or a parent **Default** `true` |
| <a id="property-before_send"></a> `before_send?` | `BeforeSendFn` \| `BeforeSendFn`[] | This function or array of functions - if provided - are called immediately before sending data to the server. It allows you to edit data before it is sent, or choose not to send it all. if provided as an array the functions are called in the order they are provided any one function returning null means the event will not be sent |
| <a id="property-bootstrap-1"></a> `bootstrap` | `BootstrapConfig` | An object containing the `distinctID`, `isIdentifiedID`, and `featureFlags` keys, where `distinctID` is a string, and `featureFlags` is an object of key-value pairs. Since there is a delay between initializing PostHog and fetching feature flags, feature flags are not always available immediately. This makes them unusable if you want to do something like redirecting a user to a different page based on a feature flag. You can, therefore, fetch the feature flags in your server and pre-fill them here, allowing PostHog to know the feature flag values immediately. After the SDK fetches feature flags from PostHog, it will use those flag values instead of bootstrapped ones. **Default** `{}` |
| <a id="property-capture_dead_clicks"></a> `capture_dead_clicks?` | `boolean` \| `DeadClicksAutoCaptureConfig` | Determines whether to capture dead clicks. by default dead clicks are ignored on elements that match a `ph-no-capture` or `ph-no-deadclick` css class on the element or a parent **See** **Default** `undefined` |
| <a id="property-capture_exceptions"></a> `capture_exceptions?` | `boolean` \| `ExceptionAutoCaptureConfig` | Determines whether to capture exceptions. **See** **Default** `undefined` |
| <a id="property-capture_heatmaps"></a> `capture_heatmaps?` | `boolean` \| `HeatmapConfig` | Determines whether to capture heatmaps. **See** **Default** `undefined` |
| <a id="property-capture_pageleave"></a> `capture_pageleave` | `boolean` \| `"if_capture_pageview"` | Determines whether PostHog should capture pageleave events. If set to `true`, it will capture pageleave events for all pages. If set to `'if_capture_pageview'`, it will only capture pageleave events if `capture_pageview` is enabled. **Default** `'if_capture_pageview'` |
| <a id="property-capture_pageview"></a> `capture_pageview` | `boolean` \| `CapturePageviewOptions` \| `"history_change"` | Determines whether PostHog should capture pageview events automatically. Can be: - `true`: Capture the initial pageview - `false`: Don't capture any pageviews - `'history_change'`: Capture the initial pageview and pageviews when the pathname changes - An object: Capture the initial pageview and pageviews when any selected URL component changes **Default** true (or `'history_change'` when `defaults` is `'2025-05-24'` or later) |
| <a id="property-capture_performance"></a> `capture_performance?` | `boolean` \| `PerformanceCaptureConfig` | Determines whether to capture performance metrics. These include Network Timing for Session Replay and Web Vitals. The `network_timing` option is only used by the Session Replay feature. For more session recording settings, see the `session_recording` and `enable_recording_console_log` configuration option. When `undefined`, fallback to the remote configuration. If `false`, neither network timing nor web vitals will work. If an object, that will override the remote configuration. **See** **Default** `undefined` |
| <a id="property-capture_webmcp"></a> `capture_webmcp?` | `boolean` \| `WebMCPCaptureConfig` | Captures WebMCP tool calls as `$mcp_tool_call` events. Set this option to `true` to capture intent and model metadata. Use an object to disable either field. PostHog wraps tools registered after the SDK initializes. Tool inputs and outputs are not captured. Metadata options are applied when each tool registers. Changing them does not update registered schemas; re-register the tool to apply the new options. **Default** `false` |
| <a id="property-consent_persistence_name"></a> `consent_persistence_name` | `string` \| `null` | Determines the key for the cookie / local storage used to store the information about whether users are opted in/out of capturing. When `null`, we used a key based on your token. **Default** `null` **See** `ConsentManager._storageKey` |
| <a id="property-conversations"></a> `conversations?` | `ConversationsConfig` | Conversations-specific configuration options, such as the support widget theme. **Default** `undefined` |
| <a id="property-cookie_expiration"></a> `cookie_expiration` | `number` | Determines the number of days to store cookies for. **Default** `365` |
| <a id="property-cookie_name"></a> ~~`cookie_name?`~~ | `string` | **Deprecated** - Use 'persistence_name' instead |
| <a id="property-cookie_persisted_properties"></a> `cookie_persisted_properties?` | readonly `string`[] | List of custom property names that should be stored in cookies (in addition to the default ones) when using 'localStorage+cookie' persistence mode. This allows these properties to be shared across subdomains when cross_subdomain_cookie is enabled. **Default** `[]` |
| <a id="property-cookieless_mode"></a> `cookieless_mode?` | `"always"` \| `"on_reject"` | Enables cookieless mode. In this mode, PostHog will not set any cookies, or use session or local storage. User identity is handled by generating a privacy-preserving hash on PostHog's servers. Web Vitals (`capture_performance.web_vitals`) are supported: metrics are sent without client session IDs; ingestion assigns `$session_id` when cookieless mode is enabled for the project. - 'always' - enable cookieless mode immediately on startup, use this if you do not intend to show a cookie banner - 'on_reject' - enable cookieless mode only if the user rejects cookies, use this if you want to show a cookie banner. If the user accepts cookies, cookieless mode will not be used, and PostHog will use cookies and local storage as usual. Note that you MUST enable cookieless mode in your PostHog project's settings, otherwise all your cookieless events will be ignored. We plan to remove this requirement in the future. |
| <a id="property-cookiewinsonconflict"></a> `cookieWinsOnConflict` | `boolean` | In `'localStorage+cookie'` persistence mode, prefer shared cookie values over per-origin localStorage when both stores carry the same key. The SDK also checks for cookie changes before captures and persistence writes so already-open sibling subdomains adopt identity changes made by `identify()` or `reset()`. When `defaults` is `'2026-08-29'` or later, this defaults to `true`. **Default** `false` |
| <a id="property-cross_subdomain_cookie"></a> `cross_subdomain_cookie` | `boolean` | Determines if cookie should be set on the top level domain (example.com). If PostHog-js is loaded on a subdomain (test.example.com), and `cross_subdomain_cookie` is set to false, it'll set the cookie on the subdomain only (test.example.com). NOTE: It will be set to `false` if we detect that the domain is a subdomain of a platform that is excluded from cross-subdomain cookie setting. The current list of excluded platforms is `herokuapp.com`, `vercel.app`, and `netlify.app`. **See** `isCrossDomainCookie` **Default** `true` |
| <a id="property-custom_blocked_useragents"></a> `custom_blocked_useragents` | `string`[] | Used to extend the list of user agents that are blocked by default. **See** from './utils/blocked-uas' - Default list of blocked user agents. **Default** `[]` |
| <a id="property-custom_campaign_params"></a> `custom_campaign_params` | `string`[] | Used to extend the list of campaign parameters that are saved by default. **See** from './utils/event-utils' - Default campaign parameters like utm_source, utm_medium, etc. **Default** `[]` |
| <a id="property-custom_personal_data_properties"></a> `custom_personal_data_properties` | `string`[] | Custom list of personal data properties to mask. E.g. if you added `email` to this list, then any `email` property in the URL will be masked. https://www.example.com/login?email=john.doe%40example.com => https://www.example.com/login?email=<MASKED> **Default** `[]` **See** - Must be enabled for this to take effect. |
| <a id="property-debug"></a> `debug` | `boolean` | Determines whether PostHog should be in debug mode. You can enable this to get more detailed logging. You can also enable this on your website by appending `?__posthog_debug=true` at the end of your URL You can also call `posthog.debug()` in your code to enable debug mode **Default** `false` |
| <a id="property-defaults"></a> `defaults` | `ConfigDefaults` | Configuration defaults for breaking changes. When set to a specific date, enables new default behaviors that were introduced on that date. Set to `'latest'` to always use the newest defaults in the loaded SDK version. Unlike a pinned date, `'latest'` opts into future default changes when the SDK is upgraded, which may include breaking changes. Explicit configuration options still take precedence. Events report the resolved date in `$config_defaults` when using `'latest'`. - `'latest'`: Use all default changes available in the loaded SDK version - `'unset'`: Use legacy default behaviors - `'2025-05-24'`: Use updated default behaviors (e.g. capture_pageview defaults to 'history_change') - `'2025-11-30'`: Defaults from '2025-05-24' plus additional changes (e.g. strict minimum duration for replay and rageclick content ignore list defaults to active) - `'2026-01-30'`: Defaults from '2025-11-30' plus external_scripts_inject_target defaults to 'head' (avoids SSR hydration errors) - `'2026-05-30'`: Defaults from '2026-01-30' plus `persistence_save_debounce_ms` defaults to `250`, `split_storage` and `detect_google_search_app` default to `true`, and rageclick defaults also exclude stepper controls and text-selection surfaces - `'2026-06-25'`: Defaults from '2026-05-30' plus `session_recording.streamNetworkBody` defaults to `true` (streams network bodies to enforce the payload size limit) - `'2026-08-29'`: Defaults from '2026-06-25' plus `cookieWinsOnConflict` defaults to `true` (the shared cross-subdomain cookie wins over stale per-origin localStorage) - `'2026-08-30'`: Defaults from '2026-08-29' plus `session_recording.captureJsonLd` defaults to `true` **Default** `'unset'` |
| <a id="property-detect_google_search_app"></a> `detect_google_search_app?` | `boolean` | Detect the Google Search App (GSA) as its own `$browser` value instead of the underlying webview it embeds — Mobile Safari on iOS, Chrome on Android. Detection keys off the `GSA/` marker present in the UA on every platform. Off by default for backwards-compatibility: enabling it reattributes existing GSA traffic away from Mobile Safari / Chrome, which would otherwise look like those browsers suddenly losing share. The `2026-05-30` config default opts in. **Default** `false` |
| <a id="property-disable_beacon"></a> `disable_beacon?` | `boolean` | Prevents posthog-js from using the `navigator.sendBeacon` API to send events. Enabling this option may hurt the reliability of sending $pageleave events. |
| <a id="property-disable_capture_url_hashes"></a> `disable_capture_url_hashes` | `boolean` | Determines whether PostHog should strip URL fragments (`#...`) from automatically captured URL fields. Disabled by default for backwards compatibility, and enabled automatically when `config.defaults` is `'2026-06-25'` or later. Set to `true` to strip hashes from: - `$current_url` on automatically captured browser events, including `$pageview` - `$initial_current_url` - `$session_entry_url` - `$elements[*].attr__href` and `$external_click_url` for autocapture and dead-click autocapture - Next.js Pages Router `$pageview` `$current_url` - web vitals `$current_url` - logs `url.full` - conversations `current_url` and `request_url` - session replay rrweb meta/custom-event `href` URLs - heatmap data URLs If your SPA relies on hash-based routes for analytics, enabling this is a breaking behavior change. If you want to capture hashes selectively, leave this disabled and use `before_send` to remove sensitive hash values before events are sent. **Default** false when `config.defaults` is unset or earlier than `'2026-06-25'`, otherwise `true` |
| <a id="property-disable_compression"></a> `disable_compression` | `boolean` | Determines whether to disable compression when sending events to the server. WARNING: Should only be used for testing. Could negatively impact performance. **Default** `false` |
| <a id="property-disable_conversations"></a> `disable_conversations` | `boolean` | Determines whether PostHog should disable all conversations functionality. **Default** `false` |
| <a id="property-disable_cookie"></a> ~~`disable_cookie?`~~ | `boolean` | **Deprecated** - use `disable_persistence` instead |
| <a id="property-disable_external_dependency_loading"></a> `disable_external_dependency_loading` | `boolean` | Determines whether PostHog should disable any external dependency loading. This will prevent PostHog from requesting any external scripts such as those needed for Session Replay, Surveys or Site Apps. **Default** `false` |
| <a id="property-disable_persistence"></a> `disable_persistence` | `boolean` | Determines whether PostHog should disable persistence. If set to `true`, the library will not save any data to the browser. It will also delete any data previously saved to the browser. **Default** `false` |
| <a id="property-disable_product_tours"></a> `disable_product_tours` | `boolean` | Determines whether PostHog should disable all product tours functionality. **Default** `false` |
| <a id="property-disable_scroll_properties"></a> `disable_scroll_properties?` | `boolean` | Determines whether to disable scroll properties. These allow you to keep track of how far down someone scrolled in your website. **Default** `false` |
| <a id="property-disable_session_recording"></a> `disable_session_recording` | `boolean` | Determines whether PostHog should disable session recording. **Default** `false` |
| <a id="property-disable_surveys"></a> `disable_surveys` | `boolean` | Determines whether PostHog should disable all surveys functionality. **Default** `false` |
| <a id="property-disable_surveys_automatic_display"></a> `disable_surveys_automatic_display` | `boolean` | Determines whether PostHog should disable automatic display of surveys. If this is true, popup or widget surveys will not be shown when display conditions are met. **Default** `false` |
| <a id="property-disable_web_experiments"></a> `disable_web_experiments` | `boolean` | Determines whether PostHog should disable web experiments. Currently disabled while we're in BETA. It will be toggled to `true` in a future release. **Default** `true` |
| <a id="property-enable_heatmaps"></a> ~~`enable_heatmaps?`~~ | `boolean` | **Deprecated** Use `capture_heatmaps` instead. |
| <a id="property-enable_recording_console_log"></a> `enable_recording_console_log?` | `boolean` | Determines whether PostHog should enable recording console logs. This is related to the Session Recording feature. For more session recording settings, see the `session_recording` and `capture_performance` configuration option. When undefined, it falls back to the remote config setting. **Default** `undefined` |
| <a id="property-error_tracking"></a> `error_tracking` | `ErrorTrackingOptions` | Determines the error tracking options. **See** `ErrorTrackingOptions` **Default** `{}` |
| <a id="property-evaluation_contexts"></a> `evaluation_contexts?` | readonly `string`[] | Evaluation contexts for feature flags. When set, only feature flags that have at least one matching evaluation tag will be evaluated for this SDK instance. Feature flags with no evaluation tags will always be evaluated. Examples: ['production', 'web', 'checkout'] **Default** `undefined` |
| <a id="property-evaluation_environments"></a> ~~`evaluation_environments?`~~ | readonly `string`[] | Evaluation environments for feature flags. **Deprecated** Use evaluation_contexts instead. This property will be removed in a future version. |
| <a id="property-external_scripts_inject_target"></a> `external_scripts_inject_target?` | `"body"` \| `"head"` | Where to inject external dependency scripts (recorder, surveys, etc.) in the DOM. - 'body': Injects scripts into document.body (legacy behavior) - 'head': Injects scripts into document.head (avoids SSR hydration errors) **Default** `'body' (or 'head' when defaults >= '2026-01-30')` |
| <a id="property-feature_flag_cache_ttl_ms"></a> `feature_flag_cache_ttl_ms?` | `number` | Sets the maximum age (in milliseconds) for cached feature flag values. When the cache is older than this value: - `getFeatureFlag()` will return `undefined` instead of stale cached values - `$feature/` properties will not be attached to events - A background refresh will be triggered automatically This prevents stale feature flag values from being used when the `/flags` request fails (e.g., due to ad blockers or network issues). When not set or set to `0`, cache expiration is disabled (cached values never expire). **Default** `0` |
| <a id="property-feature_flag_request_max_retries"></a> `feature_flag_request_max_retries` | `number` | How many times to retry a `/flags` request before giving up. Only failures that are plausibly transient are retried: HTTP 502 and 504, and a request that timed out. Every other status is terminal, as is a transport failure that is not a timeout — in a browser those are usually an ad blocker, an extension or CORS, which the status-zero circuit breaker already handles, so retrying them would only add a second doomed request. Set to 0 to disable retries. **Default** `1` |
| <a id="property-feature_flag_request_timeout_ms"></a> `feature_flag_request_timeout_ms` | `number` | Sets timeout for fetching feature flags **Default** `3000` |
| <a id="property-fetch_options"></a> `fetch_options?` | `object` | Used when sending data via `fetch`, use with care. This is intentionally meant to be used with NextJS `fetch` Incorrect `cache` usage may cause out-of-date data for feature flags, actions tracking, etc. See https://nextjs.org/docs/app/api-reference/functions/fetch#fetchurl-options |
| `fetch_options.cache?` | `RequestCache` | - |
| `fetch_options.next_options?` | `NextOptions` | - |
| <a id="property-flag_keys"></a> `flag_keys?` | readonly `string`[] | List of feature flag keys to remotely evaluate for this SDK instance. When set, only these flags are evaluated by `/flags`; omitted flags are not remotely evaluated. Dependencies of the requested flags may still be evaluated internally by PostHog. If unset, all eligible flags are evaluated. Examples: ['checkout-redesign', 'new-onboarding'] **Default** `undefined` |
| <a id="property-flags_api_host"></a> `flags_api_host?` | `string` \| `null` | URL to use for feature flag requests specifically. If not set, feature flag requests will use the URL derived from `api_host`. This is useful when you want to route feature flag requests to a different endpoint than other analytic APIs. **Default** `null` |
| <a id="property-get_current_url"></a> `get_current_url?` | (`defaultUrl`) => `string` | Overrides the URL used for client-side URL targeting: session replay URL triggers, the session replay URL blocklist, survey URL display conditions, product tour URL conditions, web experiment URL conditions, and autocapture URL allow/ignore lists. These features match against `window.location.href` directly, which does not reflect any `$current_url` you rewrite in `before_send`. In environments where the browser URL is not meaningful for targeting — e.g. Electron/desktop apps served from a generated host — return the logical URL you want these features to match against. This does not change the `$current_url` property captured on events (use `before_send` for that). **Default** undefined (uses `window.location.href`) |
| <a id="property-get_device_id"></a> `get_device_id` | (`uuid`) => `string` | Function to get the device ID. This doesn't usually need to be set, but can be useful if you want to use a custom device ID. **Default** `(uuid) => uuid` |
| <a id="property-identity_claims"></a> `identity_claims?` | `Record`\<`string`, \{ `hash`: `string`; `value`: `string`; \}\> | Additional server-signed identity claims. Claims are forwarded to products such as conversations only when `identity_distinct_id` and `identity_hash` are also present. Claim verification and consumption happen server-side. |
| <a id="property-identity_distinct_id"></a> `identity_distinct_id?` | `string` | Verified distinct_id for HMAC-based identity verification. When both `identity_distinct_id` and `identity_hash` are provided, products like conversations use server-verified identity instead of anonymous session identifiers. Can be set at init time or later via `posthog.setIdentity()`. **Example** `posthog.init('phc_...', { identity_distinct_id: 'user_123', identity_hash: 'a1b2c3d4e5f6...', })` |
| <a id="property-identity_hash"></a> `identity_hash?` | `string` | HMAC-SHA256 of `identity_distinct_id`, signed with the Secret API key from Support settings. Project secret API keys (project settings) and personal API keys are rejected. Must be provided together with `identity_distinct_id`. |
| <a id="property-inapp_link_new_window"></a> ~~`inapp_link_new_window?`~~ | `boolean` | **Deprecated** - NOT USED ANYMORE, kept here for backwards compatibility reasons |
| <a id="property-inapp_protocol"></a> ~~`inapp_protocol?`~~ | `string` | **Deprecated** - NOT USED ANYMORE, kept here for backwards compatibility reasons |
| <a id="property-integrations"></a> `integrations?` | `Record`\<`ExternalIntegrationKind`, `boolean`\> | Used to set-up external integrations with PostHog data - such as session replays, distinct id, etc. |
| <a id="property-internal_or_test_user_hostname"></a> `internal_or_test_user_hostname?` | `string` \| `RegExp` \| `null` | A hostname pattern to match test environments. When the current hostname matches, `setInternalOrTestUser()` is called automatically on startup, enabling person processing and setting `$internal_or_test_user: true`. Can be a string (exact match) or RegExp (pattern match). Set to `null` to explicitly disable (useful when using `defaults: '2026-01-30'`). **Default** `undefined (when defaults is before '2026-01-30')` **Default** `/^(localhost\|127\.0\.0\.1)$/ (when defaults >= '2026-01-30')` **Example** `// Exact match posthog.init('token', { internal_or_test_user_hostname: 'example.com' }) // Regex pattern posthog.init('token', { internal_or_test_user_hostname: /\.local$/ }) // Disable posthog.init('token', { internal_or_test_user_hostname: null })` |
| <a id="property-ip"></a> ~~`ip`~~ | `boolean` | **Deprecated** - THIS OPTION HAS NO EFFECT, kept here for backwards compatibility reasons. Use a custom transformation or "Discard IP data" project setting instead: **See** https://posthog.com/tutorials/web-redact-properties#hiding-customer-ip-address. |
| <a id="property-loaded"></a> `loaded` | (`posthog_instance`) => `void` | A function to be called once the PostHog scripts have loaded successfully. |
| <a id="property-logs"></a> `logs?` | `LogsConfig` | Logs-specific configuration options. **Default** `undefined` |
| <a id="property-mask_all_element_attributes"></a> `mask_all_element_attributes` | `boolean` | Prevent autocapture from capturing any attribute names on elements. **Default** `false` |
| <a id="property-mask_all_text"></a> `mask_all_text` | `boolean` | Prevent autocapture from capturing `textContent` on elements. **Default** `false` |
| <a id="property-mask_personal_data_properties"></a> `mask_personal_data_properties` | `boolean` | Mask personal data properties from the current URL. This will mask personal data properties such as advertising IDs (gclid, fbclid, etc.), and you can also add custom properties to mask with `custom_personal_data_properties`. **Default** `false` **See** - - Default campaign parameters that are masked by default. - - Custom list of personal data properties to mask. |
| <a id="property-metrics"></a> `metrics?` | `BrowserMetricsConfig` | Metrics-specific configuration options for the posthog.metrics API. **Default** `undefined` |
| <a id="property-name-4"></a> `name` | `string` | The name this instance will be identified by. You don't need to set this most of the time, but can be useful if you have several Posthog instances running at the same time. **Default** `'posthog'` |
| <a id="property-on_request_error"></a> `on_request_error?` | (`error`) => `void` | A function that is called when a request to the PostHog API fails. |
| <a id="property-on_xhr_error"></a> ~~`on_xhr_error?`~~ | (`failedRequest`) => `void` | **Deprecated** - use `on_request_error` instead |
| <a id="property-opt_in_site_apps"></a> `opt_in_site_apps` | `boolean` | Determines if users should be opted in to site apps. **Default** `false` |
| <a id="property-opt_out_capturing_by_default"></a> `opt_out_capturing_by_default` | `boolean` | Determines if users should be opted out of PostHog tracking by default, requiring additional logic to opt them into capturing by calling `posthog.opt_in_capturing()`. **Default** `false` |
| <a id="property-opt_out_capturing_cookie_prefix"></a> ~~`opt_out_capturing_cookie_prefix`~~ | `string` \| `null` | **Deprecated** Use `consent_persistence_name` instead. This will be removed in a future major version. |
| <a id="property-opt_out_capturing_persistence_type"></a> `opt_out_capturing_persistence_type` | `"localStorage"` \| `"cookie"` | Determines where we'll save the information about whether users are opted out of capturing. **Default** `'localStorage'` |
| <a id="property-opt_out_persistence_by_default"></a> `opt_out_persistence_by_default?` | `boolean` | Determines if users should be opted out of browser data storage by this PostHog instance by default, requiring additional logic to opt them into capturing by calling `posthog.opt_in_capturing()`. **Default** `false` |
| <a id="property-opt_out_useragent_filter"></a> `opt_out_useragent_filter` | `boolean` | Determines if users should be opted out of user agent filtering such as googlebot or other bots. If this is set to `true`, PostHog will set `$browser_type` to either `bot` or `browser` for all events, but will process all events as if they were from a browser. **Default** `false` |
| <a id="property-override_display_language"></a> `override_display_language?` | `string` \| `null` | Display language override for Product Tours. Must be a valid BCP 47 language code. In the future this will be used for Surveys and other products that deliver in-app experiences to end-users. |
| <a id="property-persistence"></a> `persistence` | `"localStorage"` \| `"cookie"` \| `"memory"` \| `"localStorage+cookie"` \| `"sessionStorage"` | Determines how PostHog stores information about the user. See [persistence](https://posthog.com/docs/libraries/js#persistence) for details. **Default** `'localStorage+cookie'` |
| <a id="property-persistence_name"></a> `persistence_name` | `string` | The name for the super properties persistent store **Default** `''` |
| <a id="property-persistence_save_debounce_ms"></a> `persistence_save_debounce_ms?` | `number` | Coalesce rapid `Persistence.save()` calls into a single write. Set to a positive number (milliseconds) to debounce writes to localStorage / cookie by that window. The in-memory `props` object is always updated synchronously so within-tab reads see the latest values immediately. Cross-tab `storage` events (which carry the full persistence value as a payload) are reduced proportionally to the debounce window. Pending writes are flushed on `beforeunload` and `pagehide` so no state is lost on tab close. The cross-tab visibility delay is bounded by the configured window. Defaults to `0` (no debouncing, write synchronously) for backwards compatibility. On pages that capture many events per second, `250` is a reasonable starting point to reduce localStorage write pressure and cross-tab IPC traffic. The `2026-05-30` config default opts into `250` automatically. **Default** `0` |
| <a id="property-person_profiles"></a> `person_profiles?` | `"always"` \| `"never"` \| `"identified_only"` | You can control whether events from PostHog-js have person processing enabled with the `person_profiles` config setting. There are three options: - `person_profiles: 'always'` - we will process persons data for all events - `person_profiles: 'never'` - we won't process persons for any event. This means that anonymous users will not be merged once they sign up or login, so you lose the ability to create funnels that track users from anonymous to identified. All events (including `$identify`) will be sent with `$process_person_profile: False`. - `person_profiles: 'identified_only'` _(default)_ - we will only process persons when you call `posthog.identify`, `posthog.alias`, `posthog.setPersonProperties`, `posthog.unsetPersonProperties`, `posthog.group`, `posthog.setPersonPropertiesForFlags` or `posthog.setGroupPropertiesForFlags` Anonymous users won't get person profiles. **Default** `'identified_only'` |
| <a id="property-prepare_external_dependency_script"></a> `prepare_external_dependency_script?` | (`script`) => `HTMLScriptElement` \| `null` | A function to be called when a script is being loaded. This can be used to modify the script before it is loaded. This is useful for adding a nonce to the script, for example. |
| <a id="property-prepare_external_dependency_stylesheet"></a> `prepare_external_dependency_stylesheet?` | (`stylesheet`) => `HTMLStyleElement` \| `null` | A function to be called when a stylesheet is being loaded. This can be used to modify the stylesheet before it is loaded. This is useful for adding a nonce to the stylesheet, for example. |
| <a id="property-process_person"></a> ~~`process_person?`~~ | `"always"` \| `"never"` \| `"identified_only"` | **Deprecated** - use `person_profiles` instead |
| <a id="property-properties_string_max_length"></a> `properties_string_max_length` | `number` | Determines the maximum length of the properties string that can be sent with capture calls. **Default** `65535` |
| <a id="property-property_blacklist"></a> ~~`property_blacklist?`~~ | `string`[] | **Deprecated** - use `property_denylist` instead |
| <a id="property-property_denylist"></a> `property_denylist` | `string`[] | A list of properties that should never be sent with capture calls. **Default** `[]` |
| <a id="property-rageclick-1"></a> `rageclick` | `boolean` \| `RageclickConfig` | Determines whether PostHog should capture rage clicks. By default, rage clicks are ignored on elements that match a `ph-no-capture` or `ph-no-rageclick` CSS class on the element or a parent. When `defaults` is `'2025-11-30'` or later, the default is `{ content_ignorelist: true }`, which also ignores repeat-click controls such as pagination arrows and pagers (see `content_ignorelist`). When `defaults` is `'2026-05-30'` or later, the default also excludes stepper controls (`+`, `-`, `−`, `–`) and text-selection surfaces. **Default** `true` |
| <a id="property-rate_limiting"></a> `rate_limiting?` | `object` | Client side rate limiting. A token bucket, per browser, that stops a runaway loop on your site from flooding capture. When it drains, further `capture` calls are dropped and a one-off `$$client_ingestion_warning` is sent reporting how many events were dropped and the page and session that tripped it - usually the fastest way to find the loop. Raise these limits if you legitimately capture in bursts; a warning under the defaults is more often a bug on the page than a limit set too low. |
| `rate_limiting.events_burst_limit?` | `number` | How many events can be captured in a burst. This defaults to 10 times the events_per_second count **Default** 10 * `events_per_second` |
| `rate_limiting.events_per_second?` | `number` | The average number of events per second that should be permitted **Default** `10` |
| <a id="property-remote_config_refresh_interval_ms"></a> `remote_config_refresh_interval_ms?` | `number` | Controls how often feature flags are automatically refreshed in long-running sessions. The default interval is 5 minutes (300000ms) to pick up server-side flag changes without requiring a page reload. This is useful for SPAs and long-running tabs. An explicitly set positive interval stays fixed, even when the page gets no user interaction. **Each refresh is a billable feature flag request.** A page that stays open all day makes up to 288 requests per day on the default interval, and every open tab and every named instance refreshes on its own timer, so they add up. Set this option to `0` to stop the background refreshes if that cost is not useful to you. **Tradeoffs:** - **Shorter intervals**: Feature flag changes propagate faster, but increases network requests, cost, and server load. - **Longer intervals**: Reduces network traffic (better for mobile/battery) and cost, but flag changes take longer to propagate. - **Disabled (0 or any negative value)**: No background refreshes. Flags only update on page load or manual `reloadFeatureFlags()` calls. Use this if you control flag updates manually or have infrequent flag changes. Hidden pages skip scheduled refreshes and reload due flags when they become visible. When this option is omitted, a visible page that gets no user interaction (such as a dashboard, a page being read, a video player, or a kiosk) doubles the interval after every refresh, up to one hour. Automatic refreshes continue at that interval; they do not stop. The next click, key press, wheel, touch, or return to visibility restores the five-minute default. Scrolling driven by a script, such as an auto-playing carousel, does not count as an interaction. Set this option explicitly to keep a fixed cadence, or to `0` to stop background refreshes completely. This option does not reload remote config. **Default** `300000 (5 minutes)` |
| <a id="property-request_batching"></a> `request_batching` | `boolean` | Determines whether PostHog should batch requests to the PostHog API. **Default** `true` |
| <a id="property-request_headers"></a> `request_headers` | `object` | A list of headers that should be sent with requests to the PostHog API. **Default** `{}` |
| <a id="property-request_queue_config"></a> `request_queue_config?` | `RequestQueueConfig` | Used to change the behavior of the request queue. This is an advanced feature and should be used with caution. |
| <a id="property-respect_dnt"></a> `respect_dnt` | `boolean` | Determines whether PostHog should respect the Do Not Track header when computing consent in `ConsentManager`. **See** `ConsentManager` **Default** `false` |
| <a id="property-reuseanonymousid"></a> `reuseAnonymousId?` | `boolean` | When true, `identify()` omits `$anon_distinct_id` from the `$identify` event and the follow-up feature flag request, so PostHog does not merge the previous anonymous identity into the identified person. **Default** `false` |
| <a id="property-rewriterequestpath"></a> `rewriteRequestPath?` | (`url`) => `URL` | Rewrites the URL used for PostHog API, feature flag, and asset requests. This is intended for customers who use a reverse proxy and need custom paths. The proxy must map the rewritten paths back to the canonical PostHog paths. UI links are not rewritten. **Example** `posthog.init('phc_...', { api_host: 'https://a.example.com', rewriteRequestPath: (url) => { if (url.pathname === '/e/') { url.pathname = '/my-events/' } else if (url.pathname === '/s/') { url.pathname = '/my-replay/' } else if (url.pathname === '/flags/') { url.pathname = '/my-flags/' } return url }, })` |
| <a id="property-sanitize_properties"></a> ~~`sanitize_properties`~~ | ((`properties`, `event_name`) => `Properties`) \| `null` | **Deprecated** - use `before_send` instead |
| <a id="property-save_campaign_params"></a> `save_campaign_params` | `boolean` | Determines whether PostHog should save marketing parameters. These are `utm_*` paramaters and friends. **See** from './utils/event-utils' - Default campaign parameters like utm_source, utm_medium, etc. **Default** `true` |
| <a id="property-save_referrer"></a> `save_referrer` | `boolean` | Determines whether PostHog should save referrer information. **Default** `true` |
| <a id="property-scroll_root_selector"></a> `scroll_root_selector?` | `string` \| `string`[] | Let the pageview scroll stats use a custom css selector for the root element, e.g. `main` It will use `window.document.documentElement` if not specified. |
| <a id="property-secure_cookie"></a> `secure_cookie` | `boolean` | Determines whether PostHog should use secure cookies. If this is `true`, PostHog cookies will be marked as secure, meaning they will only be transmitted over HTTPS. **Default** `window.location.protocol === 'https:'` |
| <a id="property-segment"></a> `segment?` | `SegmentIntegrationConfig` \| `SegmentAnalytics` | The Segment analytics object, or integration configuration. **Example** `segment: { analytics: window.analytics, filterProperties: (properties) => { for (const key in properties) { if (key.startsWith('$sdk_debug_')) { delete properties[key] } } return properties } }` **See** https://posthog.com/docs/libraries/segment |
| <a id="property-session_idle_timeout_seconds"></a> `session_idle_timeout_seconds` | `number` | Determines the session idle timeout in seconds. If no events are captured for this many seconds, the next event starts a new session with a new `$session_id` (and `$window_id`). The SDK may also proactively reset the stored session after the timeout while the page is idle, so the next event creates a new session. Session recording has a separate idle threshold: `session_recording.session_idle_threshold_ms`. That setting only controls when the user is considered idle, it does not rotate `$session_id`. Must be between 60 seconds and 10 hours. Values outside this range are clamped. **Default** `30 * 60 -- 30 minutes` |
| <a id="property-session_recording"></a> `session_recording` | `SessionRecordingOptions` | Determines the session recording options. For more session recording settings, see the `enable_recording_console_log` and `capture_performance` configuration option. When `defaults` is `'2025-11-30'` or later, `strictMinimumDuration` defaults to `true`. **See** `SessionRecordingOptions` **Default** `{}` |
| <a id="property-split_storage"></a> `split_storage?` | `boolean` | Store the feature-flag config cluster and survey config in their own localStorage entries (`<name>__flags`, `<name>__surveys`) instead of the single main persistence blob. These payloads are large and change rarely, so keeping them out of the main blob stops them riding on every high-frequency main-blob write and broadcasting cross-tab `storage` events. Only applies when persistence resolves to `localStorage` / `localStorage+cookie` (the split is pointless for `memory` / `sessionStorage` and impossible for `cookie`). On load the old main-blob location is read once and migrated forward, so upgrades never miss a cached flag. The `2026-05-30` config default opts in. **Default** `false` |
| <a id="property-store_google"></a> ~~`store_google?`~~ | `boolean` | **Deprecated** - Use `save_campaign_params` instead |
| <a id="property-strict_script_versioning"></a> `strict_script_versioning` | `boolean` \| `"fallback"` | Determines whether PostHog should load external dependency scripts from semver-qualified asset paths such as /static/1.370.0/recorder.js instead of the legacy /static/recorder.js?v=1.370.0 form. Set to `true` to use only versioned paths, `false` to use only legacy paths, or `'fallback'` to try the versioned path first and retry with the legacy path if it fails. **Default** `'fallback'` |
| <a id="property-surveys"></a> `surveys?` | `SurveyConfig` | Survey-specific configuration options. **Default** `undefined` |
| <a id="property-surveys_request_timeout_ms"></a> `surveys_request_timeout_ms` | `number` | Sets timeout for fetching surveys **Default** `10000` |
| <a id="property-token"></a> `token` | `string` | The token for your PostHog project. It should NOT be provided manually in the config, but rather passed as the first parameter to `posthog.init()`. |
| <a id="property-tracing_headers"></a> `tracing_headers?` | `string`[] | A list of hostnames for which to inject PostHog tracing headers to all requests (X-POSTHOG-DISTINCT-ID, X-POSTHOG-SESSION-ID, X-POSTHOG-WINDOW-ID). Used to link frontend sessions to backend traces (see https://posthog.com/docs/llm-analytics/link-session-replay). |
| <a id="property-ui_host"></a> `ui_host` | `string` \| `null` | If using a reverse proxy for `api_host` then this should be the actual PostHog app URL (e.g. https://us.posthog.com). This ensures that links to PostHog point to the correct host. **Default** `null` |
| <a id="property-upgrade"></a> `upgrade` | `boolean` | Determines whether PostHog should upgrade old cookies. If set to `true`, the library will check for a cookie from our old js library and import super properties from it, then the old cookie is deleted. This option only works in the initialization, so make sure you set it when you create the library. **Default** `false` |
| <a id="property-verbose"></a> ~~`verbose?`~~ | `boolean` | **Deprecated** Use `debug` instead |
| <a id="property-xhr_headers"></a> ~~`xhr_headers?`~~ | `object` | **Deprecated** - use `request_headers` instead |

### `PostHogFeatureFlags`

Legacy constructor and configuration mapping for the shared flags extension.

#### Extends

- `PostHogFeatureFlags`

#### Constructors

##### Constructor

> **new PostHogFeatureFlags**(`instance`): `PostHogFeatureFlags`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `instance` | `PostHog` |

###### Returns

`PostHogFeatureFlags`

#### Properties

| Property | Modifier | Type | Default value | Description | Overrides | Inherited from |
| ------ | ------ | ------ | ------ | ------ | ------ | ------ |
| <a id="_override_warning"></a> `_override_warning` | `public` | `boolean` | `undefined` | - | - | `PostHogFeatureFlags`.`_override_warning` |
| <a id="anon_distinct_id"></a> `$anon_distinct_id` | `public` | `string` \| `undefined` | `undefined` | - | - | `PostHogFeatureFlags`.`$anon_distinct_id` |
| <a id="featureflageventhandlers"></a> `featureFlagEventHandlers` | `public` | `FeatureFlagsCallback`[] | `undefined` | - | - | `PostHogFeatureFlags`.`featureFlagEventHandlers` |
| <a id="name-3"></a> `name` | `readonly` | `ExtensionToken`\<`PostHogFeatureFlags`\> | `FeatureFlagsExtension` | Stable extension name used for diagnostics and de-duplication within a client instance. | `PostHogFeatureFlags`.`name` | - |

#### Accessors

##### hasLoadedFlags

###### Get Signature

> **get** **hasLoadedFlags**(): `boolean`

###### Returns

`boolean`

#### Methods

##### \_callFlagsEndpoint()

> **\_callFlagsEndpoint**(`options?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | \{ `disableFlags?`: `boolean`; \} |
| `options.disableFlags?` | `boolean` |

###### Returns

`void`

##### \_fireFeatureFlagsCallbacks()

> **\_fireFeatureFlagsCallbacks**(`errorsLoading?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `errorsLoading?` | `boolean` |

###### Returns

`void`

##### \_prepareFeatureFlagsForCallbacks()

> **\_prepareFeatureFlagsForCallbacks**(): `object`

###### Returns

`object`

| Name | Type |
| ------ | ------ |
| `flags` | `string`[] |
| `flagVariants` | `Record`\<`string`, `string` \| `boolean`\> |

##### addFeatureFlagsHandler()

> **addFeatureFlagsHandler**(`handler`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `handler` | `FeatureFlagsCallback` |

###### Returns

`void`

##### destroy()

> **destroy**(): `void`

###### Returns

`void`

##### dispose()

> **dispose**(): `void`

Release final resources synchronously. Feature-level start/stop remains extension-owned.

###### Returns

`void`

##### ensureFlagsLoaded()

> **ensureFlagsLoaded**(): `void`

###### Returns

`void`

##### getAllFeatureFlags()

> **getAllFeatureFlags**(): `FeatureFlagResult`[]

###### Returns

`FeatureFlagResult`[]

##### getEarlyAccessFeatures()

> **getEarlyAccessFeatures**(`callback`, `force_reload?`, `stages?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `callback` | `EarlyAccessFeatureCallback` |
| `force_reload?` | `boolean` |
| `stages?` | `EarlyAccessFeatureStage`[] |

###### Returns

`void`

##### getFeatureFlag()

> **getFeatureFlag**(`key`, `options?`): `string` \| `boolean` \| `undefined`

Get feature flag's value for user.

By default, this method may return cached values from localStorage if the `/flags` endpoint
hasn't responded yet. This reduces flicker but means you might briefly see stale values
(e.g., a flag that was made globally inactive on the server).

An evaluated boolean flag returns `true` or `false`; `undefined` means no current evaluation
is available for the key. Globally inactive flags are omitted from the remote `/flags`
response, so after that response loads they are unavailable rather than represented by
a `false` result.

### Usage:

    if(posthog.getFeatureFlag('my-flag') === 'some-variant') { // do something }

    // Only use fresh values from the server (returns undefined until /flags responds)
    if(posthog.getFeatureFlag('my-flag', { fresh: true }) === 'some-variant') { // do something }

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | Key of the feature flag. |
| `options?` | `FeatureFlagOptions` | Optional settings. |

###### Returns

`string` \| `boolean` \| `undefined`

The flag value, or undefined if no current evaluation is available.

##### getFeatureFlagDetails()

> **getFeatureFlagDetails**(`key`): `FeatureFlagDetail` \| `undefined`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |

###### Returns

`FeatureFlagDetail` \| `undefined`

##### ~~getFeatureFlagPayload()~~

> **getFeatureFlagPayload**(`key`): `JsonType`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |

###### Returns

`JsonType`

###### Deprecated

Use `getFeatureFlagResult()` instead which properly tracks the feature flag call.
`getFeatureFlagPayload()` does not emit the `$feature_flag_called` event which may result in
missing analytics. This method will be removed in a future version.

##### getFeatureFlagResult()

> **getFeatureFlagResult**(`key`, `options?`): `FeatureFlagResult` \| `undefined`

Get a feature flag result including both the flag value and payload, while properly tracking the call.
This method emits the `$feature_flag_called` event by default.

By default, this method may return cached values from localStorage if the `/flags` endpoint
hasn't responded yet. This reduces flicker but means you might briefly see stale values
(e.g., a flag that was made globally inactive on the server).

A result with `enabled: false` is a conclusive off evaluation. `undefined` means no current
evaluation is available for the key. This includes globally inactive flags, which are omitted
from the remote `/flags` response.

### Usage:

    const result = posthog.getFeatureFlagResult('my-flag')
    if (result?.enabled) {
        console.log('Flag is enabled with payload:', result.payload)
    }

    // Only use fresh values from the server
    const freshResult = posthog.getFeatureFlagResult('my-flag', { fresh: true })

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | Key of the feature flag. |
| `options?` | `FeatureFlagOptions` | Options for the feature flag lookup. |

###### Returns

`FeatureFlagResult` \| `undefined`

The feature flag result including key, enabled, variant, and payload.

##### getFlagPayloads()

> **getFlagPayloads**(): `Record`\<`string`, `JsonType`\>

###### Returns

`Record`\<`string`, `JsonType`\>

##### getFlags()

> **getFlags**(): `string`[]

###### Returns

`string`[]

##### getFlagsWithDetails()

> **getFlagsWithDetails**(): `Record`\<`string`, `FeatureFlagDetail`\>

###### Returns

`Record`\<`string`, `FeatureFlagDetail`\>

##### getFlagVariants()

> **getFlagVariants**(): `Record`\<`string`, `string` \| `boolean`\>

###### Returns

`Record`\<`string`, `string` \| `boolean`\>

##### getRemoteConfigPayload()

> **getRemoteConfigPayload**(`key`, `callback`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |
| `callback` | `RemoteConfigFeatureFlagCallback` |

###### Returns

`void`

##### initialize()

> **initialize**(): `void`

###### Returns

`void`

##### isFeatureEnabled()

###### Call Signature

> **isFeatureEnabled**(`key`, `options?`): `boolean`

See if feature flag is enabled for user.

By default, this method may return cached values from localStorage if the `/flags` endpoint
hasn't responded yet. This reduces flicker but means you might briefly see stale values
(e.g., a flag that was made globally inactive on the server).

A `false` result means the flag value evaluated off; it does not mean the SDK observed the
flag's global active setting. When no current evaluation is available, this method returns
`options.defaultValue` if provided, otherwise `undefined`. Globally inactive flags are omitted
from the remote `/flags` response and therefore have no value.

### Usage:

    if(posthog.isFeatureEnabled('beta-feature')) { // do something }

    // Only use fresh values from the server
    if(posthog.isFeatureEnabled('beta-feature', { fresh: true })) { // do something }

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | Key of the feature flag. |
| `options?` | `FeatureFlagOptions` & `object` & `object` | Optional settings. |

###### Returns

`boolean`

Whether the flag is enabled; when the flag has no value, defaultValue if given, otherwise undefined.

###### Call Signature

> **isFeatureEnabled**(`key`, `options?`): `boolean` \| `undefined`

See if feature flag is enabled for user.

By default, this method may return cached values from localStorage if the `/flags` endpoint
hasn't responded yet. This reduces flicker but means you might briefly see stale values
(e.g., a flag that was made globally inactive on the server).

A `false` result means the flag value evaluated off; it does not mean the SDK observed the
flag's global active setting. When no current evaluation is available, this method returns
`options.defaultValue` if provided, otherwise `undefined`. Globally inactive flags are omitted
from the remote `/flags` response and therefore have no value.

### Usage:

    if(posthog.isFeatureEnabled('beta-feature')) { // do something }

    // Only use fresh values from the server
    if(posthog.isFeatureEnabled('beta-feature', { fresh: true })) { // do something }

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | Key of the feature flag. |
| `options?` | `IsFeatureEnabledOptions` | Optional settings. |

###### Returns

`boolean` \| `undefined`

Whether the flag is enabled; when the flag has no value, defaultValue if given, otherwise undefined.

##### onFeatureFlags()

> **onFeatureFlags**(`callback`): () => `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `callback` | `FeatureFlagsCallback` |

###### Returns

() => `void`

##### onReloading()

> **onReloading**(`handler`): () => `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `handler` | () => `void` |

###### Returns

() => `void`

##### ~~override()~~

> **override**(`flags`, `suppressWarning?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `flags` | `boolean` \| `string`[] \| `Record`\<`string`, `string` \| `boolean`\> |
| `suppressWarning?` | `boolean` |

###### Returns

`void`

###### Deprecated

Use overrideFeatureFlags instead. This will be removed in a future version.

##### overrideFeatureFlags()

> **overrideFeatureFlags**(`overrideOptions`): `void`

Override feature flags on the client-side. Useful for setting non-persistent feature flags,
or for testing/debugging feature flags in the PostHog app.

### Usage:

    - posthog.featureFlags.overrideFeatureFlags(false) // clear all overrides
    - posthog.featureFlags.overrideFeatureFlags(['beta-feature']) // enable flags
    - posthog.featureFlags.overrideFeatureFlags({'beta-feature': 'variant'}) // set variants
    - posthog.featureFlags.overrideFeatureFlags({ flags: ['beta-feature'] }) // enable flags
    - posthog.featureFlags.overrideFeatureFlags({ flags: {'beta-feature': 'variant'} }) // set variants
    - posthog.featureFlags.overrideFeatureFlags({ // set both flags and payloads
        flags: {'beta-feature': 'variant'},
        payloads: { 'beta-feature': { someData: true } }
      })
    - posthog.featureFlags.overrideFeatureFlags({ // only override payloads
        payloads: { 'beta-feature': { someData: true } }
      })

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `overrideOptions` | `OverrideFeatureFlagsOptions` |

###### Returns

`void`

##### receivedFeatureFlags()

> **receivedFeatureFlags**(`response`, `errorsLoading?`, `options?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `response` | `Partial`\<`FlagsResponse`\> |
| `errorsLoading?` | `boolean` |
| `options?` | \{ `partialResponse?`: `boolean`; \} |
| `options.partialResponse?` | `boolean` |

###### Returns

`void`

##### reloadFeatureFlags()

> **reloadFeatureFlags**(): `void`

Reloads feature flags asynchronously.

Constraints:

1. Avoid parallel requests
2. Delay a few milliseconds after each reloadFeatureFlags call to batch subsequent changes together

###### Returns

`void`

##### reloadFeatureFlagsAsync()

> **reloadFeatureFlagsAsync**(): `Promise`\<`FeatureFlagsReloadResult`\>

Await the next requested evaluation, rather than cached or locally injected flag changes.

###### Returns

`Promise`\<`FeatureFlagsReloadResult`\>

##### removeFeatureFlagsHandler()

> **removeFeatureFlagsHandler**(`handler`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `handler` | `FeatureFlagsCallback` |

###### Returns

`void`

##### reset()

> **reset**(): `void`

###### Returns

`void`

##### resetFlagCallReported()

> **resetFlagCallReported**(): `void`

###### Returns

`void`

##### resetGroupPropertiesForFlags()

> **resetGroupPropertiesForFlags**(`group_type?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `group_type?` | `string` |

###### Returns

`void`

##### resetPersonPropertiesForFlags()

> **resetPersonPropertiesForFlags**(`reloadFeatureFlags?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `reloadFeatureFlags?` | `boolean` |

###### Returns

`void`

##### sendFlagCallsPendingCapture()

> **sendFlagCallsPendingCapture**(): `void`

Sends `$feature_flag_called` for the flags read while capture was off, once the client can capture.

###### Returns

`void`

##### setAnonymousDistinctId()

> **setAnonymousDistinctId**(`anon_distinct_id`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `anon_distinct_id` | `string` \| `undefined` |

###### Returns

`void`

##### setGroupPropertiesForFlags()

> **setGroupPropertiesForFlags**(`properties`, `reloadFeatureFlags?`): `void`

Set override group properties for feature flags.
This is used when dealing with new groups / where you don't want to wait for ingestion
to update properties.
Takes in an object, the key of which is the group type.
For example:
    setGroupPropertiesForFlags({'organization': { name: 'CYZ', employees: '11' } })

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `properties` | \{\[`type`: `string`\]: `Properties`; \} |
| `reloadFeatureFlags?` | `boolean` |

###### Returns

`void`

##### setPersonPropertiesForFlags()

> **setPersonPropertiesForFlags**(`properties`, `reloadFeatureFlags?`): `void`

Set override person properties for feature flags.
This is used when dealing with new persons / where you don't want to wait for ingestion
to update user properties.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `properties` | `Properties` |
| `reloadFeatureFlags?` | `boolean` |

###### Returns

`void`

##### setReloadingPaused()

> **setReloadingPaused**(`isPaused`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `isPaused` | `boolean` |

###### Returns

`void`

##### setup()

> **setup**(`client`): `void` \| `Promise`\<`void`\>

Start the extension with the host client's capability surface. Called once
after construction; return a promise when setup needs asynchronous state.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `Client` |

###### Returns

`void` \| `Promise`\<`void`\>

##### unsetPersonPropertiesForFlags()

> **unsetPersonPropertiesForFlags**(`propertyNames`, `reloadFeatureFlags?`): `void`

Remove override person properties used for feature flags.
This is the counterpart to setPersonPropertiesForFlags, used when person properties
are unset so flags re-evaluate without the removed values.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `propertyNames` | `string`[] |
| `reloadFeatureFlags?` | `boolean` |

###### Returns

`void`

##### updateConfig()

> **updateConfig**(`config`, `remoteRequestsDisabled`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `config` | `PostHogConfig` |
| `remoteRequestsDisabled` | `boolean` |

###### Returns

`void`

##### updateEarlyAccessFeatureEnrollment()

> **updateEarlyAccessFeatureEnrollment**(`key`, `isEnrolled`, `stage?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |
| `isEnrolled` | `boolean` |
| `stage?` | `string` |

###### Returns

`void`

##### updateFlags()

> **updateFlags**(`flags`, `payloads?`, `options?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `flags` | `Record`\<`string`, `boolean` \| `string`\> |
| `payloads?` | `Record`\<`string`, `JsonType`\> |
| `options?` | \{ `merge?`: `boolean`; \} |
| `options.merge?` | `boolean` |

###### Returns

`void`

### `PostHogFeatureFlags`

A shared browser extension. The client calls `setup(client)` once to start it
and optional `dispose()` once for final best-effort resource cleanup.
Everything an extension consumes flows through Client.

`setup` may be async so an extension can read async KV state or remote config
before it is ready. Async extensions must guard work after each `await` so
cleanup cannot be followed by late listener, timer, or patch installation.
The disposables an extension creates in setup are its own to release.

An extension that exposes app-facing controls extends `Extension` with named
methods that share its state, e.g.:

```ts
interface SessionReplayExtension extends Extension {
    startRecording(): void
    stopRecording(): void
    isActive(): boolean
}
```

#### Extended by

- `PostHogFeatureFlags`

#### Implements

- `Extension`

#### Constructors

##### Constructor

> **new PostHogFeatureFlags**(`configSource`): `PostHogFeatureFlags`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `configSource` | `FeatureFlagsConfigSource` |

###### Returns

`PostHogFeatureFlags`

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="_override_warning-1"></a> `_override_warning` | `public` | `boolean` | - |
| <a id="anon_distinct_id-1"></a> `$anon_distinct_id` | `public` | `string` \| `undefined` | - |
| <a id="featureflageventhandlers-1"></a> `featureFlagEventHandlers` | `public` | `FeatureFlagsCallback`[] | - |
| <a id="name-4"></a> `name` | `readonly` | `string` | Stable extension name used for diagnostics and de-duplication within a client instance. |

#### Accessors

##### hasLoadedFlags

###### Get Signature

> **get** **hasLoadedFlags**(): `boolean`

###### Returns

`boolean`

#### Methods

##### \_callFlagsEndpoint()

> **\_callFlagsEndpoint**(`options?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | \{ `disableFlags?`: `boolean`; \} |
| `options.disableFlags?` | `boolean` |

###### Returns

`void`

##### \_fireFeatureFlagsCallbacks()

> **\_fireFeatureFlagsCallbacks**(`errorsLoading?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `errorsLoading?` | `boolean` |

###### Returns

`void`

##### \_prepareFeatureFlagsForCallbacks()

> **\_prepareFeatureFlagsForCallbacks**(): `object`

###### Returns

`object`

| Name | Type |
| ------ | ------ |
| `flags` | `string`[] |
| `flagVariants` | `Record`\<`string`, `string` \| `boolean`\> |

##### addFeatureFlagsHandler()

> **addFeatureFlagsHandler**(`handler`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `handler` | `FeatureFlagsCallback` |

###### Returns

`void`

##### destroy()

> **destroy**(): `void`

###### Returns

`void`

##### dispose()

> **dispose**(): `void`

Release final resources synchronously. Feature-level start/stop remains extension-owned.

###### Returns

`void`

##### ensureFlagsLoaded()

> **ensureFlagsLoaded**(): `void`

###### Returns

`void`

##### getAllFeatureFlags()

> **getAllFeatureFlags**(): `FeatureFlagResult`[]

###### Returns

`FeatureFlagResult`[]

##### getEarlyAccessFeatures()

> **getEarlyAccessFeatures**(`callback`, `force_reload?`, `stages?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `callback` | `EarlyAccessFeatureCallback` |
| `force_reload?` | `boolean` |
| `stages?` | `EarlyAccessFeatureStage`[] |

###### Returns

`void`

##### getFeatureFlag()

> **getFeatureFlag**(`key`, `options?`): `string` \| `boolean` \| `undefined`

Get feature flag's value for user.

By default, this method may return cached values from localStorage if the `/flags` endpoint
hasn't responded yet. This reduces flicker but means you might briefly see stale values
(e.g., a flag that was made globally inactive on the server).

An evaluated boolean flag returns `true` or `false`; `undefined` means no current evaluation
is available for the key. Globally inactive flags are omitted from the remote `/flags`
response, so after that response loads they are unavailable rather than represented by
a `false` result.

### Usage:

    if(posthog.getFeatureFlag('my-flag') === 'some-variant') { // do something }

    // Only use fresh values from the server (returns undefined until /flags responds)
    if(posthog.getFeatureFlag('my-flag', { fresh: true }) === 'some-variant') { // do something }

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | Key of the feature flag. |
| `options?` | `FeatureFlagOptions` | Optional settings. |

###### Returns

`string` \| `boolean` \| `undefined`

The flag value, or undefined if no current evaluation is available.

##### getFeatureFlagDetails()

> **getFeatureFlagDetails**(`key`): `FeatureFlagDetail` \| `undefined`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |

###### Returns

`FeatureFlagDetail` \| `undefined`

##### ~~getFeatureFlagPayload()~~

> **getFeatureFlagPayload**(`key`): `JsonType`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |

###### Returns

`JsonType`

###### Deprecated

Use `getFeatureFlagResult()` instead which properly tracks the feature flag call.
`getFeatureFlagPayload()` does not emit the `$feature_flag_called` event which may result in
missing analytics. This method will be removed in a future version.

##### getFeatureFlagResult()

> **getFeatureFlagResult**(`key`, `options?`): `FeatureFlagResult` \| `undefined`

Get a feature flag result including both the flag value and payload, while properly tracking the call.
This method emits the `$feature_flag_called` event by default.

By default, this method may return cached values from localStorage if the `/flags` endpoint
hasn't responded yet. This reduces flicker but means you might briefly see stale values
(e.g., a flag that was made globally inactive on the server).

A result with `enabled: false` is a conclusive off evaluation. `undefined` means no current
evaluation is available for the key. This includes globally inactive flags, which are omitted
from the remote `/flags` response.

### Usage:

    const result = posthog.getFeatureFlagResult('my-flag')
    if (result?.enabled) {
        console.log('Flag is enabled with payload:', result.payload)
    }

    // Only use fresh values from the server
    const freshResult = posthog.getFeatureFlagResult('my-flag', { fresh: true })

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | Key of the feature flag. |
| `options?` | `FeatureFlagOptions` | Options for the feature flag lookup. |

###### Returns

`FeatureFlagResult` \| `undefined`

The feature flag result including key, enabled, variant, and payload.

##### getFlagPayloads()

> **getFlagPayloads**(): `Record`\<`string`, `JsonType`\>

###### Returns

`Record`\<`string`, `JsonType`\>

##### getFlags()

> **getFlags**(): `string`[]

###### Returns

`string`[]

##### getFlagsWithDetails()

> **getFlagsWithDetails**(): `Record`\<`string`, `FeatureFlagDetail`\>

###### Returns

`Record`\<`string`, `FeatureFlagDetail`\>

##### getFlagVariants()

> **getFlagVariants**(): `Record`\<`string`, `string` \| `boolean`\>

###### Returns

`Record`\<`string`, `string` \| `boolean`\>

##### getRemoteConfigPayload()

> **getRemoteConfigPayload**(`key`, `callback`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |
| `callback` | `RemoteConfigFeatureFlagCallback` |

###### Returns

`void`

##### initialize()

> **initialize**(): `void`

###### Returns

`void`

##### isFeatureEnabled()

###### Call Signature

> **isFeatureEnabled**(`key`, `options?`): `boolean`

See if feature flag is enabled for user.

By default, this method may return cached values from localStorage if the `/flags` endpoint
hasn't responded yet. This reduces flicker but means you might briefly see stale values
(e.g., a flag that was made globally inactive on the server).

A `false` result means the flag value evaluated off; it does not mean the SDK observed the
flag's global active setting. When no current evaluation is available, this method returns
`options.defaultValue` if provided, otherwise `undefined`. Globally inactive flags are omitted
from the remote `/flags` response and therefore have no value.

### Usage:

    if(posthog.isFeatureEnabled('beta-feature')) { // do something }

    // Only use fresh values from the server
    if(posthog.isFeatureEnabled('beta-feature', { fresh: true })) { // do something }

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | Key of the feature flag. |
| `options?` | `FeatureFlagOptions` & `object` & `object` | Optional settings. |

###### Returns

`boolean`

Whether the flag is enabled; when the flag has no value, defaultValue if given, otherwise undefined.

###### Call Signature

> **isFeatureEnabled**(`key`, `options?`): `boolean` \| `undefined`

See if feature flag is enabled for user.

By default, this method may return cached values from localStorage if the `/flags` endpoint
hasn't responded yet. This reduces flicker but means you might briefly see stale values
(e.g., a flag that was made globally inactive on the server).

A `false` result means the flag value evaluated off; it does not mean the SDK observed the
flag's global active setting. When no current evaluation is available, this method returns
`options.defaultValue` if provided, otherwise `undefined`. Globally inactive flags are omitted
from the remote `/flags` response and therefore have no value.

### Usage:

    if(posthog.isFeatureEnabled('beta-feature')) { // do something }

    // Only use fresh values from the server
    if(posthog.isFeatureEnabled('beta-feature', { fresh: true })) { // do something }

###### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | Key of the feature flag. |
| `options?` | `IsFeatureEnabledOptions` | Optional settings. |

###### Returns

`boolean` \| `undefined`

Whether the flag is enabled; when the flag has no value, defaultValue if given, otherwise undefined.

##### onFeatureFlags()

> **onFeatureFlags**(`callback`): () => `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `callback` | `FeatureFlagsCallback` |

###### Returns

() => `void`

##### onReloading()

> **onReloading**(`handler`): () => `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `handler` | () => `void` |

###### Returns

() => `void`

##### ~~override()~~

> **override**(`flags`, `suppressWarning?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `flags` | `boolean` \| `string`[] \| `Record`\<`string`, `string` \| `boolean`\> |
| `suppressWarning?` | `boolean` |

###### Returns

`void`

###### Deprecated

Use overrideFeatureFlags instead. This will be removed in a future version.

##### overrideFeatureFlags()

> **overrideFeatureFlags**(`overrideOptions`): `void`

Override feature flags on the client-side. Useful for setting non-persistent feature flags,
or for testing/debugging feature flags in the PostHog app.

### Usage:

    - posthog.featureFlags.overrideFeatureFlags(false) // clear all overrides
    - posthog.featureFlags.overrideFeatureFlags(['beta-feature']) // enable flags
    - posthog.featureFlags.overrideFeatureFlags({'beta-feature': 'variant'}) // set variants
    - posthog.featureFlags.overrideFeatureFlags({ flags: ['beta-feature'] }) // enable flags
    - posthog.featureFlags.overrideFeatureFlags({ flags: {'beta-feature': 'variant'} }) // set variants
    - posthog.featureFlags.overrideFeatureFlags({ // set both flags and payloads
        flags: {'beta-feature': 'variant'},
        payloads: { 'beta-feature': { someData: true } }
      })
    - posthog.featureFlags.overrideFeatureFlags({ // only override payloads
        payloads: { 'beta-feature': { someData: true } }
      })

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `overrideOptions` | `OverrideFeatureFlagsOptions` |

###### Returns

`void`

##### receivedFeatureFlags()

> **receivedFeatureFlags**(`response`, `errorsLoading?`, `options?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `response` | `Partial`\<`FlagsResponse`\> |
| `errorsLoading?` | `boolean` |
| `options?` | \{ `partialResponse?`: `boolean`; \} |
| `options.partialResponse?` | `boolean` |

###### Returns

`void`

##### reloadFeatureFlags()

> **reloadFeatureFlags**(): `void`

Reloads feature flags asynchronously.

Constraints:

1. Avoid parallel requests
2. Delay a few milliseconds after each reloadFeatureFlags call to batch subsequent changes together

###### Returns

`void`

##### reloadFeatureFlagsAsync()

> **reloadFeatureFlagsAsync**(): `Promise`\<`FeatureFlagsReloadResult`\>

Await the next requested evaluation, rather than cached or locally injected flag changes.

###### Returns

`Promise`\<`FeatureFlagsReloadResult`\>

##### removeFeatureFlagsHandler()

> **removeFeatureFlagsHandler**(`handler`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `handler` | `FeatureFlagsCallback` |

###### Returns

`void`

##### reset()

> **reset**(): `void`

###### Returns

`void`

##### resetFlagCallReported()

> **resetFlagCallReported**(): `void`

###### Returns

`void`

##### resetGroupPropertiesForFlags()

> **resetGroupPropertiesForFlags**(`group_type?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `group_type?` | `string` |

###### Returns

`void`

##### resetPersonPropertiesForFlags()

> **resetPersonPropertiesForFlags**(`reloadFeatureFlags?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `reloadFeatureFlags?` | `boolean` |

###### Returns

`void`

##### sendFlagCallsPendingCapture()

> **sendFlagCallsPendingCapture**(): `void`

Sends `$feature_flag_called` for the flags read while capture was off, once the client can capture.

###### Returns

`void`

##### setAnonymousDistinctId()

> **setAnonymousDistinctId**(`anon_distinct_id`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `anon_distinct_id` | `string` \| `undefined` |

###### Returns

`void`

##### setGroupPropertiesForFlags()

> **setGroupPropertiesForFlags**(`properties`, `reloadFeatureFlags?`): `void`

Set override group properties for feature flags.
This is used when dealing with new groups / where you don't want to wait for ingestion
to update properties.
Takes in an object, the key of which is the group type.
For example:
    setGroupPropertiesForFlags({'organization': { name: 'CYZ', employees: '11' } })

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `properties` | \{\[`type`: `string`\]: `Properties`; \} |
| `reloadFeatureFlags?` | `boolean` |

###### Returns

`void`

##### setPersonPropertiesForFlags()

> **setPersonPropertiesForFlags**(`properties`, `reloadFeatureFlags?`): `void`

Set override person properties for feature flags.
This is used when dealing with new persons / where you don't want to wait for ingestion
to update user properties.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `properties` | `Properties` |
| `reloadFeatureFlags?` | `boolean` |

###### Returns

`void`

##### setReloadingPaused()

> **setReloadingPaused**(`isPaused`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `isPaused` | `boolean` |

###### Returns

`void`

##### setup()

> **setup**(`client`): `void` \| `Promise`\<`void`\>

Start the extension with the host client's capability surface. Called once
after construction; return a promise when setup needs asynchronous state.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `Client` |

###### Returns

`void` \| `Promise`\<`void`\>

##### unsetPersonPropertiesForFlags()

> **unsetPersonPropertiesForFlags**(`propertyNames`, `reloadFeatureFlags?`): `void`

Remove override person properties used for feature flags.
This is the counterpart to setPersonPropertiesForFlags, used when person properties
are unset so flags re-evaluate without the removed values.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `propertyNames` | `string`[] |
| `reloadFeatureFlags?` | `boolean` |

###### Returns

`void`

##### updateEarlyAccessFeatureEnrollment()

> **updateEarlyAccessFeatureEnrollment**(`key`, `isEnrolled`, `stage?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |
| `isEnrolled` | `boolean` |
| `stage?` | `string` |

###### Returns

`void`

##### updateFlags()

> **updateFlags**(`flags`, `payloads?`, `options?`): `void`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `flags` | `Record`\<`string`, `boolean` \| `string`\> |
| `payloads?` | `Record`\<`string`, `JsonType`\> |
| `options?` | \{ `merge?`: `boolean`; \} |
| `options.merge?` | `boolean` |

###### Returns

`void`

### `PostHogInterface`

> **PostHogInterface** = `Omit`\<`PostHog`, `"config"` \| `"init"` \| `"set_config"`\> & `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `config` | `PostHogConfig` |
| `set_config()` | (`config`) => `void` |

### `ProductTour`

| Property | Type |
| ------ | ------ |
| <a id="property-appearance"></a> `appearance?` | `ProductTourAppearance` |
| <a id="property-auto_launch"></a> `auto_launch?` | `boolean` |
| <a id="property-conditions"></a> `conditions?` | `ProductTourConditions` |
| <a id="property-current_iteration"></a> `current_iteration?` | `number` |
| <a id="property-description-4"></a> `description?` | `string` |
| <a id="property-disable_image_preload"></a> `disable_image_preload?` | `boolean` |
| <a id="property-display_frequency"></a> `display_frequency?` | `ProductTourDisplayFrequency` |
| <a id="property-end_date"></a> `end_date` | `string` \| `null` |
| <a id="property-id-4"></a> `id` | `string` |
| <a id="property-internal_targeting_flag_key"></a> `internal_targeting_flag_key?` | `string` |
| <a id="property-linked_flag_key"></a> `linked_flag_key?` | `string` |
| <a id="property-name-4"></a> `name` | `string` |
| <a id="property-start_date"></a> `start_date` | `string` \| `null` |
| <a id="property-steps"></a> `steps` | `ProductTourStep`[] |
| <a id="property-tour_type"></a> `tour_type` | `ProductTourType` |

### `ProductTourAppearance`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-backgroundcolor"></a> `backgroundColor?` | `string` | - |
| <a id="property-bordercolor"></a> `borderColor?` | `string` | - |
| <a id="property-borderradius-1"></a> `borderRadius?` | `number` | - |
| <a id="property-boxshadow"></a> `boxShadow?` | `string` | - |
| <a id="property-buttonborderradius"></a> `buttonBorderRadius?` | `number` | - |
| <a id="property-buttoncolor"></a> `buttonColor?` | `string` | - |
| <a id="property-dismissonclickoutside"></a> `dismissOnClickOutside?` | `boolean` | defaults to true, auto-set to false for announcements/banners |
| <a id="property-fontfamily-1"></a> `fontFamily?` | `string` | - |
| <a id="property-showoverlay"></a> `showOverlay?` | `boolean` | - |
| <a id="property-textcolor"></a> `textColor?` | `string` | - |
| <a id="property-whitelabel"></a> `whiteLabel?` | `boolean` | - |
| <a id="property-zindex"></a> `zIndex?` | `number` | - |

### `ProductTourBannerConfig`

| Property | Type |
| ------ | ------ |
| <a id="property-action"></a> `action?` | `object` |
| `action.link?` | `string` |
| `action.tourId?` | `string` |
| `action.type` | `"none"` \| `"link"` \| `"trigger_tour"` |
| <a id="property-animation"></a> `animation?` | `object` |
| `animation.duration?` | `number` |
| <a id="property-behavior"></a> `behavior` | `"sticky"` \| `"static"` \| `"custom"` |
| <a id="property-selector-2"></a> `selector?` | `string` |

### `ProductTourButtonAction`

> **ProductTourButtonAction** = `"dismiss"` \| `"link"` \| `"next_step"` \| `"previous_step"` \| `"trigger_tour"`

Button actions available on modal steps

### `ProductTourCallback`

> **ProductTourCallback** = (`tours`, `context?`) => `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tours` | `ProductTour`[] |
| `context?` | \{ `error?`: `string`; `isLoaded`: `boolean`; \} |
| `context.error?` | `string` |
| `context.isLoaded` | `boolean` |

#### Returns

`void`

### `ProductTourConditions`

| Property | Type |
| ------ | ------ |
| <a id="property-actions"></a> `actions?` | \{ `values`: `SurveyActionType`[]; \} \| `null` |
| <a id="property-autoshowdelayseconds"></a> `autoShowDelaySeconds?` | `number` |
| <a id="property-cancelevents"></a> `cancelEvents?` | \{ `values`: `SurveyEventWithFilters`[]; \} \| `null` |
| <a id="property-devicetypes"></a> `deviceTypes?` | `string`[] |
| <a id="property-events"></a> `events?` | \{ `values`: `SurveyEventWithFilters`[]; \} \| `null` |
| <a id="property-linkedflagvariant"></a> `linkedFlagVariant?` | `string` |
| <a id="property-seentourwaitperiod"></a> `seenTourWaitPeriod?` | `ProductTourWaitPeriod` |
| <a id="property-selector-3"></a> `selector?` | `string` |
| <a id="property-url-3"></a> `url?` | `string` |
| <a id="property-urlmatchtype"></a> `urlMatchType?` | `SurveyMatchType` |

### `ProductTourDismissReason`

> **ProductTourDismissReason** = `"user_clicked_skip"` \| `"user_clicked_outside"` \| `"escape_key"` \| `"element_unavailable"` \| `"container_unavailable"`

### `ProductTourDisplayFrequency`

> **ProductTourDisplayFrequency** = `"show_once"` \| `"until_interacted"` \| `"always"`

### `ProductTourEventName`

> **ProductTourEventName** = *typeof* `ProductTourEventName`\[keyof *typeof* `ProductTourEventName`\]

### `ProductTourEventProperties`

> **ProductTourEventProperties** = *typeof* `ProductTourEventProperties`\[keyof *typeof* `ProductTourEventProperties`\]

### `ProductTourRenderReason`

> **ProductTourRenderReason** = `"auto"` \| `"api"` \| `"trigger"` \| `"event"`

### `ProductTourSelectorError`

> **ProductTourSelectorError** = `"not_found"` \| `"multiple_matches"` \| `"not_visible"`

### `ProductTourStep`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bannerconfig"></a> `bannerConfig?` | `ProductTourBannerConfig` | Banner configuration (only for banner steps) |
| <a id="property-buttons"></a> `buttons?` | `ProductTourStepButtons` | Button configuration for modal steps |
| <a id="property-content-2"></a> `content` | `JSONContent` \| `null` | - |
| <a id="property-contenthtml"></a> `contentHtml?` | `string` | Pre-rendered HTML content from the editor. If present, SDK should use this instead of rendering from JSONContent. |
| <a id="property-id-5"></a> `id` | `string` | - |
| <a id="property-inferencedata"></a> `inferenceData?` | `InferredSelector` | Enhanced element data for more reliable lookup at runtime |
| <a id="property-linkedsurveyid"></a> `linkedSurveyId?` | `string` | ID of the auto-created survey for this step (set by backend) |
| <a id="property-linkedsurveyquestionid"></a> `linkedSurveyQuestionId?` | `string` | ID of the survey question (set by backend, used for event tracking) |
| <a id="property-maxwidth"></a> `maxWidth?` | `number` | Maximum tooltip width in pixels (defaults to 320px) |
| <a id="property-modalposition"></a> `modalPosition?` | `SurveyPosition` | Position for modal/survey steps (defaults to middle_center) |
| <a id="property-progressiontrigger"></a> `progressionTrigger` | `"button"` \| `"click"` | - |
| <a id="property-selector-4"></a> `selector?` | `string` | - |
| <a id="property-survey"></a> `survey?` | `ProductTourSurveyQuestion` | Inline survey question config - if present, this is a survey step |
| <a id="property-translations-3"></a> `translations?` | `Record`\<`string`, `ProductTourStepTranslation`\> | translation data for this tour step |
| <a id="property-type-8"></a> `type` | `ProductTourStepType` | - |
| <a id="property-usemanualselector"></a> `useManualSelector?` | `boolean` | Use CSS selector instead of inference. Defaults to false (use inference). |

### `ProductTourStepButton`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-action-1"></a> `action` | `ProductTourButtonAction` | - |
| <a id="property-link-1"></a> `link?` | `string` | URL to open when action is 'link' |
| <a id="property-text-6"></a> `text` | `string` | - |
| <a id="property-tourid"></a> `tourId?` | `string` | Tour ID to trigger when action is 'trigger_tour' |

### `ProductTourStepButtons`

| Property | Type |
| ------ | ------ |
| <a id="property-primary-2"></a> `primary?` | `ProductTourStepButton` |
| <a id="property-secondary"></a> `secondary?` | `ProductTourStepButton` |

### `ProductTourStepTranslation`

all translatable content for a given tour step

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-buttons-1"></a> `buttons?` | `object` |
| `buttons.primary?` | `Pick`\<`ProductTourStepButton`, `"text"`\> |
| `buttons.secondary?` | `Pick`\<`ProductTourStepButton`, `"text"`\> |
| <a id="property-content-3"></a> `content?` | `JSONContent` \| `null` |
| <a id="property-contenthtml-1"></a> `contentHtml?` | `string` |
| <a id="property-survey-1"></a> `survey?` | `Pick`\<`ProductTourSurveyQuestion`, `"questionText"` \| `"lowerBoundLabel"` \| `"upperBoundLabel"` \| `"submitButtonText"` \| `"backButtonText"`\> |

### `ProductTourStepType`

> **ProductTourStepType** = `"element"` \| `"modal"` \| `"survey"` \| `"banner"`

### `ProductTourSurveyQuestion`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-backbuttontext"></a> `backButtonText?` | `string` | - |
| <a id="property-display"></a> `display?` | `"number"` \| `"emoji"` | Rating display type - emoji or number |
| <a id="property-lowerboundlabel"></a> `lowerBoundLabel?` | `string` | Label for low end of rating scale (e.g., "Not likely") |
| <a id="property-questiontext"></a> `questionText` | `string` | - |
| <a id="property-scale"></a> `scale?` | `3` \| `5` \| `10` | Rating scale - 3 or 5 for emoji, 5 or 10 for number |
| <a id="property-submitbuttontext"></a> `submitButtonText?` | `string` | - |
| <a id="property-type-9"></a> `type` | `ProductTourSurveyQuestionType` | - |
| <a id="property-upperboundlabel"></a> `upperBoundLabel?` | `string` | Label for high end of rating scale (e.g., "Very likely") |

### `ProductTourSurveyQuestionType`

> **ProductTourSurveyQuestionType** = `"open"` \| `"rating"`

### `ProductTourType`

> **ProductTourType** = `"tour"` \| `"announcement"` \| `"banner"`

maps to main repo EffectiveProductTourType

### `ProductTourWaitPeriod`

| Property | Type |
| ------ | ------ |
| <a id="property-days"></a> `days` | `number` |
| <a id="property-types"></a> `types` | `ProductTourType`[] |

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

### `QueuedRequestWithOptions`

- `RequestWithOptions`

#### Extended by

- `RetriableRequestWithOptions`

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-batchgroup"></a> `batchGroup?` | `string` | requests sharing a batchKey are still sent separately when this differs | - |
| <a id="property-batchkey"></a> `batchKey?` | `string` | key of queue, e.g. 'sessionRecording' vs 'event' | - |
| <a id="property-callback"></a> `callback?` | (`response`) => `void` | - | `RequestWithOptions`.`callback` |
| <a id="property-compression"></a> `compression?` | `Compression` \| `"best-available"` | - | `RequestWithOptions`.`compression` |
| <a id="property-compressionfallback"></a> `compressionFallback?` | `Compression` | Used when best-available compression negotiation does not select a format. | `RequestWithOptions`.`compressionFallback` |
| <a id="property-data"></a> `data?` | `Record`\<`string`, `any`\> \| `Record`\<`string`, `any`\>[] | - | `RequestWithOptions`.`data` |
| <a id="property-disabletransport"></a> `disableTransport?` | (`"XHR"` \| `"fetch"` \| `"sendBeacon"`)[] | - | `RequestWithOptions`.`disableTransport` |
| <a id="property-fetchoptions"></a> `fetchOptions?` | `object` | - | `RequestWithOptions`.`fetchOptions` |
| `fetchOptions.cache?` | `RequestCache` | - | - |
| `fetchOptions.next?` | `NextOptions` | - | - |
| <a id="property-firecallbackondrop"></a> `fireCallbackOnDrop?` | `boolean` | When set, `_send_request` invokes `callback` with a synthetic response on the paths that otherwise drop a request without notifying the caller (client not loaded, server rate limit). Opt-in so existing callers keep their current behavior; the logs pipeline uses it to keep records for a later retry instead of losing them silently. | `RequestWithOptions`.`fireCallbackOnDrop` |
| <a id="property-headers"></a> `headers?` | `Record`\<`string`, `any`\> | - | `RequestWithOptions`.`headers` |
| <a id="property-method-1"></a> `method?` | `"POST"` \| `"GET"` | - | `RequestWithOptions`.`method` |
| <a id="property-noretries"></a> `noRetries?` | `boolean` | - | `RequestWithOptions`.`noRetries` |
| <a id="property-ondispatch"></a> `onDispatch?` | () => `void` | Called each time `_send_request` hands the request to the transport. It is not called on the paths that drop the request before the network. | `RequestWithOptions`.`onDispatch` |
| <a id="property-prefersynccompression"></a> `preferSyncCompression?` | `boolean` | Bypasses asynchronous CompressionStream gzip in favor of synchronous compression. Used for immediate requests so compression does not delay dispatch until after a navigation or page unload. | `RequestWithOptions`.`preferSyncCompression` |
| <a id="property-timeout"></a> `timeout?` | `number` | - | `RequestWithOptions`.`timeout` |
| <a id="property-timestampmode"></a> `timestampMode?` | `"body"` \| `"capture-body"` \| `"query"` | Controls where the request dispatch time is sent. - `body` adds ISO `sent_at` to the request object, or every object in an array (for example, flags and recordings). - `capture-body` wraps events in `{ api_key, batch, sent_at }` with an ISO timestamp. - `query` adds numeric `sent_at` to POST requests or cache-busting `_` to GET requests. | `RequestWithOptions`.`timestampMode` |
| <a id="property-transport-1"></a> `transport?` | `"XHR"` \| `"fetch"` \| `"sendBeacon"` | - | `RequestWithOptions`.`transport` |
| <a id="property-url-4"></a> `url` | `string` | - | `RequestWithOptions`.`url` |
| <a id="property-urlqueryargs"></a> `urlQueryArgs?` | `object` | - | `RequestWithOptions`.`urlQueryArgs` |
| `urlQueryArgs.compression` | `Compression` | - | - |

### `RageclickConfig`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-click_count"></a> `click_count?` | `number` | Number of consecutive clicks within the timeout to qualify as a rage click. **Default** `3` |
| <a id="property-content_ignorelist"></a> `content_ignorelist?` | `boolean` \| `string`[] | Controls automatic exclusion of elements by text content from rageclick detection. Useful for pagination buttons and other repeatedly-clicked UI elements. - `true`: Use the default keywords, which cover next/previous/prev wording and arrow glyphs such as '>', '<', '→', '←', '»', '«' - `false`: Disable content-based exclusion - `string[]`: Use custom keywords (max 29 items, otherwise use css_selector_ignorelist) Checks the text and aria-label of the clicked control (the nearest button, link or other interactive ancestor) against the keywords, case-insensitive. The label of a surrounding region is not checked, so a labelled wrapper does not suppress the controls inside it. The built-in word keywords (next/previous/prev/etc.) match whole words wherever they appear, even inside a list you pass yourself, so 'prev' doesn't suppress "Preview". Any other word keyword you add matches as a substring. Symbol-only keywords (e.g. '+', '-', '>') always match exactly, so they don't suppress text like "sign-up", "5 > 3", or "C++". Below the `'2025-11-30'` defaults, and in any `set_config` call, a `rageclick` object you pass replaces the default instead of merging with it, so set this property explicitly there to keep content filtering. **Default** undefined (`true` when `defaults` is `'2025-11-30'` or later; the default keywords plus the '+', '-', '−', '–' steppers when `defaults` is `'2026-05-30'` or later) |
| <a id="property-css_selector_ignorelist-1"></a> `css_selector_ignorelist?` | `string`[] | List of CSS selectors to ignore rageclicks on e.g. ['.my-calendar-button'] we consider the tree of elements from the root to the target element of the click event so for the tree div > div > button > svg and ignore list config `['[id]']` we will ignore the rageclick if the click-target or its parents has any id Nothing is ignored when there's an empty ignorelist, e.g. [] If no ignorelist is set, we default to ignoring .ph-no-rageclick If an element has .ph-no-capture, it will always be ignored by rageclick and autocapture |
| <a id="property-ignore_text_selection"></a> `ignore_text_selection?` | `boolean` | Excludes text-editing surfaces (textarea, text-like inputs, and contenteditable elements) from rageclick detection, since rapid repeated clicks there are double/triple-click text selection rather than rage. Enabled by default from the 2026-05-30 config defaults onwards. **Default** `false` |
| <a id="property-threshold_px"></a> `threshold_px?` | `number` | Maximum pixel distance between clicks to still be considered a rage click. **Default** `30` |
| <a id="property-timeout_ms"></a> `timeout_ms?` | `number` | Maximum time window (in milliseconds) between the first and last click. **Default** `1000` |

### `RatingSurveyQuestion`

- `SurveyQuestionBase`

#### Properties

| Property | Type | Inherited from |
| ------ | ------ | ------ |
| <a id="property-branching-3"></a> `branching?` | `NextQuestionBranching` \| `EndBranching` \| `ResponseBasedBranching` \| `SpecificQuestionBranching` | `SurveyQuestionBase`.`branching` |
| <a id="property-buttontext-3"></a> `buttonText?` | `string` | `SurveyQuestionBase`.`buttonText` |
| <a id="property-description-5"></a> `description?` | `string` \| `null` | `SurveyQuestionBase`.`description` |
| <a id="property-descriptioncontenttype-3"></a> `descriptionContentType?` | `SurveyQuestionDescriptionContentType` | `SurveyQuestionBase`.`descriptionContentType` |
| <a id="property-display-1"></a> `display` | `"number"` \| `"emoji"` | - |
| <a id="property-id-6"></a> `id?` | `string` | `SurveyQuestionBase`.`id` |
| <a id="property-lowerboundlabel-1"></a> `lowerBoundLabel` | `string` | - |
| <a id="property-optional-3"></a> `optional?` | `boolean` | `SurveyQuestionBase`.`optional` |
| <a id="property-question-3"></a> `question` | `string` | `SurveyQuestionBase`.`question` |
| <a id="property-scale-1"></a> `scale` | `2` \| `3` \| `5` \| `7` \| `10` | - |
| <a id="property-skipsubmitbutton-1"></a> `skipSubmitButton?` | `boolean` | - |
| <a id="property-translations-4"></a> `translations?` | `Record`\<`string`, `SurveyQuestionTranslation`\> | `SurveyQuestionBase`.`translations` |
| <a id="property-type-10"></a> `type` | `"rating"` | - |
| <a id="property-upperboundlabel-1"></a> `upperBoundLabel` | `string` | - |
| <a id="property-validation-3"></a> `validation?` | `SurveyValidationRule`[] | `SurveyQuestionBase`.`validation` |

### `RemoteConfig`

Remote configuration for a PostHog browser client.

These settings can be configured in PostHog. Configuration set directly on
the client takes precedence over values from the server.

#### Extended by

- `FlagsResponse`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-analytics-1"></a> `analytics?` | `object` | Custom endpoint configuration for analytics events. |
| `analytics.endpoint?` | `string` | - |
| <a id="property-autocapture_opt_out-1"></a> `autocapture_opt_out?` | `boolean` | If true, disables autocapture. When absent or not a boolean, the SDK keeps the last known server value; a visitor with no stored value keeps autocapture off until a response containing the field arrives. |
| <a id="property-autocaptureexceptions-1"></a> `autocaptureExceptions?` | `boolean` \| \{ `endpoint?`: `string`; \} | Exception autocapture configuration. |
| <a id="property-capturedeadclicks-1"></a> `captureDeadClicks?` | `boolean` | Whether to capture dead clicks. |
| <a id="property-captureperformance-1"></a> `capturePerformance?` | `boolean` \| `PerformanceCaptureConfig` | Performance capture configuration shared by replay and web vitals. |
| <a id="property-conversations-1"></a> `conversations?` | `boolean` \| `ConversationsRemoteConfig` | Conversations widget configuration. |
| <a id="property-defaultidentifiedonly-1"></a> `defaultIdentifiedOnly?` | `boolean` | Whether to capture only identified users by default. |
| <a id="property-editorparams-1"></a> ~~`editorParams?`~~ | `ToolbarParams` | **Deprecated** Renamed to `toolbarParams`; still present on older API responses. |
| <a id="property-elementschainasstring-1"></a> `elementsChainAsString?` | `boolean` | Whether `$elements_chain` is sent as a string rather than an array. |
| <a id="property-errortracking-1"></a> `errorTracking?` | `object` | Error tracking configuration. |
| `errorTracking.autocaptureExceptions?` | `boolean` | - |
| `errorTracking.captureExtensionExceptions?` | `boolean` | - |
| `errorTracking.suppressionRules?` | `ErrorTrackingSuppressionRule`[] | - |
| <a id="property-hasfeatureflags-1"></a> `hasFeatureFlags?` | `boolean` | Whether the team has any feature flags enabled. |
| <a id="property-heatmaps-1"></a> `heatmaps?` | `boolean` | Whether heatmaps are enabled. |
| <a id="property-isauthenticated-1"></a> `isAuthenticated` | `boolean` | Whether the current user is authenticated. |
| <a id="property-logs-1"></a> `logs?` | `object` | Log capture configuration. |
| `logs.captureConsoleLogs?` | `boolean` | - |
| <a id="property-producttours-1"></a> `productTours?` | `boolean` | Whether product tours are enabled. |
| <a id="property-sessionrecording-1"></a> `sessionRecording?` | `false` \| `SessionRecordingRemoteConfig` | Session recording configuration. |
| <a id="property-siteapps-1"></a> `siteApps` | `object`[] | Site apps available to the client. |
| <a id="property-supportedcompression-1"></a> `supportedCompression` | `Compression`[] | Supported compression algorithms. |
| <a id="property-surveys-1"></a> `surveys?` | `boolean` \| `Survey`[] | Whether surveys are enabled, optionally including their definitions. |
| <a id="property-toolbarparams-1"></a> `toolbarParams` | `ToolbarParams` | Parameters for the toolbar. |
| <a id="property-toolbarversion-1"></a> ~~`toolbarVersion`~~ | `"toolbar"` | **Deprecated** Moved to `toolbarParams`. |

### `RemoteConfigFeatureFlagCallback`

> **RemoteConfigFeatureFlagCallback** = (`payload`) => `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `payload` | `JsonType` |

#### Returns

`void`

### `RequestCallback`

> **RequestCallback** = (`response`) => `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `response` | `RequestResponse` |

#### Returns

`void`

### `RequestQueueConfig`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-flush_interval_ms"></a> `flush_interval_ms?` | `number` | ADVANCED - alters the frequency which PostHog sends events to the server. generally speaking this is only set when apps have automatic page refreshes, or very short visits. Defaults to 3 seconds when not set Allowed values between 250 and 5000 |

### `RequestResponse`

| Property | Type |
| ------ | ------ |
| <a id="property-error"></a> `error?` | `unknown` |
| <a id="property-json"></a> `json?` | `any` |
| <a id="property-statuscode"></a> `statusCode` | `number` |
| <a id="property-text-7"></a> `text?` | `string` |

### `RequestRestoreLinkPayload`

Payload for requesting a self-service restore link email

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-email-2"></a> `email` | `string` |
| <a id="property-request_url"></a> `request_url` | `string` |

### `RequestRestoreLinkResponse`

Response from self-service restore link request

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-ok"></a> `ok` | `true` |

### `RequestTarget`

> **RequestTarget** = `"api"` \| `"flags"` \| `"assets"`

Configured host used to resolve a relative request path.

### `RequestTransport`

> **RequestTransport** = `"XHR"` \| `"fetch"` \| `"sendBeacon"`

Browser transport requested for a send.

### `RequestWithOptions`

- `QueuedRequestWithOptions`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-callback-1"></a> `callback?` | (`response`) => `void` | - |
| <a id="property-compression-1"></a> `compression?` | `Compression` \| `"best-available"` | - |
| <a id="property-compressionfallback-1"></a> `compressionFallback?` | `Compression` | Used when best-available compression negotiation does not select a format. |
| <a id="property-data-1"></a> `data?` | `Record`\<`string`, `any`\> \| `Record`\<`string`, `any`\>[] | - |
| <a id="property-disabletransport-1"></a> `disableTransport?` | (`"XHR"` \| `"fetch"` \| `"sendBeacon"`)[] | - |
| <a id="property-fetchoptions-1"></a> `fetchOptions?` | `object` | - |
| `fetchOptions.cache?` | `RequestCache` | - |
| `fetchOptions.next?` | `NextOptions` | - |
| <a id="property-firecallbackondrop-1"></a> `fireCallbackOnDrop?` | `boolean` | When set, `_send_request` invokes `callback` with a synthetic response on the paths that otherwise drop a request without notifying the caller (client not loaded, server rate limit). Opt-in so existing callers keep their current behavior; the logs pipeline uses it to keep records for a later retry instead of losing them silently. |
| <a id="property-headers-1"></a> `headers?` | `Record`\<`string`, `any`\> | - |
| <a id="property-method-2"></a> `method?` | `"POST"` \| `"GET"` | - |
| <a id="property-noretries-1"></a> `noRetries?` | `boolean` | - |
| <a id="property-ondispatch-1"></a> `onDispatch?` | () => `void` | Called each time `_send_request` hands the request to the transport. It is not called on the paths that drop the request before the network. |
| <a id="property-prefersynccompression-1"></a> `preferSyncCompression?` | `boolean` | Bypasses asynchronous CompressionStream gzip in favor of synchronous compression. Used for immediate requests so compression does not delay dispatch until after a navigation or page unload. |
| <a id="property-timeout-1"></a> `timeout?` | `number` | - |
| <a id="property-timestampmode-1"></a> `timestampMode?` | `"body"` \| `"capture-body"` \| `"query"` | Controls where the request dispatch time is sent. - `body` adds ISO `sent_at` to the request object, or every object in an array (for example, flags and recordings). - `capture-body` wraps events in `{ api_key, batch, sent_at }` with an ISO timestamp. - `query` adds numeric `sent_at` to POST requests or cache-busting `_` to GET requests. |
| <a id="property-transport-2"></a> `transport?` | `"XHR"` \| `"fetch"` \| `"sendBeacon"` | - |
| <a id="property-url-5"></a> `url` | `string` | - |
| <a id="property-urlqueryargs-1"></a> `urlQueryArgs?` | `object` | - |
| `urlQueryArgs.compression` | `Compression` | - |

### `ResetOptions`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bootstrap"></a> `bootstrap?` | `BootstrapConfig` | Identity, feature flag, and session values to apply after resetting. |
| <a id="property-resetdeviceid"></a> `resetDeviceID?` | `boolean` | Whether to generate a new device ID as well as a new distinct ID. **Default** `false` |

### `ResponseBasedBranching`

| Property | Type |
| ------ | ------ |
| <a id="property-responsevalues"></a> `responseValues` | `Record`\<`string`, `any`\> |
| <a id="property-type-6"></a> `type` | `"response_based"` |

### `RestoreFromTokenPayload`

Payload for restoring ticket access from a one-time token

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-current_url"></a> `current_url?` | `string` | Optional current URL for backend observability |
| <a id="property-distinct_id"></a> `distinct_id?` | `string` | Optional distinct ID for debugging/observability |
| <a id="property-restore_token"></a> `restore_token` | `string` | Opaque one-time restore token from email link |
| <a id="property-widget_session_id"></a> `widget_session_id` | `string` | Current browser widget session ID requesting restore |

### `RestoreFromTokenResponse`

Response from restore token exchange endpoint

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-code"></a> `code?` | `string` | Optional machine-readable backend code |
| <a id="property-migrated_ticket_ids"></a> `migrated_ticket_ids?` | `string`[] | Migrated ticket IDs, if any |
| <a id="property-status-2"></a> `status` | `RestoreFromTokenStatus` | Restore result |
| <a id="property-widget_session_id-1"></a> `widget_session_id?` | `string` | Canonical widget session ID to use after restore |

### `RestoreFromTokenStatus`

> **RestoreFromTokenStatus** = `"success"` \| `"expired"` \| `"invalid"` \| `"used"`

### `RetriableRequestWithOptions`

- `QueuedRequestWithOptions`

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-batchgroup-1"></a> `batchGroup?` | `string` | requests sharing a batchKey are still sent separately when this differs | `QueuedRequestWithOptions`.`batchGroup` |
| <a id="property-batchkey-1"></a> `batchKey?` | `string` | key of queue, e.g. 'sessionRecording' vs 'event' | `QueuedRequestWithOptions`.`batchKey` |
| <a id="property-callback-2"></a> `callback?` | (`response`) => `void` | - | `QueuedRequestWithOptions`.`callback` |
| <a id="property-compression-2"></a> `compression?` | `Compression` \| `"best-available"` | - | `QueuedRequestWithOptions`.`compression` |
| <a id="property-compressionfallback-2"></a> `compressionFallback?` | `Compression` | Used when best-available compression negotiation does not select a format. | `QueuedRequestWithOptions`.`compressionFallback` |
| <a id="property-data-2"></a> `data?` | `Record`\<`string`, `any`\> \| `Record`\<`string`, `any`\>[] | - | `QueuedRequestWithOptions`.`data` |
| <a id="property-disabletransport-2"></a> `disableTransport?` | (`"XHR"` \| `"fetch"` \| `"sendBeacon"`)[] | - | `QueuedRequestWithOptions`.`disableTransport` |
| <a id="property-fetchoptions-2"></a> `fetchOptions?` | `object` | - | `QueuedRequestWithOptions`.`fetchOptions` |
| `fetchOptions.cache?` | `RequestCache` | - | - |
| `fetchOptions.next?` | `NextOptions` | - | - |
| <a id="property-firecallbackondrop-2"></a> `fireCallbackOnDrop?` | `boolean` | When set, `_send_request` invokes `callback` with a synthetic response on the paths that otherwise drop a request without notifying the caller (client not loaded, server rate limit). Opt-in so existing callers keep their current behavior; the logs pipeline uses it to keep records for a later retry instead of losing them silently. | `QueuedRequestWithOptions`.`fireCallbackOnDrop` |
| <a id="property-headers-2"></a> `headers?` | `Record`\<`string`, `any`\> | - | `QueuedRequestWithOptions`.`headers` |
| <a id="property-method-3"></a> `method?` | `"POST"` \| `"GET"` | - | `QueuedRequestWithOptions`.`method` |
| <a id="property-noretries-2"></a> `noRetries?` | `boolean` | - | `QueuedRequestWithOptions`.`noRetries` |
| <a id="property-ondispatch-2"></a> `onDispatch?` | () => `void` | Called each time `_send_request` hands the request to the transport. It is not called on the paths that drop the request before the network. | `QueuedRequestWithOptions`.`onDispatch` |
| <a id="property-prefersynccompression-2"></a> `preferSyncCompression?` | `boolean` | Bypasses asynchronous CompressionStream gzip in favor of synchronous compression. Used for immediate requests so compression does not delay dispatch until after a navigation or page unload. | `QueuedRequestWithOptions`.`preferSyncCompression` |
| <a id="property-retriesperformedsofar"></a> `retriesPerformedSoFar?` | `number` | - | - |
| <a id="property-timeout-2"></a> `timeout?` | `number` | - | `QueuedRequestWithOptions`.`timeout` |
| <a id="property-timestampmode-2"></a> `timestampMode?` | `"body"` \| `"capture-body"` \| `"query"` | Controls where the request dispatch time is sent. - `body` adds ISO `sent_at` to the request object, or every object in an array (for example, flags and recordings). - `capture-body` wraps events in `{ api_key, batch, sent_at }` with an ISO timestamp. - `query` adds numeric `sent_at` to POST requests or cache-busting `_` to GET requests. | `QueuedRequestWithOptions`.`timestampMode` |
| <a id="property-transport-3"></a> `transport?` | `"XHR"` \| `"fetch"` \| `"sendBeacon"` | - | `QueuedRequestWithOptions`.`transport` |
| <a id="property-url-6"></a> `url` | `string` | - | `QueuedRequestWithOptions`.`url` |
| <a id="property-urlqueryargs-2"></a> `urlQueryArgs?` | `object` | - | `QueuedRequestWithOptions`.`urlQueryArgs` |
| `urlQueryArgs.compression` | `Compression` | - | - |

### `SegmentAnalytics`

> **SegmentAnalytics** = `object`

Segment analytics object used for integration with PostHog

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="register-7"></a> `register` | (`integration`) => `Promise`\<`any`\> | Segment SDK versions use different plugin and resolved value types. `any` keeps current SDK types assignable without breaking legacy consumers that expect `Promise<void>`. |
| <a id="user"></a> `user` | () => `SegmentAnalyticsUser` \| `Promise`\<`SegmentAnalyticsUser`\> | - |

### `SegmentAnalyticsUser`

> **SegmentAnalyticsUser** = `object`

#### Methods

##### anonymousId()

> **anonymousId**(): `string` \| `null` \| `undefined`

###### Returns

`string` \| `null` \| `undefined`

##### id()

> **id**(): `string` \| `null` \| `undefined`

###### Returns

`string` \| `null` \| `undefined`

### `SegmentEnrichmentFilterFn`

> **SegmentEnrichmentFilterFn** = (`properties`) => `Properties` \| `null`

Filters non-colliding properties generated by PostHog before they are added to a Segment event.
Original Segment properties are excluded. Returning `null` skips PostHog enrichment for that event.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `properties` | `Properties` |

#### Returns

`Properties` \| `null`

### `SegmentIntegrationConfig`

> **SegmentIntegrationConfig** = `object`

Configuration for the PostHog Segment integration.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="analytics"></a> `analytics` | `SegmentAnalytics` | The Segment analytics object. |
| <a id="filterproperties"></a> `filterProperties?` | `SegmentEnrichmentFilterFn` \| `SegmentEnrichmentFilterFn`[] | A function or array of functions called with the properties generated by PostHog before they are added to a Segment event. Return the properties to add, or `null` to leave the original Segment event unenriched. Original Segment properties are not passed to these functions. They are merged afterward and take precedence over properties returned by this hook. If a function throws, the original Segment event is left unchanged. |

### `SendMessagePayload`

Payload for sending a message via the conversations API

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-distinct_id-1"></a> `distinct_id` | `string` | Distinct ID for linking to PostHog Person |
| <a id="property-identity_distinct_id"></a> `identity_distinct_id?` | `string` | Verified distinct_id for HMAC identity mode (requires identity_hash) |
| <a id="property-identity_hash"></a> `identity_hash?` | `string` | HMAC-SHA256 of identity_distinct_id, signed with the Secret API key from Support settings. Project secret API keys (project settings) and personal API keys are rejected. |
| <a id="property-message"></a> `message` | `string` | The message content to send |
| <a id="property-session_context"></a> `session_context?` | `SessionContext` | Session context captured when creating a new ticket Stored in a JSONField for flexibility |
| <a id="property-session_id"></a> `session_id?` | `string` | Session ID captured when creating a new ticket Stored as a separate queryable DB field |
| <a id="property-ticket_id-1"></a> `ticket_id` | `string` \| `null` | Ticket ID to send the message to (null to create a new ticket) |
| <a id="property-traits"></a> `traits` | `object` | User identification traits |
| `traits.email` | `string` \| `null` | - |
| `traits.name` | `string` \| `null` | - |
| <a id="property-widget_session_id-2"></a> `widget_session_id` | `string` | Widget session ID for access control |

### `SendMessageResponse`

Response from sending a message

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-created_at-1"></a> `created_at` | `string` | ISO timestamp when the message was created |
| <a id="property-message_id"></a> `message_id` | `string` | ID of the newly created message |
| <a id="property-ticket_id-2"></a> `ticket_id` | `string` | ID of the ticket this message belongs to |
| <a id="property-ticket_status-1"></a> `ticket_status` | `TicketStatus` | Current status of the ticket |
| <a id="property-unread_count-2"></a> `unread_count` | `number` | Number of unread messages from the team After customer sends a message, this is always 0 |

### `SendRequestInit`

Options for sending a request through Client.sendRequest.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `unknown` | JSON-serialized by the client. |
| <a id="property-compression-1"></a> `compression?` | `Compression` \| `"best-available"` | Compression used by the browser transport. |
| <a id="property-headers"></a> `headers?` | `Record`\<`string`, `string`\> | Additional headers merged with the host SDK's configured request headers. |
| <a id="property-method"></a> `method?` | `"POST"` \| `"GET"` | HTTP method to use; the host transport's default applies when omitted. |
| <a id="property-query"></a> `query?` | `Record`\<`string`, `string`\> | Query string parameters appended to the request URL. |
| <a id="property-sentat"></a> `sentAt?` | `"body"` \| `"query"` | Where POST requests add `sent_at`. For GET, `query` adds the cache-busting `_` parameter and `body` has no effect. |
| <a id="property-target"></a> `target?` | `RequestTarget` | Configured host to send through; defaults to the regular API host. |
| <a id="property-timeoutms"></a> `timeoutMs?` | `number` | Abort the request if it does not complete within this many milliseconds. |
| <a id="property-transport"></a> `transport?` | `RequestTransport` | Browser transport to prefer. Fetch is the normal runtime transport. Use `sendBeacon` only for an eligible best-effort teardown POST. Its response confirms browser handoff, not delivery. |

### `SessionContext`

Session context captured when creating a new ticket

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-current_url-1"></a> `current_url?` | `string` | Page URL where the ticket was created |
| <a id="property-session_replay_url"></a> `session_replay_url?` | `string` | URL to the session replay at the time the ticket was created Includes timestamp to jump to the exact moment |

### `SessionContext`

The current session, stamped on events to tie them to a session and a browser tab.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-lastactivitytimestamp"></a> `lastActivityTimestamp` | `readonly` | `number` | Most recent session activity, as a Unix timestamp in milliseconds. |
| <a id="property-sessionid-1"></a> `sessionId` | `readonly` | `string` | The stable session identifier attached to events captured during this session. |
| <a id="property-sessionstarttimestamp"></a> `sessionStartTimestamp` | `readonly` | `number` | When the session started, as a Unix timestamp in milliseconds. |
| <a id="property-windowid"></a> `windowId` | `readonly` | `string` | The logical browser tab/window identifier attached alongside the session id. |

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

### `SessionRecordingCanvasOptions`

> **SessionRecordingCanvasOptions** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="canvasfps"></a> `canvasFps?` | `number` \| `null` | If set, records the canvas at the given FPS Can be set in the remote configuration Limited between 0 and 12 When canvas recording is enabled, if this is not set locally, then remote config sets this as 4 **Default** `null-ish` |
| <a id="canvasquality"></a> `canvasQuality?` | `string` \| `null` | If set, records the canvas at the given quality Can be set in the remote configuration Must be a string that is a valid decimal between 0 and 1 When canvas recording is enabled, if this is not set locally, then remote config sets this as "0.4" **Default** `null-ish` |
| <a id="recordcanvas"></a> `recordCanvas?` | `boolean` \| `null` | If set, records the canvas **Default** `false` |

### `SessionRecordingEventTrigger`

V2 event trigger - always an object with name, optionally with property filters.
The server normalizes bare event name strings to this shape before sending.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-name-5"></a> `name` | `string` |
| <a id="property-properties-3"></a> `properties?` | `SessionRecordingTriggerPropertyFilter`[] |

### `SessionRecordingOptions`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-__mutationbytesbucketsize"></a> `__mutationBytesBucketSize?` | `number` | ADVANCED: enables the mutation byte budget by setting its burst allowance, in bytes. Also the largest single mutation event that will be recorded. Unset (the default), the byte budget is off. 1048576 (1MB) is a sensible starting point. Normally only altered alongside posthog support guidance. **Default** `undefined` |
| <a id="property-__mutationbytesrefillrate"></a> `__mutationBytesRefillRate?` | `number` | ADVANCED: the sustained mutation byte budget, in bytes per second. Mutation events beyond the budget are dropped and the recording resyncs with a full snapshot. Only takes effect when `__mutationBytesBucketSize` is set. Normally only altered alongside posthog support guidance. **Default** `25600` |
| <a id="property-__mutationthrottlerbucketsize"></a> `__mutationThrottlerBucketSize?` | `number` | ADVANCED: alters the bucket size for the token bucket mutation throttling Normally only altered alongside posthog support guidance. Accepts values between 0 and 100 **Default** `100` |
| <a id="property-__mutationthrottlerrefillrate"></a> `__mutationThrottlerRefillRate?` | `number` | ADVANCED: alters the refill rate for the token bucket mutation throttling Normally only altered alongside posthog support guidance. Accepts values between 0 and 100 **Default** `10` |
| <a id="property-attributefilter"></a> `attributeFilter?` | `string`[] | ADVANCED: limit which DOM attributes are observed for mutations, by passing the list to the native `MutationObserver` `attributeFilter`. Mutations to unlisted attributes never reach the recorder at all, so they cost no recording CPU - useful to exclude high-frequency inline `style` mutations from JS-driven animations on animation-heavy pages. Attributes left off the list are invisible to replay, so only set this when that loss of fidelity is acceptable. When unset (the default) or set to an empty array, all attributes are observed. A list without `id` also stops `captureJsonLd` from keeping `@id` fragments. Normally only altered alongside posthog support guidance. |
| <a id="property-blockclass"></a> `blockClass?` | `string` \| `RegExp` | Derived from `rrweb.record` options **See** https://github.com/rrweb-io/rrweb/blob/master/guide.md **Default** `'ph-no-capture'` |
| <a id="property-blockselector"></a> `blockSelector?` | `string` \| `null` | Derived from `rrweb.record` options **See** https://github.com/rrweb-io/rrweb/blob/master/guide.md **Default** `null` |
| <a id="property-canvascapture"></a> `canvasCapture?` | `object` | Tune how canvas frames are captured for replay. Only has any effect when canvas recording is enabled. - `resolutionScale`: capture canvas frames at a fraction of their display resolution. A number in `(0, 1]`; `1` is full-resolution capture (the default) and, e.g., `0.6` captures at 60%. Out-of-range or non-finite values are clamped into `(0, 1]`. Aspect ratio is preserved and replay upscales the frame back to the original display size, so playback dimensions are unchanged, just softer. Resolution is the highest-leverage lever for canvas byte size, since bytes scale with pixel area. - `maskRegionsFn`: mask regions of a recorded canvas — see its doc comment. |
| `canvasCapture.maskRegionsFn?` | ((`canvas`) => `CanvasMaskRegion`[] \| `null` \| `undefined`) \| `null` | If set, called once per canvas per captured frame; the returned regions (CSS pixels, relative to the canvas element) are painted black before the frame is encoded. Lets apps that render into canvas (e.g. Flutter web) mask content that DOM-based masking cannot see. Re-read from config on every frame, so the real provider can be swapped in after recording has started. Return `[]` for a frame with nothing to mask (recorded as is), or `null` if regions could not be computed — that frame is skipped rather than recorded unmasked. Anything other than an array — `null`, a thrown error, or an implicit `undefined` from an untyped caller — skips that frame. Not setting this at all records the canvas unmasked. The provider is called for every canvas on the page, including canvases inside shadow DOM. For a canvas it does not manage, return `[]` ("nothing to mask") — returning `null` skips that canvas's frames entirely. Called synchronously on the main thread for every captured frame (canvas FPS is 4 by default, 12 max), so keep it cheap — avoid forcing layout, and return few regions. Setting this also changes DOM full snapshots (taken at recording start and at each `full_snapshot_interval_millis`): they normally serialize canvas pixels on a separate path (`rr_dataURL`) that never sees these regions, so when this option is set that serialization is skipped entirely. Whether to skip is re-evaluated at each snapshot, so a provider installed via `set_config` after recording started is honored at the next snapshot without a recorder restart. A canvas appears blank in a snapshot until the next canvas frame paints it — ~250ms at the default 4 fps while its pixels are changing, and at most 30s otherwise, because every canvas the provider answers (with regions or `[]`) re-sends an unchanged frame as a keyframe every 30s; a canvas whose frames are skipped (`null`) stays blank. Without this option, snapshot behavior is unchanged. An app whose real provider only exists once its runtime has booted picks what happens in between by what it declares in `posthog.init`: a function covering the whole canvas blacks those frames out, `() => null` skips them, and declaring nothing records them. Client-side only, cannot be set via remote configuration. **Default** `undefined` |
| `canvasCapture.resolutionScale?` | `number` | - |
| <a id="property-capturecanvas"></a> `captureCanvas?` | `SessionRecordingCanvasOptions` | Allows local config to override remote canvas recording settings from the flags response. To mask content inside a recorded canvas, see `canvasCapture.maskRegionsFn`. |
| <a id="property-capturejsonld"></a> `captureJsonLd?` | `boolean` | Captures sanitized Schema.org JSON-LD as session replay custom events. JSON-LD inside a text mask or blocked element is never captured. The recorder keeps properties on its universal safe list at every depth. This list includes `@type` values shaped like a Schema.org term, which means letters and digits only. It drops property branches that are not on the allowlist. Retained strings starting with `http://`, `https://`, `//`, `/`, `./`, or `../` use replay URL masking, including query parameter and hash settings. This applies to nested entities and scalar arrays, but not to the fixed `@context`, normalized `@type`, or captured DOM IDs. Other strings, including bare relative paths and URLs embedded in text, are unchanged. A URL rejected by the masking callback is omitted. If the callback throws, the script is not captured. It keeps an `@id` as a fragment only when replay also captures a DOM element with the same `id` value. It drops every `@id` when `maskAllElementAttributes`, `maskAttributeFn`, or an `attributeFilter` without `id` can hide `id` attributes from replay. It also keeps the containing entity tree, even when it redacts all other fields. The event tag is `$json_ld`. The payload is a JSON-LD object or array. The event includes the current page URL in `data.href`, subject to replay URL masking and hash capture settings. The URL is omitted when the masking callback rejects it or throws. The recorder removes all script nodes from snapshots when this option is enabled. The JSON-LD observer starts only when this option is true at recording start. **See** https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/extensions/replay/external/json-ld.ts **Default** false before the `2026-08-30` defaults, otherwise true |
| <a id="property-collectfonts"></a> `collectFonts?` | `boolean` | Derived from `rrweb.record` options **See** https://github.com/rrweb-io/rrweb/blob/master/guide.md **Default** `false` |
| <a id="property-compress_events"></a> `compress_events?` | `boolean` | ADVANCED: whether to partially compress rrweb events before sending them to the server, defaults to true, can be set to false to disable partial compression NB requests are still compressed when sent to the server regardless of this setting **Default** `true` |
| <a id="property-full_snapshot_interval_millis"></a> `full_snapshot_interval_millis?` | `number` | ADVANCED: while a user is active we take a full snapshot of the browser every interval. For very few sites playback performance might be better with different interval. Set to 0 to disable **Default** `1000 * 60 * 5 (5 minutes)` |
| <a id="property-ignoreclass"></a> `ignoreClass?` | `string` \| `RegExp` | Derived from `rrweb.record` options **See** https://github.com/rrweb-io/rrweb/blob/master/guide.md **Default** `'ph-ignore-input'` |
| <a id="property-inlinestylesheet"></a> `inlineStylesheet?` | `boolean` | Derived from `rrweb.record` options **See** https://github.com/rrweb-io/rrweb/blob/master/guide.md **Default** `true` |
| <a id="property-inlinestylesheetbudgetrules"></a> `inlineStylesheetBudgetRules?` | `number` | Max CSSRules inlined synchronously per full snapshot. Sheets past the budget keep their `rel`/`href` and are inlined across idle callbacks instead of blocking the snapshot; the queue is flushed synchronously (bounded) when recording stops and on `pagehide`. The residual risk: replay falls back to loading a sheet from its original href (which may be purged, auth-gated, or renamed by replay time) only if the tab dies without `pagehide` firing, the teardown flush hits its safety cap, or stringifying the sheet fails. The default is applied by posthog-js when it starts the recorder; the recorder itself is unbounded without it. Set 0 to inline everything up front (the pre-budget behaviour). **Default** `10000` |
| <a id="property-maskallelementattributes"></a> `maskAllElementAttributes?` | `boolean` | Derived from `rrweb.record` options. Masks every string-valued source DOM attribute, including rendering attributes such as `class`, `id`, `style`, `src`, `href`, and synthesized form values. Only rrweb-generated layout metadata is retained, so this option intentionally reduces replay fidelity. Mutually exclusive with `maskAttributeFn`: when both are set this option wins and the callback is ignored. **See** https://github.com/rrweb-io/rrweb/blob/master/guide.md **Default** `false` |
| <a id="property-maskallinputs"></a> `maskAllInputs?` | `boolean` | Derived from `rrweb.record` options. When `true` (the default) session replay masks the value of every input, except `file` inputs, whose values are recorded unmasked — block those with `ph-no-capture` or `blockSelector` if they hold sensitive data. Set it to `false` to record input values, which is not recommended for apps that handle sensitive data. A `session_recording` masking option set in `posthog.init` takes precedence over the project "Privacy and masking" setting; the SDK warns once when the two differ. **See** - https://github.com/rrweb-io/rrweb/blob/master/guide.md - https://posthog.com/docs/session-replay/privacy **Default** `true` |
| <a id="property-maskattributefn"></a> `maskAttributeFn?` | ((`name`, `value`, `element?`) => `string`) \| `null` | Derived from `rrweb.record` options. Called with `(name, value, element)` for every non-empty string-valued attribute in the final serialized representation so you can mask specific attributes. Returning the original value leaves it visible. Mutually exclusive with `maskAllElementAttributes`: when both are set that option wins and this callback is ignored, so a callback cannot accidentally unmask what the coarse option hides. **See** https://github.com/rrweb-io/rrweb/blob/master/guide.md |
| <a id="property-maskcapturednetworkrequestfn"></a> `maskCapturedNetworkRequestFn?` | ((`data`) => `CapturedNetworkRequest` \| `null` \| `undefined`) \| `null` | Modify the network request before it is captured. Returning null or undefined stops it being captured. Initial navigation and performance-timing entries are also passed to this function. They have `isInitial === true`, can have `method === undefined`, and contain the page URL in `name`. If the function returns null or undefined for an initial entry, PostHog retains the replay-required timing metadata but omits its URL, headers, and body. Return a modified entry to retain a redacted URL. |
| <a id="property-maskinputfn"></a> `maskInputFn?` | ((`text`, `element?`) => `string`) \| `null` | Derived from `rrweb.record` options **See** https://github.com/rrweb-io/rrweb/blob/master/guide.md |
| <a id="property-maskinputoptions"></a> `maskInputOptions?` | `Partial`\<`MaskInputOptions`\> | Derived from `rrweb.record` options. Selects which input types to mask by input attribute, for use when `maskAllInputs` is `false`. Password inputs are always masked by default: the SDK adds `password: true` to a partial override, so set `password: false` explicitly if you must record password fields. **See** - https://github.com/rrweb-io/rrweb/blob/master/guide.md - https://posthog.com/docs/session-replay/privacy |
| <a id="property-masknetworkrequestfn"></a> ~~`maskNetworkRequestFn?`~~ | ((`data`) => `NetworkRequest` \| `null` \| `undefined`) \| `null` | **Deprecated** - use maskCapturedNetworkRequestFn instead |
| <a id="property-masktextclass"></a> `maskTextClass?` | `string` \| `RegExp` | Derived from `rrweb.record` options **See** https://github.com/rrweb-io/rrweb/blob/master/guide.md **Default** `'ph-mask'` |
| <a id="property-masktextfn"></a> `maskTextFn?` | ((`text`, `element?`) => `string`) \| `null` | Derived from `rrweb.record` options **See** https://github.com/rrweb-io/rrweb/blob/master/guide.md |
| <a id="property-masktextselector"></a> `maskTextSelector?` | `string` \| `null` | Derived from `rrweb.record` options. A CSS selector for non-input text to mask in session replay. Session replay masks input values by default (see `maskAllInputs`), but it does not mask other DOM text or images. This selector and the `ph-mask` class mask text content only — for example a rendered card number — and do not hide an image, whose `src` is still recorded. To redact a rendered image such as a scanned document, block the image or a container element with `ph-no-capture` (see `blockClass`/`blockSelector`), which replaces it with a placeholder and stops recording its subtree. **See** - https://github.com/rrweb-io/rrweb/blob/master/guide.md - https://posthog.com/docs/session-replay/privacy |
| <a id="property-recordbody"></a> `recordBody?` | `boolean` | Derived from `rrweb.record` options **See** https://github.com/rrweb-io/rrweb/blob/master/guide.md **Default** `false` |
| <a id="property-recordcrossoriginiframes"></a> `recordCrossOriginIframes?` | `boolean` | Derived from `rrweb.record` options **See** https://github.com/rrweb-io/rrweb/blob/master/guide.md **Default** `false` |
| <a id="property-recordheaders"></a> `recordHeaders?` | `boolean` | Derived from `rrweb.record` options **See** https://github.com/rrweb-io/rrweb/blob/master/guide.md **Default** `false` |
| <a id="property-samplerate"></a> `sampleRate?` | `number` | The sample rate for session recordings, a number between 0 and 1. For example, 0.5 means roughly 50% of sessions will be recorded. When `undefined`, falls back to the remote config setting. When set, takes precedence over the remote config. **Default** `undefined` |
| <a id="property-sampling"></a> `sampling?` | `SessionRecordingSamplingConfig` | Derived from `rrweb.record` options. Controls how often certain event types are captured within an already-recorded session, e.g. `{ mousemove: false }` stops recording mouse movement. Not to be confused with `sampleRate` below, which controls whether a session is recorded at all, or with `posthog.startSessionRecording({ sampling: true })`, which overrides that session-level sample rate. NB disabled event types no longer count as user activity for replay idle detection (`session_idle_threshold_ms`). For example, with `mousemove: false` pure mouse movement no longer keeps a session active, while clicks, scrolls, and inputs still do. **See** https://github.com/rrweb-io/rrweb/blob/master/guide.md **Default** `undefined` |
| <a id="property-session_idle_threshold_ms"></a> `session_idle_threshold_ms?` | `number` | ADVANCED: Controls when session recording considers the user idle. If no replay user interaction occurs for this many milliseconds, the recorder marks the recording idle, emits a `sessionIdle` replay marker, flushes buffered replay events, and drops most subsequent replay events until user activity resumes. If activity resumes before `session_idle_timeout_seconds`, recording continues under the same `$session_id`. This does not control `$session_id` rotation. Session rotation is controlled by `session_idle_timeout_seconds`, so this value should be lower than `session_idle_timeout_seconds * 1000`. **Default** `1000 * 60 * 5 (5 minutes)` |
| <a id="property-slimdomoptions"></a> `slimDOMOptions?` | `true` \| `Partial`\<`SlimDOMOptions`\> \| `"all"` | Derived from `rrweb.record` options **See** https://github.com/rrweb-io/rrweb/blob/master/guide.md **Default** `{}` |
| <a id="property-streamnetworkbody"></a> `streamNetworkBody?` | `boolean` | When recording network bodies, read them through a streaming reader that stops at the payload size limit instead of buffering the whole body and then discarding it. Bounds the memory and pre-request latency of capturing a very large body. Reads only a clone of the body, never the stream the page consumes. **Default** `false` |
| <a id="property-strictminimumduration"></a> `strictMinimumDuration?` | `boolean` | When true, minimum duration is checked against the actual buffer data (first to last timestamp) rather than session duration. This ensures recordings are not sent until they contain the minimum duration of actual data, even across page navigations. **Default** `false` |
| <a id="property-trigger_pending_buffer_interval_millis"></a> `trigger_pending_buffer_interval_millis?` | `number` | ADVANCED: controls how much recent replay data is kept in memory while session recording waits for a conditional trigger. The recorder periodically takes a full snapshot and discards older buffered events, so increasing this interval retains more pre-trigger history but can increase memory usage and CPU usage. Performance impacts on your site can start to be visible to users with larger values. Values must be between 1,000 ms and 3,600,000 ms (1 hour, inclusive); values outside this range, or non-finite values, are ignored. **Default** `1000 * 60 (1 minute)` |

### `SessionRecordingPersistedConfig`

> **SessionRecordingPersistedConfig** = `Omit`\<`SessionRecordingRemoteConfig`, `"recordCanvas"` \| `"canvasFps"` \| `"canvasQuality"` \| `"networkPayloadCapture"` \| `"sampleRate"` \| `"minimumDurationMilliseconds"`\> & `object`

the config stored in persistence when session recording remote config is received

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `cache_timestamp?` | `number` | Used to determine if the persisted config is still valid or we need to wait for a new one only accepts undefined since older versions of the library didn't set this. |
| `canvasRecording` | `object` | - |
| `canvasRecording.enabled` | `SessionRecordingRemoteConfig`\[`"recordCanvas"`\] | - |
| `canvasRecording.fps` | `SessionRecordingRemoteConfig`\[`"canvasFps"`\] | - |
| `canvasRecording.quality` | `SessionRecordingRemoteConfig`\[`"canvasQuality"`\] | - |
| `enabled` | `boolean` | - |
| `minimumDurationMilliseconds` | `number` \| `null` \| `undefined` | - |
| `networkPayloadCapture` | `SessionRecordingRemoteConfig`\[`"networkPayloadCapture"`\] & `object` | - |
| `sampleRate` | `number` \| `null` | - |

### `SessionRecordingRemoteConfig`

> **SessionRecordingRemoteConfig** = `SessionRecordingCanvasOptions` & `object`

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `consoleLogRecordingEnabled?` | `boolean` | - |
| `endpoint?` | `string` | - |
| `eventTriggers?` | `string`[] | - |
| `linkedFlag?` | `string` \| `FlagVariant` \| `null` | - |
| `masking?` | `Pick`\<`SessionRecordingOptions`, `"maskAllInputs"` \| `"maskTextSelector"` \| `"blockSelector"` \| `"maskAllElementAttributes"`\> | - |
| `minimumDurationMilliseconds?` | `number` | - |
| `networkPayloadCapture?` | `Pick`\<`NetworkRecordOptions`, `"recordBody"` \| `"recordHeaders"`\> | - |
| `sampleRate?` | `string` \| `null` | - |
| `scriptConfig?` | `object` | - |
| `scriptConfig.script?` | `string` | - |
| `triggerGroups?` | `SessionRecordingTriggerGroup`[] | V2 Trigger Groups - multiple named trigger groups with their own conditions and sample rates. Only used when version === 2. |
| `triggerMatchType?` | `"any"` \| `"all"` | Controls how event, URL, sampling, and linked flag triggers are combined. `any` means that if any of the triggers match, the session will be recorded. `all` means that all the triggers must match for the session to be recorded. |
| `urlBlocklist?` | `SessionRecordingUrlTrigger`[] | - |
| `urlTriggers?` | `SessionRecordingUrlTrigger`[] | - |
| `version?` | `1` \| `2` | Config version - defaults to 1 (legacy). When version is 2, triggerGroups is used instead of individual trigger fields. |

### `SessionRecordingSamplingConfig`

Sampling options for session recording, a subset of rrweb's sampling strategy

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-mouseinteraction"></a> `mouseInteraction?` | `boolean` | When `false`, disables capture of mouse interaction events (click, mouse up/down, hover, and touch start/end). NB replays will not show clicks when this is disabled. **Default** `undefined` |
| <a id="property-mousemove"></a> `mousemove?` | `number` \| `boolean` | Controls capture of mouse movement within a recorded session. `false` disables capture entirely; NB this also disables touchmove and drag capture. A number throttles capture so that positions are captured at most once every N milliseconds. When `undefined` (or `true`), rrweb's default applies: capture throttled to every 50ms. **Default** `undefined` |

### `SessionRecordingTriggerGroup`

V2 Trigger Group - represents a single trigger group with its own conditions and sample rate

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-conditions-1"></a> `conditions` | `object` |
| `conditions.events?` | `SessionRecordingEventTrigger`[] |
| `conditions.flag?` | `string` \| `FlagVariant` |
| `conditions.matchType` | `"all"` \| `"any"` |
| `conditions.properties?` | `SessionRecordingTriggerPropertyFilter`[] |
| `conditions.urls?` | `SessionRecordingUrlTrigger`[] |
| <a id="property-id-7"></a> `id` | `string` |
| <a id="property-mindurationms"></a> `minDurationMs?` | `number` |
| <a id="property-name-6"></a> `name` | `string` |
| <a id="property-samplerate-1"></a> `sampleRate` | `number` |

### `SessionRecordingTriggerPropertyFilter`

| Property | Type |
| ------ | ------ |
| <a id="property-key-2"></a> `key` | `string` |
| <a id="property-operator-1"></a> `operator?` | `"regex"` \| `"not_regex"` \| `"exact"` \| `"is_not"` \| `"icontains"` \| `"not_icontains"` \| `"gt"` \| `"lt"` |
| <a id="property-type-11"></a> `type` | `"event"` \| `"person"` |
| <a id="property-value-3"></a> `value?` | `string` \| `number` \| `boolean` \| `string`[] |

### `SessionRecordingUrlTrigger`

| Property | Type |
| ------ | ------ |
| <a id="property-matching"></a> `matching` | `"regex"` |
| <a id="property-url-7"></a> `url` | `string` |

### `SessionStartReason`

> **SessionStartReason** = `"sampling_overridden"` \| `"recording_initialized"` \| `"linked_flag_matched"` \| `"linked_flag_overridden"` \| *typeof* `SAMPLED` \| `"session_id_changed"` \| `"url_trigger_matched"` \| `"event_trigger_matched"`

### `SeverityLevel`

> **SeverityLevel** = `"fatal"` \| `"error"` \| `"warning"` \| `"log"` \| `"info"` \| `"debug"`

### `ShowTourOptions`

| Property | Type |
| ------ | ------ |
| <a id="property-enablestrictvalidation"></a> `enableStrictValidation?` | `boolean` |
| <a id="property-reason"></a> `reason?` | `ProductTourRenderReason` |

### `SiteApp`

> **SiteApp** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="errored"></a> `errored` | `boolean` |
| <a id="id-1"></a> `id` | `string` |
| <a id="loaded"></a> `loaded` | `boolean` |
| <a id="processedbuffer"></a> `processedBuffer` | `boolean` |
| <a id="processevent"></a> `processEvent?` | (`globals`) => `void` |

### `SiteAppGlobals`

> **SiteAppGlobals** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="event"></a> `event` | `object` |
| `event.distinct_id?` | `string` |
| `event.elements_chain?` | `string` |
| `event.event` | `EventName` |
| `event.properties` | `Properties` |
| `event.timestamp?` | `Date` |
| `event.uuid` | `string` |
| <a id="groups"></a> `groups` | `Record`\<`string`, \{ `id`: `string`; `properties`: `Properties`; `type`: `string`; \}\> |
| <a id="person"></a> `person` | `object` |
| `person.properties` | `Properties` |

### `SiteAppLoader`

> **SiteAppLoader** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="id-2"></a> `id` | `string` |
| <a id="init-1"></a> `init` | (`config`) => `object` |

### `SlimDOMOptions`

Slim DOM options for session recording

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-comment"></a> `comment?` | `boolean` |
| <a id="property-headfavicon"></a> `headFavicon?` | `boolean` |
| <a id="property-headmetaauthorship"></a> `headMetaAuthorship?` | `boolean` |
| <a id="property-headmetadesckeywords"></a> `headMetaDescKeywords?` | `boolean` |
| <a id="property-headmetahttpequiv"></a> `headMetaHttpEquiv?` | `boolean` |
| <a id="property-headmetarobots"></a> `headMetaRobots?` | `boolean` |
| <a id="property-headmetasocial"></a> `headMetaSocial?` | `boolean` |
| <a id="property-headmetaverification"></a> `headMetaVerification?` | `boolean` |
| <a id="property-headtitlemutations"></a> `headTitleMutations?` | `boolean` |
| <a id="property-headwhitespace"></a> `headWhitespace?` | `boolean` |
| <a id="property-script"></a> `script?` | `boolean` |

### `SnippetArrayItem`

> **SnippetArrayItem** = \[`method`: `string`, `args`: `any`[]\]

### `SpecificQuestionBranching`

| Property | Type |
| ------ | ------ |
| <a id="property-index"></a> `index` | `number` |
| <a id="property-type-7"></a> `type` | `"specific_question"` |

### `SupportedWebVitalsMetrics`

> **SupportedWebVitalsMetrics** = `"LCP"` \| `"CLS"` \| `"FCP"` \| `"INP"`

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

- `Omit`\<`SurveyAppearance`, `"position"` \| `"widgetType"`\>

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

### `SurveyConfig`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-autosubmitdelay"></a> ~~`autoSubmitDelay?`~~ | `number` | **Deprecated** No longer used. Pre-filled responses are now sent immediately when partial responses are enabled, or all required questions have been pre-filled. |
| <a id="property-autosubmitifcomplete"></a> ~~`autoSubmitIfComplete?`~~ | `boolean` | **Deprecated** No longer used. Surveys will automatically advance past prefilled questions with skipSubmitButton enabled. If partial response collection is enabled, partial responses for pre-filled questions will be submitted automatically on page load. |
| <a id="property-prefillfromurl"></a> `prefillFromUrl?` | `boolean` | Prefill survey responses from matching URL parameters. **Default** `undefined` |

### `SurveyConfig`

Survey configuration options

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-autosubmitdelay"></a> `autoSubmitDelay?` | `number` |
| <a id="property-autosubmitifcomplete"></a> `autoSubmitIfComplete?` | `boolean` |
| <a id="property-prefillfromurl"></a> `prefillFromUrl?` | `boolean` |

### `SurveyElement`

| Property | Type |
| ------ | ------ |
| <a id="property-el_text"></a> `$el_text?` | `string` |
| <a id="property-attr_class"></a> `attr_class?` | `string`[] |
| <a id="property-attr_id"></a> `attr_id?` | `string` |
| <a id="property-attributes-6"></a> `attributes?` | `Record`\<`string`, `any`\> |
| <a id="property-event_id"></a> `event_id?` | `number` |
| <a id="property-group_id"></a> `group_id?` | `number` |
| <a id="property-href-1"></a> `href?` | `string` |
| <a id="property-nth_child"></a> `nth_child?` | `number` |
| <a id="property-nth_of_type"></a> `nth_of_type?` | `number` |
| <a id="property-order"></a> `order?` | `number` |
| <a id="property-tag_name-1"></a> `tag_name?` | `string` |
| <a id="property-text-8"></a> `text?` | `string` |

### `SurveyEventName`

> **SurveyEventName** = *typeof* `SurveyEventName`\[keyof *typeof* `SurveyEventName`\]

### `SurveyEventProperties`

> **SurveyEventProperties** = *typeof* `SurveyEventProperties`\[keyof *typeof* `SurveyEventProperties`\]

### `SurveyEventType`

> **SurveyEventType** = *typeof* `SurveyEventType`\[keyof *typeof* `SurveyEventType`\]

### `SurveyEventWithFilters`

| Property | Type |
| ------ | ------ |
| <a id="property-name-9"></a> `name` | `string` |
| <a id="property-propertyfilters"></a> `propertyFilters?` | `PropertyFilters` |

### `SurveyMatchType`

> **SurveyMatchType** = *typeof* `SurveyMatchType`\[keyof *typeof* `SurveyMatchType`\]

### `SurveyPosition`

> **SurveyPosition** = *typeof* `SurveyPosition`\[keyof *typeof* `SurveyPosition`\]

### `SurveyPosition`

> **SurveyPosition** = *typeof* `SurveyPosition`\[keyof *typeof* `SurveyPosition`\]

### `SurveyQuestion`

> **SurveyQuestion** = `BasicSurveyQuestion` \| `LinkSurveyQuestion` \| `RatingSurveyQuestion` \| `MultipleSurveyQuestion`

### `SurveyQuestionBase`

- `BasicSurveyQuestion`
- `LinkSurveyQuestion`
- `RatingSurveyQuestion`
- `MultipleSurveyQuestion`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-branching"></a> `branching?` | `NextQuestionBranching` \| `EndBranching` \| `ResponseBasedBranching` \| `SpecificQuestionBranching` |
| <a id="property-buttontext"></a> `buttonText?` | `string` |
| <a id="property-description"></a> `description?` | `string` \| `null` |
| <a id="property-descriptioncontenttype"></a> `descriptionContentType?` | `SurveyQuestionDescriptionContentType` |
| <a id="property-id-1"></a> `id?` | `string` |
| <a id="property-optional"></a> `optional?` | `boolean` |
| <a id="property-question"></a> `question` | `string` |
| <a id="property-translations"></a> `translations?` | `Record`\<`string`, `SurveyQuestionTranslation`\> |
| <a id="property-validation"></a> `validation?` | `SurveyValidationRule`[] |

### `SurveyQuestionBranchingType`

> **SurveyQuestionBranchingType** = *typeof* `SurveyQuestionBranchingType`\[keyof *typeof* `SurveyQuestionBranchingType`\]

### `SurveyQuestionDescriptionContentType`

> **SurveyQuestionDescriptionContentType** = `"html"` \| `"text"`

### `SurveyQuestionDescriptionContentType`

> **SurveyQuestionDescriptionContentType** = *typeof* `SurveyQuestionDescriptionContentType`\[keyof *typeof* `SurveyQuestionDescriptionContentType`\]

### `SurveyQuestionTranslation`

| Property | Type |
| ------ | ------ |
| <a id="property-buttontext-1"></a> `buttonText?` | `string` |
| <a id="property-choices"></a> `choices?` | `string`[] |
| <a id="property-description-1"></a> `description?` | `string` \| `null` |
| <a id="property-link"></a> `link?` | `string` \| `null` |
| <a id="property-lowerboundlabel"></a> `lowerBoundLabel?` | `string` |
| <a id="property-question-1"></a> `question?` | `string` |
| <a id="property-upperboundlabel"></a> `upperBoundLabel?` | `string` |

### `SurveyQuestionType`

> **SurveyQuestionType** = *typeof* `SurveyQuestionType`\[keyof *typeof* `SurveyQuestionType`\]

### `SurveyRenderReason`

Represents the result of checking if a survey can be rendered.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-disabledreason"></a> `disabledReason?` | `string` | The reason why the survey cannot be rendered, if applicable |
| <a id="property-visible"></a> `visible` | `boolean` | Whether the survey is visible/can be rendered |

### `SurveyResponseValue`

> **SurveyResponseValue** = `SurveyResponseValue`

### `SurveyResponseValue`

> **SurveyResponseValue** = `string` \| `number` \| `string`[] \| `null`

### `SurveySchedule`

> **SurveySchedule** = *typeof* `SurveySchedule`\[keyof *typeof* `SurveySchedule`\]

### `SurveyTabPosition`

> **SurveyTabPosition** = *typeof* `SurveyTabPosition`\[keyof *typeof* `SurveyTabPosition`\]

### `SurveyTranslation`

| Property | Type |
| ------ | ------ |
| <a id="property-backbuttontext"></a> `backButtonText?` | `string` |
| <a id="property-introscreenbuttontext"></a> `introScreenButtonText?` | `string` |
| <a id="property-introscreendescription"></a> `introScreenDescription?` | `string` |
| <a id="property-introscreenheader"></a> `introScreenHeader?` | `string` |
| <a id="property-name-5"></a> `name?` | `string` |
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
| <a id="property-type-8"></a> `type` | `SurveyValidationType` |
| <a id="property-value-3"></a> `value?` | `number` |

### `SurveyValidationType`

> **SurveyValidationType** = *typeof* `SurveyValidationType`\[keyof *typeof* `SurveyValidationType`\]

### `SurveyWidgetType`

> **SurveyWidgetType** = *typeof* `SurveyWidgetType`\[keyof *typeof* `SurveyWidgetType`\]

### `SurveyWidgetType`

> **SurveyWidgetType** = *typeof* `SurveyWidgetType`\[keyof *typeof* `SurveyWidgetType`\]

### `SurveyWithTypeAndAppearance`

> **SurveyWithTypeAndAppearance** = `Pick`\<`Survey`, `"id"` \| `"type"` \| `"appearance"`\>

### `Ticket`

A support ticket in the conversations system

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-created_at-2"></a> `created_at` | `string` | ISO timestamp when the ticket was created |
| <a id="property-id-10"></a> `id` | `string` | Unique identifier for the ticket |
| <a id="property-last_message"></a> `last_message?` | `string` | Preview of the last message |
| <a id="property-last_message_at"></a> `last_message_at?` | `string` | ISO timestamp of the last message |
| <a id="property-message_count"></a> `message_count` | `number` | Total number of messages in this ticket |
| <a id="property-messages-1"></a> `messages?` | `Message`[] | Array of messages (only present in detailed ticket view) |
| <a id="property-status-3"></a> `status` | `TicketStatus` | Current status of the ticket |
| <a id="property-unread_count-3"></a> `unread_count?` | `number` | Number of unread messages from the team |

### `TicketStatus`

> **TicketStatus** = `"new"` \| `"open"` \| `"pending"` \| `"on_hold"` \| `"resolved"`

Status of a support ticket

### `TipTapDoc`

TipTap document - the root node of rich content

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-content-4"></a> `content?` | `TipTapNode`[] |
| <a id="property-type-13"></a> `type` | `"doc"` |

### `TipTapMark`

TipTap mark types for inline formatting

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-attrs-1"></a> `attrs?` | `object` |
| `attrs.href?` | `string` |
| `attrs.target?` | `string` |
| <a id="property-type-14"></a> `type` | `"link"` \| `"bold"` \| `"italic"` \| `"underline"` \| `"strike"` \| `"code"` |

### `TipTapNode`

TipTap node representing content in the document tree

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-attrs-2"></a> `attrs?` | `Record`\<`string`, `unknown`\> |
| <a id="property-content-5"></a> `content?` | `TipTapNode`[] |
| <a id="property-marks-1"></a> `marks?` | `TipTapMark`[] |
| <a id="property-text-9"></a> `text?` | `string` |
| <a id="property-type-15"></a> `type` | `string` |

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

### `ToolbarVersion`

> **ToolbarVersion** = `"toolbar"`

### `TreeShakeable`

> **TreeShakeable**\<`T`\> = `"optional"` *extends* keyof `TreeShakeableConfig` ? `T` \| `undefined` : `T`

For the full bundle (default), resolves to T (extensions guaranteed present).
For the slim bundle (augmented with { optional: true }), resolves to T | undefined.

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-18"></a> `T` |

### `UserProvidedTraits`

User-provided identification data (collected via the widget form)

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-email-3"></a> `email?` | `string` |
| <a id="property-name-10"></a> `name?` | `string` |

### `WebMCPCaptureConfig`

Selects the WebMCP metadata that PostHog captures.
Options are applied when a tool registers. Re-register a tool after changing these options.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-intent"></a> `intent?` | `boolean` | Captures the agent's reason for the tool call. Enabled by default. |
| <a id="property-model"></a> `model?` | `boolean` | Captures the model identifier that the agent reports. Enabled by default. |

### `WidgetPosition`

> **WidgetPosition** = `"bottom_left"` \| `"bottom_right"` \| `"top_left"` \| `"top_right"`

Position of the conversations widget on the screen.

### `Writable`

> **Writable**\<`T`\> = `{ -readonly [P in keyof T]: T[P] }`

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-19"></a> `T` |
