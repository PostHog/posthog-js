# Migrating from `posthog-js` to `@posthog/browser`

> **Draft:** `@posthog/browser` is experimental. This guide maps application-facing APIs on the [`posthog-js` facade](../browser/src/posthog-core.ts) to the current [`@posthog/browser` API](./src/types.ts). **TODO** entries identify missing migration paths, not APIs that you can call today.

The main changes are:

- Import a factory instead of a singleton, and await client creation.
- Access product APIs through extension references instead of methods on the client.
- Dispose subscriptions with `.dispose()` instead of calling an unsubscribe function.
- Check return types and behavior, not just method names. In particular, feature flag reads now return result objects, and `capture()` returns a rate-limit signal instead of the captured event.

Examples below use `legacy` for the `posthog-js` instance and `posthog` for the new client. Configuration is shown only where it affects a call-site migration; this is not a complete configuration reference. See the [package README](./README.md) for extension configuration and delivery behavior.

## Initialization

### `init()` and `new PostHog()`

Before:

```js
import legacy from 'posthog-js'

legacy.init('<project-token>', {
    api_host: 'https://us.i.posthog.com',
    loaded: (client) => {
        client.capture('app_ready')
    },
})
```

After:

```ts
import { createPostHog } from '@posthog/browser'

const posthog = await createPostHog({
    projectToken: '<project-token>',
    apiHost: 'https://us.i.posthog.com',
})
posthog.capture('app_ready')
```

Use the same factory in place of `new PostHog()` followed by `.init()`. Share the returned instance with your application; there is no default client singleton. Each factory call creates a separately owned client.

Awaiting creation means configured extensions have finished setup. It does **not** mean remote feature flag evaluation, survey definitions, or analytics delivery have completed. Check the relevant product's readiness separately.

**TODO: Document the default initialization that includes all extensions.** The current root factory includes analytics delivery and automatically loads flags, logs, and surveys unless disabled or explicitly supplied. This is not yet the complete default-extension setup replacing `posthog-js` initialization.

`@posthog/browser/core` delivers events the same way as the root import, but installs only the extensions you pass in `extensions`; it never loads flags, logs, surveys, or autocapture automatically.

### Other initialization call sites

| Before                                          | After / migration status                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `legacy.init(token, config, 'secondary')`       | `const secondary = await createPostHog({ projectToken: token, ...options })`. Keep the reference yourself instead of reading `legacy.secondary`. Translate configuration deliberately; do not spread legacy config into the new options.                                              |
| `legacy.push(['capture', 'event', properties])` | Call `posthog.capture('event', properties)` after awaiting creation. **TODO:** snippet/pre-initialization queue migration.                                                                                                                                                            |
| `legacy.set_config(config)`                     | `posthog.setConfig({ debug, analytics: { personProfiles } })` changes only these options; other options are fixed at creation. Downgrading from `always` to `identified_only` keeps processing visitors already processed; `never` stops it. **TODO:** migrate other runtime options. |
| `legacy.debug(true)` / `legacy.debug(false)`    | `posthog.debug()` / `posthog.debug(false)`, or `debug` at creation. The toggle is not persisted like `ph_debug`, so it does not carry over to the next page load.                                                                                                                     |
| `legacy.config.token`                           | `posthog.projectToken`. There is no equivalent mutable `config` object.                                                                                                                                                                                                               |
| `legacy.version`                                | `posthog.library.version`.                                                                                                                                                                                                                                                            |

## Capturing events

### `capture()`

The basic call keeps its shape:

```js
// Before
legacy.capture('checkout_completed', { order_id: 'order-123' })
```

```ts
// After
posthog.capture('checkout_completed', { order_id: 'order-123' })
```

`capture()` now returns a boolean: it synchronously attempts admission to the analytics buffer, not delivery. `false` means the client rate limit dropped the event; `true` does not confirm admission, because consent, bot filtering, or validation can also skip the event. Code that reads the legacy `CaptureResult` or modifies a returned event must change. An admitted event can still be dropped by queue limits or fail delivery.

