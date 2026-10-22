# @posthog/browser

An experimental PostHog client for modern browsers.

The client installs one analytics extension with a bounded in-memory buffer during initialization. By default, the first successfully admitted event lazily loads its queue scheduling and Capture Analytics V1 delivery machinery. Consent-denied, bot-filtered, and rejected events do not load delivery. Feature flags, logs, surveys orchestration, and autocapture dynamically load during initialization by default; their capture and display behavior retains its own consent and remote-configuration gates. Survey rendering is a further deferred chunk.

```ts
import { createPostHog } from '@posthog/browser'

const posthog = await createPostHog({ projectToken: '<project-token>' })
posthog.capture('signed_up')
await posthog.flush()
```

Configure automatic scheduling or load delivery while the client initializes:

```ts
const posthog = await createPostHog({
    projectToken: '<project-token>',
    analytics: { load: 'eager', flushAt: 20, flushInterval: 3_000 },
})
```

Importing `@posthog/browser/analytics` statically includes both buffering and delivery. Supplying its extension selects that instance and its constructor options instead of automatic delivery loading:

```ts
import { analytics } from '@posthog/browser/analytics'

const posthog = await createPostHog({
    projectToken: '<project-token>',
    extensions: [analytics({ flushAt: 5, flushInterval: 0 })],
})
```

Use `analytics: false` to keep the default entrypoint buffer-only, or import `createPostHog` from `@posthog/browser/core` for a graph with no delivery dynamic-import reference. Both modes retain the analytics extension and its buffer. `getExtension('analytics')` returns the same instance before and after delivery loads; its presence alone does not indicate that delivery is available. Analytics initializes before other configured extensions so they can capture during setup. Other extensions retain their configured order.

## Autocapture

Autocapture loads dynamically during initialization by default. Code loading alone does not enable collection: it waits for the initial remote configuration outcome and a known server opt-in (or a retained opt-in after a failed refresh). Consent, bot filtering, and local privacy exclusions still apply. `autocapture: false` omits automatic inclusion; it does not disable another product's configuration or an explicitly supplied autocapture instance.

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
const featureFlags = posthog.getExtension(FeatureFlagsExtension)
const subscription = featureFlags?.onFeatureFlags((results, errorsLoading) => {
    if (!errorsLoading) console.log(results)
})
const result = featureFlags?.getFeatureFlag('new-onboarding')
if (result?.enabled) console.log(result.variant, result.payload)
subscription?.dispose()
```

`FeatureFlagsExtension` is a lightweight typed lookup token, exported from the root, core, and flags entrypoints. `getExtension(FeatureFlagsExtension)` returns undefined when flags is disabled or failed to install. The extension's `getFeatureFlag()` returns undefined until a value is available. A disabled flag returns an object with `enabled: false`. Reads emit deduplicated flag-called analytics through ordinary capture; subscriptions do not. `updateFlags(values, payloads?, { merge })` injects flag values.

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

Browser-next supplies a `BrowserClient` to extension setup. It extends the shared client with `onIdentify`, `onGroup`, and `onReset` listeners. These fire synchronously after local state updates, independently of capture consent, and do not replay earlier operations. Listener errors are logged without stopping other listeners. Dispose subscriptions when the extension is disposed.

```ts
import type { BrowserClient, Disposable } from '@posthog/browser'

