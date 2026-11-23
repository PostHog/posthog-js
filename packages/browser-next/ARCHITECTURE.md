# `@posthog/browser` bundle architecture

## 1. Purpose

This document defines the bundle architecture for `@posthog/browser`.

The goal is a behavior-complete core in the smallest practical bundle. Core behavior is a fixed constraint. Bundle size is the optimization objective.

The root package must provide a useful capture host. It must preserve required capture admission, consent, identity, session, cross-context, no-throw, and extension-isolation behavior. The client owns capture admission and a bounded buffer; the root and `/core` deliver through Capture V1 with retries. Feature flags initialize by default. Logs, surveys orchestration and autocapture load from explicit configuration, saved-state or remote-configuration signals, or explicit resolution. The `@posthog/browser/core` entrypoint omits automatic product dynamic-import references for deliberate manual composition. Do not reduce bundle size by removing an invariant. Reimplement the invariant with a smaller mechanism or move only the policy that can safely begin after admission.

Optional feature implementations must stay outside the initial root graph. Each public optional feature must remain in a removable chunk or explicit entrypoint, and the core entrypoint must not reference it. Application bundlers must be able to remove each unused module.

These rules apply to source files, package exports, dependencies, build output, and tests. Use the Capture Analytics V1 harness for exact analytics wire behavior.

## 2. Terms

This document uses these terms:

- **Core**: The minimum code for a useful capture client.
- **Root entry point**: The `@posthog/browser` export.
- **Root graph**: Runtime modules statically reachable from the root entry point before a dynamic-import boundary.
- **Optional feature**: Behavior that is not necessary for basic capture.
- **Import side effect**: Work that starts when JavaScript evaluates a module.
- **Initial chunk**: JavaScript that an application loads before optional dynamic imports.
- **Tree-shakable**: Removable by a bundler when no used export needs the code.

The words **must** and **must not** identify requirements.
The word **should** identifies a strong recommendation.

## 3. Main design rules

1. Preserve required core behavior.
2. Keep the compliant root graph small.
3. Keep every module free of import side effects.
4. Put optional features behind import boundaries.
5. Use explicit exports and exact runtime imports.
6. Preserve ES module boundaries in the published output.
7. Measure bundles from a package consumer.
8. Reject optional implementations when they enter the initial root graph.

An API boundary is also a size boundary. A runtime option is not a size boundary.
A minifier cannot correct a bad package boundary. An automatic dynamic import does not make required behavior optional.

## 4. Package layers

Source files are grouped by responsibility:

| Directory                            | Responsibility                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `src/composition/npm/`               | Default and manual SDK compositions and product selection                                |
| `src/composition/script/`            | Self-initializing classic-script composition                                             |
| `src/core/`                          | Client lifecycle, shared contracts, the KV store, extension registry and state authority |
| `src/products/`                      | Product factories, operations and implementations                                        |
| `src/products/analytics/admission/`  | Analytics event construction, buffering and admission                                    |
| `src/products/analytics/properties/` | Registered context and person-processing policy                                          |
| `src/products/analytics/delivery/`   | Capture V1 encoding, scheduling, transport and retries                                   |
| `src/platform/`                      | Browser request and console mechanisms                                                   |
| `src/primitives/`                    | Independent identifiers, immutable snapshots, errors, UTF-8 and version utilities        |

Product factories remain with their products. Supported package import paths are defined by the `exports` map, independently of the internal source and emitted-file layout.

Use these layers:

```text
standard preset, optional features, compatibility modules
                          ↓ can import
                   core capture host
                          ↓ can import
               small runtime primitives
                          ↓ can import
                  contracts and types
```

A module can import its own layer or a lower layer.
A module must not import a higher layer.

### 4.1 Contracts and types

This layer defines TypeScript contracts. It must contain no runtime work.

Use `import type` and `export type` for this layer.
A type import must not become a JavaScript import.

Use the shared `Client` and `Extension` contracts from `@posthog/browser-common`.
Do not create a second extension contract.

### 4.2 Small runtime primitives

This layer contains small and general functions. Each function must have one clear purpose.

A primitive must not import a product feature. A primitive must not create a global singleton.
A primitive must not read browser state during module evaluation.

### 4.3 Core capture host

The core must contain all behavior that correct basic capture always needs, and no optional product implementation.

The core contains these responsibilities:

- Consent and privacy enforcement.
- Compact bot filtering.
- Device, anonymous, and identified state.
- Session, window, and cross-context correctness.
- Conflict-safe persistence and session-admission authority.
- The shared `Client` contract, implemented by the client itself and handed to every extension.
- Capture admission, identity operations, registered properties and one initial `$pageview`, without waiting for remote configuration.
- A small control-plane Fetch path for immediate remote configuration and extension requests.
- Consent and lifecycle authority for analytics dispatch.
- Extension lifecycle and isolation.
- No-throw boundaries for customer-controlled and browser operations.

Keep the capture pipeline fixed and direct. Use compact explicit state machines. Do not add a generic middleware framework or a general dependency-injection framework.

The root `createPostHog` composition wrapper snapshots product options, keeps supplied instances, and injects literal dynamic product loaders and the Capture V1 delivery factory into `createPostHogCore`. The manual core entrypoint installs only supplied extensions and has no automatic product imports. Product properties are synchronous ready-only lookups; `resolveExtension()` starts an eligible loader, shares concurrent acquisition and waits for setup.