| Before                                                                    | After / migration status                                                                                                                                                                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `legacy.capture(event, properties, { timestamp, uuid })`                  | `posthog.capture(event, properties, { timestamp, uuid })`. `timestamp` is a `Date`.                                                                                                                |
| `legacy.capture(event, { ...properties, $set: set, $set_once: setOnce })` | `posthog.capture(event, properties, { set, setOnce })`. These are person-property instructions for this event, not super properties.                                                               |
| `legacy.capture(event, properties, { send_instantly: true })`             | `posthog.capture(event, properties, { delivery: 'immediate' })` sends queued events now, including this one, with normal retries and unload handoff. Use `captureImmediate()` to await an outcome. |
| `legacy.capture(event, properties, { transport })`                        | `'sendBeacon'` becomes `{ delivery: 'unload' }`: best-effort keepalive Fetch, which does not confirm persistence. `'fetch'` and `'XHR'` need no option, because analytics always uses Fetch.       |
| Internal `_url`, `_batchKey`, and `_noTruncate` capture options           | No equivalent. Analytics always sends to Capture V1 at `apiHost` and never truncates strings. Products that need another endpoint or batch own their own delivery.                                 |

Unload delivery is best effort. Delivery is part of the client, so no further module load is needed at page teardown, but the request can still be lost.

Immediate delivery returns a summary rather than throwing for delivery failures:

```ts
const summary = await posthog.captureImmediate('checkout_completed', { order_id: 'order-123' })
if (summary.error || summary.submitted !== 1 || !summary.allPersisted) {
    console.warn('Checkout event was not confirmed persisted', summary.error)
}
```

A skipped event can have no error and zero submitted events. Do not treat absence of `summary.error` alone as confirmation. Immediate delivery can overtake buffered events and is not retained for a later flush.

### `on('eventCaptured', callback)`

Before:

```js
const unsubscribe = legacy.on('eventCaptured', (event) => {
    console.log(event.event, event.properties)
})
unsubscribe()
```

After:

```ts
const subscription = posthog.onEvent(({ event, properties }) => {
    console.log(event, properties)
})
subscription.dispose()
```

`onEvent` observes admitted events through a deeply readonly view containing the event name and final properties. It does not expose the complete legacy capture result or acknowledge network delivery. It does not replay earlier events.

### Trace feedback and metrics

The convenience methods do not exist on the new client. Their event payloads can be captured explicitly:

```js
// Before
legacy.captureTraceFeedback('trace-123', 'Helpful answer')
legacy.captureTraceMetric('trace-123', 'quality', 5)
```

```ts
// After
posthog.capture('$ai_feedback', {
    $ai_trace_id: String('trace-123'),
    $ai_feedback_text: 'Helpful answer',
})
posthog.capture('$ai_metric', {
    $ai_trace_id: String('trace-123'),
    $ai_metric_name: 'quality',
    $ai_metric_value: String(5),
})
```

Keep the string conversion for numeric trace IDs and metric values; these are the same event names and property values emitted by the facade helpers.

## Shutdown

| Before                             | After                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `await legacy.shutdown()`          | `await posthog.shutdown()`. Stops new work, attempts normal flushing, then disposes extensions and client resources. |
| `await legacy.shutdown(timeoutMs)` | `await posthog.shutdown(timeoutMs)`. The new client honors the timeout; the legacy browser facade ignored it.        |

The new shutdown is idempotent and bounded. `await posthog.dispose()` uses the same path. Use `await posthog.flush()` to drive delivery without closing the client; a completed flush is not a guarantee that every queued event persisted.

## Identity and person properties

| Before                                                                                 | After / migration status                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `legacy.identify(id, set, setOnce)`                                                    | `posthog.identify(id, set, setOnce)`. It updates local identity synchronously and returns nothing; it does not acknowledge event delivery.                                                                                                |
| `legacy.get_distinct_id()`                                                             | `posthog.distinctId`.                                                                                                                                                                                                                     |
| `legacy.reset()`                                                                       | `posthog.reset()`. It generates a new anonymous distinct ID, retains the device ID, clears group/extension state, and resets the session. Consent is retained.                                                                            |
| `legacy.reset(true)` or `legacy.reset({ resetDeviceID, bootstrap })`                   | `posthog.reset(true)` or `posthog.reset({ resetDeviceId, bootstrap: { distinctId, isIdentifiedId, sessionId, featureFlags, featureFlagPayloads } })`. Bootstrapped flags and payloads are served for the new identity until flags reload. |
| `legacy.setPersonProperties(set, setOnce)`                                             | `posthog.setPersonProperties(set, setOnce)`. It keeps the current identity and does not identify the user.                                                                                                                                |
| `legacy.unsetPersonProperties(names)`                                                  | `posthog.unsetPersonProperties(names)`. It sends `$unset` for the properties and removes them from local feature flag evaluation context.                                                                                                 |
| `legacy.people.set(properties)` / `legacy.people.set(name, value, callback)`           | `posthog.setPersonProperties(properties)` or `posthog.setPersonProperties({ [name]: value })`. There is no callback.                                                                                                                      |
| `legacy.people.set_once(properties)` / `legacy.people.set_once(name, value, callback)` | `posthog.setPersonProperties(undefined, properties)` or `posthog.setPersonProperties(undefined, { [name]: value })`. There is no callback.                                                                                                |
| `legacy.alias(alias, original)`                                                        | `posthog.alias(alias)` links `alias` to the current distinct ID without changing the current identity. There is no `original` argument.                                                                                                   |
| `legacy.createPersonProfile()`                                                         | `posthog.createPersonProfile()`.                                                                                                                                                                                                          |
| `legacy.setInternalOrTestUser()`                                                       | `posthog.setInternalOrTestUser()`. It sets the `$internal_or_test_user` person property.                                                                                                                                                  |
| `legacy.setIdentity(id, hash)` / `legacy.clearIdentity()`                              | **TODO:** no HMAC/conversations identity API. This is separate from analytics `identify()` / `reset()`.                                                                                                                                   |

