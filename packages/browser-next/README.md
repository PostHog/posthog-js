# @posthog/browser

An experimental PostHog client for modern browsers. The API is not yet stable.

Moving from `posthog-js`? See the [draft migration guide](./MIGRATION.md) for public API call-site changes and remaining gaps.

```sh
npm install @posthog/browser
```

```ts
import { createPostHog } from '@posthog/browser'

const posthog = await createPostHog({ projectToken: '<project-token>' })
posthog.capture('signed_up')
await posthog.flush()
```

The client is the single `Client` implementation that shared and browser extensions receive in `setup()`. Capture, identity, registration and their listeners are client members. Configure scheduling and person processing through the `analytics` option:

```ts
const posthog = await createPostHog({
    projectToken: '<project-token>',
    analytics: { flushAt: 20, flushInterval: 3_000, personProfiles: 'identified_only' },
})
```

Both entrypoints deliver through Capture V1 with retries, compression and payload splitting. They differ in how products load:

| Entrypoint              | Products                                                           |
| ----------------------- | ------------------------------------------------------------------ |
| `@posthog/browser`      | Loaded on demand from options, saved state or remote configuration |
| `@posthog/browser/core` | Only explicitly supplied extensions                                |

Both entrypoints share identity, session, consent and persistence behavior. Installed products are synchronous client properties, such as `posthog.featureFlags`; reading one never starts loading. `await posthog.resolveExtension(token)` waits for a product that is loading, and `posthog.getExtension(name)` returns an installed extension or one of its bindings.

`personProfiles: 'always' | 'never' | 'identified_only'` defaults to `identified_only`. Anonymous events carry `process_person_profile: false` in Capture V1 options until identification, group registration or explicit profile enablement. SDK-computed processing metadata takes precedence over caller properties; `$process_person_profile` does not change the SDK's underlying processing state.

Person and group operations are client methods:

```ts
posthog.alias('account-123')
posthog.setPersonProperties({ plan: 'pro' })
posthog.group('organization', 'current-group')
posthog.groupIdentify('organization', 'another-group', { plan: 'enterprise' })
posthog.resetGroups()
```

Profile creation and property updates preserve the current anonymous identity; they do not identify the user. Set, set-once and unset also update local feature-flag person context. Exact repeated property updates are deduplicated only after local event admission. Reset clears explicit profile enablement and deduplication, without rewriting queued events. In `never` mode, person helpers, identify and group registration are no-ops; ordinary capture continues without person processing.

`posthog.alias(targetId)` links the current ID without changing the current identity or marking it identified; it enables person processing unless disabled by policy. Use `posthog.identify()` to switch the ambient identity.

`posthog.group(type, key, properties?)` persists ambient membership. `posthog.groupIdentify(type, key, properties?, options?)` sends a group-profile update without changing membership or local flag-evaluation context; its key can be a string or finite number. Alias and group-profile events require capture consent and are suppressed in `never` mode. `posthog.resetGroups()` clears memberships, retaining identity, sessions, person properties and other stored state. When flags is installed it also clears group properties used for evaluation and requests a reload. It remains available for cleanup when capture is denied or person processing is disabled. Previously queued events retain their captured group context.

## Persistent event properties

Register context for future events:

```ts
posthog.register({ plan: 'pro', region: 'eu' })
posthog.registerOnce({ acquisitionSource: 'website' })
posthog.capture('dashboard', { plan: 'enterprise' })
const region = posthog.getProperty('region')
posthog.unregister('region')
```

`register(properties)` merges JSON-serializable properties into analytics' Core-owned persistent storage. `registerOnce(properties, defaultValue = 'None')` adds missing keys or replaces existing values strictly equal to the sentinel; other existing values, including `false`, `0`, `''` and `null`, are retained. `getProperty(key)` returns an isolated stored value, or `undefined` for a missing key. Registration inputs and captured events are snapshotted, so later input or stored-property changes do not rewrite queued events.

