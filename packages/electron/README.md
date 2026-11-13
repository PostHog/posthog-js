# @posthog/electron (alpha)

Coordinated PostHog analytics and client feature flags for Electron. One main-process client owns identity, consent, sessions, storage and networking; trusted renderer windows use a sandbox-compatible preload bridge.

This alpha supports manual events, identify/reset, groups, registered properties, opt-in/out, cached feature flags/payloads with exposure events, application lifecycle events, handled JavaScript exceptions, flush and shutdown. **Session replay, browser autocapture, automatic exception interception, surveys, product tours and native crashes are not supported.** No recorder or remotely loaded executable code is included.

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

`onStateChange(callback)` returns an unsubscribe function. `getState()` returns a copy of the current identity/consent/flag snapshot. `dispose()` removes renderer subscriptions. Main flag APIs include `getFeatureFlag()`, `getFeatureFlagPayload()` and `reloadFeatureFlagsAsync()`; renderer uses `reloadFeatureFlags()`. Flag reads report exposure through main's tracker. Options `{ sendEvent: false }` suppress renderer exposure events.

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

The SDK makes only a **best-effort flush** on uncancelled `will-quit`; it never prevents/reissues quit or tears down a client whose host may cancel quit. For a bounded drain and teardown, the host must own its quit flow and call `await posthog.shutdown(2000)` before exiting. Shutdown is idempotent and bounded, including deferred initialization; a timeout reports through `onError` and resolves `ready()` without allowing late startup. Uncancellable filesystem cleanup may finish afterward and retains ownership until pending writes settle, so an immediate replacement instance can remain inactive. Abrupt termination/OS shutdown relies on already written files, not a guaranteed final flush. Mutating calls after shutdown reject; cached getters remain readable. Closing all registered windows emits the aggregate background transition but does not shut down the SDK; tray apps can continue capturing until the host quits. `powerMonitor` suspend pauses delivery and aborts in-flight requests; resume attempts a flush respecting existing backoff. Neither power callback emits analytics nor refreshes session activity. The host owns tray/window quit policy and fatal-error behavior; the SDK does not intercept uncaught exceptions or native crashes. Desktop lifecycle semantics are a new mapping of the published lifecycle contract, not a claim of complete cross-SDK harness conformance.

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