**Persistence matters:** the new default state record is separate from legacy identity storage. Changing the import does not migrate an existing distinct ID, cookies, or cross-subdomain identity. **TODO:** document the supported historical-state migration before recommending a production identity cutover.

## Groups

Before:

```js
legacy.group('organization', 'org-123', { plan: 'paid' })
const groups = legacy.getGroups()
```

After:

```ts
posthog.group('organization', 'org-123', { plan: 'paid' })
const groups = posthog.groups
```

`group()` returns nothing and does not wait for backend ingestion or feature flag evaluation. Use `posthog.groupIdentify(type, key, properties)` to update a group's properties without changing membership. Treat `groups` as readonly application state, not a mutable configuration object.

| Before                                                  | After / migration status                                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `legacy.resetGroups()`                                  | `posthog.resetGroups()`. It clears group memberships and keeps identity, sessions and registered properties.                                                                   |
| `legacy.setGroupPropertiesForFlags(properties, reload)` | **TODO:** no matching method on the browser flags facade. `posthog.group(type, key, properties)` also associates a group and captures analytics, unlike a local flag override. |
| `legacy.resetGroupPropertiesForFlags(type)`             | **TODO:** no matching method on the browser flags facade.                                                                                                                      |

## Super properties

Registration is on the client:

```js
// Before
legacy.register({ app_version: '1.0.0' })
legacy.capture('app_ready')
legacy.unregister('app_version')
```

```ts
// After
posthog.register({ app_version: '1.0.0' })
posthog.capture('app_ready')
posthog.unregister('app_version')
```

Registered properties persist with the client's storage until unregistered or cleared by `reset()`. For values your application computes at capture time, `posthog.registerDynamicEventProperties(() => ({ ... }))` returns a subscription; disposing it removes that producer.

| Before                                                 | After / migration status                                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `legacy.register(properties, days)`                    | `posthog.register(properties)`. **TODO:** no expiration (`days`) equivalent.                                                           |
| `legacy.register_once(properties, defaultValue, days)` | `posthog.registerOnce(properties, defaultValue)`. **TODO:** no expiration (`days`) equivalent.                                         |
| `legacy.register_for_session(properties)`              | `posthog.registerForSession(properties)`.                                                                                              |
| `legacy.unregister(property)`                          | `posthog.unregister(property)`.                                                                                                        |
| `legacy.unregister_for_session(property)`              | `posthog.unregisterForSession(property)`.                                                                                              |
| `legacy.get_property(name)`                            | `posthog.getProperty(name)` reads registered properties. Use `posthog.distinctId` or `posthog.deviceId` for those SDK identity values. |
| `legacy.getSessionProperty(name)`                      | **TODO:** no equivalent session property getter.                                                                                       |

## Feature flags

### Get the extension

```ts
import { FeatureFlagsExtension } from '@posthog/browser'

const featureFlags = posthog.getExtension(FeatureFlagsExtension)
if (!featureFlags) {
    throw new Error('Feature flags are not installed')
}
```

The root factory normally installs flags; extension lookup still returns `undefined` when flags is disabled or fails installation. Treat that separately from a flag having no evaluation value. For explicit static inclusion, import `flags()` from `@posthog/browser/flags`, pass its result in `extensions`, and await client creation before using it.

### Reads return result objects