Persistent properties are overridden by session properties, then dynamic event-property producers, then caller properties and capture options. SDK identity, group, session, library and person-processing metadata remains authoritative. Registration and removal only change local context, do not emit events, and remain available when capture consent is denied or person processing is disabled. Properties survive reload with persistent storage, until overwritten, unregistered or cleared by full `reset()`; `resetGroups()` retains them.

## Session event properties

```ts
posthog.registerForSession({ checkoutFlow: 'express' })
posthog.unregisterForSession('checkoutFlow')
```

With default browser storage, session properties use Core-owned per-tab storage, surviving reloads in the same SDK session. Independent tabs are isolated; copied tabs inherit a snapshot and then diverge. With a custom `storage` adapter, `storage: false` or unavailable native session storage, properties remain in per-instance memory. They override persistent defaults, but dynamic producers, caller properties, capture options and protected SDK metadata take precedence.

Registration and removal are local, do not create a session, and remain available under capture denial or `personProfiles: 'never'`. Properties registered before the first event or after the current session expires remain pending for the next admitted session. Registration does not extend session activity. On Core session rotation or adoption, old properties are excluded from the new session's events and cleared only after successful admission; rejected events retain the old scope. Full `reset()` clears session properties; `resetGroups()` retains them. Already-admitted events retain their finalized properties.

## Migrating from the analytics extension

Earlier 0.x versions exposed analytics as a separate product. It is now part of the client:

| Previous API                                                                  | Replacement                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `posthog.analytics?.capture()`, `captureImmediate()`, `identify()`, `reset()` | The same method on `posthog`                                       |
| `posthog.analytics?.register*()`, `getProperty()`, `registerForSession()`     | The same method on `posthog`                                       |
| `posthog.analytics?.onEvent`, `isRateLimited`                                 | `posthog.onEvent`, `posthog.isRateLimited`                         |
| `posthog.analytics?.alias()`, person helpers                                  | The same method on `posthog`                                       |
| `posthog.analytics?.group()`, `groupIdentify()`, `resetGroups()`              | The same method on `posthog`                                       |
| `analytics()` from `@posthog/browser/analytics`, `analytics: { load }`        | The `analytics` option configures scheduling and person processing |
| `IPostHogInternal`, `sharedClient`                                            | Extensions receive the `IPostHog` client in `setup()`              |
| `analytics: false`, `/core` without the analytics extension                   | Always captures; see `capturePageview` and `autocapture` below     |

Capture is part of every client, so `analytics: false` (ignored, with a debug warning) and `/core` without the analytics extension no longer turn it off. Both entrypoints send the initial `$pageview`, `$feature_flag_called` the first time each flag value is read when flags is installed, and events from other installed products. Set `capturePageview: false` to skip the initial pageview and, on the root entrypoint, `autocapture: false` to turn off autocapture. `optOutByDefault: true` stops all capture until `optIn()`, but it also blocks flag and other product requests.

Extensions share the client's key-value store, as posthog-js extensions share its persistence. Data saved by earlier 0.x versions under per-extension namespaces is not migrated.

## Classic script installation (draft CDN distribution)

The CDN build supports a plain external classic script in ordinary, `async`, or `defer` placement. The proposed asset namespace is `/static/browser/<exact-version-or-major>/`; availability depends on CDN deployment. For example, once deployed:

```html
<script async src="https://us-assets.i.posthog.com/static/browser/0/script.js?projectToken=YOUR_PROJECT_TOKEN"></script>
```

The first response embeds core and full analytics, including Capture V1 delivery. Queued and immediate analytics do not require another JavaScript request. Optional implementations load through native bundler-generated script chunks relative to that script's directory, including when assets and the page have different origins. Publish the entire `dist-cdn` tree together, keeping hashed chunks available during alias updates. Query parameters and fragments are not forwarded to chunk URLs. When the installing script has a CSP nonce, deferred chunk scripts inherit it. The asset host is not the ingestion host: the SDK's US ingestion default still applies. Set `apiHost` explicitly for EU ingestion or a proxy, URL-encoding its value, for example `&amp;apiHost=https%3A%2F%2Feu.i.posthog.com` in HTML.

