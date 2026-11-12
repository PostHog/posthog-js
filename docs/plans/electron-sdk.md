# Dedicated PostHog Electron SDK — investigation and implementation plan

Status: first analytics/flags alpha implemented in this worktree, with a runnable Electron example and local runtime validation. The later browser-integration and GA milestones remain a roadmap, not a completion claim.

## Recommendation

Add `packages/electron` to this monorepo, provisionally published as **`@posthog/electron`**, with explicit `/main`, `/preload`, and `/renderer` entrypoints.

Use **`@posthog/core`'s stateful client in main**, not two independently initialized browser/Node clients. Main owns identity, consent, sessions, feature flags, persistent state, and delivery. A small preload bridge connects renderer code to that client. Reuse `posthog-js` for DOM-specific features in a subsequent integration stage. Reuse Node error-tracking utilities selectively rather than inheriting the entire server SDK.

The first usable release should provide coordinated product analytics and feature flags across main and renderer. Browser autocapture and automatic JavaScript error tracking should have separate acceptance gates. Session replay is deferred entirely: no recorder, replay APIs, replay transport/storage, or playback validation is included in this plan. Native crash reporting, minidump ingestion and native symbolication are also explicitly out of scope; no investigation or implementation is planned here. Surveys and product tours are deferred entirely and are not release prerequisites.

**Important distinction:** PostHog already supports browser analytics and DOM replay inside Electron through `posthog-js`. The dedicated SDK adds first-class main-process capture, cross-window state, durable desktop delivery, lifecycle integration, and secure setup—not a new DOM recorder.

## Investigation baseline