| Before                                                         | After                                                                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `legacy.getFeatureFlag('checkout')`                            | `featureFlags.getFeatureFlag('checkout')` returns a result object, **not** the primitive flag value. For primitive consumers, read `result?.variant ?? result?.enabled`. |
| `legacy.getFeatureFlagResult('checkout')`                      | `featureFlags.getFeatureFlag('checkout')`. Read `.key`, `.enabled`, `.variant`, and `.payload`.                                                                          |
| `legacy.getFeatureFlagPayload('checkout')`                     | `featureFlags.getFeatureFlag('checkout')?.payload`. This is now a normal flag read and can emit a flag-called event.                                                     |
| `legacy.isFeatureEnabled('checkout')`                          | `featureFlags.getFeatureFlag('checkout')?.enabled`.                                                                                                                      |
| `legacy.isFeatureEnabled('checkout', { defaultValue: false })` | `featureFlags.getFeatureFlag('checkout')?.enabled ?? false`.                                                                                                             |

Before:

```js
if (legacy.getFeatureFlag('button-color') === 'red') {
    console.log(legacy.getFeatureFlagPayload('button-color'))
}
```

After:

```ts
const buttonColor = featureFlags.getFeatureFlag('button-color')
if (buttonColor?.variant === 'red') {
    console.log(buttonColor.payload)
}
```

Do not test the result object's truthiness to determine enablement: a disabled flag has a result with `enabled: false`. `undefined` means no value is currently available. Reads emit deduplicated flag-called events. **TODO:** migration for per-read `{ send_event: false }` and `{ fresh: true }`; the browser facade's getter accepts only the key.

### Refresh, subscriptions, and injected values

| Before                                                            | After / migration status                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `legacy.reloadFeatureFlags()`                                     | `await featureFlags.reloadFeatureFlags()`. Inspect `outcome.status`: `loaded`, `error`, `skipped`, or `cancelled`. Request failures resolve rather than reject.                                                                            |
| `legacy.updateFlags(values, payloads, { merge: true })`           | `featureFlags.updateFlags(values, payloads, { merge: true })`. The argument shapes are unchanged.                                                                                                                                          |
| `legacy.getAllFeatureFlags()`                                     | **Partial:** `featureFlags.onFeatureFlags()` supplies an array of results without emitting exposure events. Keep the latest array if the application needs a snapshot. **TODO:** no direct synchronous getter on the browser flags facade. |
| `legacy.flagsEndpointWasHit` / `legacy.decideEndpointWasHit`      | No equivalent boolean property. Use the subscription for available values or await reload for a remote outcome. Installation alone does not establish readiness.                                                                           |
| `legacy.on('featureFlagsReloading', callback)`                    | **TODO:** no reload-start event. A caller can track its own awaited reload, but that does not observe every automatic reload.                                                                                                              |
| `legacy.setPersonPropertiesForFlags(properties, reload)`          | **TODO:** no matching browser flags facade method. `initialPersonProperties` is an initialization input, not a runtime local-only override setter.                                                                                         |
| `legacy.resetPersonPropertiesForFlags(reload)`                    | **TODO:** no matching browser flags facade method.                                                                                                                                                                                         |
| `legacy.updateEarlyAccessFeatureEnrollment(key, enrolled, stage)` | **TODO:** no early-access enrollment API.                                                                                                                                                                                                  |
| `legacy.getEarlyAccessFeatures(callback, forceReload, stages)`    | **TODO:** no early-access listing API.                                                                                                                                                                                                     |

`onFeatureFlags()` changes both callback arguments and cleanup:

```js
// Before
const unsubscribe = legacy.onFeatureFlags((keys, variants, { errorsLoading } = {}) => {
    console.log(keys, variants, errorsLoading)
})
unsubscribe()
```

```ts
// After
const subscription = featureFlags.onFeatureFlags((results, errorsLoading) => {
    console.log(results, errorsLoading)
})
subscription.dispose()
```

The results array includes conclusive off results as well as enabled ones; it is not the old enabled-key list. Awaiting client creation does not wait for this data. Subscriptions observe local/bootstrap/injected values as well as remote changes; use the reload outcome when you specifically need completion of a requested remote evaluation.

## Surveys

Get the installed extension instead of calling survey methods on the client:

```ts
import type { SurveysExtension } from '@posthog/browser/surveys'

const feedback = posthog.getExtension<SurveysExtension>('surveys')
if (!feedback) {
    throw new Error('Surveys are not installed')
}
```