Only these query options are supported; omitted options use the existing factory defaults:

| Option                                                               | Values                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `projectToken`                                                       | Required, nonempty project token                                                            |
| `apiHost`                                                            | Absolute HTTP(S) API base, optionally with a proxy path; no credentials, query, or fragment |
| `capturePageview`, `optOutByDefault`, `debug`, `disableBotDetection` | Literal `true` or `false`                                                                   |
| `storage`, `flags`, `logs`, `surveys`, `autocapture`                 | Literal `false` to disable the corresponding default                                        |

Unknown parameters are ignored. Invalid recognized values prevent installation and log a generic diagnostic without the URL or token. This query interface does not accept objects, callbacks, or extensions; use the npm factory for those configurations.

After the existing `createPostHog()` factory resolves, the script assigns `window.posthog` and dispatches `posthog:ready` on `window`, with the client in `event.detail`. Readiness includes extension setup, not remote configuration, flag evaluation, or successful event delivery. An early consumer subscribes to the event; a late consumer checks the global:

```js
function onPostHogReady(client) {
    client.capture('signed_up')
}
if (window.posthog) {
    onPostHogReady(window.posthog)
} else {
    window.addEventListener('posthog:ready', (event) => onPostHogReady(event.detail), { once: true })
}
```

There is no pre-load capture queue. Concurrent tags share an in-flight installation reservation: the first valid tag wins, even if later tags specify different options. Any existing `posthog` property (including a reserved undefined property or a legacy stub) prevents installation, without initialization or a new ready event. If another installer claims the global during initialization, the unpublished client is disposed rather than overwriting it. A failed installation releases its reservation so a subsequent tag can retry. Failed optional chunks retain the factory's existing failure isolation; ready can still expose working embedded analytics. Consent and capture admission remain unchanged.

Build and validate locally after building workspace dependencies:

```sh
pnpm --filter @posthog/browser build:cdn
pnpm --filter @posthog/browser bundle-size:cdn
pnpm --filter @posthog/browser test:snippet
```

`dist-cdn/script.js`, its hashed `chunks/`, and source maps are CDN-only artifacts, outside the npm package's `dist` graph. `test:snippet` serves the exact generated scripts in plain HTML from a separate nested asset origin, and verifies real Capture V1 delivery against the checked-in SDK mock server in Chromium, Firefox, and WebKit. All browser requests are restricted to the local fixture origins. Attribution reports distinguish actual minified/compressed artifact sizes from transformed module sizes before minification.

## Autocapture

With no explicit autocapture configuration, its implementation loads when saved state or remote configuration indicates a server opt-in. Supplying an autocapture options object loads it during initialization. Code loading alone does not enable collection: it waits for the initial remote configuration outcome and a known server opt-in (or a retained opt-in after a failed refresh). Consent, bot filtering, and local privacy exclusions still apply. `autocapture: false` omits automatic inclusion; it does not disable another product's configuration or an explicitly supplied autocapture instance.

```ts
const posthog = await createPostHog({
    projectToken: '<project-token>',
    autocapture: { maskAllText: true, cssSelectorAllowlist: ['button', 'a'] },
})
```

For static inclusion without a runtime module request:

```ts
import { autocapture } from '@posthog/browser/autocapture'

const posthog = await createPostHog({
    projectToken: '<project-token>',
    extensions: [autocapture({ maskAllText: true })],
})
```

An explicit instance takes precedence over the top-level option. The manual core entrypoint never imports autocapture automatically. Both paths use the same options and shared DOM implementation:

- `urlAllowlist` / `urlIgnorelist` accept strings or regular expressions; `getCurrentUrl` supplies the URL used for matching. Ignore rules override allow rules.
- `domEventAllowlist`, `elementAllowlist`, `cssSelectorAllowlist`, `cssSelectorIgnorelist`, and `elementAttributeIgnorelist` restrict capture. A custom CSS ignorelist replaces the `.ph-no-autocapture` / `[data-ph-no-autocapture]` defaults; include them explicitly to retain those exclusions. `.ph-no-capture` remains an unconditional exclusion.
- `maskAllText` and `maskAllElementAttributes` default to false; sensitive value filtering remains active. `disableCaptureUrlHashes` defaults to true.
- `captureCopiedText` defaults to false. Enabling it captures cut/copy/paste interactions; pasted text is never included.
- `rageclick` accepts false, true, or an options object. Enabled by default, it ignores text-selection surfaces and navigation/stepper content (`next`, `previous`, `prev`, `>`, `<`, `+`, `-`, `−`, `–`). Options are `cssSelectorIgnorelist`, `contentIgnorelist`, `ignoreTextSelection`, `thresholdPx` (30), `clickCount` (3), and `timeoutMs` (1000). Explicit true uses these same defaults.

Configuration arrays and regular expressions are snapshotted before asynchronous loading; callbacks remain callable. Disposal removes all DOM listeners. Survey selector metadata follows the same consent, masking, and exclusion checks as ordinary autocapture; it does not bypass them.

## Feature flags

Flags dynamically load during `createPostHog()` by default. Initialization waits for the module and extension setup, not the network response. Use `flags: false` to omit automatic flags, or configure the extension through `flags`:

```ts
import { createPostHog, FeatureFlagsExtension } from '@posthog/browser'

const posthog = await createPostHog({
    projectToken: '<project-token>',
    flags: { evaluationContexts: ['web'], requestTimeoutMs: 3_000 },
})
const featureFlags = await posthog.resolveExtension(FeatureFlagsExtension)
const subscription = featureFlags?.onFeatureFlags((results, errorsLoading) => {
    if (!errorsLoading) console.log(results)
})
const result = featureFlags?.getFeatureFlag('new-onboarding')
if (result?.enabled) console.log(result.variant, result.payload)
subscription?.dispose()
```

`FeatureFlagsExtension` is a lightweight typed lookup token, exported from the root, core, and flags entrypoints. `resolveExtension(FeatureFlagsExtension)` resolves to undefined when flags is disabled or failed to install. The extension's `getFeatureFlag()` returns undefined until a value is available. A disabled flag returns an object with `enabled: false`. Reads emit deduplicated flag-called analytics through ordinary capture; subscriptions do not. `updateFlags(values, payloads?, { merge })` injects flag values.

Use `reloadFeatureFlags()` to request a remote evaluation and await its outcome before reading again:

```ts
if (featureFlags) {
    const outcome = await featureFlags.reloadFeatureFlags()
    if (outcome.status === 'loaded') {
        console.log(featureFlags.getFeatureFlag('new-onboarding'))
    }
}
```

The promise resolves with `loaded`, `error`, `skipped` (evaluation is disabled or unavailable), or `cancelled` (reset or disposal). It does not reject on request failures. Calls made before a request starts share that evaluation; calls during an active request wait for a follow-up evaluation. Cached values and `updateFlags()` do not complete a reload. `onFeatureFlags` remains a subscription to value changes, separate from reload completion.

For static inclusion, import the factory explicitly and pass the same configuration:

```ts
import { flags } from '@posthog/browser/flags'

const posthog = await createPostHog({
    projectToken: '<project-token>',
    extensions: [flags({ featureFlagEvaluation: false, bootstrap: { featureFlags: { preview: true } } })],
})
```

An explicit extension takes precedence over the top-level option, including `flags: false`. `featureFlagEvaluation: false` keeps local/bootstrap values without requesting remote evaluation; remote configuration remains available. Other options are `bootstrap.featureFlagPayloads`, `flagKeys`, `cacheTtlMs`, `refreshIntervalMs`, `deduplicateCallsPerSession`, and `onlyEvaluateSurveyFeatureFlags`. Refresh defaults to five minutes with idle backoff; `refreshIntervalMs: 0` disables automatic refresh. The manual `@posthog/browser/core` entrypoint supports explicit flags without referencing the automatic loader.

