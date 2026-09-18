# @posthog/browser

An experimental PostHog client for modern browsers.

The client installs one analytics extension with a bounded in-memory buffer during initialization. By default, the first successfully admitted event lazily loads its queue scheduling and Capture Analytics V1 delivery machinery. Consent-denied, bot-filtered, and rejected events do not load delivery.

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

Both factories start one JSON remote-config request during initialization, without waiting for it before capture or factory completion. `remoteConfig` supplies an inline result instead of making a request. The default loader uses Fetch and `GET /array/{projectToken}/config` on `apiHost`. Loading is independent of capture consent. `fetch: false` disables built-in loading. Failure or the default 10-second `remoteConfigTimeoutMs` publishes `{ ok: false }` once, with no automatic retry; shutdown cancels the wait and suppresses late publication.

When remote configuration advertises gzip, eligible normal batches use native `CompressionStream`; delivery remains uncompressed while configuration is unresolved or compression is unavailable, invalid, stalled, or larger than the JSON body. While offline, finalized events remain admitted and avoid network attempts until an `online` notification. On `pagehide`, or `unload` where `pagehide` is unavailable, queued analytics receive one synchronous uncompressed handoff through headered keepalive Fetch under one conservative aggregate body budget. Beacon remains disabled until Capture V1 supports the required metadata without request headers.

One initial `$pageview` is admitted through the same queue after configured extensions install. Set `capturePageview: false` to disable it. Navigation tracking, URL/title enrichment, and page-leave capture remain optional product behavior.

Consent is stored separately from identity under `__ph_opt_in_out_<project-token>`. Use `consentPersistenceName` to supply a shared key verbatim. The client reads established `1`/`true`/`yes` and `0`/`false`/`no` values, including raw boolean and numeric compatibility values, and writes `1` or `0`. Configured extensions still initialize under prior denial. Identity, key-value persistence, and remote configuration remain available, while analytics capture and request transmission are consent-gated.

Session and window IDs are created on the first successfully admitted capture. Rejected work does not create or advance them. Idle timeout, maximum length, and reset rotate both IDs. Same-origin tabs share the active session while retaining distinct window IDs; ordinary reloads preserve the window ID and copied tab storage receives a new one. Session rotation is activity-driven and starts no core timer.

A compact in-memory token bucket admits 10 events per second with a burst of 100 and emits a bypassed aggregate ingestion warning when a runaway loop first reaches the limit. `shutdown(timeoutMs)` stops new work, makes one bounded normal flush attempt, removes timers and lifecycle listeners, and is idempotent. `dispose()` uses the same shutdown path.

This package is private while the API and capture behavior remain experimental.

See [Bundle architecture](./ARCHITECTURE.md) for package boundaries, tree-shaking rules, and bundle review.