The client implements the shared `Client` contract and passes itself to every extension's `setup()`. It owns capture finalization, admission, rate limiting, immediate delivery, identity operations, registered properties and dynamic event-property producers through an internal capture pipeline; an explicit opt-out purges its queued work. There is no per-extension adapter or scoped view. Extensions share the client's key-value store, as posthog-js extensions share its persistence, and the client's logger. Extension names and their `bindings` share one lookup namespace for `getExtension()`; the registered extension remains the sole lifecycle owner.

The capture pipeline owns one `EventBuffer` for its lifetime. The delivery factory supplied to the client attaches to that buffer during construction: `analytics-delivery.ts` creates the `Lane` driver with scheduling, finite flush barriers, transport and retries. Group and person client methods delegate to `products/analytics/groups.ts` and `person.ts`, which use the pipeline's package-internal methods.

Consent uses `__ph_opt_in_out_<project-token>` by default and accepts a verbatim `consentPersistenceName` override. Store interoperable `0`/`1` values and accept trimmed, case-insensitive `1`/`true`/`yes` and `0`/`false`/`no` forms, including raw boolean and numeric values from compatibility adapters. Keep this logical key independent of identity persistence and consistent across consent storage adapters. Default local storage uses native `storage` events plus a same-document SDK event; adapters can provide an optional keyed subscription for prompt external revocation. All listeners start during client initialization and stop during disposal. Deprecated prefix-derived keys and migration between storage backends belong in a compatibility entry point.

Consent is prospective point-in-time analytics authority, not a global client lifecycle lock or a transaction spanning an operation. Extension setup, registration, lookup, subscriptions, and cleanup always run. Check consent once when capture begins and immediately before each new analytics transport attempt or retry. An operation or request authorized at its boundary may finish after consent changes; except for pending immediate dispatch and retries described below, do not invalidate it using a historical consent generation. Denial purges work already queued at that transition and prevents new capture and analytics dispatch. A denial that comes from a cleared choice (`reset()` or `clearOptInOut()`, in this or another context) is the exception: it prevents new capture but keeps work admitted before it deliverable, including pending immediate dispatch, because reset affects future events only; only an explicit `0` choice purges. A later explicit opt-out in the same client purges that kept work, including pending immediate dispatch. An explicit opt-out observed from another context does not purge it, because consent is already denied and no transition occurs; dispatch pauses while that explicit choice stands. A later opt-in redrives the kept work. A later cleared choice makes it deliverable again but sends no signal, so it goes out at the next flush, reconnect or page hide (captures are rejected while consent rests at the default denial). This matches `posthog-js` and sdk-specs `opt-in/spec.md`, which never discard data accepted while opted in. Every admission path, including `groupIdentify()` and `alias()`, checks `canCapture`, so keeping dispatch open for admitted work never admits new work. Match `posthog-js` by retaining identity, group, session, and device state across capture denial; persistence restrictions are a separate policy. Client shutdown remains an independent terminal boundary.

Apply those boundaries method by method:

| Surface                                      | Consent and lifecycle boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity, group, device, and session getters | Prepare and return retained state without reinterpreting it from consent. `BrowserState` separately owns fresh compatible-consent observation.                                                                                                                                                                                                                                                                                                                                 |
| `capture()`                                  | Check once before evaluating caller properties. The synchronous capture operation then runs to completion; delivery applies its own dispatch-time gate.                                                                                                                                                                                                                                                                                                                        |
| `identify()` and `group()`                   | Valid calls update and persist state regardless of capture consent, matching `posthog-js`. Their generated analytics events pass through ordinary `capture()` admission.                                                                                                                                                                                                                                                                                                       |
| `reset()`                                    | Treat reset as cleanup, not an operation that a consent transition can invalidate. Lifecycle still prevents mutation after disposal.                                                                                                                                                                                                                                                                                                                                           |
| `sendRequest()`                              | Check immediately before each actual transport dispatch. Flag evaluation (`/flags/` on the flags host), the early-access listing GET, and conversations widget requests (`/api/conversations/`) are sent while opted out, as in `posthog-js`; the flags and conversations exemptions match the resolved request path, and a blocked client still refuses them. Do not prepare analytics identity state and do not reinterpret an already-started result after consent changes. |
| Remote configuration                         | Consent does not gate control-plane loading, caching, subscriptions, or publication. Lifecycle prevents new work after shutdown.                                                                                                                                                                                                                                                                                                                                               |
| Initial `$pageview`                          | Rely on ordinary `capture()` admission. Do not duplicate consent checks around DOM access or listener setup.                                                                                                                                                                                                                                                                                                                                                                   |
| Extension KV                                 | Reads and writes are independent of capture consent, matching `posthog-js`. Lifecycle and state readiness still apply; any future durable-storage restriction belongs to a separate persistence policy.                                                                                                                                                                                                                                                                        |
| Analytics initialization and delivery        | Analytics and its delivery initialize independently of consent. An explicit opt-out purges queued analytics and blocks dispatch; a cleared choice keeps dispatch open only for work admitted before it.                                                                                                                                                                                                                                                                        |

No general `canContinue` or `canUseState` predicate should coordinate these surfaces. State preparation belongs only to operations that consume persisted analytics state; requests, remote configuration, pageview listener setup, and delivery retries must not initialize identity state as a side effect of authorization.