Flags uses the client's key-value store and configured persistence. With `storage: false`, values remain in memory. Reset clears flag state along with the client's other persisted state.

## Extension lifecycle

Creating an extension does not initialize it. Pass it in the `extensions` option to `createPostHog()` and await the returned promise before using its controls.

### Lifecycle notifications

Extensions receive the `IPostHog` client in `setup()`. It exposes installed products, asynchronous dependency resolution, and `onIdentify`, `onChangeProperties`, `onGroup`, `onGroupsReset` and `onReset` listeners. Identification uses `onIdentify`; person-property setters use `onChangeProperties` with `set`, `setOnce` and `unset` fields. Identification with properties publishes both kinds of notification. Group-only reset uses `onGroupsReset`; full identity reset uses `onReset`. These notifications fire synchronously after local state updates, independently of capture consent, and do not replay earlier operations. Listener errors are logged without stopping other listeners. Dispose subscriptions when the extension is disposed.

```ts
import type { Disposable, IPostHog } from '@posthog/browser'

let subscription: Disposable | undefined
const extension = {
    name: 'identity-observer',
    setup(client: IPostHog) {
        subscription = client.onIdentify(({ distinctId, previousDistinctId }) => {
            console.log(previousDistinctId, distinctId)
        })
    },
    dispose() {
        subscription?.dispose()
    },
}
```

## Logs

With no explicit logs configuration, logs loads from a saved console-capture hint, remote console enablement or `resolveExtension('logs')`. Supplying a logs options object loads it during initialization. Console collection starts after the implementation loads. `captureLog()` explicitly queues an OTLP log; loading the extension alone does not turn on console capture. Console capture follows remote configuration or a local `captureConsoleLogs` opt-in:

```ts
const posthog = await createPostHog({
    projectToken: '<project-token>',
    logs: { captureConsoleLogs: true, serviceName: 'storefront', flushIntervalMs: 3_000 },
})
const logger = await posthog.resolveExtension('logs')
logger?.captureLog({ body: 'Checkout completed', level: 'info', attributes: { orderId: '123' } })
await logger?.flush()
```

Use `logs: false` to disable automatic inclusion. For static inclusion without a runtime module request:

```ts
import { logs } from '@posthog/browser/logs'

const logger = logs({ serviceName: 'storefront' })
const posthog = await createPostHog({
    projectToken: '<project-token>',
    extensions: [logger],
})
logger.captureLog({ body: 'Checkout completed' })
```

An explicit logs extension takes precedence over the top-level option, including `false`. The manual core entrypoint never loads logs automatically. Both paths accept the same options: `captureConsoleLogs`, `serviceName`, `serviceVersion`, `environment`, `resourceAttributes`, `beforeSend`, `flushIntervalMs`, `maxBufferSize`, and `maxLogsPerInterval`. Defaults match the legacy browser SDK: a 3,000ms flush interval, 100-record flush trigger, and 1,000 programmatic logs per interval. Console logs have a separate bounded queue and `console` scope, without the programmatic rate cap. Console service defaults to `posthog-browser-logs`; programmatic service defaults to `unknown_service`.

Logs includes the current URL as `url.full`. Configure `logs: { urlCapture: { path: true, search: false, hash: false } }` or pass the same `urlCapture` option to `logs()` to select which URL components are retained. These are the defaults, including for omitted fields: the origin and pathname are retained, while query parameters and fragments are removed. With `path: false`, the pathname becomes `/`. Invalid URLs are omitted. Component selection does not redact sensitive values within retained components.

The logs extension's `flush()` awaits both log queues. `posthog.flush()` awaits the client's capture queue and all installed extensions' flush methods, including logs. Consent denial and reset discard queued logs; later opt-in does not revive them. Shutdown awaits normal log delivery within its timeout before cleanup. On pagehide, logs attempt best-effort Beacon delivery with keepalive Fetch fallback. Console hooks and page lifecycle listeners are removed on disposal. Logs use their own `/i/v1/logs` endpoint, JSON payload, and project-token query authentication, never the analytics queue. The existing SDK `logger` remains diagnostic output; application logs use the logs extension's `captureLog()`.

