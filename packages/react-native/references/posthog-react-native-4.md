---
title: "PostHog React Native SDK 4.x"
sidebar: Docs
showTitle: true
contentMaxWidthClass: max-w-full
platformLogo: react
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
  - value: "Flush"
    url: flush
    depth: 0
  - value: "Get anonymous ID"
    url: get-anonymous-id
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
  - value: "Get feature flags and payloads"
    url: get-feature-flags-and-payloads
    depth: 0
  - value: "Get session ID"
    url: get-session-id
    depth: 0
  - value: "Group"
    url: group
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
  - value: "Screen"
    url: screen
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
  - value: "Autocapture"
    url: autocapture
    depth: 0
  - value: "Remote config"
    url: remote-config
    depth: 0
  - value: "Session replay privacy"
    url: session-replay-privacy
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
npm install posthog-react-native
```

### Initialize

Wrap your app in `PostHogProvider`.

```tsx
import { PostHogProvider } from 'posthog-react-native'

export default function App() {
  return (
    <PostHogProvider apiKey="<ph_project_api_key>" options={{ host: 'https://us.i.posthog.com' }}>
      <YourApp />
    </PostHogProvider>
  )
}
```

### Capture

```tsx
import { usePostHog } from 'posthog-react-native'

const posthog = usePostHog()
posthog.capture('signed_up', { plan: 'pro' })
```

### Identify

```tsx
posthog.identify('user_123', { email: 'user@example.com' })
```

## Setup

### `new PostHog(...)`

> **new PostHog**(`projectToken`, `options?`): `PostHog`

Creates a new PostHog instance for React Native. You can find all configuration options in the [React Native SDK docs](https://posthog.com/docs/libraries/react-native#configuration-options).

If you prefer not to use the PostHogProvider, you can initialize PostHog in its own file and import the instance from there.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `projectToken` | `string` | Your PostHog project token, which starts with `phc_`. Find it in your project settings: https://us.posthog.com/settings/project-details#variables |
| `options?` | `PostHogOptions` | PostHog configuration options |

#### Returns

`PostHog`

#### Example

```ts
// posthog.ts
import PostHog from 'posthog-react-native'

export const posthog = new PostHog('<ph_project_token>', {
  host: '<ph_client_api_host>'
})

// Then you can access PostHog by importing your instance
// Another file:
import { posthog } from './posthog'

export function MyApp1() {
    useEffect(async () => {
        posthog.capture('event_name')
    }, [posthog])

    return <View>Your app code</View>
}
```

### `PostHogProvider`

> **PostHogProvider**(`props`): `Element` \| `null`

PostHogProvider is a React component that provides PostHog functionality to your React Native app. You can find all configuration options in the [React Native SDK docs](https://posthog.com/docs/libraries/react-native#configuration-options).

Autocapturing navigation requires further configuration. See the [React Native SDK navigation docs](https://posthog.com/docs/libraries/react-native#capturing-screen-views)
for more information about autocapturing navigation.

This is the recommended way to set up PostHog for React Native. This utilizes the Context API to pass the PostHog client around, enable autocapture.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `props` | `PostHogProviderProps` | The PostHogProvider props |

#### Returns

`Element` \| `null`

#### Examples

```jsx
// Add to App.(js|ts)
import { usePostHog, PostHogProvider } from 'posthog-react-native'

export function MyApp() {
    return (
        <PostHogProvider projectToken="<ph_project_token>" options={{
            host: '<ph_client_api_host>',
        }}>
            <MyComponent />
        </PostHogProvider>
    )
}

// And access the PostHog client via the usePostHog hook
import { usePostHog } from 'posthog-react-native'

const MyComponent = () => {
    const posthog = usePostHog()

    useEffect(() => {
        posthog.capture("event_name")
    }, [posthog])
}

```

```jsx
// Using with existing client
import { PostHog } from 'posthog-react-native'

const posthog = new PostHog('<ph_project_token>', {
    host: '<ph_client_api_host>'
})

export function MyApp() {
    return (
        <PostHogProvider client={posthog}>
            <MyComponent />
        </PostHogProvider>
    )
}
```

### `usePostHog`

> **usePostHog**(): `PostHog`

#### Returns

`PostHog`

## Capture

### `PostHog.capture`

> **capture**(`event`, `properties?`, `options?`): `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | `string` |
| `properties?` | `PostHogEventProperties` |
| `options?` | `PostHogCaptureOptions` |

#### Returns

`void`

## Identify

### `PostHog.identify`

> **identify**(`distinctId?`, `properties?`, `options?`): `void`

