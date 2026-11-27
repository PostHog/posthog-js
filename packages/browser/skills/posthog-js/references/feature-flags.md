# Feature flags

## Get feature flag

### `PostHog.getFeatureFlag`

> **getFeatureFlag**(`key`, `options?`): `string` \| `boolean` \| `undefined`

Gets the value of a feature flag for the current user.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | Key of the feature flag. |
| `options?` | `FeatureFlagOptions` | Optional lookup settings. If `{ send_event: false }`, we won't send a `$feature_flag_called` event to PostHog, or the `$experiment_exposure` event of a config version 2 experiment split. If `{ fresh: true }`, we won't return cached values from localStorage - only values loaded from the server. |

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

By default, this method emits the `$feature_flag_called` event, and also `$experiment_exposure` when a
config version 2 experiment split supplies the value.

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

## Is feature enabled

### `PostHog.isFeatureEnabled`

> **isFeatureEnabled**(`key`, `options?`): `boolean`

Checks if a feature flag is enabled for the current user.

##### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `key` | `string` | Key of the feature flag. |
| `options?` | `FeatureFlagOptions` & `object` & `object` | Optional lookup settings. If `{ send_event: false }`, we won't send a `$feature_flag_called` event to PostHog, or the `$experiment_exposure` event of a config version 2 experiment split. If `{ fresh: true }`, we won't return cached values from localStorage - only values loaded from the server. If `{ defaultValue: false }`, we return that value instead of undefined when the flag has no value. |

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
| `options?` | `IsFeatureEnabledOptions` | Optional lookup settings. If `{ send_event: false }`, we won't send a `$feature_flag_called` event to PostHog, or the `$experiment_exposure` event of a config version 2 experiment split. If `{ fresh: true }`, we won't return cached values from localStorage - only values loaded from the server. If `{ defaultValue: false }`, we return that value instead of undefined when the flag has no value. |

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