## Surveys

With no explicit surveys configuration, orchestration loads from cached definitions, remote survey enablement or `resolveExtension('surveys')`. Supplying a surveys options object loads orchestration during initialization. Its UI is a separate dynamic chunk: a successful remote configuration with surveys enabled loads it automatically; otherwise an explicit survey call can load it for manual use. Definitions come from a separate `/api/surveys/` request and are cached for five minutes. Client creation does not wait for the renderer or definitions.

```ts
const posthog = await createPostHog({
    projectToken: '<project-token>',
    surveys: { automaticDisplay: false, requestTimeoutMs: 10_000 },
})
const feedback = await posthog.resolveExtension('surveys')
feedback?.getSurveys((surveys, context) => {
    if (context?.isLoaded && surveys[0]) feedback.displaySurvey(surveys[0].id)
})
const eligibility = await feedback?.canRenderSurvey('feedback')
```

The options are `automaticDisplay` (default `true`), `requestTimeoutMs` (default `10_000`), `prefillFromUrl` (default `false`), `overrideDisplayLanguage`, `prepareStylesheet`, and `getCurrentUrl`. `getActiveMatchingSurveys(callback, forceReload?)` applies targeting; `onSurveysLoaded(callback)` returns a disposable subscription; `cancelPendingSurvey(id)` cancels pending display. Capture consent still gates rendering and responses.

Use `surveys: false` to omit automatic inclusion. An explicitly supplied instance takes precedence, including over `false`. Importing the factory below includes orchestration only; rendering, styles, and HTML sanitization still load dynamically when needed. Importing the entrypoint or constructing the extension does not access browser globals.

```ts
import { surveys } from '@posthog/browser/surveys'

const feedback = surveys({ automaticDisplay: false })
const posthog = await createPostHog({
    projectToken: '<project-token>',
    extensions: [feedback],
})
feedback.displaySurvey('feedback')
```

Await client creation before using extension controls.

The manual core entrypoint never loads surveys automatically. Extension lookup returns undefined when surveys is omitted or fails setup. Without a document, rendering is unavailable. Disposal removes renderer listeners, polling, pending displays, and rendered elements. Survey abandonment uses the client's pagehide keepalive handoff, which delivery attaches when the client is constructed.

Definitions and event activation state use the client's shared `core` key-value store. Survey interaction state—seen markers, partial answers, and abandonment markers—uses dedicated browser localStorage, independently of configured SDK persistence, including `storage: false`. Partial answers fall back to memory when localStorage writes fail; abandonment is skipped when its marker cannot be read. Client reset clears persisted extension data, runtime state, and localStorage seen markers, partial answers, and the last-seen date. Abandonment markers are retained, matching legacy survey reset behavior. Event targeting works through admitted captures; DOM-action selector targeting uses the installed autocapture extension, including the default dynamic instance. Cached definitions hydrate their triggers without requiring a refresh. Selectors registered before autocapture setup are retained; later successful definition snapshots replace the selector set, while failed refreshes retain it. Both extension orders are supported. Matching retains the shared exact-target semantics, including SVG attribution to its enclosing control. URL-constrained actions use survey targeting context when the event has no URL; this local fallback does not add URL data to the captured event.

## Capture and delivery

Capture, immediate capture, identity, reset and event-property registration are client methods, backed by the client's capture pipeline and the delivery its entrypoint selects. Feature flags initialize during startup. When their options are omitted, logs, surveys orchestration and autocapture load on existing saved-state or remote-config signals, or explicit asynchronous acquisition. Their collection and display retain their own consent and remote-configuration gates; survey rendering is a further deferred chunk.