For static inclusion, use `surveys()` from `@posthog/browser/surveys` in `extensions`. Client creation waits for setup, not survey definitions or the dynamically loaded renderer. Rendering requires a document and remains subject to capture consent.

| Before                                                   | After / migration status                                                                                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `legacy.getSurveys(callback, forceReload)`               | `feedback.getSurveys(callback, forceReload)`. Callback shape remains `(surveys, context)`.                                                                            |
| `legacy.getActiveMatchingSurveys(callback, forceReload)` | `feedback.getActiveMatchingSurveys(callback, forceReload)`.                                                                                                           |
| `legacy.onSurveysLoaded(callback)`                       | `const subscription = feedback.onSurveysLoaded(callback)`; clean up with `subscription.dispose()`.                                                                    |
| `legacy.onActiveMatchingSurveysChanged(callback)`        | **TODO:** no equivalent continuous matching-survey subscription. `getActiveMatchingSurveys()` is a one-off request, not a replacement subscription.                   |
| `legacy.displaySurvey(id, options)`                      | `feedback.displaySurvey(id, options)`. The display options keep their existing shape.                                                                                 |
| `legacy.cancelPendingSurvey(id)`                         | `feedback.cancelPendingSurvey(id)`.                                                                                                                                   |
| `legacy.canRenderSurveyAsync(id, forceReload)`           | `await feedback.canRenderSurvey(id, forceReload)`. Inspect the returned reason's `.visible`.                                                                          |
| `legacy.canRenderSurvey(id)`                             | `await feedback.canRenderSurvey(id)`. The deprecated synchronous call becomes asynchronous; update its caller accordingly.                                            |
| `legacy.renderSurvey(id, selector)`                      | Use `feedback.displaySurvey()` with explicit inline options, as below. This migrates away from the deprecated renderer; check styling and display-condition behavior. |

```ts
import { DisplaySurveyType } from '@posthog/browser/surveys'

feedback.displaySurvey('survey-123', {
    displayType: DisplaySurveyType.Inline,
    selector: '#survey-container',
    ignoreConditions: false,
    ignoreDelay: false,
})
```

Choose `ignoreConditions` and `ignoreDelay` deliberately rather than assuming the deprecated `renderSurvey()` had the same behavior. DOM-action targeting also requires a compatible autocapture extension.

## Logs

`captureLog()` moves to the logs extension:

```js
// Before
legacy.captureLog({ body: 'checkout completed', level: 'info', attributes: { order_id: 'order-123' } })
legacy.logger.error('payment failed', { error_code: 'E001' })
```

```ts
import type { LogsExtension } from '@posthog/browser/logs'

const logger = posthog.getExtension<LogsExtension>('logs')
if (!logger) {
    throw new Error('Logs are not installed')
}
logger.captureLog({ body: 'checkout completed', level: 'info', attributes: { order_id: 'order-123' } })
logger.captureLog({ body: 'payment failed', level: 'error', attributes: { error_code: 'E001' } })
```

For explicit static inclusion, pass `logs()` from `@posthog/browser/logs` in `extensions`.

**Do not keep `posthog.logger.info()` / `.error()` for application logs.** On the new client, `posthog.logger` emits SDK diagnostic output, not records to the PostHog logs product. Replace each legacy severity helper (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) with the logs extension's `captureLog({ body, level, attributes })`.

Installing logs does not itself opt in to console collection. Console capture has separate local/remote controls. `await posthog.flush()` flushes installed extensions, including logs; `await logger.flush()` flushes logs alone.

## Consent

| Before                                                             | After / migration status                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `legacy.opt_in_capturing()`                                        | `posthog.optIn()`. It does not emit the legacy `$opt_in` event automatically.                                                                                                                                             |
| `legacy.opt_in_capturing({ captureEventName, captureProperties })` | **Partial:** call `posthog.optIn()` and explicitly capture the chosen event if needed. There are no opt-in event options; the default `$opt_in` behavior must be chosen explicitly.                                       |
| `legacy.opt_out_capturing()`                                       | `posthog.optOut()`. It blocks new analytics capture/dispatch and discards queued analytics/logs, but retains identity and SDK state. It does not disable control-plane loading, storage, or switch to cookieless capture. |
| `legacy.has_opted_out_capturing()`                                 | `posthog.hasOptedOut()` (also exposed as `posthog.isOptedOut`).                                                                                                                                                           |
| `legacy.is_capturing()`                                            | `posthog.canCapture`, the client's current ability to admit capture. This includes lifecycle and bot restrictions; it is not proof of network availability. Legacy cookieless-mode behavior is not equivalent.            |
| `legacy.has_opted_in_capturing()`                                  | **TODO:** no explicit-opt-in query. `!posthog.hasOptedOut()` does not prove the user explicitly opted in.                                                                                                                 |
| `legacy.get_explicit_consent_status()`                             | **TODO:** no equivalent three-state explicit-consent getter. Keep the application's consent authority separate from capture eligibility.                                                                                  |
| `legacy.clear_opt_in_out_capturing()`                              | **TODO:** no equivalent method to clear a persisted consent choice. Neither `reset()` nor `optIn()` is equivalent.                                                                                                        |