- Worktree: `/Users/marandaneto/Github/posthog-js-electron-plan`, branch `feat/electron-sdk`.
- PostHog source: `b64482a18cb26d29b7e2b760f344d7af2ad9823a`.
- Sentry source: `/Users/marandaneto/Github/sentry-electron`, `fa4d330cac9dc0395f5f9d963bc8990dafd6572a`.
- Published SDK contracts inspected at [sdk-specs `4a9e0e7`](https://github.com/PostHog/sdk-specs/tree/4a9e0e7005260dbd198cd67c6ab6579c64679913/openspec/specs): setup, capture, identify, reset, session manager, storage, consent gating, flag cache, application lifecycle, event batcher, shutdown, and replay privacy.
- Existing local PostHog Electron tutorial: `/Users/marandaneto/Github/posthog.com/contents/tutorials/electron-analytics.mdx`. It uses the browser full/no-external bundle; it does not establish a coordinated main/renderer client.
- Electron references: [security](https://www.electronjs.org/docs/latest/tutorial/security), [IPC](https://www.electronjs.org/docs/latest/tutorial/ipc), [sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox), [ES modules](https://www.electronjs.org/docs/latest/tutorial/esm).

This is a static architecture investigation, not proof that the proposed composition works. Existing dirty changes in the invoking PostHog checkout and other checkouts were left untouched.

## What Sentry actually does

Paths in this table are relative to the Sentry checkout above.

| Area                    | Observed design                                                                                                                                                                                                           | What PostHog should take from it                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process separation      | `package.json`, `src/index.ts`, `src/main/sdk.ts:171–249`, `src/renderer/sdk.ts:36–119`: explicit process entrypoints; main wraps NodeClient; renderer wraps the browser client and forwards delivery to main.            | Explicit imports and one main delivery/policy owner. Electron is an adapter layer, not an independently rebuilt SDK stack.                                                    |
| Preload                 | `src/preload/index.ts:1–57`, `src/main/integrations/preload-injection.ts:10–58`: a sandbox-compatible bridge, optionally injected into configured Electron sessions.                                                      | Ship a small standalone bundled preload and a helper for apps that already bundle their own preload. Start with explicit installation rather than invisible global injection. |
| Renderer initialization | `src/renderer/sdk.ts:73–115`: duplicate-init guard; main-owned release/environment; browser transport replaced with IPC.                                                                                                  | Bridge installation and renderer instrumentation are separate steps. Injecting a preload does **not** initialize browser instrumentation.                                     |
| Delivery                | `src/renderer/transport.ts:12–57`, `src/main/transports/electron-offline-net.ts`, `offline-store.ts`: renderer hands off envelopes; main owns Electron networking and a bounded disk queue.                               | Desktop apps need persistence, restart recovery, network policy, and an explicit acknowledgment contract. Renderer handoff is not successful server delivery.                 |
| Shared context          | `src/renderer/integrations/scope-to-main.ts`, `src/main/ipc.ts:390–425`: renderer scopes merge into shared main scope.                                                                                                    | Do **not** copy this as analytics identity synchronization. It is not a bidirectional identify/reset protocol, and empty user updates do not clear main user there.           |
| Alternate IPC           | `src/main/ipc.ts:526–603`: a custom fetch protocol, privileged scheme registration, and renderer-ID discovery.                                                                                                            | Avoid this complexity/CSP bypass by default. A dedicated preload is the initial supported path.                                                                               |
| Shutdown                | `src/main/sessions.ts:234–274`, `src/main/store.ts`: bounded quit work plus special handling for Windows session-end and abrupt exit paths.                                                                               | Treat normal quit, app exit, crashes, sleep, and OS shutdown as different cases. Never promise every final event can be flushed.                                              |
| Native crashes          | `src/main/integrations/sentry-minidump/index.ts`: Electron crashReporter, minidump harvesting/parsing, persisted previous-run context. `src/native/event-loop-blocked-integration.ts`: separate optional native detector. | Native crash/minidump support requires its own ingestion and symbolication design; main-thread hang detection is another distinct capability.                                 |
| Validation              | `test/e2e/test-apps`, `test/e2e/versions.json`, package postbuild checks: real Electron applications, packed SDK, process-specific errors and offline/exit scenarios.                                                     | Mocked `electron` unit tests alone are insufficient. Test the installed tarball in packaged applications.                                                                     |

Sentry's inspected main IPC handlers are not a security template: sender/frame/origin authorization and comprehensive runtime payload validation must be explicit requirements for our bridge. This is an observation about the inspected boundary, not a complete Sentry security audit.

## What we can reuse in PostHog

| Existing component                                                                                                 | Reuse                                                                                                                                                                    | Missing Electron work                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/posthog-core.ts`                                                                                | Stateful identify/reset, anonymous/distinct IDs, groups/super properties, sessions, client flags and before-send behavior.                                               | Electron initialization, durable storage, networking, lifecycle, bridge, state notifications and cross-process ordering.                                       |
| `packages/core/src/posthog-core-stateless.ts`                                                                      | Capture queue, batching, serialization, retry machinery, flush/shutdown; abstract fetch/storage/library methods around lines 402–418; `flushStorage()` around line 1244. | File-backed implementation and durability policy. Verify rather than assume offline retry behavior meets desktop requirements.                                 |
| `packages/react-native/src/posthog-rn.ts`                                                                          | Reference implementation of a stateful core adapter with asynchronous storage readiness, app context, lifecycle and storage flush integration.                           | Borrow the pattern, not React Native dependencies or its replay/native bridge.                                                                                 |
| `packages/browser/src/entrypoints/module.full.no-external.es.ts`, `packages/browser/full/no-external/package.json` | Existing DOM autocapture, rrweb replay, surveys, JS error capture and other bundled extensions without remote script loading.                                            | Supported external identity/session/flag and transport seams. Electron-safe defaults and per-window coordination.                                              |
| `packages/node/src/client.ts:170`, `packages/node/src/entrypoints/index.node.ts`                                   | Node exception parsing/coercion, release/source-context patterns, optional compression utilities.                                                                        | Server client is stateless and uses memory storage. It is not an app identity/session manager. Move narrowly reusable internals to shared code only if needed. |
| `packages/core/src/error-tracking`                                                                                 | Shared exception builders, JS stack parsers, coercers and metadata helpers.                                                                                              | Process-specific interception, renderer serialization and release/path normalization.                                                                          |
| Existing tooling                                                                                                   | pnpm workspace, Turbo, package builds/types, Vitest, Changesets, sourcemap-upload plugins and trusted publishing.                                                        | Electron packed-consumer tests, supported-version policy, npm package onboarding and documentation.                                                            |

### The browser adapter is a real implementation gap

The current browser configuration selects XHR/fetch; it does not expose a documented arbitrary IPC transport. `PostHog._send_request()` is an internal method. `before_send` can transform/drop a capture but is **not** a transport: dropping there changes acceptance/accounting semantics and misses other request classes.

Browser identity/session bootstrap exists (`packages/types/src/posthog-config.ts:184–225`), but bootstrap alone does not synchronize later identify/reset, session rotation, or other windows. Browser `SessionIdManager` (`packages/browser/src/sessionid.ts`) is separate from core's session implementation. Bootstrap alone is therefore not a substitute for authoritative cross-process state updates.

Therefore, do not ship a wrapper that monkeypatches private browser fields or forwards captures through `before_send`. Prototype and add a narrow supported internal adapter seam, with browser regression tests, before claiming integrated browser feature support. Avoid a broad SDK refactor.

## Proposed architecture

```text
main application calls ---------> Electron main client (stateful @posthog/core)
                                           |
renderer application calls                | owns identity / consent / sessions /
   -> renderer facade                     | flags / durable queues / HTTP
   -> contextBridge preload               |
   -> validated, ordered IPC -------------+
                                           |
                                           +--> existing PostHog ingestion APIs

later: renderer browser instrumentation
   -> local privacy/masking + browser adapter
   -> validated IPC -> main delivery routes

main authoritative state -> revisioned snapshots -> every authorized renderer
```

### 1. Main client

- Configure once per project/instance, before creating instrumented windows. Use `projectToken` and host in main; return a handle with explicit readiness. Restore storage/consent before releasing startup captures. Defer Electron network calls until the app is ready.
- Default to one app-wide identity across authorized windows. Supporting simultaneous unrelated accounts in different windows is **not** implicit; require separately scoped instances or defer it explicitly.
- Own the public project token, configuration, identify/reset/group/register mutations, consent, flags, session state and network endpoints. The project token is public; never embed personal API keys or local-evaluation secrets in a desktop binary.
- Expose main capture, identify/reset, groups, super properties, client flag APIs, flush and shutdown. Add handled JS exception capture using core builders, either in the MVP or the immediately following error-tracking milestone.
- Identify as the Electron SDK on the wire; decide the exact library name (`posthog-electron` proposed). Main and renderer events must not accidentally look like unrelated Node/web installations.

### 2. Renderer facade and preload

- Renderer entrypoint is browser-safe: no imports of Electron/Node built-ins. Preload exposes named SDK operations and sanitized subscription callbacks through `contextBridge`, never raw `ipcRenderer`, arbitrary channel names or IPC event objects.
- Ship a standalone **bundled CJS preload** that requires only Electron's allowed sandbox APIs, plus a source-level helper for applications that bundle a combined preload. Sandboxed preloads cannot require arbitrary npm modules or use native ESM imports; an unbundled helper import is not sufficient.
- Initial setup is explicit: install/compose preload, initialize main, register trusted window/webContents before navigation, then initialize the renderer facade. Support custom Electron partitions through explicit registration, without instrumenting unrelated windows or embedded remote content.
- Use asynchronous handshake/readiness and cached synchronous getters where useful; do not introduce synchronous IPC just to imitate browser API return types. Clearly document unavailable-before-ready results.
- Propose awaitable identity/consent mutations and a renderer `flush()` that waits for handoff and main flush under one deadline. Capture remains nonblocking, with bounded startup buffering. Final names and return types need API agreement.
- Do not promise structural compatibility with `@posthog/react` yet: its browser PostHog type has private members. Validate an explicit compatible browser-backed integration or provide an Electron-specific provider later.

### 3. Cross-process identity, consent and ordering

- Main serializes commands. Each IPC message includes protocol version, instance, renderer generation, sequence/request ID and relevant state revision. Bind the connection to the actual sender/frame, not a renderer-supplied ID.
- Main publishes coherent snapshots of identity, identified state, consent, groups, session and flags; renderers discard older snapshots and reconnect after reload. Do not broadcast person properties or other windows' event data unnecessarily.
- Guarantee `await identify(A); capture(...)` uses A. Preserve FIFO per renderer and main's processing order; do not promise a wall-clock total order across independently running windows.
- Define the stale-event policy before browser integration: preserve the event's original attribution where valid, or drop stale work explicitly. Never silently relabel already captured events after logout. Global reset/account switches must invalidate old renderer generations and pending user-scoped work.
- Consent is checked before renderer collection where applicable, again at main admission, and before delivery. Opt-out must stop analytics collection and invalidate pending analytics bridge work. Test the documented policy for existing queues and already in-flight requests.
- Preserve spec semantics: identify while opted out can still update local identity and reload flags; it must not emit analytics events. Analytics opt-out is not automatically a promise of zero feature-flag network traffic. Any stronger all-network-off mode needs separate explicit design.
- Keep control-state/opt-out persistence separate from prohibited analytics writes. Reset is not opt-in; preserve consent, install markers and the original attribution of eligible queued events according to the public contracts.

### 4. Sessions, feature flags and desktop lifecycle

- Main owns one app session across authorized windows and a separate per-window identifier. Use core session behavior initially; publish rotations. Decide and document whether sessions survive process restart.
- Do not keep a session alive solely because an idle tray process polls flags or sends background telemetry. Define which activity touches the session, including sleep/resume and all-windows-closed behavior.
- Flags are remotely evaluated once per main context and distributed with payloads, request metadata and revisions. Renderer flag reads must report exposures through the main tracker, not generate duplicate flag requests/exposures.
- Clear user-scoped caches on reset and reject late flag responses for old identities. In the browser integration stage, preserve the browser flag-result metadata required for exposure events; copying just booleans is insufficient.
- Use native lifecycle vocabulary: Installed, Updated, Opened, Backgrounded. Installation means first observed SDK launch, not a hook into an installer. Aggregate focus across windows so moving between two app windows does not double-count foreground/background events; specify tray-only and macOS no-window behavior.
- Include app version/build and appropriate OS/app context. Keep build-invariant Electron/Chromium/Node runtime metadata on install/update events rather than every event, following the lifecycle contract. Document how build numbers are supplied when Electron has no reliable equivalent.
- The published lifecycle spec does not yet enumerate Electron. Agree the desktop applicability/mapping rather than silently treating mobile callbacks as identical.

### 5. Persistent storage and networking

- Main-only files under an app userData subdirectory, namespaced by project/host/instance. Keep control state and event queues independently recoverable; never rely on renderer localStorage across session partitions.
- Use serialized asynchronous writes, bounded size/age, explicit overflow policy, atomic replacement or an append-log design, format versioning, corruption recovery and restrictive permissions where available. No synchronous whole-queue writes on every UI event.
- Define admission acknowledgments: received, durably queued, and delivered are different. Retain event UUIDs/timestamps and document at-least-once-style delivery with possible duplicates, not exactly once. State the last-uncommitted-write loss window.
- Core's current events flush removes failed HTTP batches after retry exhaustion except network errors (`posthog-core-stateless.ts:1728–1747`). Durable desktop retry on 429/5xx must be an explicit tested Electron policy, not an assumed benefit of a file store. Add the smallest reusable hook if necessary; do not change other SDKs' delivery behavior accidentally.
- Prefer an Electron `net`/session-backed fetch adapter for OS proxies and desktop TLS behavior, after testing it against core's request/response contract, compression, timeouts, Retry-After and failure classification. Consider a dedicated nonpersistent network session to avoid default cookie-store/keychain side effects, as Sentry does; test proxy/auth behavior rather than assuming isolation has no consequences.
- Restrict destinations to configured PostHog/proxy hosts and known API routes. Renderer requests cannot select arbitrary URLs, headers, paths, file locations or credentials. Test ingestion, flags and configuration with self-hosted instances and reverse proxies.
- Normal quit performs bounded flush/storage drain without overriding the host app's cancellation behavior. Unexpected exit/OS shutdown relies on already durable data; stop timers/listeners on shutdown and make teardown idempotent. Never hang app exit for the core's entire default timeout unintentionally.

### 6. Browser features: staged, not a second independent client

- Use a locally bundled browser subset for the supported autocapture/JavaScript error features, with external dependency loading disabled. Verify the delivered Electron bundles exclude the recorder; do not import the full browser bundle wholesale. Do not weaken CSP or download executable SDK extensions at runtime. Disable unsupported features instead of silently falling back to CDN scripts.
- Add adapter support for authoritative external identity/session updates and a validated main-routed transport for every supported request class—not just capture. Define who owns flags/config requests so browser extensions still receive the configuration they need without duplicate evaluation.
- Preserve already constructed browser event UUID, timestamp, identity, person-processing metadata and window/session context. Main must not recapture it through a path that enriches it a second time with the current user's state.
- Browser analytics can share suitable core queues only after preserving these semantics. Apply analytics privacy filtering **before IPC or disk**, with payload caps and explicit backpressure/drop behavior.
- Session replay is unsupported for now. Do not initialize or ship a recorder, expose recording controls, add snapshot queues/endpoints, or introduce backend/player validation as a delivery prerequisite. Remote configuration must not enable recording indirectly.
- Test file/app URLs, custom schemes, CSP and logical URL overrides without exposing local filesystem paths.
- Surveys and product tours are out of scope for now, including their rendering, configuration and public APIs. Do not advertise full browser SDK parity merely because its bundle is a dependency.

### 7. JavaScript error tracking

- First: handled JS exceptions in main/renderer, serialized using core/browser builders before Electron structured clone loses Error details. Then separately gated automatic main/preload/renderer exceptions and unhandled rejections.
- Preserve host application's fatal-error behavior; avoid duplicate capture when browser and Electron listeners coexist. Normalize ASAR/file/app stack paths, release identifiers and source maps; test existing PostHog upload tooling against packaged artifacts.
- A renderer-gone/OOM/process-exit notification can become an appropriately labeled diagnostic event, but it is not a recovered JS stack or a symbolicated native crash.
- Native crash reporting, crashReporter integration, minidump ingestion and native symbolication are excluded from this plan, including feasibility investigation.
- Keep native add-ons, ANR/hang detection, tracing/profiling and utility-process support outside the initial dependency/runtime footprint.

## Delivery milestones and acceptance gates

| Milestone                   | Deliverable                                                                                                                                                                                                   | Required evidence before moving on                                                                                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. API and feasibility      | Agree package/API, ownership, supported Electron range and bridge threat model. Build disposable spikes for sandboxed packaged preload, Electron network adapter, and external browser state/transport seams. | Packed app with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`; main + two renderer captures share identity; identity/reset race test; browser spike proves whether autocapture/error integration needs shared changes. No private monkeypatching accepted as the production design. |
| 1. Analytics/flags alpha    | Main core adapter, secure preload/facade, persistent identity/consent and bounded queue, manual capture/identify/reset/group/register, client flags, flush/shutdown, basic lifecycle.                         | Cross-process wire assertions; restart restores anonymous identity/consent and eligible events; reset does not relabel old events; malformed/unauthorized IPC rejected; shutdown bounded under dead network/storage. Publish explicitly without automatic DOM/replay/native-crash claims.                 |
| 2. Browser integration beta | Supported browser adapter, opt-in DOM autocapture, page/screen policy, handled JS errors and then opt-in automatic JS error capture.                                                                          | No duplicate flags/events/identity transitions; all supported browser request classes use intended transport; no remote executable loads; packaged release/source-map resolution; browser SDK regression suite passes.                                                                                    |
| 3. GA                       | Compatibility policy, docs/migration, CI matrices, package/release onboarding, operational observability, early adopter feedback.                                                                             | Installed tarballs and ASAR apps work across supported OS/runtime versions; no host security weakening; documented unsupported products; all advertised SDK contract scenarios validated.                                                                                                                 |
| Separate follow-ups         | Framework bindings, utility processes, logs/traces and hang detection.                                                                                                                                        | Independent demand, compatibility design and product-specific backend/acceptance evidence.                                                                                                                                                                                                                |

These are scope gates, not calendar estimates. Milestones 0 and 1 should establish estimates for browser autocapture/JavaScript error integration.

## Test strategy

1. **Core/adapter unit tests:** storage corruption/migration/quota, retry classification, clocks/idle rotation, flag cache/exposure metadata, instance isolation, initialization and idempotent cleanup.
2. **Adversarial IPC tests:** unauthorized windows and frames, remote navigation, file/custom-origin URL validation, forged renderer IDs, oversized/deep/cyclic/unserializable payloads, invalid protocol versions, rate limits, reload/destroy during reply, listener leaks. Registration alone must not authorize later navigation to arbitrary content; `file:` origins require explicit trusted path handling.
3. **Cross-process integration tests against a mock PostHog receiver:** main/renderer identify/reset ordering, simultaneous windows, opted-out cold start, flags racing logout, durable acknowledgment/restart recovery, overflow behavior, persistent partitions, all-window lifecycle aggregation.
4. **Real Electron packed-consumer tests:** supported minimum/latest runtime, Linux/Windows/macOS smoke coverage, CJS/ESM main, standalone and composed preload, renderer bundles, ASAR, Forge/Builder representative fixtures, strict CSP and no external scripts. Electron's embedded Node version—not the developer's Node—determines compatibility. Sentry's inspected minimum is Electron 35; do not copy that as our requirement without testing.
5. **Delivery failure and scope tests:** disconnected network, proxy/auth/TLS behavior, 429/5xx/413, crash during persistence, user-cancelled quit, sleep/resume, renderer OOM/crash and stale IPC. Assert no recorder code is shipped/initialized and no snapshot traffic is emitted, even when project remote configuration enables replay. Run tests on the tarball, not only source aliases.
6. **Cross-SDK contracts:** map advertised features to published sdk-specs scenarios and add Electron adapter support in the shared harness. Do not label a capability conformant from mocked unit tests alone. Any intended divergence/new Electron lifecycle behavior needs agreement and explicit documentation.

For real Electron test setup, unset `ELECTRON_RUN_AS_NODE` if inherited from the agent environment. App launches are Electron-under-test, not browser automation against a user's browser profile.

## Monorepo, release and documentation work

Proposed source layout:

```text
packages/electron/
  src/main/       # core adapter, state coordinator, storage, net, lifecycle, IPC
  src/preload/    # tiny bundled bridge and composition helper
  src/renderer/   # facade; later browser adapter and optional DOM features
  src/shared/     # protocol schemas/types and serialization constraints
  test/          # unit and installed/packaged Electron fixtures
  package.json   # explicit process exports; Electron peer/dev dependency
```

- Add semantic `check-types`, build/lint/unit/packed-consumer tasks following Turbo's prerequisite contract. Keep Electron external in production bundles and absent from renderer output; ensure no native/runtime downloads in the published package's install lifecycle.
- Use precise dependency compatibility constraints for browser/core integration. Test a single compatible browser instance and mixed installed versions where supported; do not duplicate PostHog types or rely on cross-bundle private-property ABI by accident.
- Add export/declaration checks, package tarball tests, example app and package contributor instructions. Keep shared guidance in `CONTRIBUTING.md` and release guidance in `RELEASING.md`.
- Onboard npm name/access and trusted publisher/provenance; verify Changesets and existing release discovery include the package. Use a deliberate alpha/beta dist-tag process before GA. No new CDN release path is required for locally bundled Electron code.
- Update library docs and the Electron tutorial to distinguish renderer-only `posthog-js` from the coordinated SDK. Document secure preload composition, initialization order, supported products, app-wide identity, async mutations, data storage, consent, proxy behavior, shutdown limits and offline guarantees.
- Migration from existing browser integrations must explicitly decide whether to preserve the browser anonymous identity. Offer an opt-in import/bootstrap flow if required; do not scan arbitrary Chromium profiles or merge IDs across partitions automatically. Remove the old independent initialization to prevent duplicate capture. Existing Node main usage needs the same ownership migration guidance.

## Incident-informed gates

Session replay is outside the delivery scope. Future browser/session/transport changes must still run the repository's replay incident risk check where applicable, because shared browser changes can affect existing customers:

- **Lazy-bundle version skew:** package supported extensions locally; preserve compatibility for any shared browser changes used by existing CDN bundles. Test old pinned browser cores with changed extensions if that boundary changes.
- **Privacy and consent:** test analytics secrets are absent before IPC/storage and opt-out takes effect during concurrent capture.
- **No accidental replay:** assert recorder code, initialization, recording controls and snapshot delivery remain absent regardless of project configuration.
- **Retry storms and loss:** bound retries/backpressure and explicitly test long outages. Do not double-retry browser and main queues without a defined owner.

## Alpha defaults and remaining release decisions

1. Package: `@posthog/electron`; wire library: `posthog-electron`; explicit main/preload/renderer exports.
2. Alpha scope: manual analytics, identity/groups/properties, consent, client flags/exposures, lifecycle, persistent delivery and handled JavaScript exceptions. DOM autocapture and automatic exception interception remain later work.
3. Identity/session scope: one app-wide context; simultaneous per-window accounts are not supported.
4. Runtime: experimental Electron 41+; explicit preload installation/composition. Wider OS/runtime release validation is still required.
5. API/delivery: asynchronous mutations/readiness and write-completion acknowledgments; explicit flush for server delivery. Defaults are 1,000 events, a 5 MiB state file and seven-day retention. No fsync/power-loss or multi-process-store guarantee.
6. Lifecycle/session mapping: fresh session after restart; core inactivity/maximum boundaries; aggregate window focus. Periodic flag reloads do not extend a session, but admitted analytics events currently count as activity. Advanced tray/headless activity policies and lifecycle-spec applicability still need agreement before GA.
7. Session replay, native crash support, surveys and product tours are excluded for now, including native crash feasibility work.

The implementation adds only narrow core extension hooks for Electron's transient-batch retention and whole-request flag-context validation; other SDKs retain their default behavior. See `packages/electron/README.md` and `examples/example-electron/README.md` for the implemented API, limits and test commands.
