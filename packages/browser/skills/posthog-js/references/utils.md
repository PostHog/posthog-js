# SDK utils

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

Get the list of early access features. To check enrollment status, use `isFeatureEnabled`. [Learn more in the docs](https://posthog.com/docs/feature-flags/early-access-feature-management.md#option-2-custom-implementation)

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

returns a boolean indicating whether the [toolbar](https://posthog.com/docs/toolbar.md) loaded

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

Unlike `onFeatureFlags` and `onSessionId` these are not called when the
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

Opt the user in or out of an early access feature. [Learn more in the docs](https://posthog.com/docs/feature-flags/early-access-feature-management.md#option-2-custom-implementation)

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

### `sampleByDistinctId`

> **sampleByDistinctId**(`percent`): `BeforeSendFn`

Return a `before_send` hook that samples by distinct ID.
A given ID sends either all its events or none. A rate of 0.5 keeps roughly
half of distinct IDs, not half of each ID's events.

Import it from `posthog-js/customizations` and pass it to `before_send`.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `percent` | `number` | Fraction of IDs to keep, from 0 (none) to 1 (all). |

#### Returns

`BeforeSendFn`

#### Example

```ts
import { sampleByDistinctId } from 'posthog-js/customizations'

posthog.init('<ph_project_token>', { before_send: sampleByDistinctId(0.4) })
```

### `sampleByEvent`

> **sampleByEvent**(`eventNames`, `percent`): `BeforeSendFn`

Return a `before_send` hook that samples events with the listed names.
Other events are kept. Sampling applies to individual events.

Import it from `posthog-js/customizations` and pass it to `before_send`.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `eventNames` | `string`[] | Event names to sample. |
| `percent` | `number` | Fraction of matching events to keep, from 0 (none) to 1 (all). |

#### Returns

`BeforeSendFn`

### `sampleBySessionId`

> **sampleBySessionId**(`percent`): `BeforeSendFn`

Return a `before_send` hook that samples by session ID.
A given session sends either all its events or none. A rate of 0.5 keeps
roughly half of sessions, not half of each session's events.

Import it from `posthog-js/customizations` and pass it to `before_send`.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `percent` | `number` | Fraction of sessions to keep, from 0 (none) to 1 (all). |

#### Returns

`BeforeSendFn`

#### Example

```ts
import { sampleBySessionId } from 'posthog-js/customizations'

posthog.init('<ph_project_token>', { before_send: sampleBySessionId(0.25) })
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
