# Events and properties

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

You can capture arbitrary object-like values as events. [Learn about capture best practices](https://posthog.com/docs/product-analytics/capture-events.md)

#### Example

```js
// basic event capture
posthog.capture('cta-button-clicked', {
    button_name: 'Get Started',
    page: 'homepage'
})
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

Note: logs are not subject to the user agent (bot) filter that drops events,
so they are still sent from sessions whose events are dropped.

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
