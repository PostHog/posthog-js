# Migrating from posthog-react-native 4.x to 5.0

posthog-react-native 5.0 sends events through capture v1, aligns the feature flag API with `@posthog/react` and the native SDKs (posthog-ios 4.0, posthog-android 4.0, posthog_flutter 6.0), and removes deprecated options.
Read the checklist first, then the sections that apply to you.

## Checklist

You need to change code or configuration if your app does any of these:

- sends events through a reverse proxy, or to a self-hosted PostHog (see [Reverse proxies and self-hosted PostHog](#reverse-proxies-and-self-hosted-posthog))
- uses session replay or another native feature with `posthog-react-native-session-replay`, or with `@posthog/react-native-plugin` older than 3.0 (see [Session replay and the native plugin](#session-replay-and-the-native-plugin))
- passes `apiKey` to `PostHogProvider`, or sets `evaluationEnvironments`, `disableRemoteConfig`, `sessionReplayConfig.iOSdebouncerDelayMs`, `sessionReplayConfig.androidDebouncerDelayMs`, `sessionReplayConfig.screenshotModeBackgroundCapture` or `autocapture.navigationRef` (see [Removed options](#removed-options))
- calls `useNavigationTracker()` with a `navigationRef` argument
- calls `onFeatureFlags()` or `reloadFeatureFlagsAsync()` (see [`onFeatureFlags`](#onfeatureflags))
- calls `getFeatureFlagPayload()`, `getFeatureFlags()`, `getFeatureFlagPayloads()`, `getFeatureFlagsAndPayloads()`, `onFeatureFlag()` or `overrideFeatureFlag()`, or reads `getFeatureFlagDetails()` (see [Removed feature flag methods](#removed-feature-flag-methods))
- uses the `useFeatureFlag()`, `useFeatureFlags()` or `useFeatureFlagWithPayload()` hooks (see [Feature flag hooks](#feature-flag-hooks))
- passes `sendEvent` to `getFeatureFlag()`, `getFeatureFlagResult()` or `isFeatureEnabled()`
- reads a feature flag payload that isn't valid JSON, or bootstraps string payloads
- reads `enabled` from `getFeatureFlagResult()` or `getAllFeatureFlags()` for a flag whose variant is an empty string, or filters on `$active_feature_flags`
- sets `Authorization`, `User-Agent`, `Content-Type`, `Content-Encoding` or a `PostHog-` header the SDK sets in `requestHeaders` and expects capture requests to carry it
- relies on `fetchRetryCount` or `fetchRetryDelay` for events, on `flush()` or `shutdown()` rejecting when delivery fails, or on `posthog.on('error')` firing for network errors (see [Event delivery](#event-delivery))
- sends `$ai_` events, or calls `captureTraceFeedback()` or `captureTraceMetric()` (see [AI events](#ai-events))
- registers `$is_identified` or `$process_person_profile`, or sends `null` property values (see [Event properties](#event-properties))
- sends distinct IDs or event names over 200 UTF-8 bytes, such as a JWT as the distinct ID (see [Event delivery](#event-delivery))

## Reverse proxies and self-hosted PostHog

posthog-react-native 5.0 sends events to new paths:

| Method                                                                                            | 4.x       | 5.0                      |
| ------------------------------------------------------------------------------------------------- | --------- | ------------------------ |
| `capture`, `identify`, `alias`, `group`, `screen`, `captureException` and the other event methods | `/batch/` | `/i/v1/analytics/events` |
| `captureAi` (new)                                                                                 | —         | `/i/v1/ai/events`        |
| `captureTraceFeedback`, `captureTraceMetric`                                                      | `/batch/` | `/i/v1/ai/events`        |

Feature flag, remote config, survey and session replay requests are unchanged.

If you send events to a self-hosted PostHog, check that it serves `/i/v1/analytics/events`, and `/i/v1/ai/events` if you use `captureAi()`, `captureTraceFeedback()` or `captureTraceMetric()`, before you upgrade.
A `404` keeps events queued: the SDK resends them with backoff until the queue is full, then drops the oldest. A `400`, `401`, `403` or `405` drops them. With `debug: true`, the SDK logs why, such as `HTTP 404`.

If you send events through your own reverse proxy, update it before you upgrade:

- Forward `/i/v1/analytics/events` and `/i/v1/ai/events` to PostHog.
- Pass `Authorization` through unchanged when it starts with `Bearer phc_`, or is `Bearer <your project token>` for a token older than the `phc_` prefix. The project token is no longer in the request body, and PostHog answers `401` without it.
- Pass every `PostHog-*` header, `Content-Type`, `Content-Encoding` and `User-Agent` through unchanged. PostHog answers `400` without them.
- Return PostHog's response body unchanged. The SDK drops a batch whose `2xx` response has no PostHog `results` body.
- Accept request bodies up to 20 MB. Analytics requests carry up to 5 MiB of events, and a single AI event can be over 8 MiB.
- Answer capture requests directly instead of redirecting them. React Native's fetch follows every redirect, including one to another origin, so a redirect can send your `requestHeaders` to that origin. The native SDKs follow only same-origin `307` and `308` redirects.

PostHog's managed reverse proxy already does all of this. See the [proxy guides](https://posthog.com/docs/advanced/proxy).

## Session replay and the native plugin

5.0 needs `@posthog/react-native-plugin` 3.0 or later (a peer dependency) for session replay and other native features.
It no longer falls back to `posthog-react-native-session-replay`.

```sh
npm uninstall posthog-react-native-session-replay
npm install @posthog/react-native-plugin@^3
```

Then run `pod install` in `ios`, or `npx expo prebuild --clean`. Remove `pod 'PostHog'` from your Podfile and `posthog.useSpm` from `ios/Podfile.properties.json` if you set them.

`@posthog/react-native-plugin` 3.0 needs React Native 0.75 or later, Xcode 26 or later and iOS 15 or later, and pulls posthog-ios through Swift Package Manager. See its [migration guide](https://github.com/PostHog/posthog-js/blob/main/packages/react-native-plugin/MIGRATION.md) for its own steps.

Without the plugin, session replay, native crash capture and push notification capture stay off. With `debug: true`, the SDK logs this for session replay and native crash capture.

## Removed options

| 4.x                                                                                      | 5.0                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `<PostHogProvider apiKey="phc_…">`                                                       | `<PostHogProvider projectToken="phc_…">`. In JavaScript, a leftover `apiKey` prop is ignored and the client is disabled.                                                                                                                                                                                     |
| `evaluationEnvironments`                                                                 | `evaluationContexts`                                                                                                                                                                                                                                                                                         |
| `disableRemoteConfig`                                                                    | Remove it. It had no effect.                                                                                                                                                                                                                                                                                 |
| `sessionReplayConfig.iOSdebouncerDelayMs`, `sessionReplayConfig.androidDebouncerDelayMs` | `sessionReplayConfig.throttleDelayMs`, which applies to both platforms. Without it, 4.x used the larger of the two, so set it to that value to keep the same timing.                                                                                                                                         |
| `sessionReplayConfig.screenshotModeBackgroundCapture: true`                              | Remove it. posthog-ios 4.0 removed background capture. `sessionReplayConfig.iOSCaptureMethod` takes `'standard'` (the default) or experimental `'gpu'`.                                                                                                                                                      |
| `autocapture.navigationRef`, the `PostHogNavigationRef` type                             | Remove it. With `captureScreens`, put `PostHogProvider` inside the `NavigationContainer` (`@react-navigation/native` v6 and below), or capture screens manually with `screen()`. See [capturing screen views](https://posthog.com/docs/libraries/react-native#capturing-screen-views).                       |
| `useNavigationTracker(options, navigationRef, client)`                                   | `useNavigationTracker(options, client)`. In JavaScript, a leftover `navigationRef` second argument is read as the client: screens aren't tracked and a `[PostHog] useNavigationTracker received a client without screen()` error is logged. A third-argument `client` is ignored, so remove `navigationRef`. |

## Feature flags

### `onFeatureFlags`

The callback gets one object, like posthog-ios, posthog-android and posthog_flutter:

```ts
// 4.x
posthog.onFeatureFlags((flags) => {
  if (flags['new-checkout']) showNewCheckout()
})

// 5.0
posthog.onFeatureFlags(({ flags, variants, errorsLoading }) => {
  if (variants['new-checkout']) showNewCheckout()
})
```

- `flags` lists the keys of enabled flags. Disabled flags are left out; read them with `getFeatureFlagResult(key)`.
- `variants` maps each enabled flag to `true` or its variant.
- `errorsLoading` is `true` when the latest load failed. `flags` and `variants` then hold the last known values, which are empty if none were cached.

`reloadFeatureFlagsAsync()` resolves with the same object. In 4.x it resolved with the flag map, or `undefined` when the load failed.

A callback registered after flags have loaded is also called once with the current values, right after `onFeatureFlags()` returns.
If your 4.x code read flags both in the callback and right after registering it, that work now runs twice, so keep callbacks idempotent.

### Removed feature flag methods

| 4.x                                                                                          | 5.0                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getFeatureFlagPayload(key)`                                                                 | `getFeatureFlagResult(key, { sendFeatureFlagEvent: false })?.payload`                                                                                                             |
| `getFeatureFlags()`, `getFeatureFlagPayloads()`, `getFeatureFlagsAndPayloads()`              | `getAllFeatureFlags()`, which returns a list of `{ key, enabled, variant, payload }` (see below)                                                                                  |
| `onFeatureFlag(key, cb)`                                                                     | `onFeatureFlags(() => { const value = posthog.getFeatureFlag(key); if (value !== undefined) cb(value) })`                                                                         |
| `overrideFeatureFlag(overrides)`                                                             | `updateFlags(...)`, with `disableRemoteFeatureFlags: true` so the next load doesn't replace the values. Overrides set with `overrideFeatureFlag()` in 4.x are cleared on upgrade. |
| `getFeatureFlagDetails()`                                                                    | Internal, left out of the docs, and may change in any release. Use `getAllFeatureFlags()`, or `getFeatureFlagResult(key)` for one flag.                                           |
| `{ sendEvent: false }` on `getFeatureFlag()`, `getFeatureFlagResult()`, `isFeatureEnabled()` | `{ sendFeatureFlagEvent: false }`. TypeScript rejects `sendEvent`; plain JavaScript still accepts it, but rename it.                                                              |

To build the 4.x maps from `getAllFeatureFlags()`:

```ts
const results = posthog.getAllFeatureFlags()
const flags = Object.fromEntries(results.map((r) => [r.key, r.variant ?? r.enabled]))
const payloads = Object.fromEntries(
  results.filter((r) => r.enabled && r.payload !== null).map((r) => [r.key, r.payload])
)
```

### Payloads

A payload that isn't valid JSON, including an empty one, reads as `null`.
In 4.x it read as its raw string.
Valid JSON payloads, including `"text"` with quotes, `false`, `0` and `null`, read as before.
A string payload in `bootstrap.featureFlagPayloads` stays a string: `"123"` reads as `"123"`, where 4.x read it as `123`.

### Empty-string variants

A flag whose variant is an empty string reads as disabled everywhere: `getFeatureFlagResult()` and `getAllFeatureFlags()` return `enabled: false` for it, as `isFeatureEnabled()` already did, and it's left out of `$active_feature_flags`. Disabled flags are also left out of `$active_feature_flags`.

### Feature flag hooks

The hooks match `@posthog/react`:

| 4.x                                 | 5.0                                                                                                                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useFeatureFlag(key)` for the value | `useFeatureFlagVariantKey(key)`                                                                                                                                                                                                              |
| `useFeatureFlag(key)` for on/off    | `useFeatureFlagEnabled(key)`                                                                                                                                                                                                                 |
| `useFeatureFlags()`                 | `useActiveFeatureFlags()` for the enabled flag keys                                                                                                                                                                                          |
| `useFeatureFlagWithPayload(key)`    | `useFeatureFlagResult(key)`, which returns `{ key, enabled, variant, payload }` (or `undefined`) instead of a `[value, payload]` tuple, or `useFeatureFlagPayload(key)` for the payload alone. The `FeatureFlagWithPayload` type is removed. |

For a flag that isn't in the loaded flags, `useFeatureFlagVariantKey()` and `useFeatureFlagEnabled()` return `undefined`, or the default you pass to `useFeatureFlagEnabled()`, where `useFeatureFlag()` returned `false`. Check for a falsy value instead of `=== false`.

`useFeatureFlagEnabled(key, defaultValue?, client?)` takes the client third. In JavaScript, `useFeatureFlagEnabled(key, client)` reads the client as the default, so call `useFeatureFlagEnabled(key, undefined, client)`.

`useFeatureFlagResult()` keeps its shape, and reads an empty-string variant as disabled (see [Empty-string variants](#empty-string-variants)).

## Event delivery

- `Authorization`, `User-Agent`, `Content-Type`, `Content-Encoding` and the `PostHog-` headers the SDK sets no longer reach capture requests from `requestHeaders`; the SDK sets its own. Other `requestHeaders` still do, and feature flag requests still get all of them.
- Events stay queued when a send gets no response, a `404`, `408`, `429`, `500`, `502`, `503` or `504`, or a `retry` result. They're sent again after a wait of about 1 second doubling to 30 seconds, longer if the server's `Retry-After` asks (up to 30 seconds), with no attempt limit. `fetchRetryCount` and `fetchRetryDelay` no longer apply to events.
- `flush()` and `shutdown()` no longer reject when delivery fails. Events either stay queued for a later send or are dropped and reported through `posthog.on('error')`.
- `posthog.on('error')` no longer fires for network errors or retryable statuses while events stay queued. It still fires for dropped events, with a different error that has no `response`. It carries `endpoint`, `requestId`, `drops` (events rejected one by one, each with its `uuid` and `details`), `retryExhausted` (the uuids of events lost when a whole batch failed, such as on a `400` or `401`) and `cause` (the error behind a whole-batch failure).

  ```ts
  // 4.x
  posthog.on('error', (err) => report(err.response?.status))

  // 5.0
  posthog.on('error', (err) => report(err.message, (err.drops?.length ?? 0) + (err.retryExhausted?.length ?? 0)))
  ```

- Event uuids are sent in lowercase.
- PostHog drops an event whose distinct ID or name is over 200 UTF-8 bytes (`distinct_id_too_large`, `event_name_too_long`), and `posthog.on('error')` reports it. 4.x capture shortened the distinct ID and kept the event.
- Each request carries up to 5 MiB of events. A batch that gets a `413` is split and sent again; a single event that gets a `413` is dropped.

## Event properties

5.0 sets person properties on events the way posthog-ios 4.0, posthog-android 4.0 and posthog_flutter 6.0 do:

- A registered or caller `$is_identified` or `$process_person_profile` replaces the SDK's value on that event. In 4.x the SDK's value always won. A registered `$process_person_profile: false` now makes every event personless, also after `identify()`, and `true` processes anonymous users under `personProfiles: 'identified_only'`. Neither changes the `personProfiles` policy.
- `$identify`, `$create_alias`, `$groupidentify`, `$merge_dangerously`, `$set` and `$set_once` events leave off a registered `$process_person_profile`. In 4.x, registering `false` sent it on them, and PostHog dropped them, so `identify()`, `alias()` and `group()` had no effect. A `before_send` hook can still set it, and so can a value passed on a `$set`, `$set_once` or `$merge_dangerously` call.
- `$autocapture` events carry `$process_person_profile` and `$is_identified` like other events, so anonymous autocapture follows `personProfiles: 'identified_only'`. In 4.x they carried neither, and PostHog processed the person.
- `null` and `undefined` property values are left off events, except inside `$set`, `$set_once` and `$group_set`, where a `null` still clears the property. Array elements keep their positions.

### Per-event options

Settings that tell PostHog how to process an event go in `options`, like posthog-ios 4.0 and posthog-android 4.0. `capture()`, `screen()`, `identify()`, `setPersonProperties()`, `alias()`, `group()`, `groupIdentify()`, `captureException()` and `captureAi()` take them in their options argument:

```ts
// 4.x
posthog.capture('signed_up', { $process_person_profile: false })

// 5.0
posthog.capture('signed_up', {}, { options: { process_person_profile: false } })
```

| Option                    | Legacy property           |
| ------------------------- | ------------------------- |
| `process_person_profile`  | `$process_person_profile` |
| `cookieless_mode`         | `$cookieless_mode`        |
| `disable_skew_correction` | `$ignore_sent_at`         |
| `product_tour_id`         | `$product_tour_id`        |

The legacy properties still work, and an option wins over its property. `before_send` reads and changes options through `event.options`. A hook that returns a new event keeps them unless it sets `options`, and `options: {}` removes the ones passed on the call.

## AI events

5.0 adds `captureAi()`, which sends `$ai_generation`, `$ai_span`, `$ai_trace`, `$ai_embedding` and other `$ai_` events to PostHog's AI endpoint, which accepts much larger events.
`capture()` still sends `$ai_` events to the analytics endpoint; switch them to `captureAi()`.
`captureTraceFeedback()` and `captureTraceMetric()` now send their `$ai_feedback` and `$ai_metric` events through `captureAi()`, so a reverse proxy must serve `/i/v1/ai/events` for them.

```ts
// 4.x
posthog.capture('$ai_generation', { $ai_model: 'gpt-4o', $ai_trace_id: traceId })

// 5.0
posthog.captureAi('$ai_generation', { $ai_model: 'gpt-4o', $ai_trace_id: traceId })
```

AI events have their own queue and options:

| Option                      | Default                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `captureAiCompression`      | `'gzip'` (bodies go uncompressed where the runtime has no `CompressionStream`, such as Hermes)                                                                           |
| `captureAiMaxQueueSize`     | `100` events, and at most 50 MiB; the oldest are dropped first                                                                                                           |
| `captureAiRequestTimeoutMs` | `60000`, in milliseconds. The native SDKs' `captureAiTimeout` is in seconds, so don't copy their value.                                                                  |
| `captureAiMaxEventBytes`    | 8 MiB plus 64 KiB; a larger event is dropped and `captureAi()` returns `undefined` (before the SDK finishes initializing, it returns the UUID and drops the event later) |

`flushAt`, `maxBatchSize` and `flushInterval` apply to both queues. `disableCompression` doesn't affect AI events.

The SDK doesn't redact or truncate prompts, outputs or media; use `before_send` to strip them.
With Expo's file system as storage (the default where `expo-file-system` is installed), unsent AI events survive a restart up to their newest 5 MiB. With `@react-native-async-storage/async-storage` as storage (the default without Expo's file system), or `persistence: 'memory'`, they're kept in memory only, so they're lost if the app is killed before they're sent. Pass AsyncStorage itself as `customStorage`, not a wrapper around it.
