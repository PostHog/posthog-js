# Plan: Behavior-complete, minimal `@posthog/browser`

## Goal

Build `@posthog/browser` in `packages/browser-next` as a compact replacement for the core browser SDK.

The package must preserve production capture behavior without copying the structure of the current `PostHog` class. It must reproduce required outcomes with smaller state machines, narrow components, modern browser APIs, and explicit import boundaries.

The root package will use the existing `Client` and `Extension` contracts from `@posthog/browser-common`.

## Optimization contract

Core behavior is a fixed constraint. Bundle size is the optimization objective.

```text
minimize: useful root capture-client bytes
subject to:
  wire compatibility
  consent and privacy guarantees
  identity and reset correctness
  session and cross-context correctness
  reliable bounded delivery
  no-throw behavior
  extension isolation
```

Do not make the root small by removing a required invariant. Make it small by replacing legacy mechanisms, compatibility layers, broad abstractions, and eager product composition.

Behavioral compliance does not require complete API compatibility or product parity. Deprecated aliases, mutable legacy configuration, old-browser transports, rich enrichment, and optional products can use separate entry points or remain unsupported. Each deliberate difference from `posthog-js` must be recorded.

Measure these costs separately:

1. An unused or `version`-only root import. This should approach zero after tree shaking.
2. A useful root client that creates a client and captures an event. This must contain all core guarantees.
3. The standard preset initial chunk.
4. Total bytes loaded after optional dynamic imports.

Moving required behavior into an automatic dynamic chunk does not reduce its total cost.

## Core behavioral floor

The useful root client must provide these invariants:

1. **Initialization safety**: validate configuration, perform no import-time work, and contain storage, serialization, listener, and transport failures.
2. **Consent and privacy**: resolve consent before analytics persistence or transmission, preserve explicit denial on supported upgrade paths, observe revocation across active contexts, and apply consent policy to extension requests and KV writes.
3. **Bot filtering**: reject traffic from the compact, approved blocked-user-agent set before state mutation or delivery.
4. **Identity**: distinguish device, anonymous, and current distinct IDs; implement anonymous-to-identified linkage; reject invalid IDs; and define reset preservation explicitly.
5. **Sessions**: enforce idle and maximum length, keep a shared session with a per-window ID, use fresh state before decisions, and prevent stale tabs from overwriting newer sessions.
6. **Capture protocol**: validate and copy inputs, use defined property precedence, protect protocol fields, serialize safely, enforce payload limits, and implement the Capture Analytics V1 event, batch, authentication, response, and retry contracts.
7. **Delivery lanes**: route each traffic class to an independent bounded queue, endpoint, wire serializer, batching policy, transport strategy, retry policy, and teardown policy. The root includes only the analytics lane.
8. **Extension isolation**: implement the shared client contract, enforce consent on transport and storage, isolate failures, and dispose deterministically.

Correctness, consent, privacy, and no-throw behavior take priority over a size target.

## Behavior parity gate

During Phase 0, use the temporary [`posthog-browser-v2-behavior-ledger.md`](posthog-browser-v2-behavior-ledger.md) to classify product-parity decisions before converting them into executable gates. It is development scaffolding, not package documentation or a release artifact. The Capture Analytics V1 harness is the source of truth for the analytics wire contract. Classify each observed legacy browser behavior as one of:

- Core invariant.
- Optional product behavior.
- Compatibility-only behavior.
- Deliberate browser-next difference.
- Requires server verification.

Build a black-box differential harness that runs equivalent product scenarios against `packages/browser` and `packages/browser-next`. Give both clients the same clock, storage, browser globals, Fetch implementation, and Beacon implementation. Normalize generated IDs by semantic role until both clients expose the same test-only ID seam. Compare:

- Final event payloads.
- Logical delivery admission, suppression, and lane selection.
- Persisted state.
- Identity, session, and window transitions.
- Lifecycle notifications.
- Error and no-throw behavior.

Do not assert physical request equality between the legacy and Capture V1 wire formats. The differential harness compares logical delivery behavior. Legacy wire tests remain legacy-only, and the Capture V1 harness records browser-next bodies, headers, and query parameters. Use the legacy browser suites for product semantics, but do not use their `/e/` request envelope as the new wire contract. Start with consent, identity/reset, session, request queue, retry queue, rate-limiter, and final-event tests. Add multi-client storage interleavings and transport fault injection. Every surviving product difference needs an explicit ledger decision.

Use the Capture Analytics V1 SDK test harness and peer implementations for exact wire behavior. Run that suite against browser-next, including normal Fetch and browser teardown modes. Verify the endpoint through direct regional hosts and supported reverse-proxy paths against a real PostHog test project.

### Capture Analytics V1 protocol

The root analytics lane uses `POST /i/v1/analytics/events`. It must not send analytics events to `/e/`, `/batch/`, `/capture/`, `/track/`, or `/i/v0/e/`.

Normal Fetch requests use:

- `Authorization: Bearer <project-token>`.
- `Content-Type: application/json`.
- `PostHog-Sdk-Info: posthog-js/<version>`.
- A one-indexed `PostHog-Attempt`.
- A stable `PostHog-Request-Id` across retries of one logical batch.
- A fresh `PostHog-Request-Timestamp` for each physical attempt.
- The browser-provided `User-Agent`; browser JavaScript must not try to set this forbidden header.
- `Content-Encoding` only when the body uses that encoding.

