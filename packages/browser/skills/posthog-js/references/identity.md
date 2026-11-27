# Identity and groups

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
Learn more about [identifying users](https://posthog.com/docs/product-analytics/identify.md)

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

## Alias

### `PostHog.alias`

> **alias**(`alias`, `original?`): `number` \| `void` \| `CaptureResult`

Creates an alias linking two distinct user identifiers. Learn more about [identifying users](https://posthog.com/docs/product-analytics/identify.md)

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
Learn more about [identifying users](https://posthog.com/docs/product-analytics/identify.md)

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
Learn more about [identifying users](https://posthog.com/docs/product-analytics/identify.md)

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

## Create person profile

### `PostHog.createPersonProfile`

> **createPersonProfile**(): `void`

Creates a person profile for the current user, if they don't already have one and config.person_profiles is set
 to 'identified_only'. Produces a warning and does not create a profile if config.person_profiles is set to
 'never'. Learn more about [person profiles](https://posthog.com/docs/product-analytics/identify.md)

#### Returns

`void`

#### Example

```js
posthog.createPersonProfile()
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
Learn more about [groups](https://posthog.com/docs/product-analytics/group-analytics.md)

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
Learn more about [groups](https://posthog.com/docs/product-analytics/group-analytics.md)

#### Returns

`void`

#### Example

```js
posthog.resetGroups()
```