Create session and window IDs lazily on the first successfully admitted capture. Preview session context while finalizing an event, but do not expose, persist, or install tab lifecycle state until bounded admission succeeds; rejected work must not create, rotate, or advance session state. Match `posthog-js` analytics semantics by rotating both IDs after reset, idle timeout, or maximum session length, and by adopting a sibling tab's active session while retaining the receiving tab's current window ID. Persist monotonic session revisions and explicit reset tombstones so sequential stale identity, group, or extension-data writes preserve the newest session authority; revalidate authority around admission commit, and discard stale finalized work rather than overwrite a newer session or reset. Missing or malformed optional session data is not a reset. With default storage, preserve ordinary reload windows and separate copied tab storage through tab-scoped storage; lifecycle cleanup and a no-throw navigation-type fallback cover browser reload differences. Core must not run a background timer solely to rotate sessions. Replay owns proactive recorder shutdown, interaction state, snapshot buffering, and recording-age limits; session rotation or notification alone must not start or flush a product. The alpha still documents perfectly simultaneous equal-revision whole-record writers after the final authoritative read as last-writer-wins.

The analytics delivery capability must use Capture Analytics V1 at `POST /i/v1/analytics/events`. It must not use the legacy `/e/` envelope. Normal analytics delivery must use Fetch so it can send required headers, observe the UUID-keyed result map, time out, rate limit, and retry only server-marked retry events. It receives the core's bound Fetch capability but owns analytics-specific batching, authentication, compression, response, retry, and teardown policy. The `analytics` option's `flushAt` and `flushInterval` configure count and timer triggers with defaults of 20 events and 3,000 milliseconds; `flushInterval: 0` disables the timer, while explicit flush, shutdown, and `capture()` with `delivery: 'immediate'` bypass both thresholds. A `delivery: 'immediate'` capture keeps its event in the lane and forces a drain through it; if an earlier batch exhausts its retries before that event is attempted, the lane forces one more drain after the retained batch's retry cooldown. `delivery: 'unload'` bypasses the lane through best-effort keepalive delivery. It selects at most 100 FIFO events at a time, serializes transformed events once, and greedily partitions exact uncompressed V1 envelopes at a package-private soft 5 MiB target. A larger admitted event is sent alone, and `413` remains terminal rather than triggering response-driven splitting. Remote configuration uses the small core control-plane request path and must not wait for analytics delivery to load.

When remote configuration advertises `gzip-js`, analytics compresses exact request envelopes of at least 1 KiB through native `CompressionStream('gzip')`. It sends gzip only when the result is smaller and has a valid header, CRC, and input-size trailer. Missing, hostile, malformed, stalled, or expanding compression falls back to the unchanged JSON body without consuming a delivery attempt. Delivery proceeds uncompressed while remote configuration is unresolved, so the initial pageview and queued work do not wait for negotiation. These thresholds are measured browser policy, not Capture V1 server limits.

Analytics exposes a stable typed admission capability and owns its buffer; the client attaches delivery to it in the constructor. The buffer retains at most 1,000 queued events and 8 MiB across active and queued UTF-8 serialized finalized messages. An individual finalized core message has the same 8 MiB local limit. Queue pressure evicts the oldest queued prefix when enough queued work is reclaimable; active work cannot be recalled, so active bytes can reject a new event without evicting valid queued work. Queue residence expires strictly after one hour at the next admission, installation, drain, flush, or retry handoff; expiry uses monotonic local admission time and starts no expiry timer. Retry-exhausted transient messages remain byte- and count-accounted at their original FIFO position, become ineligible for the current drive, and can be redriven by the next interval, reconnect, count trigger, `delivery: 'immediate'` capture, or explicit flush. Kept work whose interval passed while another context's explicit opt-out paused it has no armed interval; an opt-in that ends the pause redrives it, but after a later cleared choice it goes out at the next flush, reconnect or page hide (captures are rejected while consent rests at the default denial). A flush barrier resolves after its admitted snapshot receives one delivery drive; it does not hot-loop retained failures or wait indefinitely for server acceptance. These package-private values bound browser memory and stale delivery and do not claim the deployed V1 event or batch limits. The policy owns one endpoint, event/batch serializer, server payload limits, compression, transport, response classification, retry policy, and teardown policy. Events with different policies must not share a batch. A failure in one lane must not requeue or resend events accepted in another lane. The client creates its buffer before delivery attaches. Analytics `capture()` performs bounded admission, commits Core's session authority only after acceptance, and rolls back queued work when session admission fails. Attaching a policy must preserve queued event UUIDs, timestamps, identity, session, ordering, measured bytes, admission time, and retry multiplicity. Optional product entry points create their lanes only when imported; the root must not contain their implementations or a product catalog.

`captureImmediate()` is the explicit exception to queued delivery. Analytics finalizes and commits one event through the same admission boundaries, then sends it inline. The capability's package-private immediate primitive accepts a readonly message array so single capture wraps the same batch-oriented Capture V1 sender and result classifier used by lane delivery. Immediate messages never enter the lane, are not retained for a later flush, can overtake buffered work, and may run concurrently. Unlike the general point-in-time consent rule, an explicit opt-out that purges queued work also cancels pending immediate dispatch and retries; a later opt-in does not revive them. A cleared choice does not cancel them. After a cleared choice, an explicit opt-out observed from another context only pauses them, as it pauses kept queued work: a retry that comes due while that opt-out stands is cancelled, but a later opt-in or cleared choice before then lets it proceed. Already-dispatched requests may finish. A valid `2xx` resolves to a terminal summary: only `ok` and `warning` count as persisted, while `drop`, final `retry`, and missing results do not. Request-level terminal failures, exhausted transport retries, malformed responses, cancellation, and unavailable delivery resolve with an operation-level `error` in the summary, retaining known partial outcomes and setting `allPersisted` to `false` even when nothing was submitted. The public immediate-capture boundary contains unexpected exceptions and rejected delivery promises as failure summaries. Local non-admission resolves an empty summary and callers requiring durability must verify both submitted count and persistence. Analytics must degrade gracefully when a loaded delivery driver implements queued delivery without the immediate method.

