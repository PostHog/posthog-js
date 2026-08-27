# Browser-next behavior ledger

This temporary ledger classifies browser behavior while Phase 0 converts decisions into executable gates. Delete it after every retained behavior is covered by a test, an open decision, or a server-verification gate. It is not package documentation or a published API contract.

The [Capture Analytics V1 harness](https://github.com/PostHog/posthog-sdk-test-harness/blob/78074c33e7948fe0708b1c13d7fd4faefd9b9b5f/contracts/capture_analytics_v1_tests.yaml) is the source of truth for the analytics wire contract. Use this ledger with the [implementation plan](./posthog-browser-v2-minimal-bundle-plan.md) and [bundle architecture](./packages/browser-next/ARCHITECTURE.md).

## How to use this ledger

Use one classification for each behavior:

| Code | Classification                     | Meaning                                                                                          |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| CI   | Core invariant                     | The root capture client must provide this behavior.                                              |
| OP   | Optional product behavior          | An explicit optional import provides this behavior. The root must not import its implementation. |
| CO   | Compatibility-only behavior        | An upgrade adapter or compatibility entry point can provide this behavior.                       |
| DD   | Deliberate browser-next difference | Browser-next intentionally differs from legacy `posthog-js`.                                     |
| SV   | Requires server verification       | Do not lock or release this behavior until ingestion and supported proxy paths verify it.        |

`CI` fixes behavior, not implementation. A smaller implementation is valid only when it keeps the required result.

Current-state values describe `packages/browser-next` at this checkpoint:

- **Present**: the prototype provides the required result.
- **Partial**: part of the result exists, but important cases are missing.
- **Missing**: the prototype does not provide the result.
- **Blocked**: an external contract or decision is not ready.
- **Not applicable**: browser-next intentionally excludes the legacy behavior.

Update a row when a differential test finds another behavior or when an open decision changes its classification. Add the protecting test before changing a locked result. Remove a row after its durable test or decision reference carries the requirement without losing context.

## Decision boundary

These rules are locked:

- The root client is useful without optional product imports.
- Capture uses Capture Analytics V1. The legacy `/e/` request is not parity input.
- Consent, compact bot filtering, identity, sessions, same-origin conflict safety, the analytics lane, and no-throw behavior are root invariants.
- A selected cookie adapter must preserve the required cross-subdomain identity and session semantics.
- Consent uses `__ph_opt_in_out_<project-token>` by default, supports a verbatim custom `consentPersistenceName`, and stores interoperable `0`/`1` values.
- Prior explicit denial under the configured consent key must be recognized before analytics work on every supported upgrade path. Deprecated prefix-derived keys and backend migration belong to a compatibility entry point.
- General `capture()` always selects the analytics lane. An explicit product API selects an optional lane.
- Normal analytics delivery uses Fetch. Beacon is a teardown option only after the V1 header-less contract is deployed and verified.

These decisions remain open:

- **D1**: upgrade-compatible replacement or narrower API with behavior-compatible capture.
- **D3**: reset consent and device-ID semantics.
- **D5**: root, preset, or unsupported scope for DNT and cookieless modes.
- **D6**: ESM and CommonJS publication policy. This does not change runtime behavior.
- **D7**: whether reset, idle timeout, and maximum length also rotate the window ID.

## Initialization and lifecycle

| ID      | Class | Required browser-next result                                                                                                                                                                                 | Current | Primary evidence or future gate                   |
| ------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------- |
| INIT-01 | DD    | `createPostHog()` takes one required options object with `projectToken`. Missing and empty tokens fail before client work starts.                                                                            | Present | `tests/posthog.spec.ts`                           |
| INIT-02 | CI    | Importing the package starts no storage, DOM, timer, network, listener, or global-registration work.                                                                                                         | Present | Import-only bundle and server-import fixtures     |
| INIT-03 | CI    | Missing or throwing browser globals do not crash initialization.                                                                                                                                             | Partial | `src/posthog.ts`; fault-injection gate            |
| INIT-04 | CI    | Storage, serialization, listener, extension, and transport failures do not throw into host application code.                                                                                                 | Partial | Fault-injection gate                              |
| INIT-05 | DD    | The package creates no default singleton and writes no global object.                                                                                                                                        | Present | Root import fixture                               |
| INIT-06 | CI    | Client initialization starts runtime work only after options and consent are resolved.                                                                                                                       | Partial | Differential initialization trace                 |
| INIT-07 | CI    | `flush()` snapshots active lanes, attempts each under one finite shared deadline, and settles after they drain or the deadline expires. One lane failure does not skip later lanes or reject into host code. | Missing | Lane lifecycle tests                              |
| INIT-08 | CI    | `dispose()` is idempotent, stops admission, removes listeners and timers, disposes extensions in reverse order, and drains lanes.                                                                            | Partial | `tests/extensions.spec.ts`; lifecycle fault tests |
| INIT-09 | CO    | Legacy global queue bootstrapping and named global instances stay outside the root package unless D1 requires an upgrade composition.                                                                        | Blocked | D1 and compatibility-entry tests                  |

## Consent and privacy

| ID     | Class | Required browser-next result                                                                                                                                                                        | Current | Primary evidence or future gate                                           |
| ------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------- |
| CNS-01 | CI    | Consent has pending, granted, and denied states. Capture policy distinguishes pending from explicit denial.                                                                                         | Present | `packages/browser-next/tests/consent.spec.ts`                             |
| CNS-02 | CI    | Default opt-out prevents analytics persistence and transmission until opt-in.                                                                                                                       | Present | Consent and differential default-denial scenarios                         |
| CNS-03 | CI    | Explicit denial is resolved before identity, session, extension KV, queue, or network state is created.                                                                                             | Present | Prior-denial initialization trace                                         |
| CNS-04 | CI    | Opt-out stops admission, purges queued analytics and prohibited state, cancels owned in-flight work when possible, and starts no retry. A request already handed to the browser cannot be recalled. | Present | Same-document queue/backoff interleavings                                 |
| CNS-05 | CI    | Active same-origin clients observe a newer denial before capture, persistence, or extension requests.                                                                                               | Present | Three-browser multi-tab, SDK-event, adapter, and fresh-read interleavings |
| CNS-06 | CI    | Configured extensions initialize independently of consent; the host gates their capture, delivery, `sendRequest()`, remote configuration, identity, and KV reads and writes.                        | Present | Browser-next extension output and async-setup tests                       |
| CNS-07 | CI    | The default or configured consent key uses interoperable values, and every supported upgrade path recognizes prior explicit denial before analytics work starts.                                    | Partial | Root key/value matrix present; compatibility composition open             |
| CNS-08 | CO    | Deprecated prefix-derived keys and migration between consent storage backends are supplied only by an explicit compatibility composition.                                                           | Missing | Compatibility cookie/local-storage migration fixtures                     |
| CNS-09 | OP    | If DNT support is installed, a recognized DNT value denies analytics before persistence or transmission. D5 can reclassify its package scope.                                                       | Blocked | D5; legacy consent tests                                                  |
| CNS-10 | OP    | If a cookieless mode is installed, its pending, rejection, identity, and person-processing rules apply before capture. D5 can reclassify its scope.                                                 | Blocked | D5; cookieless differential tests                                         |
| CNS-11 | CO    | Legacy automatic `$opt_in` capture and deprecated consent option aliases do not enter root unless D1 requires them.                                                                                 | Blocked | D1; compatibility adapter tests                                           |
| CNS-12 | CI    | Consent storage failures fail closed for explicit denial and do not make telemetry failures visible as host exceptions.                                                                             | Present | Read/write/remove/subscription/listener fault injection                   |

## Bot filtering

| ID     | Class | Required browser-next result                                                                                                                                        | Current | Primary evidence or future gate           |
| ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------- |
| BOT-01 | CI    | The compact approved user-agent set is checked before identity, session, persistence, queue, or network mutation.                                                   | Partial | `src/bot-filter.ts`; initialization trace |
| BOT-02 | CI    | `navigator.webdriver` is blocked unless bot filtering is explicitly disabled.                                                                                       | Present | `tests/posthog.spec.ts`                   |
| BOT-03 | CI    | Configured additional blocked user-agent fragments extend the built-in set without mutating global state.                                                           | Present | `tests/posthog.spec.ts`                   |
| BOT-04 | CI    | Missing navigator data or a throwing navigator getter does not throw and fails open. This safety fallback must not mutate state before capture otherwise qualifies. | Partial | Navigator fault injection                 |
| BOT-05 | DD    | Browser-next keeps a compact local detector instead of importing the larger shared `@posthog/core` detector graph.                                                  | Present | Root module-attribution fixture           |

## Identity, groups, and reset

| ID    | Class | Required browser-next result                                                                                                                                                                                        | Current | Primary evidence or future gate                                 |
| ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------- |
| ID-01 | CI    | Device ID, anonymous ID, and current distinct ID are separate state fields.                                                                                                                                         | Present | Browser-next identity persistence and reset tests               |
| ID-02 | CI    | Anonymous capture uses a stable anonymous ID and device ID across reloads when persistence is available.                                                                                                            | Partial | Persistence/reload scenarios                                    |
| ID-03 | CI    | The first anonymous-to-identified transition emits one `$identify` with the previous anonymous ID and the new distinct ID.                                                                                          | Partial | Differential identify scenarios and Capture V1 assertions       |
| ID-04 | CI    | Identify preserves the anonymous ID needed by feature evaluation and later linkage.                                                                                                                                 | Partial | Identity plus feature-flags conformance tests                   |
| ID-05 | CI    | Repeating `identify()` with the same identified ID does not create another identity transition. A same-ID anonymous call marks the state identified. Supplied person properties produce the defined mutation event. | Present | Differential repeated-identify plus browser-next same-ID tests  |
| ID-06 | CI    | An identified-to-identified change atomically updates the current distinct ID without `$identify` or anonymous relinking. Supplied person properties produce one mutation event.                                    | Partial | Differential identified-switch scenario; property case          |
| ID-07 | CI    | Empty, whitespace-only, malformed, or dangerous distinct IDs are rejected without state mutation or delivery.                                                                                                       | Present | `packages/browser-next/tests/posthog.spec.ts` invalid-ID corpus |
| ID-08 | DD    | The typed browser-next API accepts string IDs. Legacy numeric-ID coercion is not part of root behavior.                                                                                                             | Present | Type and runtime API tests                                      |
| ID-09 | CI    | Group membership is persisted, merged into analytics events, and updated atomically with group-identify capture. Repeating the same key without properties is a no-op.                                              | Partial | Differential group scenarios; persistence and V1 wire gates     |
| ID-10 | CI    | Reset clears identified user state, groups, user-scoped properties, and session state, then creates a new anonymous identity.                                                                                       | Partial | Differential reset scenario; user-property persistence gate     |
| ID-11 | CI    | D3 defines whether reset preserves or rotates the device ID. The result must be atomic across active contexts.                                                                                                      | Blocked | D3; reset interleaving tests                                    |
| ID-12 | CI    | D3 defines whether reset clears explicit consent. Reset must never accidentally resume denied capture.                                                                                                              | Blocked | D3; consent/reset matrix                                        |
| ID-13 | CI    | The extension-facing client exposes `deviceId` and initial person properties with live, readonly semantics.                                                                                                         | Present | Browser-next extension client tests                             |
| ID-14 | CO    | Legacy `alias()`, People APIs, super-property aliases, and identity bootstrap options stay in a compatibility composition unless D1 promotes them.                                                                  | Blocked | D1; compatibility adapter tests                                 |

## Sessions and windows

| ID     | Class | Required browser-next result                                                                                         | Current | Primary evidence or future gate                                         |
| ------ | ----- | -------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| SES-01 | CI    | A session starts on the first eligible activity, not package import.                                                 | Present | Lazy-session and import-purity tests                                    |
| SES-02 | CI    | Inactivity beyond the configured/default idle timeout rotates the session.                                           | Present | Strict-boundary and differential scenarios                              |
| SES-03 | CI    | A session rotates at the maximum length even when activity continues.                                                | Present | Continuous-activity and differential scenarios                          |
| SES-04 | CI    | Same-origin tabs share the active session but use distinct window IDs.                                               | Present | Unit and three-browser multi-tab tests                                  |
| SES-05 | CI    | A window ID survives an ordinary reload when supported and does not leak into a duplicated or independent tab.       | Present | Chromium, Firefox, and WebKit reload/copied-tab tests                   |
| SES-06 | CI    | A stale tab reads fresh shared session state before activity, rotation, reset, and unload writes.                    | Present | Activity, adoption, reset, and unload interleavings                     |
| SES-07 | CI    | A stale tab cannot overwrite a newer sibling session or move activity time backwards.                                | Present | Session revisions, reset tombstones, stale-write preservation, unload   |
| SES-08 | CI    | Activity persistence is throttled well below the minimum idle timeout without making cross-tab idle decisions stale. | Present | Controlled-clock sibling-activity tests                                 |
| SES-09 | CI    | Session changes publish one notification with the correct reason after state is committed.                           | Partial | Local rotation/reset reasons pass; adoption has no public reason        |
| SES-10 | CI    | Reset creates a new session and window state according to D7 without reviving stale session state.                   | Present | Differential, consent-race, and multi-tab reset tests                   |
| SES-11 | CO    | Legacy bootstrap session IDs and deprecated session option aliases stay outside root unless D1 requires them.        | Blocked | D1; compatibility composition tests                                     |
| SES-12 | CI    | Session storage and timer failures do not throw and do not permit stale shared-state writes.                         | Partial | Storage/listener faults and no-timer tests; equal-revision races remain |

## Persistence and cross-context safety

| ID     | Class | Required browser-next result                                                                                                                         | Current | Primary evidence or future gate                                |
| ------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------- |
| PER-01 | CI    | The default persistent composition uses same-origin local storage; `storage: false` keeps state in memory.                                           | Present | `tests/posthog.spec.ts`                                        |
| PER-02 | CI    | Reads used for identity, consent, and session decisions refresh shared state first.                                                                  | Partial | Consent and session fresh reads present; identity refresh open |
| PER-03 | CI    | Writes merge or compare the fields they own. A stale whole-record snapshot cannot erase a newer identity, consent, session, or extension value.      | Missing | `packages/browser/src/__tests__/cross-tab-persistence.test.ts` |
| PER-04 | CI    | Failed reads, writes, removal, and malformed JSON do not throw. In-memory state remains internally consistent.                                       | Partial | Storage fault injection                                        |
| PER-05 | CI    | Extension KV conforms to `KeyValueStore`: initialization, synchronous buffered reads, batch reads, object writes, and multi-key removal.             | Present | Browser-next KV contract tests                                 |
| PER-06 | CI    | Extension namespaces cannot change object prototypes or read another extension's values.                                                             | Present | `tests/extensions.spec.ts`                                     |
| PER-07 | OP    | A cookie adapter is optional. When selected, it reconciles cross-subdomain identity and session state, propagates removal, and rejects stale writes. | Missing | Final PR #4496 corpus                                          |
| PER-08 | OP    | The cookie adapter preserves local-only properties while reconciling shared identity/session fields.                                                 | Missing | Final PR #4496 corpus                                          |
| PER-09 | CO    | Full legacy identity, group, super-property, session, and product-state migration is an explicit upgrade adapter.                                    | Missing | D1 migration matrix                                            |
| PER-10 | CI    | Explicit denial prevents analytics and extension persistence even when an adapter is installed.                                                      | Missing | Consent/adapter conformance tests                              |

## Event construction

| ID     | Class | Required browser-next result                                                                                                                                                                             | Current | Primary evidence or future gate                                    |
| ------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| EVT-01 | CI    | `capture()` no-ops when disposed, blocked as a bot, denied by consent, invalid, or locally rate limited.                                                                                                 | Partial | Differential final-event tests                                     |
| EVT-02 | CI    | Capture copies caller input. Later caller mutation cannot alter a queued event.                                                                                                                          | Partial | Input mutation tests                                               |
| EVT-03 | CI    | Property precedence is explicit: host defaults, dynamic properties, caller properties, then protected protocol fields.                                                                                   | Partial | Collision matrix                                                   |
| EVT-04 | CI    | Caller properties cannot override token/authentication, distinct ID, UUID, timestamps, session/window IDs, SDK metadata, or lane selection.                                                              | Partial | Protected-field tests                                              |
| EVT-05 | CI    | Serialization uses JSON value semantics: omit unsupported object values and use `null` in arrays. Cycles, BigInt, and throwing access drop the event locally with a safe diagnostic. No failure escapes. | Missing | Serialization fault corpus                                         |
| EVT-06 | CI    | Event names are validated. Empty and whitespace-only names cause no state or queue mutation.                                                                                                             | Present | `packages/browser-next/tests/posthog.spec.ts` invalid-event corpus |
| EVT-07 | CI    | Every admitted event receives one UUID and timestamp before it enters a queue. Retries preserve both.                                                                                                    | Partial | Controlled ID/clock tests                                          |
| EVT-08 | CI    | `$set`, `$set_once`, `$unset`, and `$groups` remain in V1 event `properties`.                                                                                                                            | Present | Capture V1 transform tests                                         |
| EVT-09 | CI    | Session and window IDs are promoted to V1 root fields and are not duplicated as stale protocol properties.                                                                                               | Present | Capture V1 transform tests                                         |
| EVT-10 | CI    | `$lib` and `$lib_version` are not event properties in V1. `PostHog-Sdk-Info` carries SDK attribution.                                                                                                    | Present | Capture V1 harness                                                 |
| EVT-11 | CI    | Typed V1 controls are coerced to supported strict types or omitted. One malformed control cannot reject the batch.                                                                                       | Present | Capture V1 options corpus                                          |
| EVT-12 | CI    | Per-event and per-batch byte limits are checked before transport. An oversized single event is dropped locally with name-and-byte-count diagnostics only; later lane work remains usable.                | Partial | 8 MiB local finalized-message limit present; V1 live limits open   |
| EVT-13 | CI    | `onEvent` observes a deeply readonly copy of the finalized admitted analytics event. Listener failure is isolated.                                                                                       | Present | Admission, oversize, consent-race, and host-conformance tests      |
| EVT-14 | CO    | Legacy `before_send`, property denylist aliases, sanitizers, and broad super-property APIs stay in a compatibility composition unless D1 promotes them.                                                  | Blocked | D1; differential hook tests                                        |
| EVT-15 | OP    | Feature flags can register dynamic event properties and capture exposure events through the analytics lane.                                                                                              | Missing | Feature-flags extension tests                                      |

## Capture Analytics V1 wire contract

Legacy `/e/`, `/batch/`, `/capture/`, `/track/`, and `/i/v0/e/` behavior is not parity input for this section.

| ID    | Class | Required browser-next result                                                                                                                                                  | Current | Primary evidence or future gate                                          |
| ----- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| V1-01 | DD    | The analytics lane sends `POST /i/v1/analytics/events`.                                                                                                                       | Present | Capture V1 harness                                                       |
| V1-02 | DD    | Fetch sends Bearer authorization, JSON content type, SDK info, attempt, request ID, request timestamp, and truthful content encoding.                                         | Present | Capture V1 harness                                                       |
| V1-03 | DD    | Browser code does not try to set the forbidden `User-Agent` header.                                                                                                           | Present | Browser Fetch assertion                                                  |
| V1-04 | DD    | The body is `{ created_at, batch }`. It contains no project token, `api_key`, or `sent_at`.                                                                                   | Present | Capture V1 harness                                                       |
| V1-05 | DD    | Every event contains `event`, `uuid`, `distinct_id`, `timestamp`, `options`, `properties`, and optional promoted session/window IDs.                                          | Present | Capture V1 harness                                                       |
| V1-06 | DD    | `options` is always an object and is `{}` when empty.                                                                                                                         | Present | Capture V1 harness                                                       |
| V1-07 | DD    | A 2xx UUID-keyed results map treats `ok` and `warning` as accepted, `drop` as terminal, and `retry` as the only per-event retry instruction.                                  | Present | Capture V1 harness                                                       |
| V1-08 | DD    | Partial retry keeps only retry-marked events and preserves event UUIDs/timestamps, request ID, and batch `created_at`. It increments attempt and refreshes request timestamp. | Present | Capture V1 harness                                                       |
| V1-09 | DD    | Unknown result codes and missing UUID results are terminal successes.                                                                                                         | Present | Capture V1 harness                                                       |
| V1-10 | DD    | Transport and approved transient failures use bounded exponential backoff, jitter, and `Retry-After` as a minimum.                                                            | Present | Capture V1 retry tests                                                   |
| V1-11 | DD    | Validation, authentication, billing, payload-size, media-type, and V1 rate-limit responses are terminal unless the canonical contract changes.                                | Present | Capture V1 status matrix                                                 |
| V1-12 | SV    | Direct regional hosts and supported reverse proxies pass CORS preflight and forward all required headers unchanged.                                                           | Partial | Direct browser/live Cloud and local proxy passed; deployed proxy pending |
| V1-13 | SV    | Compression encodings, per-event limits, batch limits, duplicate UUID handling, and missing-result behavior match deployed ingestion.                                         | Blocked | Live project and harness tests                                           |
| V1-14 | DD    | The legacy browser wire-envelope fixture remains a legacy test only. It cannot approve browser-next analytics delivery.                                                       | Present | `packages/browser/src/__tests__/posthog-core.wire-envelope.test.ts`      |

## Delivery lanes and reliability

| ID     | Class | Required browser-next result                                                                                                                                                                                                                                                                    | Current | Primary evidence or future gate                                |
| ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------- |
| DLV-01 | CI    | The root statically contains one analytics lane with one bounded queue.                                                                                                                                                                                                                         | Present | Root attribution and bounded queue tests                       |
| DLV-02 | CI    | A lane owns admission, size limits, queue, flush thresholds, endpoint, serializer, compression, transport, response classification, and retry policy.                                                                                                                                           | Present | Lane scheduling, Capture V1, and bounded delivery tests        |
| DLV-03 | CI    | Events with different endpoints, wire formats, limits, or retry rules never share a queue or batch.                                                                                                                                                                                             | Missing | Mixed-lane tests                                               |
| DLV-04 | CI    | Failure in one lane cannot requeue or resend an event accepted in another lane.                                                                                                                                                                                                                 | Missing | Route-isolation tests                                          |
| DLV-05 | CI    | Normal analytics flush uses Fetch and processes the complete V1 response before it removes or retries events.                                                                                                                                                                                   | Present | Capture V1 sender and retained-retry flush tests               |
| DLV-06 | CI    | Queued count, active-plus-queued byte, and queued-residence thresholds are bounded. Reclaim the oldest queued prefix before admitting new work when possible; active bytes cannot be recalled and may force rejection. Report aggregate local loss without payload data or throwing.            | Present | Count/byte/age, active/retry, barrier, and fault tests         |
| DLV-07 | CI    | Request timeout, retry count, elapsed retry time, and backoff are bounded. Disposal cannot leave retry timers active.                                                                                                                                                                           | Present | Time budgets, active cancellation, and shutdown tests          |
| DLV-08 | CI    | Offline state pauses avoidable sends and reconnect triggers prompt bounded retry without a request storm.                                                                                                                                                                                       | Present | Offline staging, race, and reconnect tests                     |
| DLV-09 | CI    | A compact client rate limiter stops runaway capture loops and makes aggregate local drops observable without recursively rate limiting its warning.                                                                                                                                             | Present | Token-bucket and capture integration tests                     |
| DLV-10 | CI    | Server rate or quota state is scoped to the affected lane/product and does not block unrelated lanes.                                                                                                                                                                                           | Missing | Lane rate-limit tests                                          |
| DLV-11 | CI    | `pagehide` is the primary teardown signal. `unload` is a compatibility fallback. Listeners start at initialization and are removed at disposal.                                                                                                                                                 | Present | Jest listener tests and three-browser pagehide test            |
| DLV-12 | CI    | Teardown starts no asynchronous compression or retry timers. It attempts only data that fits one aggregate keepalive budget.                                                                                                                                                                    | Present | Exact UTF-8 aggregate-budget lifecycle tests                   |
| DLV-13 | CI    | Until V1 Beacon support is verified, teardown uses immediate Fetch with `keepalive: true` and normal V1 headers.                                                                                                                                                                                | Present | Header/body tests and native three-browser handoff             |
| DLV-14 | SV    | Analytics Beacon is enabled only after backend and proxy support for the V1 header-less query contract is deployed and tested.                                                                                                                                                                  | Blocked | Backend/proxy/live verification                                |
| DLV-15 | CI    | Beacon success means browser handoff only. It never marks server acceptance, parses event results, or starts response-based retry.                                                                                                                                                              | Missing | Beacon handoff tests                                           |
| DLV-16 | OP    | Durable delivery can add IndexedDB, longer retries, and offline persistence without changing analytics wire semantics.                                                                                                                                                                          | Missing | Durable adapter tests                                          |
| DLV-17 | CI    | Configurable count and interval thresholds trigger normal delivery; explicit flush and shutdown bypass them, and disposal removes their timers.                                                                                                                                                 | Present | Lane and public analytics scheduling tests                     |
| DLV-18 | CI    | Retry-exhausted transient work remains bounded and FIFO for a later drive; one flush attempt resolves without hot-looping, while shutdown blocks capture and performs one timeout-bounded final drive.                                                                                          | Present | Retained-retry, flush, cancellation, and shutdown tests        |
| DLV-19 | CI    | The accessible root loads analytics once after the first admitted event, forwards a stable scheduling snapshot, reuses preinstalled marked analytics delivery, retains work on import failure, and coordinates flush/shutdown; `analytics: false` and the core entry preserve manual buffering. | Present | Automatic analytics selection, race, failure, and bundle tests |

## Standard preset and product behavior

These rows classify observable product behavior even though the implementations stay outside the root. A product port needs its own detailed conformance corpus before its entry point can ship.

| ID     | Class | Required browser-next result                                                                                                                                                                                                                             | Current | Primary evidence or future gate                                  |
| ------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| PRD-01 | OP    | Browser context reads URL, path, host, referrer, browser, OS, device, screen, locale, and timezone at event time where applicable. Missing or hostile DOM values do not throw or block capture.                                                          | Missing | Legacy event-property corpus and browser-context extension tests |
| PRD-02 | OP    | Page-view capture emits one `$pageview` for each configured navigation, assigns stable page-view state, includes the finalized URL/title context, and does not duplicate history transitions.                                                            | Missing | Legacy page-view tests and real-browser navigation tests         |
| PRD-03 | OP    | Page-leave capture closes the active page view once, computes duration from that view, uses the teardown path when needed, and does not emit a leave without matching page state.                                                                        | Missing | Legacy page-view/pageleave tests and lifecycle tests             |
| PRD-04 | OP    | Campaign attribution parses the supported campaign and click-ID parameters, preserves first-touch values separately from current values, updates on later landings as specified, and never captures URL hash/query data outside the approved properties. | Missing | Legacy campaign, referrer, and person-processing tests           |
| PRD-05 | OP    | Autocapture observes only configured interactions, applies masking and element/property allow/deny rules before capture, and removes all DOM listeners on disposal.                                                                                      | Missing | Legacy autocapture unit and real-browser corpus                  |
| PRD-06 | OP    | Feature flags request evaluation for the current identity/groups, cache namespaced results, reload after relevant identity changes, expose typed values/payloads, and deduplicate `$feature_flag_called` according to the selected policy.               | Missing | Legacy feature-flag and shared extension conformance tests       |
| PRD-07 | OP    | Error tracking converts supported failures to the canonical exception event without throwing, deduplicates already-captured errors, applies privacy controls, and removes global handlers on disposal.                                                   | Missing | Legacy exception-autocapture corpus                              |
| PRD-08 | OP    | Replay starts only after consent and product configuration allow it, preserves lazy-bundle compatibility, applies masking before serialization, keeps recording delivery in its own lane, and stops fully on opt-out/disposal.                           | Missing | Replay compatibility, privacy, lifecycle, and real-browser tests |
| PRD-09 | OP    | Surveys load only when configured, evaluate targeting with feature flags, expose explicit controls, and remove UI/listeners/state on disposal or ineligibility.                                                                                          | Missing | Legacy surveys conformance and browser tests                     |
| PRD-10 | OP    | Product tours load only when configured, evaluate targeting, isolate rendered content from executable customer-page behavior, and clean up all UI/listeners on disposal.                                                                                 | Missing | Product-tour targeting, sanitization, and browser tests          |
| PRD-11 | OP    | Web vitals observe the supported metrics, attach the correct page/session context, avoid duplicate reports, and disconnect observers on disposal.                                                                                                        | Missing | Legacy web-vitals and navigation tests                           |
| PRD-12 | OP    | Logs use a dedicated lane with bounded records/batches/retries, privacy-safe console capture when selected, product-scoped rate limiting, teardown drain, and no recursion into SDK diagnostics.                                                         | Missing | Legacy logs queue, retry, console, and unload tests              |
| PRD-13 | OP    | Metrics use a dedicated lane with bounded aggregation/flush, product-scoped failures, timeout settlement, teardown drain, and no effect on analytics acceptance.                                                                                         | Missing | Legacy metrics batching and unload tests                         |
| PRD-14 | OP    | Tracing header injection is an explicit import, matches only configured hosts, preserves caller request semantics, and never patches global Fetch/XHR from the root package.                                                                             | Missing | Legacy tracing-header request corpus                             |
| PRD-15 | OP    | Remote configuration starts only for installed products, has bounded request and parse behavior, publishes a stable outcome, and cannot publish product configuration after consent revocation or disposal.                                              | Partial | Remote-config extension and delayed-response tests               |
| PRD-16 | OP    | The standard preset statically installs only its approved small startup extensions and dynamically imports configured large products. Initial and total loaded size are reported separately.                                                             | Missing | Standard-preset behavior and bundle fixtures                     |
| PRD-17 | OP    | Omitting a product import removes its implementation and prevents its listeners, storage, timers, requests, and lanes from starting.                                                                                                                     | Partial | Per-entry static/dynamic bundle and side-effect fixtures         |

## Extensions and optional products

| ID     | Class | Required browser-next result                                                                                                                       | Current | Primary evidence or future gate                         |
| ------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| EXT-01 | CI    | The host implements the shared `@posthog/browser-common` `Client` and `Extension` contracts.                                                       | Present | Shared legacy/browser-next/TestClient conformance suite |
| EXT-02 | CI    | Extension setup failure rolls back partial installation. One extension failure does not break capture or another extension.                        | Partial | `tests/extensions.spec.ts`                              |
| EXT-03 | CI    | Extensions have isolated KV and logger scopes. The client invokes final disposal once in reverse installation order.                               | Partial | `tests/extensions.spec.ts`                              |
| EXT-04 | CI    | The registry contains only supplied and internally loaded instances. It has no static product catalog.                                             | Present | Root module attribution                                 |
| EXT-05 | CI    | A literal dynamic import creates the optional chunk before client creation or inside a product-specific package API.                               | Missing | Dynamic consumer fixtures                               |
| EXT-06 | OP    | Feature flags install as an explicit extension, use the flags request target, persist only their namespace, and expose a typed factory handle.     | Missing | Feature-flags extension suite                           |
| EXT-07 | OP    | AI capture installs an explicit private lane. `captureAi()` selects it; `capture('$ai_generation')` remains analytics.                             | Missing | AI lane fixture                                         |
| EXT-08 | OP    | An optional lane activates lazily, enforces independent limits, and joins host flush/disposal without exposing an arbitrary endpoint or lane name. | Missing | AI lane and bundle fixtures                             |
| EXT-09 | OP    | Replay, surveys, web vitals, logs, metrics, traces, and other products remain outside the root graph.                                              | Present | Forbidden-module bundle gate                            |
| EXT-10 | OP    | Remote configuration starts only when an installed product requests it, has a bounded timeout, and isolates malformed responses and listeners.     | Partial | Remote-config extension tests                           |
| EXT-11 | CI    | Optional product omission removes its implementation from the bundle.                                                                              | Partial | Static and dynamic consumer fixtures                    |

## Required gate mapping

Phase 0 work protects these groups:

| Phase task                        | Ledger coverage                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0.2 differential harness         | Initialization, consent, bot filtering, identity, sessions, event construction, lifecycle, no-throw results, and observable standard/product scenarios |
| P0.3 legacy regression port       | `CNS-*`, `ID-*`, `SES-*`, `EVT-*`, `DLV-06` through `DLV-11`                                                                                           |
| P0.3 Capture V1 port              | `V1-*`, `EVT-07` through `EVT-12`, `DLV-05`, `DLV-07`, `DLV-12`, `DLV-13`, and `DLV-15`                                                                |
| P0.4 same-origin interleavings    | `CNS-05`, `ID-11`, `ID-12`, `SES-04` through `SES-10`, and `PER-02` through `PER-04`                                                                   |
| P0.5 cookie corpus                | `PER-07`, `PER-08`, and `PER-10`                                                                                                                       |
| P0.6 fault injection              | `INIT-03`, `INIT-04`, `CNS-12`, `BOT-04`, `SES-12`, `PER-04`, `EVT-05`, local teardown, and delivery failures                                          |
| P0.7 live Capture V1 verification | `V1-12`, `V1-13`, compression, limits, and proxy paths                                                                                                 |
| P0.8 Beacon verification          | Server/proxy portion of `DLV-14`; P0.3 and P0.6 protect local teardown behavior in `DLV-12`, `DLV-13`, and `DLV-15`                                    |
| P0.9 bundle fixtures              | `INIT-02`, `BOT-05`, `DLV-01`, `PRD-16`, `PRD-17`, `EXT-04`, `EXT-05`, `EXT-09`, and `EXT-11`                                                          |

## Change rule

For each runtime change:

1. Name the ledger row.
2. Add or identify its differential, conformance, fault, or live test.
3. Keep optional implementation imports outside the root.
4. Update the row's current state only after the protecting test passes.
5. Add a new row when the harness finds unclassified behavior.

Do not weaken a `CI` row to meet a bundle target. Reclassify a row only with an explicit product decision and update the implementation plan in the same change.
