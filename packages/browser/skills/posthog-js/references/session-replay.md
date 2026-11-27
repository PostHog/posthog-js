# Session replay

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