After configured extensions install, core admits one enabled initial `$pageview` through ordinary capture before the factory resolves. `capturePageview: false` disables it. Hidden documents wait on one disposable visibility listener. Consent and bot filtering are enforced only when ordinary capture begins, and a later explicit opt-in can admit a pageview that prior denial held pending. Analytics keeps the UUID of the last admitted `$pageview` in memory for its session, sends it on later events as `$pageview_id`, adds `$prev_pageview_id` to `$pageview` and `$pageleave`, and exposes it through `getPageViewId()`; reset and session rotation clear it. Analytics adds the sanitized page URL (`$current_url`, `$host`, `$pathname`) to every event and the document `title` to `$pageview`, read at capture time as the lowest property layer, so registered, session, dynamic and caller values replace them. The client's `urlSanitization` shapes page URLs: logs, web vitals and session replay use `analyticsOf(client).recordUrl()`, the function events use. Conversations keeps the page URL for its restore links, and autocapture element links follow `autocapture.disableCaptureUrlHashes`. `analyticsOf` lives in a module with no runtime imports, so a product chunk that needs only it does not share core modules with the entry. Core has no referrer, history patching, or page-leave behavior.

Select an optional lane through an explicit product API, such as `captureAi()`, not an event-name prefix or a caller-supplied lane string on general `capture()`. General `capture()` always uses analytics. The product module receives only its private lane sink. Install the lane lazily, then include it in client `flush()` and `dispose()`. Lane sinks, lane state, delivery policies, and the coordinator are package-private implementation details; do not export them from the package root or add them to the shared `Client` contract. This follows Python's `_capture_ai` lane and the unmerged Node `captureAi` design while keeping product code removable from the browser root.

Teardown delivery must use the Capture V1 header-less Beacon contract only after the target backend and proxy paths support it. Until then, use Fetch with `keepalive: true` and the normal V1 headers. The current conservative aggregate body budget is 80% of 64 KiB, one client-wide pool that the analytics handoff shares with replay's unload delivery: each keepalive request holds its bytes until it settles, and replay's beacons hold none; requests walk active and queued source identities in FIFO order, and splitting does not replenish the browser's shared quota. Teardown does not mutate retained work because keepalive acceptance is not server acceptance. It does not parse responses, start asynchronous compression, or start retry timers. Register `pagehide`, or `unload` only when `pagehide` is unavailable, when delivery initializes and remove the listener during disposal. Online/offline listeners are scoped to the same delivery lifetime: offline is a scheduling hint that pauses avoidable sends, while online promptly redrives retained work. A compact in-memory token bucket runs before event construction with a default 10-event-per-second refill and 100-event burst; its aggregate warning bypasses the limiter without weakening consent or bounded admission. Explicit shutdown stops new work, makes one timeout-bounded normal flush drive, aborts remaining transport, and shares the idempotent disposal path.

### 4.4 Optional adapters and extensions

Put delivery or product behavior in an extension, capability, or adapter. Examples include analytics delivery, replay, surveys, and web vitals. The client's capture pipeline owns its queue and attaches its entrypoint's delivery when the client is constructed. Optional products likewise own their buffers and delivery policies.

An optional module can import the core. The core must not import the optional module.

Application-facing log methods belong to the logs extension reference. Shared/core logs owns its queue, batching, retries, and flush implementation. An extension can observe reset and consent changes to clear its own queued data. The extension registry flushes each installed owner once, independently of its lookup bindings, and isolates failures. `client.flush()` awaits each optional `Extension.flush()`; shutdown passes the `shutdown` reason and awaits flushing within its timeout before releasing resources. Logs uses normal delivery for these flushes and Beacon for pagehide.

Each optional module must have an explicit entry point. A consumer must import that entry point directly.

### 4.5 Standard preset

A standard preset can select recommended features. The root entry point must not import the standard preset.

The preset must keep large features behind dynamic imports. Each large feature must create a separate chunk.

Measure the preset in two ways:

- Initial size.
- Total size after all dynamic imports.

### 4.6 Compatibility and migration modules

Put old-browser support, full historical-state migrations, and heavy fallbacks in separate entry points.

The root graph must not contain these modules. Importing the root must not run a general migration.

A supported upgrade path must still recognize a prior explicit denial before the first capture admission or transport dispatch. This narrow privacy compatibility rule is part of consent enforcement, not an optional historical-state migration; identity and KV persistence remain a separate policy.

Cross-context conflict safety is also a core invariant. Same-origin local-storage persistence must prevent stale writers. A selected cross-subdomain cookie adapter must provide equivalent reconciliation for shared cookie state.

## 5. Root entry point

The initial root graph contains the client, its capture pipeline, Capture V1 delivery and product-composition glue. Group and person operations are client methods in the root graph; optional products stay outside it.

The root entry point must use named exports. It must not create a default client singleton.

Use a narrow root wrapper with a literal dynamic loader and a separate core entry:

```ts
// Root composition: acquire a whole product on demand.
const loadFlags = () => import('../../products/flags/flags').then(({ flags }) => flags(snapshot))

// @posthog/browser/core
export { createPostHog } from './core'
```

Do not use this form:

```ts
export * from './products'
export { default } from './singleton'
```

