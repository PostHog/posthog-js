# @posthog/electron (alpha)

Coordinated PostHog analytics and client feature flags for Electron. One main-process client owns identity, consent, sessions, storage and networking; trusted renderer windows use a sandbox-compatible preload bridge.

This alpha supports manual events/screens, alias/identify/reset, person properties, groups, registered properties, opt-in/out, cached feature flags/results/payloads with exposure events and local flag-evaluation context, application lifecycle events, handled JavaScript exceptions, flush and shutdown. **Session replay, browser autocapture, automatic exception interception, surveys, product tours and native crashes are not supported.** No recorder or remotely loaded executable code is included.

**Release status:** private and unpublished until the final alpha-release PR. Use local tarballs while developing; merging this PR does not enable npm publication.

## Setup

Install `@posthog/electron` alongside your application's Electron development dependency. Electron 41+ is the initial experimental runtime range; validate your packaged application on every OS/runtime you ship. Do not bundle Electron into your application JavaScript.

### Main process

```js
import { app, BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { init } from '@posthog/electron/main'

const require = createRequire(import.meta.url)
const posthog = init({
    projectToken: '<ph_project_token>',
    host: 'https://us.i.posthog.com',
    onError: (error) => console.error('[PostHog]', error),
})

app.whenReady().then(async () => {
    await posthog.ready()
    const page = '/absolute/path/to/index.html'
    const window = new BrowserWindow({
        webPreferences: {
            preload: require.resolve('@posthog/electron/preload'),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
        },
    })
    posthog.registerWindow(window, { allowedUrls: [pathToFileURL(page).href] })
    await window.loadFile(page)
    await posthog.capture('application_ready')
})
```

Initialize main once, before creating instrumented windows. Use explicit process subpaths; there is intentionally no ambiguous root export. Avoid top-level `await app.whenReady()` in a native ESM entrypoint: launch an async function/callback without awaiting it at module scope, so Electron can finish loading the entrypoint and become ready.

Only registered windows' main frames at explicitly allowed URLs can use the bridge. URLs are exact except for fragments, including file paths; authorization is checked again after navigation and when queued commands execute. Register every trusted window explicitly, including windows in custom partitions. Do not register remote/untrusted content.

If you already have a preload, bundle `exposePostHogBridge()` from `@posthog/electron/preload/helper` into it instead of replacing it. Sandboxed preloads cannot require arbitrary npm dependencies: the helper must be bundled, with only `electron` external. Keep context isolation enabled; never expose raw IPC APIs to the page.

### Renderer

Bundle this code for the browser with Vite, esbuild or your existing renderer bundler:

```js
import { init } from '@posthog/electron/renderer'

const posthog = await init()
await posthog.capture('button_clicked', { button: 'save' })
await posthog.identify('user-123', { plan: 'pro' })
await posthog.group('organization', 'org-456', { name: 'Example' })
await posthog.register({ workspace: 'primary' })
await posthog.reloadFeatureFlags()
const enabled = posthog.isFeatureEnabled('new-ui')
const payload = posthog.getFeatureFlagPayload('new-ui')
await posthog.captureException(new Error('Example handled error'))
await posthog.flush()
```

Main and renderer mutations return promises. Await identity/reset/consent changes before captures that depend on them. Renderer captures are asynchronous and acknowledge completed file writes in main, **not** server delivery. `flush()` waits for prior commands and main delivery; delivery errors reject it. Cache getters are synchronous after `await init()`.

One identity/session is shared across the app, not one per window. Use `reset()` on logout before identifying a different account. Reset preserves opt-out state, install markers and accepted queued events with their original identities. Stale renderer commands around an account change are rejected rather than assigned to the new user; their promise rejects so the app can decide whether a fresh action is appropriate. Do not blindly replay a rejected capture under another user.

`onStateChange(callback)` returns an unsubscribe function. `getState()` returns a copy of the current identity/consent/flag snapshot. `dispose()` removes renderer subscriptions.

## Public API contracts

