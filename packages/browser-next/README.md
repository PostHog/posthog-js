# @posthog/browser

An experimental PostHog client for modern browsers.

The package root contains the capture host and a bounded in-memory analytics queue. By default, the first successfully admitted event loads first-party Capture Analytics V1 delivery through a literal dynamic import. Consent-denied, bot-filtered, and rejected events do not load it.

```ts
import { createPostHog } from '@posthog/browser'

const posthog = await createPostHog({ projectToken: '<project-token>' })
posthog.capture('signed_up')
await posthog.flush()
```

Configure automatic scheduling or load analytics while the client initializes:

```ts
const posthog = await createPostHog({
    projectToken: '<project-token>',
    analytics: { load: 'eager', flushAt: 20, flushInterval: 3_000 },
})
```

A preinstalled analytics extension satisfies delivery without triggering a duplicate automatic load, and its constructor options apply:

```ts
import { analytics } from '@posthog/browser/analytics'

const posthog = await createPostHog({
    projectToken: '<project-token>',
    extensions: [analytics({ flushAt: 5, flushInterval: 0 })],
})
```

Use `analytics: false` to keep the default entrypoint buffer-only, or import `createPostHog` from `@posthog/browser/core` for a graph with no analytics dynamic-import reference. Client-owned extensions are supplied through `extensions` when the client is created.

`capture()` admits an event to the queue synchronously and does not wait for code or network delivery. `flush()` waits for an in-progress automatic load and retries a failed first load once when explicitly asked to flush; without available delivery it resolves without discarding unexpired queued events. Core admission retains at most 1,000 queued events and 8 MiB of active-plus-queued finalized analytics messages; queued work expires strictly after one hour on the next queue interaction. Queue overflow evicts the oldest queued prefix, while active bytes cannot be recalled and can cause a new event to be rejected.

The analytics extension sends FIFO Capture V1 batches of at most 100 events and partitions large backlogs by exact uncompressed envelope size. `flushAt` defaults to 20 and triggers delivery by queued count; `flushInterval` defaults to 3,000 milliseconds and triggers delivery by age. Set `flushInterval: 0` to disable timer delivery. Explicit `flush()` and shutdown bypass both thresholds. Retry-exhausted transient failures remain in the bounded lane for a later interval, reconnect, or explicit flush rather than hot-looping or being discarded.

When remote configuration advertises gzip, eligible normal batches use native `CompressionStream`; delivery remains uncompressed while configuration is unresolved or compression is unavailable, invalid, stalled, or larger than the JSON body. While offline, finalized events remain admitted and avoid network attempts until an `online` notification. On `pagehide`, or `unload` where `pagehide` is unavailable, queued analytics receive one synchronous uncompressed handoff through headered keepalive Fetch under one conservative aggregate body budget. Beacon remains disabled until Capture V1 supports the required metadata without request headers.

One initial `$pageview` is admitted through the same queue after configured extensions install. Set `capturePageview: false` to disable it. Navigation tracking, URL/title enrichment, and page-leave capture remain optional product behavior.

Consent is stored separately from identity under `__ph_opt_in_out_<project-token>`. Use `consentPersistenceName` to supply a shared key verbatim. The client reads established `1`/`true`/`yes` and `0`/`false`/`no` values, including raw boolean and numeric compatibility values, and writes `1` or `0`. Configured extensions still initialize under prior denial. Identity, key-value persistence, and remote configuration remain available, while analytics capture and request transmission are consent-gated.

Session and window IDs are created on the first successfully admitted capture. Rejected work does not create or advance them. Idle timeout, maximum length, and reset rotate both IDs. Same-origin tabs share the active session while retaining distinct window IDs; ordinary reloads preserve the window ID and copied tab storage receives a new one. Session rotation is activity-driven and starts no core timer.

A compact in-memory token bucket admits 10 events per second with a burst of 100 and emits a bypassed aggregate ingestion warning when a runaway loop first reaches the limit. `shutdown(timeoutMs)` stops new work, makes one bounded normal flush attempt, removes timers and lifecycle listeners, and is idempotent. `dispose()` uses the same shutdown path.

This package is private while the API and capture behavior remain experimental.

See [Bundle architecture](./ARCHITECTURE.md) for package boundaries, tree-shaking rules, and bundle review.