The root entry point must not re-export optional runtime features. Its loaders acquire whole products; survey rendering remains a further deferred import. Flags initializes by default. Logs, surveys and autocapture activate from explicit options, saved-state or remote-configuration signals, or explicit resolution. You can re-export types when the compiler produces no JavaScript import.

Treat `createPostHog` and its static imports as one size unit.
A bundler cannot remove an internal module when the factory always needs that module.

Do not implement a large optional feature as a method on the core client class.
Bundlers usually retain all methods on a used class.
Use an extension or an adapter instead.

### Autocapture

Explicit autocapture options, saved-state or remote-configuration opt-in, or explicit resolution trigger a literal dynamic import and setup, unless disabled or an explicit instance exists. `/autocapture` statically includes the same browser-common implementation; the manual core has no automatic import. Configuration uses camelCase, maps inside the optional module, and snapshots arrays/regular expressions without losing callbacks. The latest staged browser defaults apply: URL hashes are redacted, rageclick ignores stepper content and text-selection surfaces, clipboard capture is opt-in, and text/attribute masking remains false by default. Remote-config/cached opt-out policy, consent, DOM privacy filters, and event wire properties remain shared. No new core method or host contract is needed.

Survey action selectors are owned by the optional surveys module. It returns copied snapshots to autocapture at setup and forwards replacements when definitions register later. Receiver creation hydrates running triggers from the existing cached definitions without adding requests or bypassing TTL/backoff. Successful full definition refreshes replace next's trigger maps, including empty snapshots; failed fetches retain them. The shared orchestration also replaces trigger maps for legacy clients. Survey disposal clears its selector set. For URL-constrained actions, the surveys observation adapter supplies a missing URL from its existing targeting URL capability only to local matching; explicit event URL values are preserved and observed/wire events are not modified. There is no generic extension-registration observer or core selector catalog. Matching keeps existing exact-target and SVG-control attribution rather than broadening ancestor matches.

### Feature flags

`flags` accepts the same `FlagsOptions` as `flags(options)` from `@posthog/browser/flags`. With no explicit `featureFlags` extension, the root awaits a literal flags import and extension setup before resolving. It does not await remote evaluation. `flags: false` disables automatic inclusion; an explicit instance takes precedence. Failed loading/setup is isolated from core capture. The manual core entrypoint never imports flags automatically.

Applications access flag controls through `await posthog.resolveExtension(FeatureFlagsExtension)`. The typed token is lightweight and does not import the implementation. Result conversion, subscriptions, bootstrap, and evaluation stay in the optional module. Missing or failed extensions return undefined from lookup. Callbacks enumerate results without emitting flag-called events.

The client supplies browser notifications alongside the shared `Client` contract. Identification publishes `onIdentify`; local person-property updates publish the product-host `onChangeProperties` notification with `set`, `setOnce` and `unset` fields. Property setters do not publish identification, while identification with properties publishes both notifications. Core also supplies `onGroup`, `onGroupsReset` and `onReset`. Notifications run synchronously, independently of capture admission. Publishers isolate listener failures and do not replay earlier operations. Extensions subscribe during setup and dispose their subscriptions during teardown. Flags uses identification to update identity-dependent tracking and property changes to update evaluation context; core does not look up product-specific hooks.

Flags passes the shared `Client` directly to the shared feature-flags implementation and stores its values through `Client.kv`. The host owns storage selection, serialization, and durable writes. Core reset clears persisted extension data before notifying flags to clear its in-memory evaluation state and reload. Flag values follow the client's configured persistence, including memory-only operation with `storage: false`.

### Logs

Logs follows the flags composition pattern: explicit configuration or resolution loads the literal module import and awaits setup, not remote configuration. `logs: false` omits automatic inclusion; an explicit `logs(options)` extension owns its configuration and takes precedence. The manual core entrypoint contains no logs import. Applications call `captureLog()` on the logs extension; SDK diagnostics retain the existing `logger`.

The optional module adapts the shared browser-common logs implementation. It owns programmatic and console queues, OTLP resources/scopes, the console runtime, persisted console enablement hints, and pagehide handoff. Console capture follows existing local/remote gates, not module loading. The generic console serialization and patching runtime is shared with legacy browser bundles; historical ABI routing and global registration stay exclusively in the legacy entrypoint.

Shared logs uses the SDK-provided `Client.sendRequest()` for JSON requests to `/i/v1/logs?token=...` with a 60-second timeout. Logs owns status classification and retry policy; requests retain their own timeouts, while the SDK bounds how long shutdown waits for extension flushing. Pagehide uses the existing logs Beacon contract with keepalive Fetch fallback. This does not enable Beacon for analytics. Product queues, serializers, and console instrumentation stay in the optional module. Logs reads session context through the shared `Client.session` property without creating or advancing a session. The property can be undefined; an existing `SessionContext` includes `lastActivityTimestamp`. The logs adapter records the current page URL with the client's `urlSanitization`, as events record `$current_url`, and omits a URL that can't be recorded.

The logs extension subscribes to the browser client's reset and consent-change notifications to clear its queues on reset or observed consent denial. Capture stops when shutdown begins, but already admitted logs can flush while dispatch authority remains valid. `flush()` awaits analytics and both logs queues independently. Shutdown shares its existing timeout across delivery and disposal; an in-flight logs request can outlive that wait until its own timeout. Logs resolves `FeatureFlagsCommonExtension` through `Client.getExtension()` and reads `getFlags()` from the shared flags implementation to include flag keys without emitting exposure analytics. The host isolates extension setup, flush, and cleanup failures.

### Surveys