The default consent key is `__ph_opt_in_out_<project-token>` in the configured store. Use `consentPersistenceName` for a custom key. Recognizing a legacy localStorage denial does not mean every cookie-backed or custom-storage consent setup migrates automatically. **TODO:** complete those migration instructions before switching such applications.

## Sessions and replay

| Before                                             | After / migration status                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `legacy.get_session_id()`                          | `posthog.session?.sessionId`. This read does not create a session; it can be `undefined` before the first admitted event, including when `bootstrap.sessionId` supplies the ID.                                                                                                                                       |
| `legacy.onSessionId((sessionId, windowId) => ...)` | **Partial:** read `posthog.session` for current state and use `posthog.onNewSession(({ sessionId, windowId }) => ...)` for new-session notifications. Clean up with `.dispose()`. Unlike the old callback, `onNewSession` does not replay existing state or notify every sibling-session adoption/window-only change. |
| `legacy.get_session_replay_url(options)`           | **TODO:** no replay URL helper. A session ID alone does not prove a recording exists.                                                                                                                                                                                                                                 |
| `legacy.startSessionRecording(options)`            | **TODO:** document the replay extension's start API when available on the supported browser entrypoint.                                                                                                                                                                                                               |
| `legacy.stopSessionRecording()`                    | **TODO:** replay stop API.                                                                                                                                                                                                                                                                                            |
| `legacy.sessionRecordingStarted()`                 | **TODO:** replay status API.                                                                                                                                                                                                                                                                                          |
| `legacy.getPageViewId()`                           | `posthog.getPageViewId()`: the UUID of the last `$pageview` in the current session, also sent on later events as `$pageview_id`. Only `$pageview` captures set it; there is no SPA navigation tracking yet.                                                                                                           |

Do not assume that installing the client or reading `session` starts recording. The new core's initial `$pageview` also does not by itself replace legacy SPA navigation tracking, page-leave capture, or URL/title enrichment.

## Error tracking and other integrations

These facade APIs do not yet have equivalents on the supported browser entrypoints:

| Existing call site                                               | Migration status                                                                                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `legacy.captureException(error, properties)`                     | **TODO:** exception extension and manual capture mapping, including legacy return-value callers. Capturing a generic event is not equivalent to exception normalization. |
| `legacy.addExceptionStep(message, properties)`                   | **TODO:** exception breadcrumb/step API.                                                                                                                                 |
| `legacy.startExceptionAutocapture(config)`                       | **TODO:** exception autocapture start/configuration API.                                                                                                                 |
| `legacy.stopExceptionAutocapture()`                              | **TODO:** exception autocapture stop API.                                                                                                                                |
| `legacy.SentryIntegration` / `legacy.sentryIntegration(options)` | **TODO:** Sentry integration mapping.                                                                                                                                    |
| `legacy.loadToolbar(params)`                                     | **TODO:** toolbar API and its boolean return contract.                                                                                                                   |

## Scope and remaining gaps

This inventory covers the application-facing methods and accessors on `posthog-core.ts`, including deprecated methods that applications may still call. It does not inventory methods on the legacy `featureFlags`, `surveys`, `sessionRecording`, or other nested implementation objects. Their new application-facing entrypoints should be documented with the relevant extension.

Members marked `@internal`—including legacy `getExtension()`, `calculateEventProperties()`, and `toString()`—and underscore-prefixed methods are not migration contracts. The new client's public `getExtension()` is used above to locate product APIs; do not port assumptions about legacy runtime manager objects to it.

Before treating this draft as a complete migration path, resolve the TODOs for the APIs your application uses, especially default initialization, identity/consent continuity, persistent super properties, and missing product extensions. Do not replace an unsupported API with a similarly named operation that changes identity, persistence, or capture behavior.