`posthog.capture()` runs synchronously. Its `false` result is a rate-limit backpressure signal, not a general rejection signal. `true` is neither an admission nor a delivery acknowledgement: consent, lifecycle, filtering, invalid properties or queue limits can suppress an event while it still returns `true`. Use `captureImmediate()` and check its summary when persistence matters. Capture never waits for network delivery. `flush()` delivers queued work and resolves without discarding unexpired queued events when delivery is unavailable. Analytics retains at most 1,000 queued events and 8 MiB of active-plus-queued finalized analytics messages; queued work expires strictly after one hour on the next queue interaction. Queue overflow evicts the oldest queued prefix, while active bytes cannot be recalled and can cause a new event to be rejected.

Queued and immediate capture omit null or undefined object properties from delivered events, including nested objects and objects inside arrays. Array positions are preserved; null and undefined array entries are sent as JSON `null`. Events with no remaining custom properties are still delivered with their SDK metadata.

Use `captureImmediate()` only when the caller needs a terminal delivery outcome before continuing:

```ts
const summary = await posthog.captureImmediate('import_completed', { source: 'warehouse' })
if (summary.error) {
    console.warn('Immediate capture failed', summary.error)
} else if (summary.submitted !== 1 || !summary.allPersisted) {
    // Capture V1 did not confirm persistence of this event.
}
```

Immediate capture finalizes the event through the same consent, identity, session, protected-property, size, and rate-limit boundaries, then bypasses the lane and sends inline through the same Capture V1 sender. A valid `2xx` resolves to a `CaptureSummary`; `drop`, final `retry`, and missing outcomes set `allPersisted` to `false`, while `warning` counts as persisted. Terminal HTTP failures, exhausted transport retries, malformed responses, cancellation, and unavailable delivery resolve with `summary.error` and `allPersisted: false`, retaining any known partial outcomes. These failures do not reject the promise. Local non-admission resolves an empty summary, so durability-sensitive callers must check both `submitted` and `allPersisted`. Immediate requests can overtake buffered events and run concurrently with each other; they are never retained for a later `flush()`. An explicit opt-out cancels pending immediate dispatch and retries, even if the user opts in again; a cleared choice (`reset()` or `clearOptInOut()`) does not. Already-dispatched requests may finish.

`captureImmediate()` is available on both entrypoints because delivery is part of the client. The manual core captures even without supplied extensions: it sends the initial `$pageview` unless `capturePageview: false`, and an installed flags extension sends `$feature_flag_called` the first time each flag value is read.

Capture V1 delivery sends FIFO batches of at most 100 events and partitions large backlogs by exact uncompressed envelope size. `flushAt` defaults to 20 and triggers delivery by queued count; `flushInterval` defaults to 3,000 milliseconds and triggers delivery by age. Set `flushInterval: 0` to disable timer delivery. Explicit `flush()`, shutdown, and `capture(event, properties, { delivery: 'immediate' })` bypass both thresholds. A `delivery: 'immediate'` capture stays in the lane with normal retries and unload handoff, and starts a drain now that sends queued events with it. Prefer it over `capture()` followed by `flush()` when the event must not wait behind a full offline backlog or, with `flushInterval: 0`, behind a failed older batch: if an older batch exhausts its retries before the event is attempted, the lane makes one more drain instead of waiting for another trigger. `{ delivery: 'unload' }` sends the event through best-effort keepalive Fetch and does not confirm persistence. Retry-exhausted transient failures remain in the bounded lane for a later interval, reconnect, `delivery: 'immediate'` capture, or explicit flush rather than hot-looping or being discarded.

`posthog.setConfig({ debug, analytics: { personProfiles } })` changes only these options on a running client; other options are fixed at creation. `posthog.debug()` and `posthog.debug(false)` toggle diagnostic logs at runtime and are not persisted across page loads.