Explicit surveys options, a remote-configuration gate, or explicit resolution acquire only optional surveys orchestration; acquisition awaits setup, not remote configuration, renderer loading, or survey definitions. The orchestration module owns the literal dynamic import of the shared renderer. A successful remote configuration with a truthy surveys gate loads UI automatically. A false or unavailable gate leaves it deferred, while explicit survey APIs may initialize a non-automatic manager. If enabled remote configuration arrives later, that same manager starts its idempotent automatic-display loop unless automatic display is disabled; it is not replaced or duplicated. The explicit `@posthog/browser/surveys` factory includes orchestration only and defers the same renderer through a literal dynamic import. Preact, CSS, and DOMPurify belong behind that boundary; DOMPurify initializes browser capabilities when its module loads, so it must not enter the import-pure factory graph. An explicit instance wins over `surveys`, and `surveys: false` omits automatic inclusion.

Application-facing survey controls belong to the extension reference, obtained from the explicit factory or `getExtension()`. The extension receives host capabilities through ordinary setup and subscribes to `BrowserClient.onReset` for runtime cleanup. Renderer waiting and call coordination stay in the optional module; no post-init public registry installation is introduced. Manual `canRenderSurvey` resolves unavailable when disposed during loading or fetch. Callback delivery is suppressed after disposal.

The shared renderer, Preact components, CSS string, event/action receiver, and matching helpers are reused by legacy adapters. Capture, flags, submission IDs, configuration, and stylesheet preparation are explicit runtime capabilities, not a concrete PostHog facade. Legacy global routing, preview wrappers, and UUID behavior remain legacy-owned. Native capability reads occur at invocation/setup, preserving strict static-entry import purity.

The optional module stores definitions and event-activation state through the client's shared `core` `Client.kv` store. Survey interaction history—seen markers, partial answers, and abandonment markers—uses dedicated browser localStorage with the existing survey keys, independently of SDK persistence, including `storage: false`. Failed partial-answer writes retain an in-memory fallback. Abandonment checks capture permission before writing its marker and skips capture if reading the marker fails. Client reset clears persisted extension data, and the extension's reset subscription delegates to the shared surveys reset implementation. This clears in-memory progress and activation state, plus localStorage seen markers, partial answers, and the last-seen date. Abandonment markers remain, matching legacy survey reset behavior. Existing capture consent gates still control eligibility and submission, while cleanup always runs. The renderer owns polling, language/visibility listeners, pending display timeouts, and Preact unmounting.

Survey abandonment uses a package-private analytics pre-teardown subscription: the analytics buffer retains callbacks, and the delivery attached in the client constructor invokes them synchronously before its single keepalive queue handoff. Browser-native `pagehide` listener ordering is not portable (Chromium can invoke an earlier non-capture listener before a later capture listener), so capture phase alone cannot provide this ordering. Subscription failures are contained and disposal removes callbacks. A surveys-owned `pagehide` fallback admits abandonment when analytics delivery is unavailable, but cannot ensure delivery from a module still loading during unload.

Survey definitions are fetched separately at `/api/surveys/` with the existing token query, cache TTL, and failure backoff. The surveys extension resolves the browser-next flags facade through `Client.getExtension()` for configuration and person-property context; shared surveys resolves common flags through its common token. Event targets observe admitted captures. Action matching can register DOM selectors through an optional autocapture capability; that extension must be installed for selector-backed DOM events.

### Toolbar

The root reads the toolbar signals when the client is created, before an application router can replace the URL hash: a toolbar authorization in the hash for this project, or saved `_postHogToolbarParams`. A signal acquires the toolbar module without delaying initialization; otherwise explicit resolution acquires it. Inline equivalents of the shared hash checks keep the toolbar module out of the initial chunk. `toolbar: false` omits automatic inclusion, an explicit instance takes precedence, and the manual core has no automatic import.

The optional module adapts the shared `@posthog/browser-common/toolbar` loader, which posthog-js also uses. The page-wide load state lets several SDK instances load `toolbar.js` once. The shared loader writes `_postHogToolbarParams` to localStorage, independently of SDK persistence, because the toolbar application reads and clears that key. Loading does not depend on capture consent. The toolbar receives no client instance, because the toolbar application reads private posthog-js state. Each extension instance registers at most one Turbolinks watcher, and disposal removes it and cancels pending script loads. The client's `uiHost` supplies the app origin as `apiURL`.

### Conversations

Conversations follows the surveys pattern. Explicit options, a remote-configuration gate, or explicit resolution acquire the extension module; acquisition awaits setup, not remote configuration or the renderer. The extension loads the shared `@posthog/browser-common/conversations-renderer` chunk through a literal dynamic import only once remote configuration enables conversations. The renderer contains the manager, widget, and persistence that posthog-js also uses, behind a `ConversationsHost` adapter. `conversations: false` omits automatic inclusion, an explicit instance takes precedence, and the manual core has no automatic import.

As in posthog-js, widget state uses a dedicated `ph_conv_<project-token>` localStorage record, independently of SDK persistence, including `storage: false`, and regardless of capture consent. The record holds the widget session ID, written when the manager is created, and later the ticket ID, widget state, and visitor-entered name and email. `sendRequest()` sends `/api/conversations/` requests while the visitor is opted out, as posthog-js does. The widget's `$conversations_*` events use ordinary `capture()` admission, so consent still gates them. Reset clears the record, or the manager resets it, and bumps a generation so that a renderer that finishes loading afterwards starts over. A page has one widget: only the client whose manager created it controls and destroys it, but as in posthog-js, a reset from any client resets it.