let subscription: Disposable | undefined
const extension = {
    name: 'identity-observer',
    setup(client: BrowserClient) {
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

Logs dynamically load during initialization by default, separately from analytics. `captureLog()` explicitly queues an OTLP log; loading the extension alone does not turn on console capture. Console capture follows remote configuration or a local `captureConsoleLogs` opt-in:

```ts
import type { LogsExtension } from '@posthog/browser/logs'

const posthog = await createPostHog({
    projectToken: '<project-token>',
    logs: { captureConsoleLogs: true, serviceName: 'storefront', flushIntervalMs: 3_000 },
})
const logger = posthog.getExtension<LogsExtension>('logs')!
logger.captureLog({ body: 'Checkout completed', level: 'info', attributes: { orderId: '123' } })
await logger.flush()
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

The logs extension's `flush()` awaits both log queues. `posthog.flush()` awaits all installed extensions' flush methods, including analytics and logs. Consent denial and reset discard queued logs; later opt-in does not revive them. Shutdown awaits normal log delivery within its timeout before cleanup. On pagehide, logs attempt best-effort Beacon delivery with keepalive Fetch fallback. Console hooks and page lifecycle listeners are removed on disposal. Logs use their own `/i/v1/logs` endpoint, JSON payload, and project-token query authentication, never the analytics queue. The existing SDK `logger` remains diagnostic output; application logs use the logs extension's `captureLog()`.

## Surveys

Surveys orchestration loads dynamically during initialization by default. Its UI is a separate dynamic chunk: a successful remote configuration with surveys enabled loads it automatically; otherwise an explicit survey call can load it for manual use. Definitions come from a separate `/api/surveys/` request and are cached for five minutes. Client creation does not wait for the renderer or definitions.

```ts
import type { SurveysExtension } from '@posthog/browser/surveys'

const posthog = await createPostHog({
    projectToken: '<project-token>',
    surveys: { automaticDisplay: false, requestTimeoutMs: 10_000 },
})
const feedback = posthog.getExtension<SurveysExtension>('surveys')
feedback?.getSurveys((surveys, context) => {
    if (context?.isLoaded && surveys[0]) feedback.displaySurvey(surveys[0].id)
})
const eligibility = await feedback?.canRenderSurvey('feedback')
```

The options are `automaticDisplay` (default `true`), `requestTimeoutMs` (default `10_000`), `prefillFromUrl` (default `false`), `overrideDisplayLanguage`, `prepareStylesheet`, and `getCurrentUrl`. `getActiveMatchingSurveys(callback, forceReload?)` applies targeting; `onSurveysLoaded(callback)` returns a disposable subscription; `cancelPendingSurvey(id)` cancels pending display. Capture consent still gates rendering and responses.

Use `surveys: false` to omit automatic inclusion. An explicitly supplied instance takes precedence, including over `false`. To include orchestration, rendering, and styles statically without runtime module loading:

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

The manual core entrypoint never loads surveys automatically. Extension lookup returns undefined when surveys is omitted or fails setup. Without a document, rendering is unavailable. Disposal removes renderer listeners, polling, pending displays, and rendered elements. Survey abandonment uses analytics' existing pagehide keepalive handoff when delivery is initialized; an analytics module still loading during pagehide cannot send it.

Definitions and event activation state use the host-provided surveys KV namespace in the core persistence record. Survey interaction state—seen markers, partial answers, and abandonment markers—uses dedicated browser localStorage, independently of configured SDK persistence, including `storage: false`. Partial answers fall back to memory when localStorage writes fail; abandonment is skipped when its marker cannot be read. Client reset clears persisted extension data, runtime state, and localStorage seen markers, partial answers, and the last-seen date. Abandonment markers are retained, matching legacy survey reset behavior. Event targeting works through admitted captures; DOM-action selector targeting uses the installed autocapture extension, including the default dynamic instance. Cached definitions hydrate their triggers without requiring a refresh. Selectors registered before autocapture setup are retained; later successful definition snapshots replace the selector set, while failed refreshes retain it. Both extension orders are supported. Matching retains the shared exact-target semantics, including SVG attribution to its enclosing control. URL-constrained actions use survey targeting context when the event has no URL; this local fallback does not add URL data to the captured event.

## Capture and delivery

`capture()` admits an event to the queue synchronously and does not wait for code or network delivery. With pending queued work, `flush()` joins an in-progress delivery load and can retry failed automatic loading; without available delivery it resolves without discarding unexpired queued events. Analytics retains at most 1,000 queued events and 8 MiB of active-plus-queued finalized analytics messages; queued work expires strictly after one hour on the next queue interaction. Queue overflow evicts the oldest queued prefix, while active bytes cannot be recalled and can cause a new event to be rejected.

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

Immediate capture finalizes the event through the same consent, identity, session, protected-property, size, and rate-limit boundaries, then bypasses the lane and sends inline through the same Capture V1 sender. A valid `2xx` resolves to a `CaptureSummary`; `drop`, final `retry`, and missing outcomes set `allPersisted` to `false`, while `warning` counts as persisted. Terminal HTTP failures, exhausted transport retries, malformed responses, cancellation, and unavailable delivery resolve with `summary.error` and `allPersisted: false`, retaining any known partial outcomes. These failures do not reject the promise. Local non-admission resolves an empty summary, so durability-sensitive callers must check both `submitted` and `allPersisted`. Immediate requests can overtake buffered events and run concurrently with each other; they are never retained for a later `flush()`. An observed consent denial permanently cancels pending immediate dispatch and retries, even if the user opts in again; already-dispatched requests may finish.

The default entrypoint loads delivery on the first admitted immediate call. The core entrypoint supports immediate capture only when `analytics()` was explicitly installed through `extensions`; otherwise it resolves with an unavailable-delivery error without adding a delivery import to the core graph.

The analytics extension sends FIFO Capture V1 batches of at most 100 events and partitions large backlogs by exact uncompressed envelope size. `flushAt` defaults to 20 and triggers delivery by queued count; `flushInterval` defaults to 3,000 milliseconds and triggers delivery by age. Set `flushInterval: 0` to disable timer delivery. Explicit `flush()` and shutdown bypass both thresholds. Retry-exhausted transient failures remain in the bounded lane for a later interval, reconnect, or explicit flush rather than hot-looping or being discarded.

Both factories start one JSON remote-config request during initialization, without waiting for it before capture or factory completion. `remoteConfig` supplies an inline result instead of making a request. The default loader uses Fetch and `GET /array/{projectToken}/config`. Recognized PostHog US/EU hosts resolve to the corresponding assets host; custom hosts retain their configured base, including path prefixes. Loading is independent of capture consent. `fetch: false` disables built-in loading. Failure or the default 10-second `remoteConfigTimeoutMs` publishes `{ ok: false }` once, with no automatic retry; shutdown cancels the wait and suppresses late publication.

When remote configuration advertises gzip, eligible normal batches use native `CompressionStream`; delivery remains uncompressed while configuration is unresolved or compression is unavailable, invalid, stalled, or larger than the JSON body. While offline, finalized events remain admitted and avoid network attempts until an `online` notification. On `pagehide`, or `unload` where `pagehide` is unavailable, queued analytics receive one synchronous uncompressed handoff through headered keepalive Fetch under one conservative aggregate body budget. Beacon remains disabled until Capture V1 supports the required metadata without request headers.

One initial `$pageview` is admitted through the same queue after configured extensions install. Set `capturePageview: false` to disable it. Navigation tracking, URL/title enrichment, and page-leave capture remain optional product behavior.

Consent is stored separately from identity under `__ph_opt_in_out_<project-token>`. Use `consentPersistenceName` to supply a shared key verbatim. The client reads established `1`/`true`/`yes` and `0`/`false`/`no` values, including raw boolean and numeric compatibility values, and writes `1` or `0`. Configured extensions still initialize under prior denial. Identity, key-value persistence, and remote configuration remain available, while analytics capture and request transmission are consent-gated.

Session and window IDs are created on the first successfully admitted capture. Rejected work does not create or advance them. Idle timeout, maximum length, and reset rotate both IDs. Same-origin tabs share the active session while retaining distinct window IDs; ordinary reloads preserve the window ID and copied tab storage receives a new one. Session rotation is activity-driven and starts no core timer.

A compact in-memory token bucket admits 10 events per second with a burst of 100 and emits a bypassed aggregate ingestion warning when a runaway loop first reaches the limit. `shutdown(timeoutMs)` stops new work, makes one bounded normal flush attempt, removes timers and lifecycle listeners, and is idempotent. `dispose()` uses the same shutdown path.

This package is private while the API and capture behavior remain experimental.

See [Bundle architecture](./ARCHITECTURE.md) for package boundaries, tree-shaking rules, and bundle review.