Both factories start one JSON remote-config request during initialization, without waiting for it before capture or factory completion. `remoteConfig` supplies an inline result instead of making a request. The default loader uses Fetch and `GET /array/{projectToken}/config`. Recognized PostHog US/EU hosts resolve to the corresponding assets host; custom hosts retain their configured base, including path prefixes. Loading is independent of capture consent. `fetch: false` disables built-in loading. Failure or the default 10-second `remoteConfigTimeoutMs` publishes `{ ok: false }` once, with no automatic retry; shutdown cancels the wait and suppresses late publication.

When remote configuration advertises gzip, eligible normal batches use native `CompressionStream`; delivery remains uncompressed while configuration is unresolved or compression is unavailable, invalid, stalled, or larger than the JSON body. While offline, finalized events remain admitted and avoid network attempts until an `online` notification. On `pagehide`, or `unload` where `pagehide` is unavailable, queued analytics receive one synchronous uncompressed handoff through headered keepalive Fetch under one conservative aggregate body budget. Beacon remains disabled until Capture V1 supports the required metadata without request headers.

One initial `$pageview` is admitted through the same queue after configured extensions install. Set `capturePageview: false` to disable it. Events captured after a `$pageview` in the same session carry its UUID as `$pageview_id`, and `posthog.getPageViewId()` returns it. Navigation tracking, URL/title enrichment, and page-leave capture remain optional product behavior.

Consent is stored separately from identity under `__ph_opt_in_out_<project-token>`. Use `consentPersistenceName` to supply a shared key verbatim. The client reads established `1`/`true`/`yes` and `0`/`false`/`no` values, including raw boolean and numeric compatibility values, and writes `1` or `0`. Configured extensions still initialize under prior denial. Identity, key-value persistence, and remote configuration remain available, while analytics capture and request transmission are consent-gated.

`posthog.getExplicitConsentStatus()` returns `'granted'`, `'denied'`, or `'pending'` when the user has not chosen, independently of `optOutByDefault`. `posthog.clearOptInOut()` forgets the stored choice and returns consent to the configured default. `reset()` also forgets the stored choice, as posthog-js does: a user who opted out is captured again after a logout reset unless the app calls `optOut()` again, and with `optOutByDefault` capture stops after `reset()` until the app calls `optIn()` again. Neither call discards analytics events captured before it, in this or another tab; they are still delivered.

Session and window IDs are created on the first successfully admitted capture. Rejected work does not create or advance them. Idle timeout, maximum length, and reset rotate both IDs. Same-origin tabs share the active session while retaining distinct window IDs; ordinary reloads preserve the window ID and copied tab storage receives a new one. Session rotation is activity-driven and starts no core timer. Session and window IDs are UUIDv7, as in posthog-js. `posthog.onSessionId(({ sessionId, windowId }) => …)` reports the current session without creating one, then every change; dispose the returned subscription to stop.

`reset()` starts a new anonymous identity and session and keeps the device ID. Pass `reset(true)` or `reset({ resetDeviceId: true })` to also replace the device ID, and `reset({ bootstrap: { distinctId, isIdentifiedId, sessionId } })` to seed the new identity and next session. The setup `bootstrap` option accepts the same values, though a stored identity takes precedence; use `bootstrap.sessionId` to continue a UUIDv7 session ID passed from another domain.

Identity and session state live in the configured storage only. To share them across subdomains, and with posthog-js through its `ph_<project-token>_posthog` cookie, pass `cookie: cookiePersistence()` from `@posthog/browser/persistence/cookie`. The cookie is opt-in, uses `SameSite=Lax`, is `Secure` on HTTPS pages, and accepts `crossSubdomain`, `secure`, `expirationDays`, and `name` options. Consent stays in the configured storage.

A compact in-memory token bucket admits 10 events per second with a burst of 100 and emits a bypassed aggregate ingestion warning when a runaway loop first reaches the limit. `shutdown(timeoutMs)` stops new work, makes one bounded normal flush attempt, removes timers and lifecycle listeners, and is idempotent. `dispose()` uses the same shutdown path.

See [Bundle architecture](./ARCHITECTURE.md) for package boundaries, tree-shaking rules, and bundle review.