Authorization and the PostHog metadata headers make a cross-origin browser request preflighted. The V1 endpoint and every supported customer proxy path must answer `OPTIONS`, allow these headers, and forward them unchanged. Include this in real-browser and proxy tests.

The batch body has `created_at` and a non-empty `batch`. It has no `api_key`, token, or `sent_at`. Keep `created_at` stable while retrying one logical batch.

Each event has these root fields:

- `event`.
- `uuid`.
- `distinct_id`.
- `timestamp`.
- Optional `session_id` and `window_id`.
- `options`, always an object and `{}` when empty.
- `properties`.

Promote protocol controls from properties into typed V1 fields. This includes session/window IDs and the current cookieless, skew-correction, person-processing, and product-tour controls. Put `$set`, `$set_once`, `$unset`, and `$groups` in `properties`. Do not send `$lib` or `$lib_version` in event properties; the server materializes them from `PostHog-Sdk-Info`. Coerce a supported control value to its strict V1 type or omit it. A malformed option must not reject the whole batch.

A normal 2xx response contains a UUID-keyed `results` map. Treat `ok` and `warning` as accepted, `drop` as terminal, and `retry` as the only per-event retry instruction. Retry only those events. Keep their event UUIDs, event timestamps, request ID, and batch creation time stable. Increment the attempt and refresh only the physical request timestamp. Treat unknown result codes as terminal for forward compatibility. Cover a missing UUID result explicitly in tests and follow the final server/harness decision.

Retry transport failures and the server-approved transient status set with bounded exponential backoff, jitter, and `Retry-After` as a minimum, all under the browser retry budget. Do not retry terminal validation, authentication, billing, payload-size, media-type, or V1 rate-limit responses. Surface terminal drops and retry exhaustion without throwing into the host application.

Reference implementations and contracts:

- [Node V1 types](https://github.com/PostHog/posthog-js/blob/9c0632a7def256accc1f6ceec40467bb8507e531/packages/node/src/capture-v1/types.ts#L15-L54), [transform](https://github.com/PostHog/posthog-js/blob/9c0632a7def256accc1f6ceec40467bb8507e531/packages/node/src/capture-v1/transform.ts#L92-L159), and [sender](https://github.com/PostHog/posthog-js/blob/9c0632a7def256accc1f6ceec40467bb8507e531/packages/node/src/capture-v1/sender.ts#L61-L186).
- [Python V1 transform and contract](https://github.com/PostHog/posthog-python/blob/398fce78f6bce4b39fcf5553d865c4eb1551203f/posthog/capture_v1.py#L1-L32) and [partial-retry loop](https://github.com/PostHog/posthog-python/blob/398fce78f6bce4b39fcf5553d865c4eb1551203f/posthog/capture_v1.py#L466-L609).
- [Rust V1 event and response types](https://github.com/PostHog/posthog-rs/blob/125e89f2b0bd70c77a20635aee675088c48c6532/src/event_v1.rs#L12-L195) and [request/response control flow](https://github.com/PostHog/posthog-rs/blob/125e89f2b0bd70c77a20635aee675088c48c6532/src/client/v1_capture.rs#L233-L353).
- [Capture Analytics V1 harness](https://github.com/PostHog/posthog-sdk-test-harness/blob/78074c33e7948fe0708b1c13d7fd4faefd9b9b5f/contracts/capture_analytics_v1_tests.yaml), including required headers, retry metadata, result pruning, typed options, and historical routing.

### Cross-context persistence

Cross-context correctness is core behavior, not an optional synchronization product.

For same-origin local storage, prevent stale whole-record writes and observe identity, consent, and session changes before capture and mutation. For shared cross-subdomain cookies, use the reviewed final form and regression tests from [posthog-js PR #4496](https://github.com/PostHog/posthog-js/pull/4496) as parity input. The PR is still under review, so update this plan if its semantics change before merge. The cookie adapter must:

- Reconcile before capture and persistence writes.
- Preserve local-only properties.
- Propagate authoritative removals.
- Publish complete `identify()` and `reset()` transitions.
- Prevent stale tabs from resurrecting old identity or session state.
- Keep the local window ID when it adopts a shared session.
- Handle persistence disablement, re-enablement, and storage migration safely.

Reactive notification frameworks can remain optional. Fresh reads, conflict-safe writes, and stale-writer protection cannot.

Consent uses the portable default key `__ph_opt_in_out_<project-token>` and interoperable `0`/`1` values. `consentPersistenceName` overrides that key verbatim without appending the project token. The logical key is independent of the identity persistence key and applies to whichever consent storage adapter is selected. Readers accept the established yes/no-like value forms so existing default and custom-name decisions remain valid across SDKs.

Full historical-state migration can remain in a compatibility entry point. That entry maps `consent_persistence_name` to `consentPersistenceName`. Deprecated prefix-derived keys and migration between storage backends are compatibility behavior, not root behavior. Recognition of a prior explicit denial must run before the first analytics write or request in every supported upgrade path.

## Main design rule

The root must contain behavior required for a correct capture client. The root must not contain optional product implementations.

Use one compact implementation for each required responsibility:

- Consent enforcement.
- Bot detection.
- Identity and session state.
- Conflict-safe persistence.
- Capture V1 event construction.
- A small lane dispatcher and analytics lane.
- In-memory batching.
- Native compression.
- Fetch and Beacon transport.
- Bounded partial retry.
- Extension lifecycle.

Use modern browser APIs and direct state machines. Do not add generic middleware, service locators, or dependency-injection frameworks. Heavy fallback implementations and optional product code stay outside the root graph.

## Package structure

```text
packages/browser-next/
├── src/
│   ├── index.ts
│   ├── browser-client.ts
│   ├── capture.ts
│   ├── identity.ts
│   ├── session.ts
│   ├── store.ts
│   ├── delivery.ts
│   ├── consent.ts
│   ├── bot-filter.ts
│   ├── remote-config.ts
│   └── extensions/
│       ├── client-adapter.ts
│       ├── registry.ts
│       └── loader.ts
├── tests/
├── fixtures/
├── scripts/
├── package.json
└── rslib.config.ts
```

The npm package will use these entrypoints:

```text
@posthog/browser
@posthog/browser/standard
@posthog/browser/persistence/cookie
@posthog/browser/persistence/durable
@posthog/browser/delivery/durable
@posthog/browser/compression/fflate
@posthog/browser/extensions/*
@posthog/browser/migrate/posthog-js
```

## Root behavior

The root will provide one useful capture client.

```ts
import { createPostHog } from '@posthog/browser'

const posthog = await createPostHog({
    projectToken: '<project-token>',
    apiHost: 'https://us.i.posthog.com',
})

await posthog.capture('signed_up', { plan: 'pro' })
```

The factory will return only after identity and extension startup are complete.

The root will not create a default singleton. A default singleton adds import side effects and hidden global state.

### Public API

```ts
interface BrowserClient {
    capture(event, properties?, options?): Promise<void>
    identify(distinctId, properties?): Promise<void>
    group(type, key, properties?): Promise<void>
    reset(): void
    flush(): Promise<void>
    installExtension(extension): Promise<Disposable>
    loadExtension(loader): Promise<Disposable>
    getExtension(name): Extension | undefined
    dispose(): Promise<void>
}
```

`capture()` will resolve after the queue accepts the event. `flush()` will wait for the current delivery work.

## Capture pipeline

Use one fixed pipeline. Do not add a generic middleware system.

```text
capture()
  → read consent state
  → apply the bot filter
  → read identity and session state
  → add dynamic properties
  → add caller properties
  → add protected protocol properties
  → publish onEvent
  → select the analytics lane
  → enqueue the normalized event
  → build the lane-specific Capture V1 batch
  → compress the batch when useful
  → send the batch
  → prune and retry only server-marked retry events
```

The pipeline will copy caller-owned data. It will not mutate properties or configuration from the caller.

Protocol properties will win over extension properties. An extension cannot replace the project token or identity fields.

## Minimal implementations

### Persistence

Keep a small, conflict-safe local-storage implementation in the root. Use memory when local storage fails.

Keep consent separate from resettable identity and session state. Do not rely on a once-loaded whole-record cache. Re-read shared fields before state decisions and merge writes so a stale client cannot restore an old identity, consent decision, group, or session.

The root implementation must provide same-origin multi-tab correctness. It does not need a general synchronization framework.

Keep these implementations behind separate entry points when the root does not configure them:

- Cross-subdomain cookie storage.
- IndexedDB storage.
- Durable event queues.
- Full legacy browser identity, group, super-property, and storage migration.

An optional persistence adapter is still responsible for the same core semantics when selected. The cookie adapter must implement the agreed cross-subdomain reconciliation behavior after PR #4496 is finalized. The default upgrade composition must recognize legacy explicit denial before initialization, even when broader legacy browser-state migration is not installed.

### Bot detection

Keep a compact blocked-user-agent filter in the root.

Do not import the full browser and device detection graph. Put detailed browser enrichment in a browser-context extension.

### Compression

Use `CompressionStream` when the browser supports it.

Send uncompressed data when `CompressionStream` is unavailable. Do not include `fflate` in the root.

Compress only batches that exceed a measured threshold. Compression increases work for small payloads.

Expose the JavaScript fallback through `@posthog/browser/compression/fflate`.

### Delivery lanes

A lane is the smallest delivery unit with independent failure and backpressure behavior. Each lane owns:

- Event admission and size limits.
- One bounded queue.
- Flush count, byte, and time thresholds.
- Endpoint and wire serializer.
- Authentication and request metadata.
- Compression policy.
- Normal and teardown transports.
- Response classification and retry policy.
- Failure reporting.

Do not put events with different endpoints, wire shapes, payload limits, or retry semantics in one batch. A failure in one lane must not requeue or resend events already accepted in another lane.

Keep the framework small. A browser lane is a policy bundle, not a worker pool or general scheduling framework. The root statically includes one analytics lane. Optional products install their lanes from explicit entry points; the root must not contain a catalog or implementation for AI, replay, logs, metrics, or traces.

Use an explicit product API to select a non-analytics lane. Do not infer the lane from an event-name prefix, and do not add a caller-selected lane string to general `capture()`. For example, an optional AI module can own `captureAi()` and a private AI lane sink. A call to `capture('$ai_generation')` still uses the analytics lane. A call to `captureAi({ event: '$ai_generation', ... })` uses the AI lane because the API selected it. The method can warn about an unexpected event name, but the name must not override the selected lane.

The concrete precedents are:

- Python defines an internal [`_Lane`](https://github.com/PostHog/posthog-python/blob/398fce78f6bce4b39fcf5553d865c4eb1551203f/posthog/client.py#L345-L454) and sends [`capture()` and `_capture_ai()` through explicit analytics and AI lane arguments](https://github.com/PostHog/posthog-python/blob/398fce78f6bce4b39fcf5553d865c4eb1551203f/posthog/client.py#L1518-L1547). Its tests require that an AI-named event sent through general `capture()` is not rerouted and that the two APIs use separate endpoints and queues.
- Python gives the AI lane its [own endpoint, size cap, V0 wire mode, and lazy start](https://github.com/PostHog/posthog-python/blob/398fce78f6bce4b39fcf5553d865c4eb1551203f/posthog/client.py#L1003-L1041). Client `flush()` coordinates all lanes under [one total timeout budget](https://github.com/PostHog/posthog-python/blob/398fce78f6bce4b39fcf5553d865c4eb1551203f/posthog/client.py#L2392-L2405).
- An unmerged Node design adds explicit [`captureAi()` and `captureAiImmediate()` methods](https://github.com/PostHog/posthog-js/blob/3bcd7c558cdda3c0860fe1210a3848c9d89db9b1/packages/node/src/client.ts#L841-L887). It activates a dedicated `/i/v0/ai/batch/` route only on use, applies lane-specific byte limits and 413 splitting, and keeps general `capture()` on its normal route. The AI package uses a [small optional capability check with a compatibility fallback](https://github.com/PostHog/posthog-js/blob/3bcd7c558cdda3c0860fe1210a3848c9d89db9b1/packages/ai/src/captureAiEvent.ts#L3-L36). Treat this branch as design evidence, not released Node behavior.
- Current Node Capture V1 also has a transitional `$ai_*` compatibility route. Its separate queue proves failure isolation, but its event-name routing is not the browser-next API model.

The browser implementation should preserve explicit routing, queue isolation, lazy activation, per-lane limits, and coordinated lifecycle without copying server-side threads, persistence, or worker machinery.

Use one small host boundary. This is illustrative, not a frozen public contract:

```ts
interface LaneSink<E> {
    enqueue(event: E): Promise<void>
}

interface Delivery {
    analytics: LaneSink<Event>
    installLane<E>(lane: InstalledLane<E>): LaneSink<E>
    flush(options?: { unload?: boolean }): Promise<void>
    request(path: string, init?: SendRequestInit): Promise<ApiResponse>
    dispose(): Promise<void>
}
```

`installLane()` is extension-host infrastructure, not a public arbitrary-endpoint API. It registers a supplied lane for coordinated flush and disposal. Core `capture()` can reach only `analytics`. An optional product receives only its own returned sink. Omit the product import and its lane implementation must be absent from the bundle.

The root implementation will use:

- An in-memory batch.
- `fetch` during normal runtime.
- `sendBeacon` for best-effort teardown delivery.
- Keepalive Fetch as the teardown fallback.
- A short timeout.
- A small retry limit.
- No durable queue.

#### Transport policy

Normal and teardown delivery have different guarantees:

- `flush()` flushes every active lane with its normal transport. For the analytics lane, this is Fetch. It can observe the V1 results map, apply timeouts, honor rate limits, and partially retry eligible failures.
- `flush({ unload: true })` asks each lane to hand off its pending batches synchronously. A page lifecycle handler cannot wait for asynchronous delivery work.
- The analytics lane prefers `navigator.sendBeacon()` for teardown only after the Capture V1 header-less contract is available on the target ingestion path. Encode the required token, SDK metadata, attempt, request ID, request timestamp, and compression metadata through the approved V1 Beacon query parameters. A `true` result means only that the browser accepted the handoff. It is not a delivery response.
- If the V1 Beacon contract is unavailable, or Beacon is unavailable, throws, or rejects a batch, attempt Fetch with `keepalive: true` and the normal V1 headers immediately. Do not send a knowingly invalid header-less V1 request.
- Beacon sends do not parse per-event results, use response-based retries, or start new retry timers. Pending retries get one best-effort teardown attempt using their existing logical request metadata where the protocol requires it.
- Enforce one aggregate teardown-byte budget across Beacon and keepalive Fetch attempts. The browser's shared in-flight keepalive quota is not reset for each split request. Prioritize smaller analytics batches, attempt only work that fits the remaining budget, and make local overflow observable. Splitting can help an individual batch fit but cannot increase the total quota.
- Do not start asynchronous `CompressionStream` work during teardown. Use an already encoded body or a synchronous, server-approved representation.
- Use `pagehide` as the primary teardown signal and `unload` only as a compatibility fallback. Register the listener during client initialization, not module import, and remove it during disposal.
- Direct `request()` calls use Fetch unless the caller explicitly requests Beacon. Beacon is valid only for requests whose method, body, authentication, metadata, and response needs are compatible with its fire-and-forget POST semantics.

The approved Capture V1 design defines a header-less Beacon mode with `beacon=1`, query fallbacks for header metadata, and a `204` response. The current capture backend still has an empty V1 query type and requires standard headers. Treat Beacon support as blocked until the deployed backend and reverse proxies implement and test that contract. See the [current backend query type](https://github.com/PostHog/posthog/blob/efb3546cd8c72b9bb1749ceeeb5f8e74d3ae1d86/rust/capture/src/v1/analytics/query.rs#L1-L4) and [required-header validation](https://github.com/PostHog/posthog/blob/efb3546cd8c72b9bb1749ceeeb5f8e74d3ae1d86/rust/capture/src/v1/context.rs#L89-L170).

The unload flush promise reports that handoff attempts finished. It cannot confirm Beacon delivery.

The durable delivery entrypoint can add IndexedDB, longer retries, and offline delivery.

This single boundary replaces separate transport, queue, batch, compression, and retry frameworks.

## Extension host

Use `Extension` from `packages/browser-common/src/extension.ts` without changes.

Use `Client` from `packages/browser-common/src/client.ts` as the extension-facing API.

The production adapter must implement all `Client` members. The adapter must not expose the concrete capture implementation.

### Extension-scoped client

Create a small client view for each extension.

This view will provide:

- Extension-scoped `kv`.
- An extension-scoped logger.
- Shared identity and session reads.
- Shared capture and request methods.
- Shared event publishers.

This design keeps extension storage keys separate.

### Extension registry

Use an extension name map for lifecycle, duplicate detection, and optional app-facing lookup. Callers can also retain the extension instance when they need its controls.

Install an extension with this sequence:

1. Reserve the extension name.
2. Create the extension-scoped client.
3. Run `setup(client)`.
4. Publish the ready state.

If setup fails, dispose the extension. Then remove all reserved state.

Dispose extensions in reverse installation order.

### Dynamic loading

The root must not contain a list of extension implementations.

Callers can load an extension explicitly:

```ts
await posthog.loadExtension(async () => {
    const module = await import('@posthog/browser/extensions/feature-flags')
    return module.featureFlags()
})
```

The `standard` entrypoint can provide a loader map. Each loader must create a separate dynamic chunk.

## Standard entrypoint

`@posthog/browser/standard` will provide the recommended browser configuration.

It can install these small extensions during startup:

- Browser context.
- Page views.
- Page leaves.
- Campaign properties.

It can load these extensions after remote configuration arrives:

- Autocapture.
- Feature flags.
- Error tracking.
- Replay.
- Surveys.
- Product tours.
- Web vitals.
- Logs.
- Metrics.

Report the initial size and the total loaded size separately.

## Shared extension migration

Place shared extension implementations in `@posthog/browser-common` only after both SDK versions use them.

Follow this order:

1. Port browser context.
2. Port page views.
3. Port feature flags.
4. Port error tracking.
5. Port autocapture.
6. Port replay.
7. Port surveys and product tours.

Add a static legacy-browser `Client` adapter in `packages/browser`.

Run each shared extension against these clients:

- The legacy-browser adapter.
- The browser-next adapter.
- `TestClient` from `@posthog/browser-common`.

Do not add the browser-next dynamic loader to the legacy browser default bundle.

## Build rules

Build unbundled ES modules with Rslib. Publish CommonJS only when a supported consumer requires it and bundle measurements show that the export conditions preserve tree shaking.

Use ES2023 as the source target. Let application bundlers select their target.

Add an exact `exports` map. Do not expose internal file paths.

Set `sideEffects: false` for the npm module graph. Keep snippet and global entrypoints in separate packages or allowlists.

The root must not import these packages:

- `core-js`
- `fflate`
- `preact`
- `dompurify`
- `rrweb`
- `web-vitals`

The root must not import `packages/browser` or any `@posthog/core` runtime module.

Use type-only imports for `Client`, `Extension`, and public types.

## Size plan

Measure a packed-package consumer bundle. Do not measure source files or unbundled output alone.

Create these fixtures:

| Fixture         | Purpose                                    |
| --------------- | ------------------------------------------ |
| `capture`       | Create a client and capture one event      |
| `identity`      | Identify, group, reset, and capture        |
| `standard`      | Install the standard browser configuration |
| `feature-flags` | Load feature flags dynamically             |
| `replay`        | Load replay dynamically                    |
| `all`           | Load every supported extension             |
| `ssr-import`    | Import the package without browser globals |

Measure each fixture with esbuild and Rollup.

Report these values:

- Minified bytes.
- Gzip bytes.
- Brotli bytes.
- Initial chunks.
- Dynamic chunks.
- Total loaded bytes.
- Module attribution.

### Size targets and regression policy

The current 12 KiB gzip root threshold is a working optimization target. It is not permission to omit a core invariant and it is not a release gate until the parity floor passes.

Track aspirational budgets for each independently removable artifact:

| Artifact                  | Gzip goal |
| ------------------------- | --------: |
| Root capture fixture      |    12 KiB |
| Root stretch target       |     8 KiB |
| Standard initial bundle   |    16 KiB |
| Browser-context extension |     3 KiB |
| Feature-flags loader code |     4 KiB |
| Bot filter                |     2 KiB |
| Cookie persistence        |     3 KiB |
| Durable delivery adapter  |     6 KiB |

After the required behavior suite passes, record the smallest compliant baseline and set regression budgets from that measurement. Review every increase for module attribution and user benefit. Optimize implementations and boundaries when a required invariant exceeds a goal; do not delete the invariant.

CI must always fail when an optional product implementation enters the root graph. Absolute byte gates become binding only after a behavior-compliant baseline exists.

## Current checkpoint

Use these checkboxes as the source of truth for project progress. Mark a phase complete only when all tasks in that phase are complete.

### Progress at a glance

- [x] **Foundation**: Create the private package, required options-object API, architecture rules, initial tests, and initial bundle measurements.
- [ ] **Phase 0**: Establish the compliance gates.
- [ ] **Phase 1**: Restore shared contract conformance.
- [ ] **Phase 2**: Implement the compact compliant core.
- [ ] **Phase 3**: Complete the extension host.
- [ ] **Phase 4**: Add persistence and delivery adapters.
- [ ] **Phase 5**: Add remote configuration.
- [ ] **Phase 6**: Add the standard entry point.
- [ ] **Phase 7**: Port shared extensions.
- [ ] **Phase 8**: Optimize the compliant graph.
- [ ] **Phase 9**: Release the alpha.

### Completed foundation

- [x] Create `packages/browser-next` and configure its package and build files.
- [x] Use one required `PostHogOptions` object for `createPostHog`.
- [x] Require and runtime-validate `projectToken`.
- [x] Keep the package free of a default singleton.
- [x] Add the bundle architecture and link it from the README and agent guide.
- [x] Add the initial unit coverage for the options-object API.
- [x] Run the current unit suite, lint, formatting, and diff checks successfully.
- [x] Measure the initial capture, ESM `version`-only, and CommonJS `version`-only fixtures.

The package already exists in `packages/browser-next`. Its factory uses one required options object:

```ts
const posthog = await createPostHog({
    projectToken: 'ph_test',
})
```

`projectToken` is required at the type and runtime boundaries. The package has no default singleton. The current unit suite, lint, formatting, and diff checks pass.

The current capture fixture is 22,775 B minified and 7,620 B gzip, but this is not a compliant baseline. The prototype still omits required behavior. The first Capture V1 transform, Fetch attempt, and result-classification slice added approximately 2.6 KiB minified and 0.9 KiB gzip. Bounded selective retry, transient status handling, jittered backoff, and `Retry-After` added approximately 2.2 KiB minified and 0.8 KiB gzip. Per-attempt timeout, response-body timeout, late-response cleanup, and an aggregate elapsed budget added 1,169 B minified and 422 B gzip. An ESM `version`-only consumer is approximately 50 bytes gzip, while the current CommonJS form retains approximately 6.3 KiB gzip. Re-evaluate CommonJS publication before release.

Known blockers and gaps:

- Browser-next satisfies the current `@posthog/browser-common` `Client` and `KeyValueStore` type contracts. The shared conformance suite now runs against the legacy browser adapter, browser-next, and `TestClient`.
- Browser-next type checking, declaration generation, build, and bundle measurement pass when run directly. The filtered pnpm command can still trigger unrelated workspace dependency repair in this checkout.
- The current event request uses the Capture Analytics V1 endpoint, event/batch transform, required normal-Fetch headers, result classification, bounded selective retry, transient-status/network backoff, per-attempt timeout, and an aggregate elapsed budget. It does not yet use a bounded queue, compression, payload limits, teardown delivery, or rate limiting.
- An opt-in live check sends synthetic events through both the direct regional host and a path-preserving local reverse proxy to the real Capture V1 backend. Direct browser Fetch also passed CORS preflight, and the resulting events were query-visible. Deployed managed-proxy verification remains open.
- The Capture V1 RFC defines browser Beacon query fallbacks, but the current deployed-source backend still requires headers and has not implemented its V1 query type.
- No lane abstraction currently isolates queue, endpoint, serialization, size, transport, and retry policy.
- Consent can be bypassed by extension requests and can become stale across active clients.
- The agreed shared default/custom consent-key contract and interoperable value encoding are not yet implemented.
- Persistence uses stale whole-record snapshots and is not safe across tabs.
- Identity, reset, session/window, batching, retry, unload, rate-limit, and serialization behavior are incomplete.
- The minimal fixture can fail before a successful declaration build because it imports the package through its public self-reference.

Decisions that still need an explicit answer:

- [ ] **D1**: Decide whether the package is an upgrade-compatible replacement or a narrower API with behavior-compatible capture.
- [x] **D2**: Use Capture Analytics V1 at `POST /i/v1/analytics/events` for the root analytics lane; do not use the legacy `/e/` contract.
- [ ] **D3**: Approve reset consent and device-ID semantics.
- [x] **D4**: Use `__ph_opt_in_out_<project-token>` by default, preserve custom consent names through `consentPersistenceName`, and use interoperable `0`/`1` values. Keep deprecated prefix-derived keys and backend migration in a compatibility entry point.
- [ ] **D5**: Decide whether DNT and cookieless modes are root contracts, standard-preset contracts, or unsupported alpha behavior.
- [ ] **D6**: Decide the final ESM and CommonJS publication policy.
- [ ] **D7**: Decide whether a new session also creates a new window ID. Legacy `posthog-js` rotates both after reset, idle timeout, and maximum length. The current browser-next state rotates only the session ID.

## Implementation phases

### Phase 0: Establish the compliance gates

- [x] **P0.1**: Create the behavior ledger.
- [x] **P0.2**: Build the legacy-browser/browser-next differential harness.
- [ ] **P0.3**: Port the Capture Analytics V1 harness plus the legacy browser consent, identity/reset, session, queue, retry, and rate-limit regression cases.
    - [x] Add executable differential cases for consent admission, identity transitions, person-property mutation, group updates and idempotence, reset, idle timeout, and maximum session length.
    - [x] Add browser-next invalid distinct-ID, group type/key, and event-name regression cases.
        - [ ] Promote retained scenarios to durable browser-next suites before the transitional legacy adapter is removed.
        - [ ] Add the browser-next analytics queue, retry, teardown, and rate-limit cases after those mechanisms exist.
        - [x] Port the Capture Analytics V1 transform, normal-Fetch request, and response-classification harness.
        - [x] Add selective partial-retry, attempt-metadata, status/transport retry, backoff, `Retry-After`, consent/disposal cancellation, and retry-exhaustion cases to the sender harness.
        - [ ] Run the sender through the future bounded analytics queue and its admission/flush lifecycle.
- [ ] **P0.4**: Add same-origin multi-client storage interleavings.
- [ ] **P0.5**: Add PR #4496 cookie cases to the cookie-adapter corpus.
- [ ] **P0.6**: Add transport and storage fault injection.
- [ ] **P0.7**: Verify Capture V1 Fetch, partial-retry, proxy-path, compression, and payload-limit behavior against a real PostHog test project.
    - [x] Verify uncompressed Fetch against the direct regional host, direct browser CORS preflight, and a path-preserving local reverse proxy to the live backend.
    - [ ] Verify a deployed managed reverse proxy, compression encodings, and payload limits.
- [ ] **P0.8**: Verify that the deployed backend and proxies support the Capture V1 header-less Beacon contract before enabling Beacon for that lane.
- [ ] **P0.9**: Make the packed consumer and module-attribution fixtures reliable.
- [ ] **P0.10**: Delete the temporary behavior ledger after every retained row maps to a durable test, an explicit open decision, or a server-verification gate.

Do not freeze more generic runtime contracts until this phase identifies the required behavior.

### Phase 1: Restore shared contract conformance

- [x] **P1.1**: Implement every `@posthog/browser-common` `Client` member.
- [x] **P1.2**: Make the key-value store conform to the shared contract.
- [ ] **P1.3**: Freeze extension key namespacing and consent policy.
- [x] **P1.4**: Add shared host-conformance tests for the legacy browser, browser-next, and `TestClient`.
- [ ] **P1.5**: Resolve synchronous extension disposal versus asynchronous host disposal.
- [x] **P1.6**: Restore type checking, declaration generation, and bundle measurement.

### Phase 2: Implement the compact compliant core

- [ ] **P2.1**: Implement consent and legacy-denial recognition.
- [ ] **P2.2**: Implement separate device, anonymous, and identified state.
- [ ] **P2.3**: Implement conflict-safe local-storage persistence.
- [ ] **P2.4**: Implement idle, maximum-length, window, and cross-tab session behavior.
- [x] **P2.5**: Implement the Capture V1 event transform, batch envelope, required Fetch headers, and result parser.
- [ ] **P2.6**: Implement a small lane dispatcher and the root analytics lane with an independent bounded queue and policy.
- [ ] **P2.7**: Implement in-memory batching and native compression within the analytics lane.
- [ ] **P2.8**: Implement normal Fetch delivery and synchronous best-effort teardown delivery with V1 Beacon mode when supported, keepalive Fetch fallback, timeout, bounded partial retry, backoff, jitter, flush, unload, and rate limiting.
- [ ] **P2.9**: Add `capture`, `identify`, `group`, `reset`, `flush`, and `dispose` state-machine coverage.

After each invariant passes, measure its marginal cost and inspect module attribution. Simplify the mechanism when it is too large. Do not weaken the invariant.

Use the current optimized non-compliant capture fixture only as a directional baseline. Do not assign the remaining bytes to incomplete features. After P0 compliance passes, optimize the complete graph, freeze its measured baseline, and allocate regression allowances by measured implementation rather than estimates:

| Runtime area                                 | Binding allowance rule                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Identity, consent, persistence, sessions     | No increase without a new invariant and before/after attribution.                               |
| Capture V1 transform and sender              | Measure the smallest compliant implementation, then freeze that result.                         |
| Analytics queue, retry, rate limit, teardown | Add one mechanism at a time; each change must report marginal gzip and attribution.             |
| Extension host                               | The shared contract and three-host suite are fixed; optional products must add zero root bytes. |
| Total root                                   | Set the release ceiling only after the complete P0/P2 compliance suite passes.                  |

A later change can spend bytes only against the frozen compliant baseline. It cannot treat the old 12 KiB aspirational threshold as available capacity.

### Phase 3: Complete the extension host

- [ ] **P3.1**: Add extension-scoped KV stores and loggers.
- [ ] **P3.2**: Add shared publishers and the extension-name registry.
- [ ] **P3.3**: Add extension setup rollback and failure isolation.
- [ ] **P3.4**: Add reverse-order disposal.
- [ ] **P3.5**: Enforce consent on extension capture, requests, and persistence.
- [ ] **P3.6**: Add a narrow host-owned lane-installation capability that returns a private typed sink to the installing product without exposing arbitrary endpoints or a lane selector on general `capture()`.
- [ ] **P3.7**: Add an optional AI fixture modeled on Python `_capture_ai` and Node `captureAi`: explicit API routing, lazy lane activation, independent queue/limits/endpoint, and coordinated flush/disposal. Keep the AI implementation outside the root graph.
- [ ] **P3.8**: Add explicit dynamic loading.

Run shared contract and adversarial lifecycle tests against browser-next.

### Phase 4: Add persistence and delivery adapters

- [ ] **P4.1**: Add cross-subdomain cookie persistence with the finalized PR #4496 semantics.
- [ ] **P4.2**: Add full legacy browser-state migration.
- [ ] **P4.3**: Add durable delivery.
- [ ] **P4.4**: Add the JavaScript compression fallback.
- [ ] **P4.5**: Add older transport fallbacks only when browser-support evidence requires them.

Each selected adapter must preserve the same core invariants. Keep its implementation outside the root graph when the root does not select it.

### Phase 5: Add remote configuration

- [ ] **P5.1**: Put remote configuration in a dynamic host module.
- [ ] **P5.2**: Load the module when an extension requests configuration.
- [ ] **P5.3**: Cache the first request.
- [ ] **P5.4**: Define timeout, retry, late-success, and permanent-failure behavior.
- [ ] **P5.5**: Publish later configuration changes.

Do not load remote configuration for direct capture users.

### Phase 6: Add the standard entry point

- [ ] **P6.1**: Add the recommended adapter and extension composition.
- [ ] **P6.2**: Keep heavy implementations behind literal dynamic imports.
- [ ] **P6.3**: Define startup order and missing-provider behavior.
- [ ] **P6.4**: Report initial and total loaded sizes.
- [ ] **P6.5**: Document deliberate differences from the `posthog-js` default composition.

### Phase 7: Port shared extensions

- [ ] **P7.1**: Add the legacy-browser `Client` adapter.
- [ ] **P7.2**: Port one extension at a time.
- [ ] **P7.3**: Keep each token module implementation-free.
- [ ] **P7.4**: Add a separate export for each extension.
- [ ] **P7.5**: Run the same behavior tests against the legacy browser and browser-next.

### Phase 8: Optimize the compliant graph

- [ ] **P8.1**: Record the first behavior-compliant packed-consumer baseline.
- [ ] **P8.2**: Inspect the consumer graph and remove accidental dependencies.
- [ ] **P8.3**: Replace broad shared utilities with measured narrow primitives.
- [ ] **P8.4**: Evaluate ESM-only publication.
- [ ] **P8.5**: Add entry points only when they produce a meaningful reduction.
- [ ] **P8.6**: Set regression budgets from the optimized compliant baseline.

### Phase 9: Release the alpha

- [ ] **P9.1**: Run unit, differential, conformance, and fault-injection tests.
- [ ] **P9.2**: Run real-browser and real-ingestion tests.
- [ ] **P9.3**: Run packed-package and size tests.
- [ ] **P9.4**: Run the read-only code review.
- [ ] **P9.5**: Promote retained differential scenarios to durable browser-next or shared conformance tests, then delete the transitional legacy adapter and dual-run layer.
- [ ] **P9.6**: Publish `@posthog/browser@2.0.0-alpha.0`.

Do not change `posthog-js` release output during the alpha.

## Release acceptance criteria

The alpha must meet these conditions:

- [ ] **A1**: The temporary behavior ledger is empty and deleted; durable tests and explicit decisions explain every retained core difference.
- [ ] **A2**: The Capture Analytics V1 harness passes for normal Fetch and the approved browser teardown path.
- [ ] **A3**: Consent, bot-filter, identity, reset, session, cross-context, normal delivery, teardown delivery, and no-throw suites pass.
- [ ] **A4**: The shared browser-client and key-value-store conformance suites pass.
- [ ] **A5**: Package import performs no storage, DOM, timer, or network work.
- [ ] **A6**: The root imports no optional product or heavy fallback implementation.
- [ ] **A7**: `createPostHog` enforces consent before analytics persistence or transmission.
- [ ] **A8**: Capture and extension failures do not break the host application.
- [ ] **A9**: Stale clients cannot restore revoked consent, old identity, or an obsolete session.
- [ ] **A10**: Extension cleanup is safe after partial setup.
- [ ] **A11**: Dynamic extensions stay outside the initial chunk.
- [ ] **A12**: CI reports initial bytes, total loaded bytes, and module attribution.
- [ ] **A13**: The useful root meets the optimized behavior-compliant budget. A missed aspirational target requires more optimization or an explicit size review, never removal of core behavior.
- [ ] **A14**: Legacy `posthog-js` behavior and CDN artifacts remain unchanged.

The first milestone is Phase 0. It turns behavioral compliance and bundle size into simultaneous, measurable constraints.