Associates events with a specific user. Learn more about [identifying users](https://posthog.com/docs/product-analytics/identify)

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `distinctId?` | `string` | A unique identifier for your user. Typically either their email or database ID. |
| `properties?` | `PostHogEventProperties` | Optional dictionary with key:value pairs to set the person properties |
| `options?` | `PostHogCaptureOptions` | Optional capture options |

#### Returns

`void`

#### Examples

```js
// Basic identify
posthog.identify('distinctID', {
  email: 'user@posthog.com',
  name: 'My Name'
})
```

```js
// Using $set and $set_once
posthog.identify('distinctID', {
  $set: {
    email: 'user@posthog.com',
    name: 'My Name'
  },
  $set_once: {
    date_of_first_log_in: '2024-03-01'
  }
})
```

## Logs

### `PostHog.logger`

> **get** **logger**(): `Logger`

Convenience per-level logger. Each method is shorthand for
`posthog.captureLog({ body, level, attributes })`. Lazily constructed
on first access, then reused.

##### Example

```ts
posthog.logger.info('checkout completed', { order_id: 'ord_789' })
posthog.logger.error('payment failed', { code: 'E001' })
```

##### Returns

`Logger`

### `PostHog.captureLog`

> **captureLog**(`options`): `void`

Captures a structured log record and sends it to PostHog's logs product
(`/i/v1/logs`). Low-level primitive — most callers will prefer
`posthog.logger.info(...)` / `.warn(...)` / `.error(...)` etc., which
wrap this with a level pre-set.

Records are buffered per-session, rate-limited, batched into OTLP
payloads, and flushed on a timer, on AppState change, or when the
buffer reaches capacity. Configure flush cadence, rate cap, and a
`beforeSend` filter via the `logs` option on `new PostHog(...)`.

Note — naming collision: `posthog.captureLog()` (this method) is the
**logs product** API. There is also a separate, pre-existing
`sessionReplayConfig.captureLog` boolean that controls whether
**session replay** records the device's `console.*` output. The two
are unrelated: this method emits structured records to the logs
pipeline regardless of whether session replay is on.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options` | `CaptureLogOptions` | Log record. `body` is required; `level` defaults to `'info'`. `attributes` are attached as OTLP key-value attributes and will override auto-populated ones (distinctId, sessionId) on key conflict. |

#### Returns

`void`

#### Example

```ts
posthog.captureLog({
  body: 'checkout completed',
  level: 'info',
  attributes: { order_id: 'ord_789', amount_cents: 4999 },
})
```

### `PostHog.flushLogs`

> **flushLogs**(): `Promise`\<`void`\>

Manually flushes the logs queue.

Logs flush automatically on a timer, when the buffer fills, or on
AppState change — most apps never need to call this. Use it when you
want a synchronous-style hand-off (e.g. before navigating away from a
critical screen, in a custom crash handler, or while testing locally).

If a flush is already in progress, both callers join the same in-flight
promise — no double-send.

Note: this drains the **logs** pipeline only. Events are flushed via
flush, and shutdown drains both before terminating.

#### Returns

`Promise`\<`void`\>

Promise that resolves when the flush is complete.

#### Example

```ts
await posthog.flushLogs()
```

#### See

flush

## Alias

### `PostHog.alias`

> **alias**(`alias`): `void`

Assigns an alias to the current user.

Sometimes, you want to assign multiple distinct IDs to a single user. This is helpful when your primary distinct ID is inaccessible.
For example, if a distinct ID used on the frontend is not available in your backend.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `alias` | `string` | The alias to assign to the current user |

#### Returns

`void`

#### Example

```js
// set alias for current user
posthog.alias('distinct_id')
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

> **captureException**(`error`, `additionalProperties?`, `hint?`): `void`

Capture a caught exception manually

Exceptions also include capture-time `$app_state` (active, background, inactive or extension) on any
platform where React Native AppState provides a known value. On iOS and Android, optional
`expo-updates` (0.25.0 or newer) adds `$expo_update_id`, `$expo_runtime_version`, `$expo_channel`
and `$expo_is_embedded_launch` for enabled updates outside development mode. Unknown values
are omitted.
These exception-only fields are separate from the static app metadata controlled by
`customAppProperties`, including the existing `$app_version` and `$app_build`.
Override these fields with `additionalProperties`, or remove them using `before_send`.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `error` | `unknown` | The error to capture |
| `additionalProperties?` | `PostHogEventProperties` | Any additional properties to add to the error event |
| `hint?` | `EventHint` | - |

#### Returns

`void`

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

### `PostHogErrorBoundary`

- `Component`\<`PostHogErrorBoundaryProps`, `PostHogErrorBoundaryState`\>

#### Constructors

##### Constructor

> **new PostHogErrorBoundary**(`props`): `PostHogErrorBoundary`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `props` | `PostHogErrorBoundaryProps` |

###### Returns

`PostHogErrorBoundary`

#### Properties

| Property | Modifier | Type | Default value | Description | Overrides |
| ------ | ------ | ------ | ------ | ------ | ------ |
| <a id="context"></a> `context` | `public` | `object` | `undefined` | If using the new style context, re-declare this in your class to be the `React.ContextType` of your `static contextType`. Should be used with type annotation or static contextType. `static contextType = MyContext // For TS pre-3.7: context!: React.ContextType<typeof MyContext> // For TS 3.7 and above: declare context: React.ContextType<typeof MyContext>` **See** [https://react.dev/reference/react/Component#context](https://react.dev/reference/react/Component#context) | `React.Component.context` |
| `context.client` | `public` | `PostHog` | `undefined` | - | - |
| <a id="contexttype"></a> `contextType` | `static` | `Context`\<\{ `client`: `PostHog`; \}\> | `PostHogContext` | If set, `this.context` will be set at runtime to the current value of the given Context. Usage: `type MyContext = number const Ctx = React.createContext<MyContext>(0) class Foo extends React.Component { static contextType = Ctx context!: React.ContextType<typeof Ctx> render () { return <>My context's value: {this.context}</>; } }` **See** [https://react.dev/reference/react/Component#static-contexttype](https://react.dev/reference/react/Component#static-contexttype) | `React.Component.contextType` |

#### Methods

##### componentDidCatch()

> **componentDidCatch**(`error`, `errorInfo`): `void`

Catches exceptions generated in descendant components. Unhandled exceptions will cause
the entire component tree to unmount.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `error` | `unknown` |
| `errorInfo` | `ErrorInfo` |

###### Returns

`void`

##### render()

> **render**(): `ReactNode`

###### Returns

`ReactNode`

##### getDerivedStateFromError()

> `static` **getDerivedStateFromError**(`error`): `Partial`\<`PostHogErrorBoundaryState`\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `error` | `unknown` |

###### Returns

`Partial`\<`PostHogErrorBoundaryState`\>

## Create person profile

### `PostHog.createPersonProfile`

> **createPersonProfile**(): `void`

Creates a person profile for the current user, if they don't already have one.

This is useful when using `personProfiles: 'identified_only'` mode and you want to
explicitly create a profile for an anonymous user before they identify.

If `personProfiles` is 'identified_only' and no profile exists, this will create one.
If `personProfiles` is 'never', this will log an error and do nothing.
If `personProfiles` is 'always' or a profile already exists, this is a no-op.

#### Returns

`void`

#### Example

```js
// Create a person profile for an anonymous user
posthog.createPersonProfile()
```

## Debug

### `PostHog.isDebug`

> **get** **isDebug**(): `boolean`

##### Returns

`boolean`

### `PostHog.debug`

> **debug**(`enabled?`): `void`

Enables or disables debug mode for detailed logging.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `enabled?` | `boolean` |

#### Returns

`void`

#### Remarks

Debug mode logs all PostHog calls to the console for troubleshooting.
This is useful during development to understand what data is being sent.

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

Records a breadcrumb-style exception step. Steps accumulate in a rolling, byte-bounded buffer
and are attached to every captured `$exception` as `$exception_steps`, giving the error tracking
UI a timeline of recent activity before each error.

The `$timestamp` is captured at call time. The reserved keys `$message` and `$timestamp` are
stripped from `properties` — the SDK sets the canonical values. This method never throws.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `message` | `string` | A non-empty description of the step |
| `properties?` | `Properties` | Optional additional context to attach to the step |

#### Returns

`void`

#### Example

```js
posthog.addExceptionStep('User tapped Checkout', { screen: 'cart' })
```

## Flush

### `PostHog.flush`

> **flush**(): `Promise`\<`void`\>

Manually flushes the event queue.

You can set the number of events in the configuration that should queue before flushing.
Setting this to 1 will send events immediately and will use more battery. This is set to 20 by default.
You can also manually flush the queue. If a flush is already in progress it returns a promise for the existing flush.

Note: this drains the **events** pipeline only. Logs are flushed via
flushLogs, and shutdown drains both before terminating.

#### Returns

`Promise`\<`void`\>

Promise that resolves when the flush is complete

#### Example

```js
// manually flush the queue
await posthog.flush()
```

#### See

flushLogs

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

## Get anonymous ID

### `PostHog.getAnonymousId`

> **getAnonymousId**(): `string`

Returns the current anonymous ID.

This is the ID assigned to users before they are identified. It's used to track
anonymous users and link them to identified users when they sign up.

#### Returns

`string`

The stored anonymous ID. This may be an empty string if the client is not yet fully initialized.

#### Example

```js
// get the anonymous ID
const anonId = posthog.getAnonymousId()
console.log('Anonymous ID:', anonId)
```

## Get distinct ID

### `PostHog.getDistinctId`

> **getDistinctId**(): `string`

Gets the current user's distinct ID.

You may find it helpful to get the current user's distinct ID. For example, to check whether you've already called identify for a user or not.
This returns either the ID automatically generated by PostHog or the ID that has been passed by a call to identify().

#### Returns

`string`

The current user's distinct ID

#### Example

```js
// get current distinct ID
const distinctId = posthog.getDistinctId()
```

## Get feature flag

### `PostHog.getFeatureFlag`

> **getFeatureFlag**(`key`, `options?`): `string` \| `boolean` \| `undefined`

Gets the value of a feature flag for the current user.

Returns `true` or `false` for an evaluated boolean flag and a string for a multivariate flag.
Returns `undefined` before flags load or when loading fails. For backwards compatibility, a
missing key can resolve to `false` after a non-empty response is stored; use
`getFeatureFlagResult()` to distinguish an unavailable key from a conclusive off result.

Globally inactive flags are omitted from remote responses, so they follow this missing-key
behavior rather than carrying an explicit off evaluation.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature flag key |
| `options?` | `FeatureFlagResultOptions` | Optional per-call settings |

#### Returns

`string` \| `boolean` \| `undefined`

The current feature flag value, or undefined if flags are unavailable

#### Example

```js
// get feature flag value
const value = posthog.getFeatureFlag('key-for-your-boolean-flag')
```

### `useFeatureFlag`

> **useFeatureFlag**(`flag`, `client?`): `FeatureFlagValue` \| `undefined`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `flag` | `string` |
| `client?` | `PostHog` |

#### Returns

`FeatureFlagValue` \| `undefined`

## Get feature flag payload

### `PostHog.getFeatureFlagPayload`

> **getFeatureFlagPayload**(`key`): `JsonType` \| `undefined`

Gets the payload of a feature flag for the current user.

Returns JsonType or undefined if not loaded yet or if there was a problem loading.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature flag key |

#### Returns

`JsonType` \| `undefined`

The feature flag payload or undefined if not loaded

#### Deprecated

Use `getFeatureFlagResult()` instead, which returns the flag value and payload from a single evaluation.

#### Example

```js
// get feature flag payload
const payload = posthog.getFeatureFlagResult('key-for-your-multivariate-flag')?.payload
```

### `useFeatureFlagWithPayload`

> **useFeatureFlagWithPayload**(`flag`, `client?`): `FeatureFlagWithPayload`

Returns a flag's value and payload, and updates when flags reload.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `flag` | `string` |
| `client?` | `PostHog` |

#### Returns

`FeatureFlagWithPayload`

#### Deprecated

Use `useFeatureFlagResult()` instead, which returns the flag value and payload from a single evaluation.

## Get feature flag result

### `PostHog.getFeatureFlagResult`

> **getFeatureFlagResult**(`key`, `options?`): `FeatureFlagResult` \| `undefined`

Returns the current evaluation result for a feature flag. `enabled: false` is a conclusive
off result; `undefined` means no evaluation is available for the key.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |
| `options?` | `FeatureFlagResultOptions` |

#### Returns

`FeatureFlagResult` \| `undefined`

### `useFeatureFlagResult`

> **useFeatureFlagResult**(`flag`, `client?`): `FeatureFlagResult` \| `undefined`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `flag` | `string` |
| `client?` | `PostHog` |

#### Returns

`FeatureFlagResult` \| `undefined`

## Get feature flags

### `PostHog.getAllFeatureFlags`

> **getAllFeatureFlags**(): `FeatureFlagResult`[]

Returns all currently cached feature flags as `FeatureFlagResult`s. This is a synchronous read of
the flags from the last load (no network request) and does not send a `$feature_flag_called` event.

#### Returns

`FeatureFlagResult`[]

### `PostHog.getFeatureFlags`

> **getFeatureFlags**(): \{\[`key`: `string`\]: `FeatureFlagValue`; \} \| `undefined`

Returns the value of every loaded flag, keyed by flag key.

#### Returns

\{\[`key`: `string`\]: `FeatureFlagValue`; \} \| `undefined`

#### Deprecated

Use `getAllFeatureFlags()` instead, which returns each flag's value and payload together.

### `useFeatureFlags`

> **useFeatureFlags**(`client?`): \{\[`key`: `string`\]: `FeatureFlagValue`; \} \| `undefined`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client?` | `PostHog` |

#### Returns

\{\[`key`: `string`\]: `FeatureFlagValue`; \} \| `undefined`

## Get feature flags and payloads

### `PostHog.getFeatureFlagsAndPayloads`

> **getFeatureFlagsAndPayloads**(): `object`

Returns the values and payloads of every loaded flag, as two maps keyed by flag key.

#### Returns

`object`

| Name | Type |
| ------ | ------ |
| `flags` | \{\[`key`: `string`\]: `FeatureFlagValue`; \} \| `undefined` |
| `payloads` | \{\[`key`: `string`\]: `JsonType`; \} \| `undefined` |

#### Deprecated

Use `getAllFeatureFlags()` instead, which returns each flag's value and payload together.

## Get session ID

### `PostHog.getSessionId`

> **getSessionId**(): `string`

Returns the current session_id.

#### Returns

`string`

The stored session ID for the current session. This may be an empty string if the client is not yet fully initialized.

#### Remarks

This should only be used for informative purposes.
Any actual internal use case for the session_id should be handled by the sessionManager.

## Group

### `PostHog.group`

> **group**(`groupType`, `groupKey`, `properties?`): `void`

Associates the current user with a group.

Group analytics allows you to associate the events for that person's session with a group (e.g. teams, organizations, etc.).
This is a paid feature and is not available on the open-source or free cloud plan.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `groupType` | `string` | The type of group (e.g. 'company', 'team') |
| `groupKey` | `string` | The unique identifier for the group |
| `properties?` | `PostHogEventProperties` | Optional properties to set for the group |

#### Returns

`void`

#### Examples

```js
// associate with a group
posthog.group('company', 'company_id_in_your_db')
```

```js
// associate with a group and update properties
posthog.group('company', 'company_id_in_your_db', {
  name: 'Awesome Inc.',
  employees: 11,
})
```

### `PostHog.groups`

> **groups**(`groups`): `void`

** GROUPS
*

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `groups` | `PostHogGroupProperties` |

#### Returns

`void`

## Group identify

### `PostHog.groupIdentify`

> **groupIdentify**(`groupType`, `groupKey`, `groupProperties?`, `options?`): `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `groupType` | `string` |
| `groupKey` | `string` \| `number` |
| `groupProperties?` | `PostHogEventProperties` |
| `options?` | `PostHogCaptureOptions` |

#### Returns

`void`

## Is feature enabled

### `PostHog.isFeatureEnabled`

> **isFeatureEnabled**(`key`, `options`): `boolean`

Checks if a feature flag is enabled for the current user.

A `false` return value means the SDK resolved the current value as off. If no evaluation is
available, this method returns `defaultValue` when provided. Without a default, it returns
`undefined` before flags load; for backwards compatibility, a missing key can resolve to
`false` after a non-empty response is stored.

Globally inactive flags are omitted from remote responses, so they follow this missing-key
behavior rather than carrying an explicit off evaluation.

##### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature flag key |
| `options` | `FeatureFlagResultOptions` & `object` & `object` | Optional per-call settings |

##### Returns

`boolean`

True if the flag evaluates on, false if it evaluates off, or the missing-value fallback described above

##### Examples

```js
// check if feature flag is enabled
const isEnabled = posthog.isFeatureEnabled('key-for-your-boolean-flag')
```

```js
// fall back to false while flags are not loaded
const isEnabled = posthog.isFeatureEnabled('key-for-your-boolean-flag', { defaultValue: false })
```

#### Call Signature

> **isFeatureEnabled**(`key`, `options?`): `boolean` \| `undefined`

Checks if a feature flag is enabled for the current user.

A `false` return value means the SDK resolved the current value as off. If no evaluation is
available, this method returns `defaultValue` when provided. Without a default, it returns
`undefined` before flags load; for backwards compatibility, a missing key can resolve to
`false` after a non-empty response is stored.

Globally inactive flags are omitted from remote responses, so they follow this missing-key
behavior rather than carrying an explicit off evaluation.

##### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | The feature flag key |
| `options?` | `IsFeatureEnabledOptions` | Optional per-call settings |

##### Returns

`boolean` \| `undefined`

True if the flag evaluates on, false if it evaluates off, or the missing-value fallback described above

##### Examples

```js
// check if feature flag is enabled
const isEnabled = posthog.isFeatureEnabled('key-for-your-boolean-flag')
```

```js
// fall back to false while flags are not loaded
const isEnabled = posthog.isFeatureEnabled('key-for-your-boolean-flag', { defaultValue: false })
```

## Is opt out

### `PostHog.isDisabled`

> **get** **isDisabled**(): `boolean`

##### Returns

`boolean`

### `PostHog.optedOut`

> **get** **optedOut**(): `boolean`

##### Returns

`boolean`

## Is session replay active

### `PostHog.isSessionReplayActive`

> **isSessionReplayActive**(): `Promise`\<`boolean`\>

Returns whether session replay is currently active.

Note: This is only available on iOS and Android. On web/macOS, this always returns false.

#### Returns

`Promise`\<`boolean`\>

Whether session replay is currently active

#### Example

```js
const isActive = await posthog.isSessionReplayActive()
```

## On feature flags

### `PostHog.onFeatureFlags`

> **onFeatureFlags**(`cb`): () => `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `cb` | (`flags`) => `void` |

#### Returns

() => `void`

## Opt in

### `PostHog.optIn`

> **optIn**(): `Promise`\<`void`\>

Opts the user in to data capture.

By default, PostHog has tracking enabled unless it is forcefully disabled by default using the option { defaultOptIn: false }.
Once this has been called it is persisted and will be respected until optOut is called again or the reset function is called.
When opting in after an opt-out, session replay restarts in a new session if the app wanted it on at opt-out: `enableSessionReplay` is on, or the app called `startSessionRecording()`, and the app has not called `stopSessionRecording()` since. This holds even if replay was not recording at opt-out, for example while it waited for the linked flag or an event trigger. The linked flag, sampling and event triggers apply to the restart as usual. The promise resolves once session replay has been re-evaluated. A `startSessionRecording()` or `stopSessionRecording()` call made while opted out does not change this; to keep replay stopped, call `stopSessionRecording()` before `optOut()` or after `optIn()`.

#### Returns

`Promise`\<`void`\>

#### Example

```js
// opt in to tracking
posthog.optIn()
```

### `PostHog.optOut`

> **optOut**(): `Promise`\<`void`\>

Opts the user out of data capture.

You can completely opt-out users from data capture. Once this has been called it is persisted and will be respected until optIn is called again or the reset function is called.
The promise resolves once session replay has stopped.

#### Returns

`Promise`\<`void`\>

#### Example

```js
// opt out of tracking
posthog.optOut()
```

## Register

### `PostHog.register`

> **register**(`properties`): `Promise`\<`void`\>

Registers super properties that are sent with every event.

Super properties are properties associated with events that are set once and then sent with every capture call.
They persist across sessions and are stored locally.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `properties` | `PostHogEventProperties` | An associative array of properties to store about the user |

#### Returns

`Promise`\<`void`\>

#### Example

```js
// register super properties
posthog.register({
    'icecream pref': 'vanilla',
    team_id: 22,
})
```

### `PostHog.registerForSession`

> **registerForSession**(`properties`): `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `properties` | `PostHogEventProperties` |

#### Returns

`void`

## Reload feature flags

### `PostHog.reloadFeatureFlags`

> **reloadFeatureFlags**(): `void`

Reloads feature flags from the server.

PostHog loads feature flags when instantiated and refreshes whenever methods are called that affect the flag.
If you want to manually trigger a refresh, you can call this method.

#### Returns

`void`

#### Remarks

When the `disableRemoteFeatureFlags` option is set, this method is a no-op; supply
flag values via `updateFlags()` instead.

#### Example

```js
// reload feature flags
posthog.reloadFeatureFlags()
```

### `PostHog.reloadFeatureFlagsAsync`

> **reloadFeatureFlagsAsync**(): `Promise`\<`Record`\<`string`, `string` \| `boolean`\> \| `undefined`\>

Reloads feature flags from the server asynchronously.

PostHog loads feature flags when instantiated and refreshes whenever methods are called that affect the flag.
If you want to manually trigger a refresh and get the result, you can call this method.

#### Returns

`Promise`\<`Record`\<`string`, `string` \| `boolean`\> \| `undefined`\>

Promise that resolves with the refreshed flags

#### Example

```js
// reload feature flags and get result
posthog.reloadFeatureFlagsAsync().then((refreshedFlags) => console.log(refreshedFlags))
```

#### Remarks

When the `disableRemoteFeatureFlags` option is set, no request is made and the
promise resolves with the currently stored flags (from `bootstrap` or `updateFlags()`).

## Reset

### `PostHog.reset`

> **reset**(`propertiesToKeep?`): `void`

Resets the user's ID and anonymous ID after logout.

To reset the user's ID and anonymous ID, call reset. Usually you would do this right after the user logs out.
This also clears all stored super properties and more.

By default (when `propertiesToKeep` is not provided), the app lifecycle properties
(`InstalledAppBuild` and `InstalledAppVersion`) are automatically preserved to prevent
duplicate "Application Installed" events on the next app launch.

If you pass `propertiesToKeep` explicitly, only the properties you specify will be preserved.
To keep the default app lifecycle behavior, include `PostHogPersistedProperty.InstalledAppBuild`
and `PostHogPersistedProperty.InstalledAppVersion` in your array.

Note: The event queue (`PostHogPersistedProperty.Queue`) and logs queue
(`PostHogPersistedProperty.LogsQueue`) are always preserved regardless of
what is passed in `propertiesToKeep`, to ensure in-flight data is not lost.

The project-level remote config (`PostHogPersistedProperty.RemoteConfig`,
`PostHogPersistedProperty.SessionReplay`, `PostHogPersistedProperty.Surveys`) is also
always preserved — it is not user data — so session replay and surveys keep working
after an identity change. The user-specific survey state (`SurveysSeen`,
`SurveyLastSeenDate`) is still cleared.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `propertiesToKeep?` | `PostHogPersistedProperty`[] | Optional array of persisted properties to preserve during reset. When not provided, app lifecycle and device bucketing properties are automatically preserved. When provided, only the specified properties are preserved. The event queue and logs queue are always preserved regardless. |

#### Returns

`void`

#### Examples

```js
// reset after logout (preserves app lifecycle properties by default)
posthog.reset()
```

```js
// reset but keep feature flag overrides and app lifecycle properties
posthog.reset([
  PostHogPersistedProperty.OverrideFeatureFlags,
  PostHogPersistedProperty.InstalledAppBuild,
  PostHogPersistedProperty.InstalledAppVersion,
])
```

## Reset group properties for flags

### `PostHog.resetGroupPropertiesForFlags`

> **resetGroupPropertiesForFlags**(`reloadFeatureFlags?`): `void`

Resets group properties for feature flag evaluation.

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `reloadFeatureFlags?` | `boolean` | `true` | Whether to reload feature flags after setting the properties. Defaults to true. |

#### Returns

`void`

#### Example

```js
// reset group properties for flags
posthog.resetGroupPropertiesForFlags()
```

## Reset person properties for flags

### `PostHog.resetPersonPropertiesForFlags`

> **resetPersonPropertiesForFlags**(`reloadFeatureFlags?`): `void`

Resets person properties for feature flag evaluation.

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `reloadFeatureFlags?` | `boolean` | `true` | Whether to reload feature flags after setting the properties. Defaults to true. |

#### Returns

`void`

#### Example

```js
// reset person properties for flags
posthog.resetPersonPropertiesForFlags()
```

## Screen

### `PostHog.screen`

> **screen**(`name`, `properties?`, `options?`): `Promise`\<`void`\>

Captures a screen view event.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `name` | `string` | The name of the screen |
| `properties?` | `PostHogEventProperties` | Optional properties to include with the screen event |
| `options?` | `PostHogCaptureOptions` | Optional capture options |

#### Returns

`Promise`\<`void`\>

#### Remarks

This function requires a name. You may also pass in an optional properties object.
Once initialized, the screen name is registered immediately for subsequent events, including exceptions.
During initialization, screen registration and event capture retain their call order.
Exceptions use the last recorded screen, not a destination that has not yet been tracked.

#### Examples

```js
// Basic screen capture
posthog.screen('dashboard')
```

```js
// Screen capture with properties
posthog.screen('dashboard', {
    background: 'blue',
    hero: 'superhog',
})
```

### `useNavigationTracker`

> `const` **useNavigationTracker**: (`options?`, `navigationRef?`, `client?`) => `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | `PostHogAutocaptureNavigationTrackerOptions` |
| `navigationRef?` | `PostHogNavigationRef` |
| `client?` | `PostHog` |

#### Returns

`void`

## Set group properties for flags

### `PostHog.setGroupPropertiesForFlags`

> **setGroupPropertiesForFlags**(`properties`, `reloadFeatureFlags?`): `void`

Sets group properties for feature flag evaluation.

These properties are automatically attached to the current group (set via posthog.group()).
When you change the group, these properties are reset.

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `properties` | `Record`\<`string`, `Record`\<`string`, `JsonType`\>\> | `undefined` | The group properties to set for flag evaluation |
| `reloadFeatureFlags?` | `boolean` | `true` | Whether to reload feature flags after setting the properties. Defaults to true. |

#### Returns

`void`

#### Example

```js
// set group properties for flags
posthog.setGroupPropertiesForFlags({'company': {'property1': 'value', property2: 'value2'}})
```

## Set person properties

### `PostHog.setPersonProperties`

> **setPersonProperties**(`userPropertiesToSet?`, `userPropertiesToSetOnce?`, `reloadFeatureFlags?`): `void`

Sets properties on the person profile associated with the current `distinct_id`.
Learn more about [identifying users](https://posthog.com/docs/product-analytics/identify)

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `userPropertiesToSet?` | \{\[`key`: `string`\]: `JsonType`; \} | `undefined` | Optional: An object of properties to store about the user. These properties will overwrite any existing values for the same keys. |
| `userPropertiesToSetOnce?` | \{\[`key`: `string`\]: `JsonType`; \} | `undefined` | Optional: An object of properties to store about the user. If a property is previously set, this does not override that value. |
| `reloadFeatureFlags?` | `boolean` | `true` | Whether to reload feature flags after setting the properties. Defaults to true. |

#### Returns

`void`

#### Remarks

Updates user properties that are stored with the person profile in PostHog.
If `personProfiles` is set to `identified_only` and no profile exists, this will create one.

#### Examples

```js
// set user properties
posthog.setPersonProperties({
    email: 'user@example.com',
    plan: 'premium'
})
```

```js
// set properties with $set_once
posthog.setPersonProperties(
    { name: 'Max Hedgehog' },  // $set properties
    { initial_url: '/blog' }   // $set_once properties
)
```

```js
// set properties without reloading feature flags
posthog.setPersonProperties({ plan: 'premium' }, undefined, false)
```

### `PostHog.unsetPersonProperties`

> **unsetPersonProperties**(`propertyNames`, `reloadFeatureFlags?`): `void`

Removes properties from the person profile associated with the current `distinct_id`.
Learn more about [identifying users](https://posthog.com/docs/product-analytics/identify)

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `propertyNames` | `string` \| `string`[] | `undefined` | The name (or names) of the person properties to remove. |
| `reloadFeatureFlags?` | `boolean` | `true` | Whether to reload feature flags after removing the properties. Defaults to true. |

#### Returns

`void`

## Set person properties for flags

### `PostHog.setPersonPropertiesForFlags`

> **setPersonPropertiesForFlags**(`properties`, `reloadFeatureFlags?`): `void`

Sets person properties for feature flag evaluation.

Sometimes, you might want to evaluate feature flags using properties that haven't been ingested yet, or were set incorrectly earlier.
You can do so by setting properties the flag depends on with this call. These are set for the entire session.
Successive calls are additive: all properties you set are combined together and sent for flag evaluation.

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `properties` | `Record`\<`string`, `JsonType`\> | `undefined` | The person properties to set for flag evaluation |
| `reloadFeatureFlags?` | `boolean` | `true` | Whether to reload feature flags after setting the properties. Defaults to true. |

#### Returns

`void`

#### Example

```js
// set person properties for flags
posthog.setPersonPropertiesForFlags({'property1': 'value', property2: 'value2'})
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

## Start session recording

### `PostHog.startSessionRecording`

> **startSessionRecording**(`resumeCurrent?`): `Promise`\<`void`\>

Starts session recording.
This method will have no effect if PostHog is not enabled, or if session replay is disabled in your project settings.

A refused manual start is retried with successive delays of 1, 2, 4, 8, and 16 seconds,
and on subsequent feature flags loads while pending. This promise resolves after the
initial attempt, without waiting for retries or guaranteeing recording is active.
A newer start supersedes an unfinished request. Stop, reset, opt-out, and shutdown
cancel pending starts. Use `isSessionReplayActive()` to check the current recording state.

Note: This is only available on iOS and Android. On web/macOS, this is a no-op.

Requires `posthog-react-native-session-replay` version 1.3.0 or higher.

#### Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `resumeCurrent?` | `boolean` | `true` | Whether to resume recording of current session (true) or start a new session (false). Defaults to true. |

#### Returns

`Promise`\<`void`\>

#### Examples

```js
// Resume the current session recording
await posthog.startSessionRecording()
```

```js
// Start a new session recording
await posthog.startSessionRecording(false)
```

## Stop session recording

### `PostHog.stopSessionRecording`

> **stopSessionRecording**(): `Promise`\<`void`\>

Stops the current session recording if one is in progress.

Note: This is only available on iOS and Android. On web/macOS, this is a no-op.

Requires `posthog-react-native-session-replay` version 1.3.0 or higher.

#### Returns

`Promise`\<`void`\>

#### Example

```js
await posthog.stopSessionRecording()
```

## Unregister

### `PostHog.unregister`

> **unregister**(`property`): `Promise`\<`void`\>

Removes a super property so it won't be sent with future events.

Super Properties are persisted across sessions so you have to explicitly remove them if they are no longer relevant.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `property` | `string` | The name of the super property to remove |

#### Returns

`Promise`\<`void`\>

#### Example

```js
// remove a super property
posthog.unregister('icecream pref')
```

### `PostHog.unregisterForSession`

> **unregisterForSession**(`property`): `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `property` | `string` |

#### Returns

`void`

## Autocapture

### `PostHog.autocapture`

> **autocapture**(`eventType`, `elements`, `properties?`, `options?`): `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `eventType` | `string` |
| `elements` | `PostHogAutocaptureElement`[] |
| `properties?` | `PostHogEventProperties` |
| `options?` | `PostHogCaptureOptions` |

#### Returns

`void`

## Remote config

### `PostHog.reloadRemoteConfigAsync`

> **reloadRemoteConfigAsync**(): `Promise`\<`PostHogRemoteConfig` \| `undefined`\>

#### Returns

`Promise`\<`PostHogRemoteConfig` \| `undefined`\>

## Session replay privacy

### `PostHogMaskView`

> **PostHogMaskView**(`options`): `Element`

PostHogMaskView is a wrapper component that hides its children from PostHog
session recordings without compromising accessibility.

It works by:
- Setting `accessibilityLabel` to `"ph-no-capture"` to hide the content from session recordings
- Setting `importantForAccessibility` to `"no"` to prevent the wrapper View from hiding
  accessible content on Android (since `accessibilityLabel` would otherwise interfere)
- Setting `collapsable={false}` so React Native keeps this wrapper in the native view hierarchy
  (otherwise layout-only view flattening can remove it and masking is not detected on iOS/Android)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | `PostHogMaskViewProps` |

#### Returns

`Element`

#### Example

```jsx
import { PostHogMaskView } from 'posthog-react-native'

function SensitiveForm() {
  return (
    <PostHogMaskView>
      <TextInput placeholder="Credit card number" />
      <TextInput placeholder="CVV" />
    </PostHogMaskView>
  )
}
```

## Surveys

### `PostHog.getSurveys`

> **getSurveys**(): `Promise`\<`Survey`[]\>

#### Returns

`Promise`\<`Survey`[]\>

### `PostHogSurveyProvider`

> **PostHogSurveyProvider**(`props`): `Element`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `props` | `PostHogSurveyProviderProps` |

#### Returns

`Element`

### `Questions`

> **Questions**(`options`): `Element`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | \{ `appearance`: `SurveyAppearanceTheme`; `client?`: `PostHog`; `initialProgress?`: `SurveyProgress`; `onProgressChange?`: (`progress`, `completed`) => `boolean`; `onResponsesChange?`: (`responses`) => `void`; `onSubmit`: () => `void`; `styleOverrides?`: `StyleProp`\<`ViewStyle`\>; `survey`: `Survey`; `surveyLanguage?`: `string` \| `null`; \} |
| `options.appearance` | `SurveyAppearanceTheme` |
| `options.client?` | `PostHog` |
| `options.initialProgress?` | `SurveyProgress` |
| `options.onProgressChange?` | (`progress`, `completed`) => `boolean` |
| `options.onResponsesChange?` | (`responses`) => `void` |
| `options.onSubmit` | () => `void` |
| `options.styleOverrides?` | `StyleProp`\<`ViewStyle`\> |
| `options.survey` | `Survey` |
| `options.surveyLanguage?` | `string` \| `null` |

#### Returns

`Element`

### `SurveyModal`

> **SurveyModal**(`props`): `Element` \| `null`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `props` | `SurveyModalProps` |

#### Returns

`Element` \| `null`

## SDK utils

### `PostHog.capturePushNotificationOpened`

> **capturePushNotificationOpened**(`options`): `Promise`\<`void`\>

Captures `$push_notification_opened` when a user opens a push notification.
Requires `@posthog/react-native-plugin`.

Only for taps PostHogOptions.capturePushNotificationOpened cannot see itself —
local notifications, plus Android taps while the app is running if
`@posthog/react-native-plugin` is older than 2.6.0. A notification PostHog sent is still
counted once when both paths report it (same `posthog.invocation_id` and action within
five minutes); one from another provider is counted twice.

Keys of `payload`'s `posthog` entry become `$notification_<key>` properties. Leave
`action` unset for a plain tap; `subtitle` is iOS only. The native SDK builds and
sends the event, so JS `before_send` never sees it — redact anything sensitive first.

Not supported on web.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | \{ `action?`: `string`; `body?`: `string`; `payload?`: \{\[`key`: `string`\]: `JsonType`; \}; `subtitle?`: `string`; `title?`: `string`; \} |
| `options.action?` | `string` |
| `options.body?` | `string` |
| `options.payload?` | \{\[`key`: `string`\]: `JsonType`; \} |
| `options.subtitle?` | `string` |
| `options.title?` | `string` |

#### Returns

`Promise`\<`void`\>

### `PostHog.getDeviceId`

> **getDeviceId**(): `string`

Returns the stable device identifier used for device-level feature flag bucketing.
This ID persists across identify() and reset() calls, only changing on a fresh
app install, manual cache clearing, or OS-initiated storage cleanup.

#### Returns

`string`

The device ID, or an empty string if not yet initialized

### `PostHog.getFeatureFlagDetails`

> **getFeatureFlagDetails**(): `PostHogFeatureFlagDetails` \| `undefined`

#### Returns

`PostHogFeatureFlagDetails` \| `undefined`

### `PostHog.getSurveyDisplayLanguageOverride`

> **getSurveyDisplayLanguageOverride**(): `string` \| `null`

#### Returns

`string` \| `null`

### `PostHog.on`

> **on**(`event`, `cb`): () => `void`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | `string` |
| `cb` | (...`args`) => `void` |

#### Returns

() => `void`

### `PostHog.registerPushNotificationToken`

> **registerPushNotificationToken**(`deviceToken`, `options?`): `Promise`\<`void`\>

Registers this device's push token so PostHog Workflows can target it.
Requires `@posthog/react-native-plugin`.

Registration happens at startup on its own when
PostHogOptions.capturePushNotificationSubscriptions is on, so call this for
token refreshes, which that startup fetch cannot see — on Android only, since a
refresh listener yields an FCM token and iOS defaults to APNs. Safe to call before
the native SDK is ready; the call queues rather than being dropped.

`appId` says which provider delivers: the Firebase `project_id` for an FCM token, the
APNs bundle id for an APNs token. Unset, iOS uses the bundle id and Android the
default `FirebaseApp`'s project id, so pass it if you don't use Firebase or use a
non-default project. Registration fails server-side if your PostHog project has no
matching integration for `appId`.

To use FCM on iOS too, pass the Firebase `project_id` as `appId` and set
PostHogOptions.capturePushNotificationSubscriptions to `false` first —
otherwise the device registers twice (APNs under the bundle id, FCM under the project
id), a Workflow with both integrations delivers twice, and
unregisterPushNotificationToken clears only the most recent.

Not supported on web or macOS.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `deviceToken` | `string` |
| `options?` | \{ `appId?`: `string`; \} |
| `options.appId?` | `string` |

#### Returns

`Promise`\<`void`\>

### `PostHog.resetSessionId`

> **resetSessionId**(): `void`

#### Returns

`void`

### `PostHog.unregisterPushNotificationToken`

> **unregisterPushNotificationToken**(): `Promise`\<`void`\>

Unregisters this device's push token so Workflows stop targeting it — for example
from your logout flow. Requires `@posthog/react-native-plugin`.

Durable: a failed or offline request retries on the next flush or launch. `reset()`
already moves a registered token to the new identity, so this is only needed if you
manage subscriptions yourself.

Not supported on web or macOS.

#### Returns

`Promise`\<`void`\>

### `PostHog.updateFlags`

> **updateFlags**(`flags`, `payloads?`, `options?`): `void`

Replaces (or merges into) the stored feature flags and payloads with locally supplied
values, exactly as if they had been returned by the flags endpoint: the values are
persisted, `getFeatureFlag()`/`getFeatureFlagPayload()` read them back, and
`onFeatureFlags` listeners fire. Makes no network request.

Intended for apps that evaluate flags outside the SDK (e.g. server-side local
evaluation) and push the results in at runtime, typically together with the
`disableRemoteFeatureFlags` option so the SDK never fetches flags itself.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `flags` | `Record`\<`string`, `boolean` \| `string`\> | Flag keys mapped to their values (boolean, or a variant string) |
| `payloads?` | `Record`\<`string`, `JsonType`\> | Optional flag keys mapped to their JSON payloads |
| `options?` | \{ `merge?`: `boolean`; \} | Set `merge: true` to merge with the currently stored flags instead of replacing them |
| `options.merge?` | `boolean` | - |

#### Returns

`void`

#### Remarks

The values are cleared by `reset()`, so push them again after an identity change.

#### Examples

```js
// replace all stored flags with locally evaluated ones
posthog.updateFlags({ 'my-flag': true, 'multivariate-flag': 'variant-1' })
```

```js
// include payloads
posthog.updateFlags({ 'my-flag': true }, { 'my-flag': { color: 'blue' } })
```

```js
// merge into the stored flags instead of replacing them
posthog.updateFlags({ 'my-flag': false }, undefined, { merge: true })
```

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

### `AutocaptureOptions`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-androidndkcrashes"></a> `androidNdkCrashes?` | `boolean` | Enables autocapture of native C/C++ (NDK) crashes on Android, through the optional native plugin. Requires Android 12 (API 31) or later and exception autocapture enabled in the project's error tracking settings. An NDK crash kills the process immediately, so it is captured on the next app launch from the records the OS kept, which means properties such as `$app_version` and the identity describe that launch rather than the crash. The first launch after enabling this also captures the native crashes the OS still holds from before. For readable stack traces, upload the app's `.so` debug symbols. With Expo, set `uploadNativeSymbols` on the `posthog-react-native/expo` config plugin: https://posthog.com/docs/error-tracking/upload-source-maps/react-native#native-crash-symbolication Ignored on other platforms. Disabled by default. Requires `@posthog/react-native-plugin` 2.12.0 or newer. |
| <a id="property-console"></a> `console?` | `boolean` \| `LogLevel`[] | - |
| <a id="property-nativecrashes"></a> `nativeCrashes?` | `boolean` | Enables native iOS/Android/macOS crash autocapture through the optional native plugin. On Android this covers Java/Kotlin crashes; native C/C++ (NDK) crashes are enabled with `androidNdkCrashes`. On Apple platforms it covers signal crashes too. Disabled by default. Requires `@posthog/react-native-plugin` installed (2.2.0 or newer for macOS). |
| <a id="property-uncaughtexceptions"></a> `uncaughtExceptions?` | `boolean` | - |
| <a id="property-unhandledrejections"></a> `unhandledRejections?` | `boolean` | - |

### `BasicSurveyQuestion`

> **BasicSurveyQuestion** = `SurveyQuestionBase` & `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `type` | *typeof* `SurveyQuestionType.Open` |

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

### `CaptureLogger`

> **CaptureLogger** = `Logger`

### `CaptureLogOptions`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attributes"></a> `attributes?` | `LogAttributes` | Per-log attributes (request-specific context like order_id, duration_ms) |
| <a id="property-body"></a> `body` | `string` | The log message body (required) |
| <a id="property-level"></a> `level?` | `LogSeverityLevel` | Log severity level (default: 'info') |
| <a id="property-span_id"></a> `span_id?` | `string` | Span ID for correlation — 16 hex chars |
| <a id="property-trace_flags"></a> `trace_flags?` | `number` | W3C trace flags (default: 0) |
| <a id="property-trace_id"></a> `trace_id?` | `string` | Trace ID for correlation — 32 hex chars |

### `Compression`

| Enumeration Member | Value |
| ------ | ------ |
| <a id="enumeration-member-base64"></a> `Base64` | `"base64"` |
| <a id="enumeration-member-gzipjs"></a> `GZipJS` | `"gzip-js"` |

### `EndBranching`

> **EndBranching** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="type"></a> `type` | *typeof* `SurveyQuestionBranchingType.End` |

### `ErrorTrackingOptions`

| Property | Type |
| ------ | ------ |
| <a id="property-autocapture"></a> `autocapture?` | `boolean` \| `AutocaptureOptions` |
| <a id="property-exceptionsteps"></a> `exceptionSteps?` | `ExceptionStepsOptions` |

### `EvaluationReason`

> **EvaluationReason** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="code"></a> `code` | `string` \| `undefined` |
| <a id="condition_index"></a> `condition_index` | `number` \| `undefined` |
| <a id="description"></a> `description` | `string` \| `undefined` |

### `EventHint`

- `CoercingContext`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-mechanism-1"></a> `mechanism?` | `Partial`\<`Mechanism`\> |
| <a id="property-skipfirstlines-1"></a> `skipFirstLines?` | `number` |
| <a id="property-syntheticexception-1"></a> `syntheticException?` | `Error` \| `null` |

### `ExceptionStepsOptions`

Controls the breadcrumb-style exception steps recorded via `addExceptionStep` and attached
to captured exceptions as `$exception_steps`.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-enabled"></a> `enabled?` | `boolean` | Whether exception steps are recorded and attached. **Default** `true` |
| <a id="property-maxbytes"></a> `maxBytes?` | `number` | Total UTF-8 byte budget (~32KB) for the in-memory buffer. Oldest steps are evicted first when exceeded. **Default** `32768` |

### `FeatureFlagDetail`

> **FeatureFlagDetail** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="enabled-1"></a> `enabled` | `boolean` |
| <a id="failed"></a> `failed?` | `boolean` |
| <a id="key"></a> `key` | `string` |
| <a id="metadata"></a> `metadata` | `FeatureFlagMetadata` \| `undefined` |
| <a id="reason"></a> `reason` | `EvaluationReason` \| `undefined` |
| <a id="variant"></a> `variant` | `string` \| `undefined` |

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

### `FeatureFlagResult`

> **FeatureFlagResult** = `object`

Result of evaluating a feature flag, including both the flag value and its payload.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="enabled-2"></a> `enabled` | `readonly` | `boolean` | Whether the returned feature flag evaluation is enabled. `false` is a conclusive off result. |
| <a id="key-1"></a> `key` | `readonly` | `string` | - |
| <a id="payload-1"></a> `payload?` | `readonly` | `JsonType` | - |
| <a id="variant-1"></a> `variant?` | `readonly` | `string` | - |

### `FeatureFlagResultOptions`

> **FeatureFlagResultOptions** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="sendevent"></a> `sendEvent?` | `boolean` | Whether to send a $feature_flag_called event. Defaults to true. |

### `FeatureFlagValue`

> **FeatureFlagValue** = `string` \| `boolean`

### `FeatureFlagWithPayload`

> **FeatureFlagWithPayload** = \[`FeatureFlagValue` \| `undefined`, `JsonType` \| `undefined`\]

### `IsFeatureEnabledOptions`

> **IsFeatureEnabledOptions** = `FeatureFlagResultOptions` & `object`

#### Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `defaultValue?` | `boolean` | Value to return when the flag has no value, e.g. flags have not loaded yet or no flag with that key exists. |

### `JsonType`

> **JsonType** = `string` \| `number` \| `boolean` \| `null` \| \{\[`key`: `string`\]: `JsonType`; \} \| `JsonType`[] \| `JsonType`[]

### `LinkSurveyQuestion`

> **LinkSurveyQuestion** = `SurveyQuestionBase` & `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `link?` | `string` \| `null` |
| `type` | *typeof* `SurveyQuestionType.Link` |

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

### `LogLevel`

> **LogLevel** = `"debug"` \| `"log"` \| `"info"` \| `"warn"` \| `"error"`

### `LogSeverityLevel`

> **LogSeverityLevel** = `"trace"` \| `"debug"` \| `"info"` \| `"warn"` \| `"error"` \| `"fatal"`

Log capture types

### `Mechanism`

| Property | Type |
| ------ | ------ |
| <a id="property-exception_id"></a> `exception_id?` | `number` |
| <a id="property-handled"></a> `handled?` | `boolean` |
| <a id="property-parent_id"></a> `parent_id?` | `number` |
| <a id="property-source"></a> `source?` | `string` |
| <a id="property-synthetic-2"></a> `synthetic?` | `boolean` |
| <a id="property-type-4"></a> `type?` | `string` |

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

### `PartialWithRequired`

> **PartialWithRequired**\<`T`, `K`\> = `{ [P in K]: T[P] }` & `{ [P in Exclude<keyof T, K>]?: T[P] }`

Creates a type with all properties of T, but makes only K properties required while the rest remain optional.

#### Type Parameters

| Type Parameter | Description |
| ------ | ------ |
| <a id="type-parameter-t-8"></a> `T` | The base type containing all properties |
| <a id="type-parameter-k"></a> `K` *extends* keyof `T` | Union type of keys from T that should be required |

#### Example

```ts
interface User {
  id: number;
  name: string;
  email?: string;
  age?: number;
}

// Makes 'id' and 'name' required, but 'email' and 'age' optional
type RequiredUser = PartialWithRequired<User, 'id' | 'name'>;

const user: RequiredUser = {
  id: 1,      // Must be provided
  name: "John" // Must be provided
  // email and age are optional
};
```

### `PostHogAutocaptureElement`

> **PostHogAutocaptureElement** = `object` & `PostHogEventProperties`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `$el_text?` | `string` |
| `href?` | `string` |
| `nth_child?` | `number` |
| `nth_of_type?` | `number` |
| `order?` | `number` |
| `tag_name` | `string` |

### `PostHogAutocaptureNavigationTrackerOptions`

> **PostHogAutocaptureNavigationTrackerOptions** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="routetoname"></a> `routeToName?` | (`name`, `params`) => `string` |
| <a id="routetoproperties"></a> `routeToProperties?` | (`name`, `params`) => `Record`\<`string`, `any`\> |

### `PostHogAutocaptureOptions`

> **PostHogAutocaptureOptions** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="capturescreens"></a> `captureScreens?` | `boolean` | Capture the screen name (or route name) and properties Only used for expo-router, @react-navigation/native and react-native-navigation For react-native-navigation, you need to call initReactNativeNavigation before using this option See example: https://posthog.com/docs/libraries/react-native#with-react-native-navigation-and-autocapture For @react-navigation/native v6 and below, you need to wrap the PostHogProvider within the NavigationContainer See example: https://posthog.com/docs/libraries/react-native#with-react-navigationnative-and-autocapture For @react-navigation/native v7 and above, because of a library change, you'll need to capture the screens manually and disable this option You can use the onStateChange callback from the NavigationContainer to capture the screens automatically using the screen capture method You can use the 'usePostHog()' hook or your own posthog instance to capture the screens Since captureScreens is disabled, you don't need to pass the navigationRef, the navigation mutation object is also ignored See example: https://reactnavigation.org/docs/screen-tracking/ and https://posthog.com/docs/libraries/react-native#manually-capturing-screen-capture-events For expo-router, expo-router uses @react-navigation/native, but does not expose the NavigationContainer, you'll need to capture the screens manually and disable this option expo-router always has access to a URL, you can use the URL to capture the screens automatically using the screen capture method You can use the 'usePostHog()' hook or your own posthog instance to capture the screens Since captureScreens is disabled, you don't need to pass the navigationRef, the navigation mutation object is also ignored See example: https://docs.expo.dev/router/reference/screen-tracking/ and https://posthog.com/docs/libraries/react-native#manually-capturing-screen-capture-events **Default** `true` |
| <a id="capturetouches"></a> `captureTouches?` | `boolean` | Enable autocapture of touch events. On React Native Web this also captures `click` events — mouse, trackpad, keyboard activation and programmatic clicks — emitted with `$event_type: 'click'`, since browsers fire `touchend` only for touch input. **Default** `false` |
| <a id="customlabelprop"></a> `customLabelProp?` | `string` | Custom prop name used to label elements for autocapture **Default** `'ph-label'` |
| <a id="ignorelabels"></a> `ignoreLabels?` | `string`[] | List of element labels to ignore during autocapture **Default** `[]` |
| <a id="maxelementscaptured"></a> `maxElementsCaptured?` | `number` | Maximum number of elements to capture in the component tree hierarchy **Default** `20` |
| <a id="navigation"></a> `navigation?` | `PostHogAutocaptureNavigationTrackerOptions` | Used for mutating the screen name and properties Only used if captureScreens is true **Default** `Default to the route name and params` |
| <a id="navigationref"></a> ~~`navigationRef?`~~ | `PostHogNavigationRef` | If you create a navigation ref with createNavigationContainerRef, you need to pass the navigation ref Only used for expo-router and @react-navigation/native if captureScreens is true **Deprecated** this is deprecated since it didn't work as expected, check out the `captureScreens` comments for capturing screen views semi-automatically |
| <a id="nocaptureprop"></a> `noCaptureProp?` | `string` | Prop name used to prevent autocapture on an element and its children **Default** `'ph-no-capture'` |
| <a id="propstocapture"></a> `propsToCapture?` | `string`[] | List of prop names to capture from elements **Default** `['style', 'testID', 'accessibilityLabel', 'ph-label', 'children']` |

### `PostHogCaptureOptions`

> **PostHogCaptureOptions** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="_originatedfromcaptureexception"></a> `_originatedFromCaptureException?` | `boolean` | Internal flag set by captureException() to indicate this $exception event originated from the proper exception capture path. Used to warn users who call capture('$exception') directly. |
| <a id="disablegeoip"></a> `disableGeoip?` | `boolean` | - |
| <a id="timestamp-2"></a> `timestamp?` | `Date` | If provided, overrides the auto-generated timestamp. UTC is preferred; non-UTC input is converted to UTC. |
| <a id="uuid-1"></a> `uuid?` | `string` | If provided overrides the auto-generated event UUID. Must be a valid UUID. |

### `PostHogCoreOptions`

> **PostHogCoreOptions** = `object`

#### Extended by

- `PostHogOptions`

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
| <a id="evaluationcontexts"></a> `evaluationContexts?` | readonly `string`[] | Evaluation contexts for feature flags. When set, only feature flags that have at least one matching evaluation tag will be evaluated for this SDK instance. Feature flags with no evaluation tags will always be evaluated. Examples: ['production', 'web', 'mobile'] **Default** `undefined` |
| <a id="evaluationenvironments"></a> ~~`evaluationEnvironments?`~~ | readonly `string`[] | Evaluation environments for feature flags. **Deprecated** Use evaluationContexts instead. This property will be removed in a future version. |
| <a id="featureflagsrequestmaxretries"></a> `featureFlagsRequestMaxRetries?` | `number` | How many times feature flag requests retry after a transient network error. Set to 0 to disable feature flag request retries. **Default** `1` |
| <a id="featureflagsrequesttimeoutms"></a> `featureFlagsRequestTimeoutMs?` | `number` | Timeout in milliseconds for feature flag calls **Default** `10000 for stateful clients, 3000 for stateless` |
| <a id="fetchretrycount"></a> `fetchRetryCount?` | `number` | How many times we will retry HTTP requests **Default** `3` |
| <a id="fetchretrydelay"></a> `fetchRetryDelay?` | `number` | The delay between HTTP request retries in milliseconds **Default** `3000` |
| <a id="flushat-2"></a> `flushAt?` | `number` | The number of events to queue before sending to PostHog (flushing) **Default** `20` |
| <a id="flushinterval"></a> `flushInterval?` | `number` | The interval in milliseconds between periodic flushes **Default** `10000` |
| <a id="historicalmigration"></a> `historicalMigration?` | `boolean` | Special flag to indicate ingested data is for a historical migration **Default** `false` |
| <a id="host-2"></a> `host?` | `string` | PostHog API host, usually 'https://us.i.posthog.com' or 'https://eu.i.posthog.com' **Default** `'https://us.i.posthog.com'` |
| <a id="maxbatchsize"></a> `maxBatchSize?` | `number` | The maximum number of queued messages to be flushed as part of a single batch (must be higher than `flushAt`) **Default** `100` |
| <a id="maxqueuesize"></a> `maxQueueSize?` | `number` | The maximum number of cached messages either in memory or on the local storage (must be higher than `flushAt`) **Default** `1000` |
| <a id="personprofiles"></a> `personProfiles?` | `"always"` \| `"identified_only"` \| `"never"` | Determines when to create Person Profiles for users. - 'always': Always create a person profile for every user (anonymous and identified). - 'identified_only': Only create a person profile when the user is identified via identify(), alias(), or group(). Events captured before identification will NOT have person profiles and will be anonymous events. - 'never': Never create person profiles. identify(), alias(), and group() will be no-ops. **Default** `'identified_only'` **Examples** `// Only create profiles when users are identified (recommended for most apps) const posthog = new PostHog('<api_key>', { personProfiles: 'identified_only', }) // Later when user logs in: posthog.identify('user-123', { email: 'user@example.com' })` `// Always create profiles (for apps where you want to track all users) const posthog = new PostHog('<api_key>', { personProfiles: 'always', })` `// Never create profiles (anonymous analytics only) const posthog = new PostHog('<api_key>', { personProfiles: 'never', })` |
| <a id="preloadfeatureflags-2"></a> `preloadFeatureFlags?` | `boolean` | Whether to load feature flags when initialized or not **Default** `true` |
| <a id="remoteconfigrequesttimeoutms"></a> `remoteConfigRequestTimeoutMs?` | `number` | Timeout in milliseconds for remote config calls **Default** `3000` |
| <a id="requesttimeout"></a> `requestTimeout?` | `number` | Timeout in milliseconds for any calls **Default** `10000` |
| <a id="sendfeatureflagevent"></a> `sendFeatureFlagEvent?` | `boolean` | Whether to track that `getFeatureFlag` was called (used by Experiments) In posthog-node this is also the default for reads from an `evaluateFlags()` snapshot (`isEnabled()` / `getFlag()`). Pass `sendFeatureFlagEvents` to one of those reads, or to a single-flag getter, to override it for that call. **Default** `true` |
| <a id="sessionexpirationtimeseconds"></a> `sessionExpirationTimeSeconds?` | `number` | For Session Analysis how long before we expire a session in seconds **Default** `1800` |

### `PostHogCustomAppProperties`

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-app_build"></a> `$app_build?` | `string` \| `null` | Build number like "1.2.2" or "122" |
| <a id="property-app_name"></a> `$app_name?` | `string` \| `null` | Name of the app as displayed below the icon like "PostHog" |
| <a id="property-app_namespace"></a> `$app_namespace?` | `string` \| `null` | Namespace of the app usually like "com.posthog.app" |
| <a id="property-app_version"></a> `$app_version?` | `string` \| `null` | Human friendly app version like what a user would see in the app store like "1.2.2" |
| <a id="property-device_manufacturer"></a> `$device_manufacturer?` | `string` \| `null` | Manufacturer like "Apple", "Samsung" or "Android" |
| <a id="property-device_model"></a> `$device_model?` | `string` \| `null` | Model identifier like "iPhone13,2" or "SM-S921B" |
| <a id="property-device_name"></a> `$device_name?` | `string` \| `null` | Readable model name like "iPhone 12" or "Samsung Galaxy S24" |
| <a id="property-device_type"></a> `$device_type?` | `string` \| `null` | Device type ("Mobile" \| "Desktop") |
| <a id="property-is_emulator"></a> `$is_emulator?` | `boolean` \| `null` | Whether the app is running on an emulator/simulator |
| <a id="property-locale"></a> `$locale?` | `string` \| `null` | Locale (language) of the device like "en-US" |
| <a id="property-os_name"></a> `$os_name?` | `string` \| `null` | Operating system name like iOS or Android |
| <a id="property-os_version"></a> `$os_version?` | `string` \| `null` | Operating system version "14.0" |
| <a id="property-react_native_version"></a> `$react_native_version?` | `string` \| `null` | React Native version like "0.79.6". Not set by default: the SDK sends it only on `Application Installed` and `Application Updated` |
| <a id="property-timezone"></a> `$timezone?` | `string` \| `null` | Timezone of the device like "Europe/Berlin" |

### `PostHogCustomStorage`

| Property | Type |
| ------ | ------ |
| <a id="property-getitem"></a> `getItem` | (`key`) => `string` \| `Promise`\<`string` \| `null`\> \| `null` |
| <a id="property-setitem"></a> `setItem` | (`key`, `value`) => `void` \| `Promise`\<`void`\> |

### `PostHogErrorBoundaryFallbackProps`

> **PostHogErrorBoundaryFallbackProps** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="componentstack"></a> `componentStack` | `string` |
| <a id="error"></a> `error` | `unknown` |
| <a id="reseterror"></a> `resetError` | () => `void` |

### `PostHogErrorBoundaryProps`

> **PostHogErrorBoundaryProps** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="additionalproperties"></a> `additionalProperties?` | `Properties` \| ((`error`) => `Properties`) |
| <a id="children"></a> `children?` | `React.ReactNode` \| (() => `React.ReactNode`) |
| <a id="fallback"></a> `fallback?` | `React.ReactNode` \| `FunctionComponent`\<`PostHogErrorBoundaryFallbackProps`\> |

### `PostHogErrorBoundaryState`

> **PostHogErrorBoundaryState** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="componentstack"></a> `componentStack` | `string` \| `null` |
| <a id="error-2"></a> `error` | `unknown` |
| <a id="haserror"></a> `hasError` | `boolean` |

### `PostHogEventProperties`

> **PostHogEventProperties** = `object`

#### Index Signature

\[`key`: `string`\]: `JsonType`

### `PostHogFeatureFlagDetails`

> **PostHogFeatureFlagDetails** = `PartialWithRequired`\<`PostHogFlagsResponse`, `"flags"` \| `"featureFlags"` \| `"featureFlagPayloads"` \| `"requestId"`\>

These are the fields we care about from PostHogFlagsResponse for feature flags.

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

### `PostHogGroupProperties`

> **PostHogGroupProperties** = `object`

#### Index Signature

\[`type`: `string`\]: `string` \| `number`

### `PostHogLogsConfig`

Configuration for the logs feature on `new PostHog(key, { logs: ... })`.
All fields are optional; per-SDK defaults apply (mobile vs browser tune
differently for cellular cost vs tab-suspension behavior).

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-beforesend"></a> `beforeSend?` | `BeforeSendLogFn` \| `BeforeSendLogFn`[] | Pre-send filter. See BeforeSendLogFn for shape and examples. Configure as a single function or a chain. |
| <a id="property-environment"></a> `environment?` | `string` | Deployment environment attached as OTLP `deployment.environment` (e.g. `'production'`, `'staging'`, `'dev'`). |
| <a id="property-flushintervalms"></a> `flushIntervalMs?` | `number` | How often the periodic background flush fires (ms). Records also flush eagerly when the buffer fills, on AppState changes (RN), and on `shutdown()`. Lower values trade battery/bandwidth for fresher data. Default: 10000 (RN) / 3000 (browser). |
| <a id="property-maxbatchrecordsperpost"></a> `maxBatchRecordsPerPost?` | `number` | Max records per outbound POST. Keeps each request under the server's request body cap. On a 413 response, the SDK halves this value, retries the same records, then ramps back up by 1 per healthy send. A 413 on a single-record batch drops the record (it's larger than the server can accept regardless of batch size). Default: 50 (RN) / 100 (browser). |
| <a id="property-maxbuffersize"></a> `maxBufferSize?` | `number` | Number of buffered records that triggers an immediate flush. Records also flush on the periodic interval and on `shutdown()`. The queue can grow past this while an async flush is in flight (e.g. during a synchronous burst); a separate, larger memory backstop evicts the oldest only once the queue exceeds the per-interval rate cap. Default: 100. |
| <a id="property-ratecap"></a> `rateCap?` | `object` | Tumbling-window rate cap. Bounds how many records can be captured within a sliding (technically tumbling) time window. Records exceeding the cap are dropped synchronously at `captureLog()` (they never enter the buffer or consume bandwidth). A single warn line is logged per window when the cap is hit. Defaults are per-SDK; on RN the default is `{ maxLogs: 500, windowMs: 10000 }` (≈50 logs/sec ceiling, tuned for cellular bandwidth). **Examples** **Allow brief bursts up to 1000/min** `logs: { rateCap: { maxLogs: 1000, windowMs: 60000 } }` **Disable the cap entirely (unbounded)** `logs: { rateCap: { maxLogs: undefined } }` |
| `rateCap.maxLogs?` | `number` | Max records accepted per `windowMs` window. `undefined` = unbounded. |
| `rateCap.windowMs?` | `number` | Window length in ms. Tumbling, not sliding — the counter resets the first time a capture fires after the window expires. |
| <a id="property-resourceattributes"></a> `resourceAttributes?` | `Record`\<`string`, `LogAttributeValue`\> | Extra OTLP resource attributes attached to every record. Spread first; SDK-controlled keys (`service.name`, `telemetry.sdk.*`, RN's `os.*`) are layered on top so users cannot accidentally clobber them. Use the dedicated `serviceName` / `environment` / `serviceVersion` fields to override those keys. |
| <a id="property-servicename"></a> `serviceName?` | `string` | Service name attached to every record as the OTLP `service.name` resource attribute. Used by the Logs UI for filtering / grouping. Defaults to `'unknown_service'` when unset. |
| <a id="property-serviceversion"></a> `serviceVersion?` | `string` | Service version attached as OTLP `service.version`. Useful for correlating regressions to specific app releases. |

### `PostHogMaskViewProps`

Props for the PostHogMaskView component.

#### Extends

- `ViewProps`

#### Properties

| Property | Type | Description | Overrides |
| ------ | ------ | ------ | ------ |
| <a id="property-children"></a> `children` | `ReactNode` | The child components to mask from PostHog capture | `ViewProps.children` |

### `PostHogNavigationRef`

> **PostHogNavigationRef** = `object`

#### Deprecated

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="current"></a> ~~`current?`~~ | `PostHogNavigationRef` \| `any` |
| <a id="isready"></a> ~~`isReady`~~ | () => `boolean` |

#### Methods

##### ~~getCurrentRoute()~~

> **getCurrentRoute**(): `any`

###### Returns

`any`

### `PostHogOptions`

- `PostHogCoreOptions`

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-addtracingheaders"></a> `addTracingHeaders?` | `string`[] | A list of hostnames for which to inject PostHog tracing headers (X-POSTHOG-DISTINCT-ID, X-POSTHOG-SESSION-ID) on outgoing `fetch` requests. Use this to link requests made from your app to session replays and LLM traces in PostHog. When set, the global `fetch` is patched on initialization and the headers are added to requests whose hostname matches one of the entries. Requires the SDK to wire up `patchFetchForTracingHeaders` against this option (currently supported in posthog-react-native). | `PostHogCoreOptions.addTracingHeaders` |
| <a id="property-before_send"></a> `before_send?` | `BeforeSendFn` \| `BeforeSendFn`[] | Allows modification or dropping of events before they're sent to PostHog. If an array is provided, the functions are run in order. If a function returns null, the event will be dropped. | `PostHogCoreOptions.before_send` |
| <a id="property-bootstrap"></a> `bootstrap?` | `object` | Option to bootstrap the library with given distinctId and feature flags | `PostHogCoreOptions.bootstrap` |
| `bootstrap.distinctId?` | `string` | - | - |
| `bootstrap.featureFlagPayloads?` | `Record`\<`string`, `JsonType`\> | - | - |
| `bootstrap.featureFlags?` | `Record`\<`string`, `FeatureFlagValue`\> | - | - |
| `bootstrap.isIdentifiedId?` | `boolean` | - | - |
| <a id="property-captureapplifecycleevents"></a> `captureAppLifecycleEvents?` | `boolean` | Captures app lifecycle events such as Application Installed, Application Updated, Application Opened, Application Became Active and Application Backgrounded. Application Installed and Application Updated events are not supported with persistence set to 'memory'. **Default** `true` | - |
| <a id="property-capturepushnotificationopened"></a> `capturePushNotificationOpened?` | `boolean` | Whether to automatically capture `$push_notification_opened` on a notification tap. Requires `@posthog/react-native-plugin`. Fires for pushes from any provider, not just PostHog's — but title and body are attached only for PostHog's own, so third-party notification text never reaches analytics. On Android, taps that launch the app and taps while it's running are both captured from `@posthog/react-native-plugin` 2.6.0 (earlier versions: cold starts only); call PostHog.capturePushNotificationOpened for the taps it misses. The native SDK builds and sends this event, so JS `before_send` never sees it. On iOS a tap can reach the app before your JS runs, so the SDK installs a hook at launch to catch a tap that cold-launches the app. Two switches gate automatic capture there, and `false` on either one means the SDK sends no `$push_notification_opened` of its own (an explicit PostHog.capturePushNotificationOpened call still captures): - This option set to `false` turns capture off when `setup()` runs and releases the launch hook, dropping the tap it was holding. The hook is still installed for the window between launch and `setup()`. - `com.posthog.posthog.CAPTURE_PUSH_NOTIFICATION_OPENED` set to `false` in `Info.plist` (Expo: `ios.infoPlist`) skips the launch hook entirely, so nothing is installed before your JS runs, and forces capture off at `setup()` even when this option is `true`. It is the same key posthog-flutter reads. Not supported on web. **Default** `true` | - |
| <a id="property-capturepushnotificationsubscriptions"></a> `capturePushNotificationSubscriptions?` | `boolean` | Whether to automatically register this device's push token so PostHog Workflows can target it. Requires `@posthog/react-native-plugin`. Your app still owns permission — PostHog only observes the token the OS hands back, and never sees later refreshes. Forward those to PostHog.registerPushNotificationToken yourself. Not supported on web or macOS. **Default** `true` | - |
| <a id="property-customappproperties"></a> `customAppProperties?` | `PostHogCustomAppProperties` \| ((`properties`) => `PostHogCustomAppProperties`) | Allows you to provide your own implementation of the common information about your App or a function to modify the default App properties generated | - |
| <a id="property-customstorage"></a> `customStorage?` | `PostHogCustomStorage` | Allows you to provide a custom asynchronous storage such as async-storage, expo-file-system or a synchronous storage such as mmkv. If not provided, PostHog will attempt to use the best available storage via optional peer dependencies (async-storage, expo-file-system). If `persistence` is set to 'memory', this option will be ignored. | - |
| <a id="property-defaultoptin"></a> `defaultOptIn?` | `boolean` | If set to false the SDK will not track until the `optIn` function is called. **Default** `true` | `PostHogCoreOptions.defaultOptIn` |
| <a id="property-disable_capture_url_hashes"></a> `disable_capture_url_hashes?` | `boolean` | Whether to strip URL fragments (`#...`) from automatically captured URL fields. Disabled by default for backwards compatibility. Set to `true` to strip hashes from: - `$current_url` on automatically captured browser events, including `$pageview` - `$initial_current_url` - `$session_entry_url` - `$elements[*].attr__href` and `$external_click_url` for autocapture and dead-click autocapture - Next.js Pages Router `$pageview` `$current_url` - web vitals `$current_url` - logs `url.full` - conversations `current_url` and `request_url` - session replay rrweb meta/custom-event `href` URLs - heatmap data URLs If your SPA relies on hash-based routes for analytics, enabling this is a breaking behavior change. If you want to capture hashes selectively, leave this as `false` and use `before_send` to remove sensitive hash values before events are sent. **Default** `false` | `PostHogCoreOptions.disable_capture_url_hashes` |
| <a id="property-disablecompression"></a> `disableCompression?` | `boolean` | Whether to disable GZIP compression **Default** `false` | `PostHogCoreOptions.disableCompression` |
| <a id="property-disabled"></a> `disabled?` | `boolean` | If set to true the SDK is essentially disabled (useful for local environments where you don't want to track anything) **Default** `false` | `PostHogCoreOptions.disabled` |
| <a id="property-disablegeoip"></a> `disableGeoip?` | `boolean` | Whether to disable GeoIP lookups **Default** `false` | `PostHogCoreOptions.disableGeoip` |
| <a id="property-disableremoteconfig"></a> ~~`disableRemoteConfig?`~~ | `boolean` | Whether to load remote config when initialized or not **Deprecated** Remote config is now always loaded and this option is a no-op. It will be removed in a future version. **Default** `false` | `PostHogCoreOptions.disableRemoteConfig` |
| <a id="property-disableremotefeatureflags"></a> `disableRemoteFeatureFlags?` | `boolean` | Advanced: whether to disable fetching and evaluating feature flags from PostHog entirely. When set to true, `reloadFeatureFlags()` and the reloads triggered by `identify()`, `group()`, `setPersonPropertiesForFlags()` and `reset()` become no-ops, and any request to the flags endpoint that still goes out (e.g. to fetch remote config or surveys) carries `disable_flags: true` so the server skips flag evaluation. Flag values must be supplied via the `bootstrap` option or `updateFlags()` instead; `getFeatureFlag()` and related methods keep working against those values. Until `updateFlags()` runs, reads return their not-loaded defaults, so use `bootstrap` for any flags needed at startup. Equivalent to the web SDK's `advanced_disable_feature_flags`. Note: surveys gated on feature flags will not evaluate unless the survey targeting flags are also provided via `updateFlags()`. This option cannot be toggled at runtime. `posthog-node` inherits this option but does not implement it (no-op). **Default** `false` | `PostHogCoreOptions.disableRemoteFeatureFlags` |
| <a id="property-disablesurveys"></a> `disableSurveys?` | `boolean` | Whether to load surveys when initialized or not Requires the `PostHogSurveyProvider` to be used **Default** `false` | `PostHogCoreOptions.disableSurveys` |
| <a id="property-enablepersistsessionidacrossrestart"></a> `enablePersistSessionIdAcrossRestart?` | `boolean` | If enabled, the session id ($session_id) will be persisted across app restarts. This is an option for back compatibility, so your current data isn't skewed with the new version of the SDK. If this is false, the session id will be always reset on app restart. **Default** `false` | - |
| <a id="property-enablesessionreplay"></a> `enableSessionReplay?` | `boolean` | Enable Recording of Session Replays for Android and iOS Requires Record user sessions to be enabled in the PostHog Project Settings This option is read once, at setup. To record only some sessions, either gate recording from your project settings (sampling, a linked flag, or event triggers), or leave this option off and drive the recorder from your app with `startSessionRecording()` and `stopSessionRecording()`. **Default** `false` | - |
| <a id="property-errortracking"></a> `errorTracking?` | `ErrorTrackingOptions` | Error Tracking Configuration | - |
| <a id="property-evaluationcontexts"></a> `evaluationContexts?` | readonly `string`[] | Evaluation contexts for feature flags. When set, only feature flags that have at least one matching evaluation tag will be evaluated for this SDK instance. Feature flags with no evaluation tags will always be evaluated. Examples: ['production', 'web', 'mobile'] **Default** `undefined` | `PostHogCoreOptions.evaluationContexts` |
| <a id="property-evaluationenvironments"></a> ~~`evaluationEnvironments?`~~ | readonly `string`[] | Evaluation environments for feature flags. **Deprecated** Use evaluationContexts instead. This property will be removed in a future version. | `PostHogCoreOptions.evaluationEnvironments` |
| <a id="property-featureflagsrequestmaxretries"></a> `featureFlagsRequestMaxRetries?` | `number` | How many times feature flag requests retry after a transient network error. Set to 0 to disable feature flag request retries. **Default** `1` | `PostHogCoreOptions.featureFlagsRequestMaxRetries` |
| <a id="property-featureflagsrequesttimeoutms"></a> `featureFlagsRequestTimeoutMs?` | `number` | Timeout in milliseconds for feature flag calls **Default** `10000 for stateful clients, 3000 for stateless` | `PostHogCoreOptions.featureFlagsRequestTimeoutMs` |
| <a id="property-fetchretrycount"></a> `fetchRetryCount?` | `number` | How many times we will retry HTTP requests **Default** `3` | `PostHogCoreOptions.fetchRetryCount` |
| <a id="property-fetchretrydelay"></a> `fetchRetryDelay?` | `number` | The delay between HTTP request retries in milliseconds **Default** `3000` | `PostHogCoreOptions.fetchRetryDelay` |
| <a id="property-flushat"></a> `flushAt?` | `number` | The number of events to queue before sending to PostHog (flushing) **Default** `20` | `PostHogCoreOptions.flushAt` |
| <a id="property-flushinterval"></a> `flushInterval?` | `number` | The interval in milliseconds between periodic flushes **Default** `10000` | `PostHogCoreOptions.flushInterval` |
| <a id="property-historicalmigration"></a> `historicalMigration?` | `boolean` | Special flag to indicate ingested data is for a historical migration **Default** `false` | `PostHogCoreOptions.historicalMigration` |
| <a id="property-host"></a> `host?` | `string` | PostHog API host, usually 'https://us.i.posthog.com' or 'https://eu.i.posthog.com' **Default** `'https://us.i.posthog.com'` | `PostHogCoreOptions.host` |
| <a id="property-logs"></a> `logs?` | `PostHogLogsConfig` | Logs feature configuration. Enables structured log capture via `posthog.captureLog(...)` or `posthog.logger.info(...)`. Records ship to PostHog's logs product (`/i/v1/logs`) in OTLP format, batched on a timer, AppState change, buffer fill, or manual `flushLogs()`. Capture is **unconditional** — calling the API ships records as long as the SDK is initialized and the user hasn't opted out. The only blockers are `optedOut`, missing/empty `body`, and missing API key. All fields below are optional; per-SDK defaults apply (mobile defaults are tuned for cellular bandwidth and battery, ~50 logs/sec ceiling). **Examples** **Minimal — just service tagging, defaults for everything else** `new PostHog(key, { logs: { serviceName: 'my-app', environment: 'production' } })` **Tune for higher-volume logging** `new PostHog(key, { logs: { serviceName: 'my-app', rateCap: { maxLogs: 5000, windowMs: 60000 }, maxBufferSize: 500, beforeSend: (r) => r.body.includes('secret') ? null : r, } })` | - |
| <a id="property-maxbatchsize"></a> `maxBatchSize?` | `number` | The maximum number of queued messages to be flushed as part of a single batch (must be higher than `flushAt`) **Default** `100` | `PostHogCoreOptions.maxBatchSize` |
| <a id="property-maxqueuesize"></a> `maxQueueSize?` | `number` | The maximum number of cached messages either in memory or on the local storage (must be higher than `flushAt`) **Default** `1000` | `PostHogCoreOptions.maxQueueSize` |
| <a id="property-overridedisplaylanguage"></a> `overrideDisplayLanguage?` | `string` \| `null` | Overrides the language used when rendering translated survey copy. When unset, the SDK falls back to the persisted person property `language` and then the device locale. | - |
| <a id="property-persistence"></a> `persistence?` | `"memory"` \| `"file"` | Allows you to provide the storage type. 'file' will try to load the best available storage, the provided 'customStorage', 'customAsyncStorage' or in-memory storage. **Default** `'file'` | - |
| <a id="property-personprofiles"></a> `personProfiles?` | `"always"` \| `"identified_only"` \| `"never"` | Determines when to create Person Profiles for users. - 'always': Always create a person profile for every user (anonymous and identified). - 'identified_only': Only create a person profile when the user is identified via identify(), alias(), or group(). Events captured before identification will NOT have person profiles and will be anonymous events. - 'never': Never create person profiles. identify(), alias(), and group() will be no-ops. **Default** `'identified_only'` **Examples** `// Only create profiles when users are identified (recommended for most apps) const posthog = new PostHog('<api_key>', { personProfiles: 'identified_only', }) // Later when user logs in: posthog.identify('user-123', { email: 'user@example.com' })` `// Always create profiles (for apps where you want to track all users) const posthog = new PostHog('<api_key>', { personProfiles: 'always', })` `// Never create profiles (anonymous analytics only) const posthog = new PostHog('<api_key>', { personProfiles: 'never', })` | `PostHogCoreOptions.personProfiles` |
| <a id="property-preloadfeatureflags"></a> `preloadFeatureFlags?` | `boolean` | Whether to load feature flags when initialized or not **Default** `true` | `PostHogCoreOptions.preloadFeatureFlags` |
| <a id="property-pushidentityprovider"></a> `pushIdentityProvider?` | `PostHogPushIdentityProvider` | Mints a signed identity-verification token for push subscription requests. Only needed when your PostHog project requires identity verification for push. Requires `@posthog/react-native-plugin`. Called with the current `distinctId` and `appId`. Mint on your backend (HS256, `sub` = distinctId, an `app_id` claim, `aud` = `posthog:push_identity`), never in the app. Return `null` to send the request unauthenticated; a slow or throwing implementation does the same after 10 seconds. | - |
| <a id="property-rageclickconfig"></a> `rageClickConfig?` | `PostHogRageClickConfig` | Configure rage click (rage tap) detection on iOS. The native iOS SDK fires a `$rageclick` event when a user taps the same area repeatedly in quick succession. The default thresholds (3 taps, 30 points, 1 second) were tuned for web and frequently produce false positives on mobile. Raise the thresholds or set `enabled: false` to suppress them. Android is unaffected — posthog-android does not have native rage click detection. Requires `@posthog/react-native-plugin` version 2.7.0 or newer. | - |
| <a id="property-remoteconfigrequesttimeoutms"></a> `remoteConfigRequestTimeoutMs?` | `number` | Timeout in milliseconds for remote config calls **Default** `3000` | `PostHogCoreOptions.remoteConfigRequestTimeoutMs` |
| <a id="property-requestheaders"></a> `requestHeaders?` | `object` | A list of headers that should be sent with requests to the PostHog API. | - |
| <a id="property-requesttimeout"></a> `requestTimeout?` | `number` | Timeout in milliseconds for any calls **Default** `10000` | `PostHogCoreOptions.requestTimeout` |
| <a id="property-sendfeatureflagevent"></a> `sendFeatureFlagEvent?` | `boolean` | Whether to track that `getFeatureFlag` was called (used by Experiments) In posthog-node this is also the default for reads from an `evaluateFlags()` snapshot (`isEnabled()` / `getFlag()`). Pass `sendFeatureFlagEvents` to one of those reads, or to a single-flag getter, to override it for that call. **Default** `true` | `PostHogCoreOptions.sendFeatureFlagEvent` |
| <a id="property-sessionexpirationtimeseconds"></a> `sessionExpirationTimeSeconds?` | `number` | For Session Analysis how long before we expire a session in seconds **Default** `1800` | `PostHogCoreOptions.sessionExpirationTimeSeconds` |
| <a id="property-sessionreplayconfig"></a> `sessionReplayConfig?` | `PostHogSessionReplayConfig` | Configuration for Session Replay | - |
| <a id="property-setdefaultpersonproperties"></a> `setDefaultPersonProperties?` | `boolean` | Automatically include common device and app properties in feature flag evaluation. When enabled, the following properties are sent with every /flags request: - $app_version: App version - $app_build: App build number - $app_namespace: App bundle identifier / namespace - $os_name: Operating system name - $os_version: Operating system version - $device_type: Device type (Mobile, Desktop) - $lib: Name of the SDK library - $lib_version: Version of the SDK library This ensures feature flags that rely on these properties work correctly without waiting for server-side processing of identify() calls. **Default** `true` | - |

### `PostHogPersistedProperty`

| Enumeration Member | Value |
| ------ | ------ |
| <a id="enumeration-member-aicapturequeue"></a> `AiCaptureQueue` | `"ai_capture_queue"` |
| <a id="enumeration-member-aiqueue"></a> `AiQueue` | `"ai_queue"` |
| <a id="enumeration-member-anonymousid"></a> `AnonymousId` | `"anonymous_id"` |
| <a id="enumeration-member-bootstrapfeatureflagdetails"></a> `BootstrapFeatureFlagDetails` | `"bootstrap_feature_flag_details"` |
| <a id="enumeration-member-bootstrapfeatureflagpayloads"></a> `BootstrapFeatureFlagPayloads` | `"bootstrap_feature_flag_payloads"` |
| <a id="enumeration-member-bootstrapfeatureflags"></a> `BootstrapFeatureFlags` | `"bootstrap_feature_flags"` |
| <a id="enumeration-member-deviceid"></a> `DeviceId` | `"device_id"` |
| <a id="enumeration-member-distinctid"></a> `DistinctId` | `"distinct_id"` |
| <a id="enumeration-member-enablepersonprocessing"></a> `EnablePersonProcessing` | `"enable_person_processing"` |
| <a id="enumeration-member-featureflagdetails"></a> `FeatureFlagDetails` | `"feature_flag_details"` |
| <a id="enumeration-member-featureflagpayloads"></a> `FeatureFlagPayloads` | `"feature_flag_payloads"` |
| <a id="enumeration-member-featureflags"></a> `FeatureFlags` | `"feature_flags"` |
| <a id="enumeration-member-flagsendpointwashit"></a> `FlagsEndpointWasHit` | `"flags_endpoint_was_hit"` |
| <a id="enumeration-member-groupproperties"></a> `GroupProperties` | `"group_properties"` |
| <a id="enumeration-member-installedappbuild"></a> `InstalledAppBuild` | `"installed_app_build"` |
| <a id="enumeration-member-installedappversion"></a> `InstalledAppVersion` | `"installed_app_version"` |
| <a id="enumeration-member-logsqueue"></a> `LogsQueue` | `"logs_queue"` |
| <a id="enumeration-member-optedout"></a> `OptedOut` | `"opted_out"` |
| <a id="enumeration-member-overridefeatureflags"></a> `OverrideFeatureFlags` | `"override_feature_flags"` |
| <a id="enumeration-member-personmode"></a> `PersonMode` | `"person_mode"` |
| <a id="enumeration-member-personproperties"></a> `PersonProperties` | `"person_properties"` |
| <a id="enumeration-member-props"></a> `Props` | `"props"` |
| <a id="enumeration-member-pushregistered"></a> `PushRegistered` | `"push_registered"` |
| <a id="enumeration-member-queue"></a> `Queue` | `"queue"` |
| <a id="enumeration-member-remoteconfig"></a> `RemoteConfig` | `"remote_config"` |
| <a id="enumeration-member-sessionid"></a> `SessionId` | `"session_id"` |
| <a id="enumeration-member-sessionlasttimestamp"></a> `SessionLastTimestamp` | `"session_timestamp"` |
| <a id="enumeration-member-sessionreplay"></a> `SessionReplay` | `"session_replay"` |
| <a id="enumeration-member-sessionreplayeventtriggeractivatedsession"></a> `SessionReplayEventTriggerActivatedSession` | `"session_replay_event_trigger_activated_session"` |
| <a id="enumeration-member-sessionstarttimestamp"></a> `SessionStartTimestamp` | `"session_start_timestamp"` |
| <a id="enumeration-member-surveylastseendate"></a> `SurveyLastSeenDate` | `"survey_last_seen_date"` |
| <a id="enumeration-member-surveys"></a> `Surveys` | `"surveys"` |
| <a id="enumeration-member-surveysinprogress"></a> `SurveysInProgress` | `"surveys_in_progress"` |
| <a id="enumeration-member-surveysseen"></a> `SurveysSeen` | `"surveys_seen"` |

### `PostHogProviderProps`

Props for the PostHogProvider component.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-apikey"></a> ~~`apiKey?`~~ | `string` | Your PostHog project token. Ignored when `projectToken` is set. **Deprecated** Use `projectToken` instead. This will be removed in the next major version. |
| <a id="property-autocapture"></a> `autocapture?` | `boolean` \| `PostHogAutocaptureOptions` | Autocapture configuration - can be a boolean or detailed options. When not set, the default behavior is: - `captureScreens`: true - `captureTouches`: false - `captureAppLifecycleEvents`: true Set to `true` to enable all autocapture features (including touches). Set to `false` to disable all autocapture features. |
| <a id="property-children-1"></a> `children` | `ReactNode` | The child components to render within the PostHog context |
| <a id="property-client"></a> `client?` | `PostHog` | An existing PostHog client instance |
| <a id="property-debug"></a> `debug?` | `boolean` | Enable debug mode for additional logging **Default** `false` |
| <a id="property-options"></a> `options?` | `PostHogOptions` | PostHog configuration options |
| <a id="property-projecttoken"></a> `projectToken?` | `string` | Your PostHog project token, which starts with `phc_`. Find it in your project settings: https://us.posthog.com/settings/project-details#variables |
| <a id="property-style"></a> `style?` | `StyleProp`\<`ViewStyle`\> | Custom styles for the provider wrapper View |

### `PostHogPushIdentityProvider`

> **PostHogPushIdentityProvider** = (`distinctId`, `appId`) => `Promise`\<`string` \| `null`\>

Mints a signed identity-verification token for a push subscription request.

Called by the native SDK with the current `distinctId` and `appId`. Return
`null` to send the request without an identity token.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `distinctId` | `string` |
| `appId` | `string` |

#### Returns

`Promise`\<`string` \| `null`\>

### `PostHogRageClickConfig`

> **PostHogRageClickConfig** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="enabled"></a> `enabled?` | `boolean` | Enable or disable rage click (rage tap) detection. When enabled the native SDK emits a `$rageclick` event whenever a user taps the same area repeatedly in quick succession. **Default** `true` |
| <a id="minimumtapcount"></a> `minimumTapCount?` | `number` | Number of consecutive taps required to trigger a rage click. **Default** `3` |
| <a id="thresholdpoints"></a> `thresholdPoints?` | `number` | Maximum pixel distance between consecutive taps for them to still count toward a rage click. **Default** `30` |
| <a id="timeoutinterval"></a> `timeoutInterval?` | `number` | Maximum time in seconds allowed between consecutive taps. **Default** `1.0` |

### `PostHogRemoteConfig`

> **PostHogRemoteConfig** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="captureperformance"></a> `capturePerformance?` | `boolean` \| \{\[`key`: `string`\]: `JsonType`; \} | Capture performance remote config. Either a boolean (false = disabled) or a map with configuration. When a map, `network_timing` (boolean) controls whether network timing capture is enabled remotely. |
| <a id="errortracking-1"></a> `errorTracking?` | `boolean` \| \{\[`key`: `string`\]: `JsonType`; \} | Error tracking remote config. Either a boolean (false = disabled) or a map with configuration. When a map, `autocaptureExceptions` (boolean) controls whether automatic exception capture is enabled remotely. |
| <a id="hasfeatureflags"></a> `hasFeatureFlags?` | `boolean` | Indicates if the team has any flags enabled (if not we don't need to load them) |
| <a id="logs"></a> `logs?` | `boolean` \| \{\[`key`: `string`\]: `JsonType`; \} | Logs feature remote config. When a map, `captureConsoleLogs` (boolean) is the local opt-in flag for `console.*` autocapture (read by the JS SDK's `PostHogLogs` extension to decide whether to load the autocapture bundle). |
| <a id="sessionrecording"></a> `sessionRecording?` | `boolean` \| \{\[`key`: `string`\]: `JsonType`; \} | - |
| <a id="supportedcompression"></a> `supportedCompression?` | `Compression`[] | Supported compression algorithms |
| <a id="surveys"></a> `surveys?` | `boolean` \| `Survey`[] | Whether surveys are enabled |

### `PostHogSessionReplayConfig`

> **PostHogSessionReplayConfig** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="androiddebouncerdelayms"></a> ~~`androidDebouncerDelayMs?`~~ | `number` | Deboucer delay used to reduce the number of snapshots captured and reduce performance impact This is used for capturing the view as a screenshot The lower the number more snapshots will be captured but higher the performance impact Ps: it was 500ms (0.5s) by default until version 3.3.7 **Default** `1000` **Deprecated** please use throttleDelayMs instead |
| <a id="capturelog-1"></a> `captureLog?` | `boolean` | Enable capturing of logs as console events **Default** `true` |
| <a id="capturenetworktelemetry"></a> `captureNetworkTelemetry?` | `boolean` | Enable capturing network telemetry iOS only **Default** `true` |
| <a id="capturetouches-1"></a> `captureTouches?` | `boolean` | Capture touch coordinates in session replay. Set to false to keep screenshots without recording taps that could reveal sensitive input on a known keypad layout. Does not change masking or `PostHogProvider` touch autocapture. Android and iOS only. Requires `@posthog/react-native-plugin` 2.9.0 or later; older plugins and `posthog-react-native-session-replay` ignore this option. Set before constructing PostHog. Changes after initialization do not update native state. **Default** `true` |
| <a id="iosdebouncerdelayms"></a> ~~`iOSdebouncerDelayMs?`~~ | `number` | Deboucer delay used to reduce the number of snapshots captured and reduce performance impact This is used for capturing the view as a screenshot The lower the number more snapshots will be captured but higher the performance impact **Default** `1000` **Deprecated** please use throttleDelayMs instead |
| <a id="maskallimages"></a> `maskAllImages?` | `boolean` | Enable masking of all images to a placeholder **Default** `true` |
| <a id="maskallsandboxedviews"></a> `maskAllSandboxedViews?` | `boolean` | Enable masking of all sandboxed system views These may include UIImagePickerController, PHPickerViewController and CNContactPickerViewController iOS only **Default** `true` |
| <a id="maskalltextinputs"></a> `maskAllTextInputs?` | `boolean` | Enable masking of all text and text input fields **Default** `true` |
| <a id="samplerate"></a> `sampleRate?` | `number` | Session replay sample rate between 0 and 1 Local config has precedence over remote config when both are set. If undefined, sampling is controlled by remote config (when available). |
| <a id="screenshotcolormode"></a> `screenshotColorMode?` | `"ARGB_8888"` \| `"RGB_565"` | **`Experimental`** Experimental. Screenshot bitmap pixel format. ARGB_8888 preserves transparency and color precision. RGB_565 uses half the bitmap memory but reduces color precision and removes alpha, making transparent window regions appear black. Unsupported devices fall back to ARGB_8888. Android only. Requires `@posthog/react-native-plugin` 2.8.0 or later. **Default** `'ARGB_8888'` |
| <a id="screenshotcompressionquality"></a> `screenshotCompressionQuality?` | `number` | **`Experimental`** Experimental. WebP compression quality, clamped to 0–100. Fractional values are truncated. Higher values generally retain more detail and produce larger payloads. Compression is lossy, except at quality 100 on Android 10, which uses lossless WebP. Non-finite values use the native default. Does not change screenshot resolution. Android only. Requires `@posthog/react-native-plugin` 2.8.0 or later. **Default** `30` |
| <a id="screenshotmodebackgroundcapture"></a> `screenshotModeBackgroundCapture?` | `boolean` | Schedule screenshot image capture on a background queue. iOS only Experimental support Warning: Enabling this option will trigger Main Thread Checker warnings and may briefly freeze the app the first time a screenshot is captured. Consider disabling Main Thread Checker in your scheme's run diagnostics when enabling this. **Default** `false` |
| <a id="screenshotscale"></a> `screenshotScale?` | `number` | **`Experimental`** Experimental. Multiplier for the physical width and height of screenshots, clamped to 0.1–1.0. For example, 0.5 captures half the width and height, or one quarter of the pixels. The logical replay viewport is unchanged. Non-finite values use the native default. Android only. Requires `@posthog/react-native-plugin` 2.8.0 or later. Does not enable session replay or change compression quality or color mode. **Default** `undefined, which uses the native default: one pixel per dp with posthog-android 3.74.0 or later, native resolution with older versions.` |
| <a id="throttledelayms"></a> `throttleDelayMs?` | `number` | Throttling delay used to reduce the number of snapshots captured and reduce performance impact This is used for capturing the view as a wireframe or screenshot The lower the number more snapshots will be captured but higher the performance impact This value has precedence over iOSdebouncerDelayMs and androidDebouncerDelayMs If this is not set, we will take the max number between iOSdebouncerDelayMs and androidDebouncerDelayMs for back compatibility **Default** `1000` |
| <a id="verifyscreenshotmaskalignment"></a> `verifyScreenshotMaskAlignment?` | `boolean` | Verify that masks remain aligned while capturing session replay screenshots. Android only. Requires `@posthog/react-native-plugin`. Enabling this can preserve screenshots during pixel-only redraws, including continuously animated content, but performs additional view hierarchy walks while a screenshot is captured. **Default** `false` |

### `PostHogSurveyProviderProps`

> **PostHogSurveyProviderProps** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="androidkeyboardbehavior"></a> `androidKeyboardBehavior?` | `"padding"` \| `"height"` | The keyboard avoiding behavior for the survey modal (KeyboardAvoidingView), applied only to Android devices. - 'padding': Adds padding to avoid keyboard (recommended) - 'height': Resizes the view height (default, for legacy - may cause flickering on some Android devices) **Default** `'height'` |
| <a id="autopresentsurveys"></a> `autoPresentSurveys?` | `boolean` | Whether eligible popover surveys are automatically presented. (Default: true) Set to false to defer presentation — e.g. while a native-stack formSheet/modal is on top. Deferral is display-only: the survey stays armed and presents once this is true again. A survey already on screen is not interrupted when this becomes false. You own flipping this back to true (e.g. wire it to route/screen focus). While it stays false the survey remains deferred and never shows — if the un-defer never happens (sheet dismissed without re-focusing the provider, an unmount, an error boundary), the survey stays armed indefinitely and no "survey shown" event fires. |
| <a id="children-1"></a> `children` | `React.ReactNode` | - |
| <a id="client"></a> `client?` | `PostHog` | - |
| <a id="defaultsurveyappearance"></a> `defaultSurveyAppearance?` | `SurveyAppearance` | The default appearance for surveys when not specified in PostHog. Accepts the React Native-only appearance fields as well (e.g. `maxFontSizeMultiplier`) — they are merged into the same theme object the survey components read, and PostHog never sends them down. |
| <a id="overrideappearancewithdefault"></a> `overrideAppearanceWithDefault?` | `boolean` | If true, PosHog appearance will be ignored and defaultSurveyAppearance is always used. |

### `Properties`

> **Properties** = `Record`\<`string`, `any`\>

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

### `SpecificQuestionBranching`

> **SpecificQuestionBranching** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="index"></a> `index` | `number` |
| <a id="type-4"></a> `type` | *typeof* `SurveyQuestionBranchingType.SpecificQuestion` |

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
| <a id="description"></a> `description?` | `string` |
| <a id="enable_partial_responses"></a> `enable_partial_responses?` | `boolean` \| `null` |
| <a id="end_date"></a> `end_date?` | `string` |
| <a id="feature_flag_keys"></a> `feature_flag_keys?` | `object`[] |
| <a id="id"></a> `id` | `string` |
| <a id="internal_targeting_flag_key"></a> `internal_targeting_flag_key?` | `string` |
| <a id="linked_flag_key"></a> `linked_flag_key?` | `string` |
| <a id="name"></a> `name` | `string` |
| <a id="questions"></a> `questions` | `SurveyQuestion`[] |
| <a id="schedule"></a> `schedule?` | `SurveySchedule` \| `null` |
| <a id="start_date"></a> `start_date?` | `string` |
| <a id="targeting_flag_key"></a> `targeting_flag_key?` | `string` |
| <a id="translations"></a> `translations?` | `Record`\<`string`, `SurveyTranslation`\> |
| <a id="type"></a> `type` | `SurveyType` |

### `SurveyActionType`

> **SurveyActionType** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="id-1"></a> `id` | `number` |
| <a id="name"></a> `name?` | `string` |
| <a id="steps"></a> `steps?` | `ActionStepType`[] |

### `SurveyAppearance`

React Native survey appearance, including native-only text scaling options.

#### Extends

- `SurveyAppearance`

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-allowgoback"></a> `allowGoBack?` | `boolean` | - | `SurveyAppearance.allowGoBack` |
| <a id="property-autodisappear"></a> `autoDisappear?` | `boolean` | - | `SurveyAppearance.autoDisappear` |
| <a id="property-backbuttontext"></a> `backButtonText?` | `string` | - | `SurveyAppearance.backButtonText` |
| <a id="property-backgroundcolor"></a> `backgroundColor?` | `string` | - | `SurveyAppearance.backgroundColor` |
| <a id="property-bordercolor"></a> `borderColor?` | `string` | - | `SurveyAppearance.borderColor` |
| <a id="property-displayintroscreen"></a> `displayIntroScreen?` | `boolean` | - | `SurveyAppearance.displayIntroScreen` |
| <a id="property-displaythankyoumessage"></a> `displayThankYouMessage?` | `boolean` | - | `SurveyAppearance.displayThankYouMessage` |
| <a id="property-inputbackground"></a> `inputBackground?` | `string` | - | `SurveyAppearance.inputBackground` |
| <a id="property-inputtextcolor"></a> `inputTextColor?` | `string` | - | `SurveyAppearance.inputTextColor` |
| <a id="property-introscreenbuttontext"></a> `introScreenButtonText?` | `string` | - | `SurveyAppearance.introScreenButtonText` |
| <a id="property-introscreendescription"></a> `introScreenDescription?` | `string` | - | `SurveyAppearance.introScreenDescription` |
| <a id="property-introscreendescriptioncontenttype"></a> `introScreenDescriptionContentType?` | `SurveyQuestionDescriptionContentType` | - | `SurveyAppearance.introScreenDescriptionContentType` |
| <a id="property-introscreenheader"></a> `introScreenHeader?` | `string` | - | `SurveyAppearance.introScreenHeader` |
| <a id="property-maxfontsizemultiplier"></a> `maxFontSizeMultiplier?` | `number` \| `Partial`\<`Record`\<`SurveyTextRole`, `number`\>\> | Caps how far survey text may grow under the OS text-size setting, as a multiple of its base size - React Native's `maxFontSizeMultiplier`, applied to every semantic `Text` and `TextInput` the survey renders. Icon-only text fallbacks do not scale because they occupy fixed-size icon boxes. Pass a number to cap every role at once, or an object to cap them separately: a survey headline can usually take more scaling than a numeral inside a rating button, and a host app that already caps its own text by role will want to match those ceilings here. `maxFontSizeMultiplier: 1.6 // or maxFontSizeMultiplier: { question: 1.5, description: 1.8, ratingNumber: 1.2 }` Roles left out of the object are uncapped, as they are today. Use `0` for no maximum, or a value of `1` or greater to set a cap. Other values below `1` (such as `0.8`) do not shrink text and are unsupported by React Native; depending on the platform and version, they may be ignored or rejected. Leave it unset (the default) and survey text scales without a ceiling. That is what the OS asks for, but not always what a fixed-size survey card can hold - at the largest accessibility sizes an unbounded 18pt headline renders roughly one word per line. React Native only inherits this prop through nested `Text`, so a host app cannot apply it from the outside - it has to come in here. **Default** `undefined (no ceiling)` | - |
| <a id="property-placeholder"></a> `placeholder?` | `string` | - | `SurveyAppearance.placeholder` |
| <a id="property-position"></a> `position?` | `SurveyPosition` | - | `SurveyAppearance.position` |
| <a id="property-ratingbuttonactivecolor"></a> `ratingButtonActiveColor?` | `string` | - | `SurveyAppearance.ratingButtonActiveColor` |
| <a id="property-ratingbuttoncolor"></a> `ratingButtonColor?` | `string` | - | `SurveyAppearance.ratingButtonColor` |
| <a id="property-shufflequestions"></a> `shuffleQuestions?` | `boolean` | - | `SurveyAppearance.shuffleQuestions` |
| <a id="property-submitbuttoncolor"></a> `submitButtonColor?` | `string` | - | `SurveyAppearance.submitButtonColor` |
| <a id="property-submitbuttontext"></a> `submitButtonText?` | `string` | - | `SurveyAppearance.submitButtonText` |
| <a id="property-submitbuttontextcolor"></a> `submitButtonTextColor?` | `string` | - | `SurveyAppearance.submitButtonTextColor` |
| <a id="property-surveypopupdelayseconds"></a> `surveyPopupDelaySeconds?` | `number` | - | `SurveyAppearance.surveyPopupDelaySeconds` |
| <a id="property-textcolor"></a> `textColor?` | `string` | - | `SurveyAppearance.textColor` |
| <a id="property-thankyoumessageclosebuttontext"></a> `thankYouMessageCloseButtonText?` | `string` | - | `SurveyAppearance.thankYouMessageCloseButtonText` |
| <a id="property-thankyoumessagedescription"></a> `thankYouMessageDescription?` | `string` | - | `SurveyAppearance.thankYouMessageDescription` |
| <a id="property-thankyoumessagedescriptioncontenttype"></a> `thankYouMessageDescriptionContentType?` | `SurveyQuestionDescriptionContentType` | - | `SurveyAppearance.thankYouMessageDescriptionContentType` |
| <a id="property-thankyoumessageheader"></a> `thankYouMessageHeader?` | `string` | - | `SurveyAppearance.thankYouMessageHeader` |
| <a id="property-widgetcolor"></a> `widgetColor?` | `string` | - | `SurveyAppearance.widgetColor` |
| <a id="property-widgetlabel"></a> `widgetLabel?` | `string` | - | `SurveyAppearance.widgetLabel` |
| <a id="property-widgetselector"></a> `widgetSelector?` | `string` | - | `SurveyAppearance.widgetSelector` |
| <a id="property-widgettype"></a> `widgetType?` | `SurveyWidgetType` | - | `SurveyAppearance.widgetType` |

### `SurveyAppearance`

> **SurveyAppearance** = `object`

#### Extended by

- `SurveyAppearance`

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

### `SurveyAppearanceTheme`

> **SurveyAppearanceTheme** = `Omit`\<`Required`\<`SurveyAppearance`\>, `"widgetSelector"` \| `"widgetType"` \| `"widgetColor"` \| `"widgetLabel"` \| `"shuffleQuestions"` \| `"textColor"` \| `"inputTextColor"` \| `"placeholder"` \| `"maxFontSizeMultiplier"`\> & `object`

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `inputTextColor?` | `string` |
| `maxFontSizeMultiplier?` | `SurveyAppearance`\[`"maxFontSizeMultiplier"`\] |
| `placeholder?` | `string` |
| `textColor?` | `string` |

### `SurveyEventWithFilters`

| Property | Type |
| ------ | ------ |
| <a id="property-name-3"></a> `name` | `string` |
| <a id="property-propertyfilters"></a> `propertyFilters?` | `PropertyFilters` |

### `SurveyMatchType`

> **SurveyMatchType** = *typeof* `SurveyMatchType`\[keyof *typeof* `SurveyMatchType`\]

### `SurveyModalProps`

> **SurveyModalProps** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="androidkeyboardbehavior-1"></a> `androidKeyboardBehavior?` | `"padding"` \| `"height"` |
| <a id="appearance-1"></a> `appearance` | `SurveyAppearanceTheme` |
| <a id="client-1"></a> `client?` | `PostHog` |
| <a id="initialprogress"></a> `initialProgress?` | `SurveyProgress` |
| <a id="onclose"></a> `onClose` | (`submitted`, `responses`) => `void` |
| <a id="onprogresschange"></a> `onProgressChange?` | (`progress`, `completed`) => `boolean` |
| <a id="onshow"></a> `onShow` | () => `void` |
| <a id="survey-1"></a> `survey` | `Survey` |
| <a id="surveylanguage"></a> `surveyLanguage` | `string` \| `null` |

### `SurveyPosition`

> **SurveyPosition** = *typeof* `SurveyPosition`\[keyof *typeof* `SurveyPosition`\]

### `SurveyProgress`

> **SurveyProgress** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="questionindex"></a> `questionIndex` | `number` |
| <a id="questionorder"></a> `questionOrder` | `number`[] |
| <a id="questionsnapshots"></a> `questionSnapshots` | `Record`\<`string`, `string`\> |
| <a id="responses"></a> `responses` | `SurveyResponses` |
| <a id="submissionid"></a> `submissionId` | `string` |
| <a id="surveylanguage"></a> `surveyLanguage?` | `string` \| `null` |

### `SurveyQuestion`

> **SurveyQuestion** = `BasicSurveyQuestion` \| `LinkSurveyQuestion` \| `RatingSurveyQuestion` \| `MultipleSurveyQuestion`

### `SurveyQuestionBase`

> **SurveyQuestionBase** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="branching"></a> `branching?` | `NextQuestionBranching` \| `EndBranching` \| `ResponseBasedBranching` \| `SpecificQuestionBranching` |
| <a id="buttontext"></a> `buttonText?` | `string` |
| <a id="description-2"></a> `description?` | `string` \| `null` |
| <a id="descriptioncontenttype"></a> `descriptionContentType?` | `SurveyQuestionDescriptionContentType` |
| <a id="id-2"></a> `id` | `string` |
| <a id="optional"></a> `optional?` | `boolean` |
| <a id="originalquestionindex"></a> `originalQuestionIndex` | `number` |
| <a id="question"></a> `question` | `string` |
| <a id="translations"></a> `translations?` | `Record`\<`string`, `SurveyQuestionTranslation`\> |
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

### `SurveyResponses`

> **SurveyResponses** = `Record`\<`string`, `SurveyResponseValue`\>

### `SurveyResponseValue`

> **SurveyResponseValue** = `string` \| `number` \| `string`[] \| `null`

### `SurveySchedule`

> **SurveySchedule** = *typeof* `SurveySchedule`\[keyof *typeof* `SurveySchedule`\]

### `SurveyTextRole`

> **SurveyTextRole** = `"question"` \| `"description"` \| `"header"` \| `"choice"` \| `"input"` \| `"button"` \| `"ratingLabel"` \| `"ratingNumber"` \| `"validationHint"`

The distinct kinds of text a survey renders, each at its own base size. They
are separate because one ceiling cannot serve all of them: `question` is an
18pt headline that can wrap freely, while `ratingNumber` sits inside a
fixed-width button and has nowhere to grow.

### `SurveyTranslation`

| Property | Type |
| ------ | ------ |
| <a id="property-backbuttontext"></a> `backButtonText?` | `string` |
| <a id="property-introscreenbuttontext"></a> `introScreenButtonText?` | `string` |
| <a id="property-introscreendescription"></a> `introScreenDescription?` | `string` |
| <a id="property-introscreenheader"></a> `introScreenHeader?` | `string` |
| <a id="property-name-4"></a> `name?` | `string` |
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
| <a id="property-value-4"></a> `value?` | `number` |

### `SurveyValidationType`

> **SurveyValidationType** = *typeof* `SurveyValidationType`\[keyof *typeof* `SurveyValidationType`\]

### `SurveyWidgetType`

> **SurveyWidgetType** = *typeof* `SurveyWidgetType`\[keyof *typeof* `SurveyWidgetType`\]