## 6. Import graph rules

### 6.1 Use exact runtime imports

Import the exact runtime module that the code needs.

Use this form:

```ts
import { Publisher } from '@posthog/browser-common/pubsub'
import type { Client, Extension } from '@posthog/browser-common'
```

Do not use a runtime root barrel when an exact subpath exists.
Do not use a utility barrel for runtime imports.

### 6.2 Keep barrels narrow

A barrel can export types. A runtime barrel must use explicit named exports.

Do not use `export *` across product boundaries.
Do not use `export *` across side-effect boundaries.

A root barrel must not import a module only to register it.

### 6.3 Prevent cycles

Keep the import graph acyclic. A cycle can prevent tree shaking and can change initialization order.

Move shared contracts to a lower layer when two modules need each other.
Do not fix a cycle with a runtime service locator.

### 6.4 Do not use internal deep imports

Publish each supported entry point in the `exports` map.
Do not require consumers to import a file from `dist`.

Internal emitted files are not public entry points.

## 7. Import purity

The package declares `sideEffects: false`. Every published entry point must satisfy that declaration.

Module evaluation must not do these operations:

- Read or write storage.
- Read the DOM.
- Add an event listener.
- Start a timer.
- Start a network request.
- Create a client.
- Register an extension.
- Modify a global object.
- Install a polyfill.
- Emit telemetry.

Start work only from a factory, a method, or `Extension.setup()`.

Use a function to read a browser capability:

```ts
const getDefaultFetch = () => globalThis.fetch?.bind(globalThis)
```

Do not capture a browser capability at module scope:

```ts
const defaultFetch = globalThis.fetch?.bind(globalThis)
```

A module can define constants and pure functions at module scope.
A module can create immutable data when that data has no external effect.
Keep large data tables outside core when basic capture does not need them.

If an import side effect is unavoidable, prefer a separate package. Otherwise, create an explicit side-effect entry point and change `package.json#sideEffects` from `false` to an array that lists only that entry. Do not set the whole package to `sideEffects: true`.

## 8. Optional feature rules

### 8.1 Use an import boundary

Use a separate export subpath for each substantial optional feature. Feature flags, logs, surveys orchestration, and autocapture use literal dynamic imports from the root entrypoint; the core entrypoint references none of their automatic loaders.

Example:

```text
@posthog/browser
@posthog/browser/standard
@posthog/browser/delivery/analytics
@posthog/browser/persistence/cookie
@posthog/browser/delivery/durable
@posthog/browser/flags
```

Add the source entry and the package export in the same change.
Add a consumer bundle test for each public runtime entry.

### 8.2 Do not use configuration as a bundle boundary

A boolean option changes runtime behavior. It usually does not remove imported code.

Do not use this pattern for a large feature:

```ts
import { largeFeature } from './large-feature'

if (options.enableLargeFeature) {
    largeFeature()
}
```

Use an explicit import or a client-owned extension:

```ts
import { largeFeature } from '@posthog/browser/extensions/large-feature'

const posthog = await createPostHog({
    projectToken,
    extensions: [largeFeature()],
})
```

A small branch can stay in core when a separate boundary adds more bytes.
The change must include measurements that support this decision.

### 8.3 Register only selected extensions

The extension registry stores configured instances and automatic instances selected by the root factory. Explicit feature-flags, logs, surveys, and autocapture instances take precedence over their corresponding top-level options. Flags register the same extension implementation used by static inclusion.

Keep product factories, option interpretation and literal imports in composition code. Core may store injected named loaders and dependency bookkeeping, but must not import a static catalog of product implementations. Other products require explicit composition until their automatic loading contract is implemented.

Do not put this code in the root graph:

```ts
import { replay } from './replay'
import { surveys } from './surveys'

const products = { replay, surveys }
```

A product-name catalog can exist in a separate preset entry point.

### 8.4 Use real dynamic imports

A generic loader function does not create a chunk by itself. The owner or a product-specific package API must contain a literal dynamic `import()`.

Use this form when the application selects an extension before client creation:

```ts
const { flags } = await import('@posthog/browser/flags')
const posthog = await createPostHog({
    projectToken,
    extensions: [flags()],
})
```

Use a literal module path. This lets the bundler create a stable chunk. Do not use a computed import path for a known product list.

## 9. Extension design

An extension must be a factory result or an application-supplied instance.
It must not be a shared mutable singleton.

An extension may start external work during `setup()` or through its own controls after setup.
The client owns every configured or internally created extension for its lifetime. Runtime installation, removal, and replacement are not public extension contracts; feature-level start and stop remain extension-owned controls.
An extension must release owned resources in its final `dispose()`.
Cleanup must be safe after partial setup.

The client passes itself to every extension. Applications see it as `IPostHog`, which omits `sendRequest()`; extensions receive it as `IPostHogExtensionHost`, which adds it. The host must dispose extensions in reverse installation order.

Extension names and binding names share one lookup namespace. Browser product properties and awaited `resolveExtension()` return successfully initialized lifecycle owners; `getExtension()` also returns binding targets, such as the shared flags implementation under `FeatureFlagsCommonExtension`. The registered extension is the sole lifecycle owner: binding targets are not independently set up, flushed or disposed. Names and bindings are reserved before setup and released when setup fails or the extension is disposed.

An extension failure must not stop core capture. A failed setup must remove all reserved registry state.

## 10. Dependency rules

The root graph must not import these packages:

- `posthog-js`.
- `@posthog/core`.
- `core-js`.
- `fflate`.
- Preact.
- DOMPurify.
- rrweb.
- `web-vitals`.

Put a heavy dependency behind an optional entry point. Prefer a browser capability before a JavaScript fallback.

Do not install a global polyfill from the root graph.
Use a local capability check and a local fallback when the fallback is small.

Check the `sideEffects` field of each runtime dependency.
Import a side-effect-free subpath when the dependency provides one.

Move code to `@posthog/browser-common` only when more than one SDK uses the code.
Shared location does not make code free. Measure the resulting consumer graph.

## 11. Build and package rules

Publish unbundled ES modules. Preserve the source module boundaries.

Also publish CommonJS only when a supported consumer needs it.
Modern bundlers must resolve the ES module output through the `import` condition.

Use modern JavaScript as the library target. Let the application bundler select older targets.
Do not add compatibility transforms to the root without browser-support evidence.

Keep an exact `exports` map. Do not expose all files with a wildcard export.

Keep `sideEffects: false` while all entry points remain import-pure. If an explicit side-effect entry becomes necessary, use a small array allowlist instead of `false`.

Do not combine all entry points into one prebuilt runtime bundle.
The package needs preserved ES module boundaries for consumer tree shaking.

### CDN-only classic entry

The standalone classic-script installer lives in `src/composition/script/`, explicitly excluded from Rslib's npm entry glob and declaration build. Its generated CDN artifacts remain outside the npm `files` allowlist. `build:cdn` emits `dist-cdn/script.js` with the complete initial core graph embedded, plus optional asynchronous chunks and source maps. Rspack's automatic public path captures the executing external script's directory synchronously and removes its query and fragment before loading chunks. There is no separate client download between the initial response and core construction.

This deployment artifact intentionally initializes a client; it is not an npm export and does not change the import-purity contract or `sideEffects: false`. Keep the root factory's extension setup order, override precedence, snapshots, consent, and failure isolation unchanged. The installer delegates readiness to that factory. See the [script installation guide](./README.md#classic-script-installation-draft-cdn-distribution) for query configuration, global ownership, and ready-event semantics. `bundle-size:cdn` checks the generated initial graph and reports initial/deferred artifact sizes and module attribution; `test:snippet` runs the generated classic artifacts in plain HTML against the SDK mock server.

## 12. Bundle tests

Measure code as a package consumer. Build the package before each measurement.
Do not use source-file size as a bundle metric.
Do not use npm unpacked size as a browser bundle metric.

Run the current core check from `packages/browser-next`:

```sh
pnpm bundle-size
```

The previous 12 KiB gzip threshold is not a binding budget. Set the release ceiling only after the core behavior suite passes and the compliant graph is optimized. This policy is not permission to omit required behavior.

After the first behavior-compliant baseline, set binding regression budgets from the optimized consumer bundle. If required behavior exceeds the working budget, inspect and simplify the implementation. Do not delete the invariant.

The current check reports these values for the core capture fixture:

- Minified bytes.
- Gzip bytes.
- Brotli bytes.

The current check also reads an esbuild metafile. It rejects known heavy modules in the root graph and prints minified-byte attribution. Pass `--analyze` for the full esbuild import-path report. It does not store a baseline.

Add these fixtures when the related public entry points exist:

| Fixture                 | Required check                                        |
| ----------------------- | ----------------------------------------------------- |
| Root export only        | An unused root export does not retain unrelated code. |
| Type-only consumer      | Type imports produce no JavaScript.                   |
| Optional static import  | Only the selected optional feature enters the graph.  |
| Optional dynamic import | The feature stays outside the initial chunk.          |
| Standard preset         | Initial and total sizes stay separate.                |
| Server import           | Package import does not require browser globals.      |

Each optional-feature check must report these values:

- Initial chunk bytes.
- Dynamic chunk bytes.
- Total loaded bytes.
- Module attribution.

Extend the bundle-size script when you add a new public entry point.
Fail the check when a forbidden product or dependency enters the root graph.

Review initial and total bundle measurements for runtime changes.
An increase needs a user benefit and a short size explanation.

## 13. Review procedure

Use this procedure for each runtime change:

1. Identify the durable behavior test, explicit decision, or Capture V1 compliance case.
2. Add or identify the parity, conformance, or fault-injection test that protects it.
3. Identify the new static imports.
4. Check the direction of each import.
5. Convert contract imports to `import type`.
6. Check all changed modules for import side effects.
7. Add an export only when a public import boundary is necessary.
8. Add or update a consumer fixture.
9. Run `pnpm bundle-size`.
10. Inspect module attribution when the runtime graph changes.
11. Report the behavioral decision and size change in the pull request.

Ask these questions during review:

- Does basic capture always need this code?
- Can an application omit this feature by omitting one import?
- Does a runtime option hide code that needs an import boundary?
- Does the root import an optional implementation?
- Does a barrel make the runtime graph unclear?
- Does module evaluation start work?
- Does the dynamic loader create a separate chunk?
- Does the package export match the intended public boundary?
- Do bundle tests prove the result?

If an answer is not clear, do not add the code to the root graph.

## 14. Decision priority

Use this priority when two designs have similar behavior:

1. Select the smaller root graph.
2. Select the design with the clearer import boundary.
3. Select the design with fewer import side effects.
4. Select the design with fewer framework abstractions.
5. Select the design that produces stable dynamic chunks.
6. Select the design that is easier to measure.

Do not trade correctness, privacy, or no-throw behavior for a smaller bundle.
Use bundle size as an architectural constraint, not as the only constraint.
