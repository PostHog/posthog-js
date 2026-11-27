# Privacy and consent

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