The following helpers are available in **both main and renderer**. Mutations return `Promise<void>`; getters read cached state synchronously and never fetch flags. Await main `ready()` or renderer `init()` before using cached state. Before readiness, identity getters return `''` and flags may be unavailable. Renderer consent is conservatively opted out until synchronized; await main readiness before relying on persisted consent. Renderer `getState()` throws until its first synchronized snapshot.

| Helpers (same arguments in both processes)                                                                              | Contract                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alias(alias)`                                                                                                          | Link the current distinct ID to an alias through core's `$create_alias`; do not switch identity or reload flags.                                                                                                                                                 |
| `screen(name, properties?)`                                                                                             | Capture `$screen`; the name argument wins over a supplied `$screen_name`. Event-only: no persistent current-screen context.                                                                                                                                      |
| `getDistinctId()`, `getAnonymousId()`, `getSessionId()`                                                                 | Return the shared app identity/session. Anonymous ID remains stable after identify and rotates on reset.                                                                                                                                                         |
| `setPersonProperties(properties?, propertiesOnce?)`                                                                     | Core's deduplicated `$set`/`$set_once` update of the current person, without switching identity. Empty updates no-op. Mirrors properties into flag context and starts core's background flag refresh.                                                            |
| `setPersonPropertiesForFlags(properties, reloadFeatureFlags = true)`                                                    | Merge local person overrides; no profile event. Supports core's nested `$set`/`$set_once` input.                                                                                                                                                                 |
| `setGroupPropertiesForFlags(propertiesByGroupType, reloadFeatureFlags = true)`                                          | Merge local overrides by group type, e.g. `{ company: { plan: 'pro' } }`; no group-profile event or membership change.                                                                                                                                           |
| `resetPersonPropertiesForFlags(reloadFeatureFlags = false)`, `resetGroupPropertiesForFlags(reloadFeatureFlags = false)` | Clear all overrides of that kind, not profile data, identity or group membership. No per-group reset. The default matches core: no automatic refresh.                                                                                                            |
| `reloadFeatureFlags()`                                                                                                  | Wait for earlier mutations, refresh using the current context, persist and synchronize the cache. `reloadFeatureFlagsAsync()` is a compatibility alias in both processes.                                                                                        |
| `getFeatureFlag(key, options?)`, `isFeatureEnabled(key, options?)`                                                      | Return a cached value/boolean. Missing keys retain the alpha/core behavior: `false` with a nonempty flag cache, otherwise `undefined`. `isFeatureEnabled` also accepts `defaultValue` for unavailable keys, without overriding a known `false` or empty variant. |
| `getFeatureFlagResult(key, options?)`                                                                                   | Return `{ key, enabled, variant?, payload }`, or `undefined` for unknown/unavailable keys. Empty variants remain `variant: ''` and are disabled.                                                                                                                 |
| `getAllFeatureFlags()`                                                                                                  | Return an array of known result objects (empty when unavailable), without exposure events.                                                                                                                                                                       |
| `getFeatureFlagPayload(key)`                                                                                            | Return a copied, decoded payload; missing payloads are `null` once flags are available, otherwise `undefined`. No exposure event.                                                                                                                                |
| `hasOptedOutCapturing()`, `optedOut`                                                                                    | Read the same cached consent state.                                                                                                                                                                                                                              |

Single-flag value/result/enabled reads report exposure through main's core tracker by default. Use `{ sendFeatureFlagEvent: false }` to suppress it; the existing `{ sendEvent: false }` remains supported. If both are provided, `sendFeatureFlagEvent` wins. Renderer exposures are bound to the identity, value and flag snapshot actually observed, so a later refresh cannot report a newer variant on the caller's behalf. Bulk reads, payload reads and state synchronization do not report exposures. Results, payloads and state snapshots are defensive copies.

Flag-context setters with the default `true`, and resetters with `true`, resolve after their requested refresh and persistence. With `false`, they acknowledge only the local write; call `await reloadFeatureFlags()` when ready to evaluate. `identify`, `group` and `setPersonProperties` may initiate a background refresh through core; their mutation acknowledgments do not wait for that refresh. A failed flag fetch retains cached flags and normally resolves without a result/error indicator; it is not a successful-freshness guarantee. Bridge authorization, invalid/non-JSON/oversized payloads, stale identity, rate limits, disposal, shutdown and persistence failures can reject commands. Handle rejected promises; do not automatically retry stale actions under a different user.

Alias and person-profile updates respect `personProfiles: 'never'`. Opt-out blocks alias, screen and person-profile event helpers in both processes. Local flag-context overrides and explicit reloads remain available while opted out, like the existing flag/identity APIs; opt-out is not an all-network-off switch.

### Published-contract coverage and limits

The API mapping above follows [sdk-specs at `4a9e0e7005260dbd198cd67c6ab6579c64679913`](https://github.com/PostHog/sdk-specs/tree/4a9e0e7005260dbd198cd67c6ab6579c64679913). Focused tests exercise both the real main client and the renderer facade through its validated main command handler, using real core semantics and mocked Electron transport. They cover delivered alias/screen/person events, identity stability, consent/profile gates, flag-context merge/reset/reload request bodies, copied cached results, empty variants, exposure suppression and request authorization/ordering. This is **not** a claim of complete shared-harness conformance or real Electron/OS validation.

The published screen spec's canonical prose describes event-only behavior with no persistent screen context, but its “Screen updates current screen context” scenario asks for such a context. Electron follows the event-only prose; that contradictory scenario is not supported. Structured results normalize core's documented empty-variant enabled-state gap at the Electron read boundary, without changing the raw flag value or exposure provenance. Group overrides use the published js-core map-by-group variant and all-groups reset; resetters follow core's no-reload default rather than the optional mobile default.

| Payload source                                                      | Guarantee / inherited limit                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Detailed `/flags` metadata with raw serialized JSON                 | Electron decodes once at the main read boundary for payload getters, results, bulk results and renderer snapshots. Malformed/empty/whitespace bytes become `null` and are reported through `onError`; valid JSON preserves strings (including `''`), objects, arrays, `false`, `0` and `null`. Core's lenient raw-string fallback is not exposed here.                                                 |
| Legacy `featureFlags`/`featureFlagPayloads` responses and bootstrap | Core normalizes these before Electron can read raw metadata. Existing decoded strings must not be decoded again. A malformed legacy payload may already have become a valid serialized string in core; Electron preserves that string because the original provenance cannot be recovered. Full malformed-legacy-payload conformance would require a separate core/ingress change, outside this patch. |

## Consent and storage

- Capture is opted in by default; configure `defaultOptIn: false` for explicit opt-in. Call `optIn()`/`optOut()` from either process.
- Opt-out blocks new events. Events accepted while opted in remain queued and deliverable. Already in-flight requests may complete. Identify may still change local identity and reload flags while opted out, as specified by the client SDK contract; opt-out is not an all-network-off switch.
- Files live under `app.getPath('userData')/posthog/<project-and-host-hash>/state.json`. `storageDirectory` changes the base directory; project/host isolation remains enforced. The file contains identity, consent, flags, properties and queued events; it is not encrypted. Do not include secrets or personal API keys in analytics or in the desktop binary.
- Defaults: at most 1,000 events through core's queue, a 5 MiB state file, and seven-day event retention. Configure `maxQueueSize`, `maxStorageBytes` and `maxQueueAgeMs`. Expired events and oldest events exceeding the storage cap are discarded; oversized non-queue state is rejected through the operation/error callback. Budget property/flag payload sizes accordingly.
- Storage writes are serialized and atomically renamed. Acknowledgment means the write/rename completed, not an fsync/power-loss guarantee. Each project/host store allows **one local process writer**. A second process remains inactive (including networking), reports through `onError`, and resolves `ready()` without reading the owner's analytics. Opting in cannot activate an unowned store. Use a separate `storageDirectory` for deliberately independent instances/identities.
- Ownership is released on normal awaited shutdown. Stale ownership is reclaimed only for a same-host PID proven absent; live, permission-denied, foreign-host or unreadable ownership is never stolen. UUID-specific `.reclaim-*` tombstones prevent competing reclaimers from removing a successor's lock; they intentionally remain on disk. A crashed reclaimer or incomplete `.owner` file can require manual recovery: stop **all** application processes before removing the stale `.owner` and associated tombstone. Do not remove these files from a running app. This policy assumes a local filesystem, not a network filesystem or distributed lock service.
- Corrupt/unreadable existing storage falls back to opted out and empty analytics, reporting via `onError`. Call `optIn()` explicitly after addressing the cause if appropriate.
- Network errors, 407, 408, 429 and 5xx preserve batches after bounded immediate retries; background retries use backoff, jitter and Retry-After. Permanent failures may drop the batch. Retries retain event UUIDs, but duplicate delivery remains possible. `flushInterval: 0` disables scheduled background flushes; explicit flush and queue-size-triggered flush still work.

Requests use an isolated Electron session with omitted cookies and HTTP credentials. Automatic redirects are rejected: configure the final ingestion URL, including any reverse-proxy path, rather than relying on redirects to move event or flag bodies.

## Lifecycle and shutdown

Lifecycle capture defaults on (`captureAppLifecycleEvents: false` disables its events). Installed means first observed SDK launch, not installer execution. Updates compare the saved app version and optional `appBuild`. Installed/Updated carry Electron/Node/Chromium versions; ordinary events carry app/OS context. Focus is aggregated across registered windows. Sessions start fresh on process restart, with core's default 30-minute inactivity and 24-hour maximum boundaries; periodic flag reloads alone do not extend them. Admitted analytics events currently count as activity; avoid periodic heartbeat captures if that is not the session behavior you want.

The SDK makes only a **best-effort flush** on uncancelled `will-quit`; it never prevents/reissues quit or tears down a client whose host may cancel quit. For a bounded drain and teardown, the host must own its quit flow and call `await posthog.shutdown(2000)` before exiting. Shutdown is idempotent and bounded, including deferred initialization; a timeout reports through `onError` and resolves `ready()` without allowing late startup. Uncancellable filesystem cleanup may finish afterward and retains ownership until pending writes settle, so an immediate replacement instance can remain inactive. On normal process exit, unsaved local state — including an `optIn()`/`optOut()` that was called but not awaited — is written synchronously before ownership is released, so consent survives an immediate `app.quit()`. Network delivery is not part of that final write. Abrupt termination/OS shutdown relies on already written files, not a guaranteed final flush. Mutating calls after shutdown reject; cached getters remain readable. Closing all registered windows emits the aggregate background transition but does not shut down the SDK; tray apps can continue capturing until the host quits. `powerMonitor` suspend pauses delivery and aborts in-flight requests; resume attempts a flush respecting existing backoff. Neither power callback emits analytics nor refreshes session activity. The host owns tray/window quit policy and fatal-error behavior; the SDK does not intercept uncaught exceptions or native crashes. Desktop lifecycle semantics are a new mapping of the published lifecycle contract, not a claim of complete cross-SDK harness conformance.

## Networking limits

Requests use Chromium's isolated in-memory `session.fromPartition('posthog-electron')`, not Node's fetch or the default browser session. A host can configure that session's proxy with Electron's `setProxy()` after app readiness and before capture/flush. SDK requests omit cookies and HTTP credentials. **Authenticated proxies are not currently supported**: a 407 is retained for retry/configuration recovery, not evidence of authenticated-proxy compatibility. Applications requiring authenticated enterprise proxies must treat this alpha limitation as a production-readiness gate.

TLS certificate verification remains Chromium's default. The SDK does not disable verification, install certificate-error overrides, or trust arbitrary private CAs. Validate your actual enterprise trust/proxy deployment separately. There is no exactly-once guarantee: interrupted delivery may be retried with the same UUID and can duplicate events.

## Local validation

See [the Electron example](../../examples/example-electron) for an interactive mock-server application, real two-window sandboxed smoke tests, and live-project configuration.

From the repository root:

```sh
pnpm turbo run build check-types test:unit test:built --filter=@posthog/electron
# After explicitly installing the Electron binary:
pnpm --filter @posthog/electron test:transport
```

For loopback subprocess delivery/network tests and their real-versus-synthetic coverage limits, see [delivery tests](test/delivery/README.md).

The example installs tarballs, not source symlinks. No PostHog credentials are needed for its smoke test. The shared browser SDK is unchanged; optional DOM autocapture integration remains a later milestone rather than an advertised alpha feature.
