# Error tracking

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
