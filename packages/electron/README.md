# @posthog/electron

Coordinated PostHog analytics and client feature flags for Electron. One main-process client owns identity, consent, sessions, storage and networking; trusted renderer windows use a sandbox-compatible preload bridge and explicitly registered utility processes use `process.parentPort`.

The SDK supports manual events/screens, alias/identify/reset, person properties, groups, registered properties, opt-in/out, cached feature flags/results/payloads with exposure events and local flag-evaluation context, application lifecycle events, handled JavaScript exceptions, opt-in DOM autocapture, opt-in automatic JavaScript error capture, flush and shutdown. **Session replay, surveys, product tours and native crashes are not supported.** No recorder or remotely loaded executable code is included.

See the [release gates](https://github.com/PostHog/posthog-js/blob/main/RELEASING.md#electron-releases) and [migration guide](./MIGRATION.md). Local tarball tests with a core override do not prove compatibility with npm dependencies.

## Setup

Install with `pnpm add @posthog/electron` alongside your application's Electron development dependency. Pin the resolved version for reproducible builds. Electron 41+ is the initial experimental runtime range, not an assertion that every OS/runtime combination has passed. Validate your packaged application on every OS/runtime you ship. Do not bundle Electron into your application JavaScript.

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
    posthog.capture('application_ready')
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
posthog.capture('button_clicked', { button: 'save' })
await posthog.identify('user-123', { plan: 'pro' })
await posthog.group('organization', 'org-456', { name: 'Example' })
await posthog.register({ workspace: 'primary' })
await posthog.reloadFeatureFlags()
const enabled = posthog.isFeatureEnabled('new-ui')
const payload = posthog.getFeatureFlagPayload('new-ui')
posthog.captureException(new Error('Example handled error'))
await posthog.flush()
```

`capture()`, `screen()` and `captureException()` return nothing and never throw or reject, like the Node SDK. They queue the event and return immediately. Main reports storage write failures and unusable properties through its `onError`, and silently drops captures after shutdown. `captureException()` is also dropped across an identity change. `capture()` and `screen()` called after an unawaited `identify()` or `reset()` use the new identity. Renderer and utility report failed capture requests through their own `onError`. A refused request, such as a stale command or one over the rate limit, means the event was dropped. A utility timeout only means the child stopped waiting: main may still store and deliver the event, so do not retry it. Captures made synchronously inside the renderer or utility `onError`, and `captureException(error)` for the error it received, don't report their own failures, so they can't loop. An async `onError` that captures a different event after an `await` is not covered: if main keeps refusing requests, each failed capture calls `onError` again. Don't capture unconditionally from an async `onError`. Other main and renderer mutations return promises. Await identity/reset/consent changes before captures that depend on them, because commands run in call order. A resolved call is an asynchronous operation receipt, not proof that an event was sent: consent, filtering and queue limits can prevent admission. `flush()` waits for prior commands and attempts main delivery; delivery errors reject it, and a successful response is not a guarantee of eventual ingestion/query visibility. Cache getters are synchronous after `await init()`.

One identity/session is shared across the app, not one per window. Use `reset()` on logout before identifying a different account. Reset preserves opt-out state, project autocapture settings, install markers and accepted queued events with their original identities. Stale renderer commands around an account change are rejected rather than assigned to the new user. A stale mutation's promise rejects so the app can decide whether a fresh action is appropriate. A stale capture is dropped and reported through `onError`. Do not blindly replay it under another user.

`onStateChange(callback)` returns an unsubscribe function. `getState()` returns a copy of the current identity/consent/flag snapshot. `dispose()` removes renderer subscriptions, DOM autocapture observers and automatic exception listeners.

## Main and renderer helpers

These helpers are available in **both main and renderer**. Mutations return `Promise<void>`, except `screen()`, which returns nothing like `capture()`; getters read cached state synchronously and never fetch flags. Await main `ready()` or renderer `init()` before using cached state. Renderer identity getters return `''` and consent is conservatively opted out until synchronized; `getState()` throws until its first snapshot.

| Helpers                                                                                                                 | Behavior                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `alias(alias)`                                                                                                          | Link the current distinct ID to an alias without switching identity or reloading flags.                                                                                                                                  |
| `screen(name, properties?)`                                                                                             | Capture `$screen`; name wins over a supplied `$screen_name`. Event-only: no persistent current-screen context.                                                                                                           |
| `getDistinctId()`, `getAnonymousId()`, `getSessionId()`                                                                 | Read the shared app identity/session. Anonymous ID stays stable across identify and rotates on reset.                                                                                                                    |
| `setPersonProperties(properties?, propertiesOnce?)`                                                                     | Update the current person's `$set`/`$set_once` properties without switching identity. Empty updates do nothing. Also updates flag context and starts a background refresh.                                               |
| `setPersonPropertiesForFlags(properties, reloadFeatureFlags = true)`                                                    | Merge local person overrides without a profile event. Accepts nested `$set`/`$set_once` input.                                                                                                                           |
| `setGroupPropertiesForFlags(propertiesByGroupType, reloadFeatureFlags = true)`                                          | Merge local overrides by group type, e.g. `{ company: { plan: 'pro' } }`, without profile events or membership changes.                                                                                                  |
| `resetPersonPropertiesForFlags(reloadFeatureFlags = false)`, `resetGroupPropertiesForFlags(reloadFeatureFlags = false)` | Clear all overrides of that kind, not profiles, identity or membership. No per-group reset or automatic refresh by default.                                                                                              |
| `reloadFeatureFlags()`                                                                                                  | Refresh using the current shared context after earlier mutations, persist and synchronize the cache. `reloadFeatureFlagsAsync()` is a compatibility alias.                                                               |
| `getFeatureFlag(key, options?)`, `isFeatureEnabled(key, options?)`                                                      | Read a cached value/boolean. A missing key is `false` with a nonempty cache, otherwise `undefined`. `isFeatureEnabled` accepts `defaultValue` for unknown/unavailable keys; known `false` and empty variants always win. |
| `getFeatureFlagResult(key, options?)`                                                                                   | Return `{ key, enabled, variant?, payload }`, or `undefined` for unknown/unavailable keys. Empty variants remain `variant: ''` and are disabled.                                                                         |
| `getAllFeatureFlags()`                                                                                                  | Return copied cached results (empty when unavailable), without exposure events.                                                                                                                                          |
| `getFeatureFlagPayload(key)`                                                                                            | Return a copied, decoded payload without exposure events. Missing payloads are `null` once flags are available, otherwise `undefined`.                                                                                   |
| `hasOptedOutCapturing()`, `optedOut`                                                                                    | Read cached consent state.                                                                                                                                                                                               |

Single-flag value/result/enabled reads report deduplicated exposure events by default. Use `{ sendFeatureFlagEvent: false }` to suppress them; `{ sendEvent: false }` remains supported. If both are provided, `sendFeatureFlagEvent` wins. Renderer exposures refer to the identity, value and flag snapshot actually observed, not a later refreshed variant. Bulk reads, payload reads and state synchronization do not report exposures. Results, payloads and state snapshots are defensive copies.

Flag-context setters copy the supplied properties at invocation. Nonempty setters with the default `true`, and resetters with `true`, resolve after the requested refresh attempt and persistence. With `false`, they acknowledge only the local write; cached flag values stay unchanged until a reload. Call `await reloadFeatureFlags()` when ready to evaluate. `identify`, `group` and `setPersonProperties` can start background refreshes that their mutation acknowledgments do not await. A failed flag fetch normally retains cached flags and resolves; completion is not a freshness guarantee. Handle rejected command promises, and do not automatically retry stale actions under another user.

Alias and person-profile updates respect `personProfiles: 'never'`. Opt-out blocks alias, screen and person-profile event helpers. Local flag-context overrides and explicit reloads remain available while opted out; opt-out is not an all-network-off switch.

Malformed JSON payloads from detailed flag responses return `null` and report through `onError`. Valid JSON retains its decoded value, including strings, `false`, `0` and `null`. Legacy flag responses and bootstrap payloads can preserve malformed input as a string; already-decoded strings are returned unchanged rather than parsed again.

Electron sends anonymous and distinct IDs for flag evaluation, but the SDK does not send a separate `$device_id`. Device-ID bucketing is not supported.

## Opt-in DOM autocapture

Autocapture is **off by default**, configured per trusted renderer:

```js
const posthog = await init({
    autocapture: { maskAllText: true, maskAllElementAttributes: true },
    onError: (error) => console.error('[PostHog renderer]', error),
})
// Use autocapture: true for shared browser privacy defaults, or false to leave it off.
```

`init(options?: RendererOptions)` accepts `autocapture?: boolean | AutocaptureConfig` and `onError?: (error: unknown) => void`. Repeated init returns the same client; the first call's options apply. The config object accepts:

- `maskAllText`, `maskAllElementAttributes`, `disableCaptureUrlHashes`: booleans, default `false`.
- `url_allowlist`, `url_ignorelist`: arrays of strings or regular expressions.
- `dom_event_allowlist`: an array of `'click'`, `'change'`, `'submit'`.
- `element_allowlist`: an array of `'a'`, `'button'`, `'form'`, `'input'`, `'select'`, `'textarea'`, `'label'`.
- `css_selector_allowlist`, `css_selector_ignorelist`, `element_attribute_ignorelist`: string arrays.

Eligible DOM click/change/submit interactions emit `$autocapture` with `$event_type` and sanitized element hierarchy metadata through the renderer's ordinary `capture()` pipeline. Main owns identity/session context, `before_send`, persistence, batching and delivery. `onError` reports renderer setup/bridge failures without throwing from DOM handlers; main network/storage errors use main's `onError`.

Consent is checked **before inspecting or serializing DOM targets**. Opt-out removes observers; opt-in and identity/reset changes synchronize and restart them without duplicates. Dispose removes all observers. Shared browser sanitization preserves `ph-no-capture`, `ph-sensitive`, password and sensitive-value exclusions. Native input values and clipboard contents are not collected by this integration. Text and safe attributes may still contain application-specific personal data: use masking/ignorelists and main's `before_send` for your privacy policy. Custom selector ignorelists replace the shared defaults (`.ph-no-autocapture`, `[data-ph-no-autocapture]`); include them explicitly if needed. `ph-no-capture` cannot be overridden.

Enabling autocapture requests only project autocapture config, through main's existing authenticated, URL-restricted bridge and core config transport. A cold start waits for the config outcome; unknown/missing opt-out information stays off. Failures retain the last known server setting, including a project kill switch. Only boolean `autocapture_opt_out` and `elementsChainAsString` settings are cached/mirrored; remote config cannot install replay, surveys or other products. `getState().autocapture` exposes these optional booleans and `status: 'pending' | 'loaded' | 'failed' | 'disabled'`.

Main options `disableRemoteConfig: true` explicitly permit local-only autocapture when no cached project kill switch exists; `disableRemoteFeatureFlags` **does not** bypass the project config gate. `remoteConfigRequestTimeoutMs` bounds config fetches. Main `disabled: true` always prevents autocapture. No full browser SDK, recorder, DOM snapshotting or remotely loaded executable code is included.

Automatic JavaScript exception capture is supported only in main and renderer, not utility processes. Utility reuses the shared facade, whose bundle includes inert optional DOM/error observer definitions; utility exposes no options to enable them and needs no browser globals. A utility facade and its main registration have a single lifetime: after disposal, unregister and create/register a new child rather than reinitializing the facade in the same child.

## JavaScript errors

`captureException(error, properties?)` reports a handled error from main or renderer using core's stack parser and the normal shared identity, consent, queue and transport. Manual reports retain `mechanism.handled: true`.

Automatic capture is **off by default in both processes**. Enable it independently where needed:

```js
// Main
const posthog = init({ projectToken: '<ph_project_token>', enableExceptionAutocapture: true })

// Renderer (from @posthog/electron/renderer)
const posthog = await init({ enableExceptionAutocapture: true })
```

Listeners start after SDK readiness. Main observes `uncaughtExceptionMonitor`; renderer observes `error` and `unhandledrejection` with `addEventListener`. Reports use `handled: false`, the appropriate `onuncaughtexception` / `onerror` / `onunhandledrejection` mechanism and canonical Node/browser hook sources. Renderer resource-load errors are excluded. Existing error handlers, `window.onerror`, default browser reporting, warnings and process termination behavior are not replaced or cancelled (except with the opt-in `captureUnhandledRejections`, below). Listeners are removed at main shutdown or renderer disposal, with no retired capture lifetime. Automatic reporting is rate-limited using core's default exception limiter with a single bucket per client; reporting failures are contained.

Consent is checked before inspecting error properties or submitting exception data; opted-out errors are not retained for later opt-in. Capture uses the existing bridge's identity generation checks, so stale reports are dropped rather than replayed as a new user. Renderer same-document dispose/reinit retains request sequencing for the same SDK module and stable preload bridge; this does not coordinate separately bundled SDK copies or distinct transports.

**Main-process unhandled promise rejections are not captured by default.** By default, main observes only `uncaughtExceptionMonitor`, which sees a rejection only when Node escalates it to an uncaught exception. Electron's main process (all supported versions, 41+) forces Node's `warn-with-error-code` mode and ignores `--unhandled-rejections` set on the command line or in `NODE_OPTIONS`. An unhandled rejection prints `UnhandledPromiseRejectionWarning` and sets `process.exitCode = 1`, but the process keeps running and the monitor never sees it. Choose one of:

- Opt in to the SDK listener with `captureUnhandledRejections: true` (requires `enableExceptionAutocapture: true`):

    ```js
    const posthog = init({
        projectToken: '<ph_project_token>',
        enableExceptionAutocapture: true,
        captureUnhandledRejections: true,
    })
    ```

    This installs `process.on('unhandledRejection')`. Node only applies its default handling when no `unhandledRejection` listener exists, so while the SDK listener is installed an unhandled rejection no longer prints `UnhandledPromiseRejectionWarning` or sets `process.exitCode = 1`. If your app reads `process.exitCode` to decide whether a run failed, set it yourself. This lasts until shutdown, including while the user is opted out: consent stops reporting, not the listener. If your app already has an `unhandledRejection` listener, Node's default handling is already off and nothing else changes. The SDK makes one capture attempt per rejection, subject to consent and rate limiting, with the `onunhandledrejection` mechanism and `node.process_unhandled_rejection` source. Delivery is not guaranteed.

- Or keep the default and capture from your own handler. Adding the first `unhandledRejection` listener has the same effect on the warning and `process.exitCode` as the SDK listener.

    ```js
    const onUnhandledRejection = (reason) => {
        posthog.captureException(reason)
    }
    process.on('unhandledRejection', onUnhandledRejection)
    ```

    During teardown, call `process.removeListener('unhandledRejection', onUnhandledRejection)`.

Fatal reports are best effort: the SDK never delays termination or forces an exit, and abrupt termination can happen before queued capture, disk writes or delivery complete. Use manual capture in application-owned recovery handlers if needed. This is JavaScript error capture, **not native crash reporting or native symbolication**.

### React renderer (optional)

React 18+ applications can use `@posthog/electron/react`. React is an optional peer dependency: main, preload and non-React renderers do not install or load it. Install React in your renderer app (and `@types/react` if using TypeScript).

Pass an **already initialized Electron renderer client**, not a browser `posthog-js` client or a project token:

```jsx
import { createRoot } from 'react-dom/client'
import { init } from '@posthog/electron/renderer'
import {
    PostHogProvider,
    usePostHog,
    useFeatureFlagEnabled,
    useFeatureFlagVariantKey,
    useFeatureFlagPayload,
} from '@posthog/electron/react'

const posthog = await init()

function App() {
    const client = usePostHog()
    const enabled = useFeatureFlagEnabled('new-ui')
    const variant = useFeatureFlagVariantKey('new-ui')
    const payload = useFeatureFlagPayload('new-ui')

    return (
        <button
            disabled={!enabled}
            onClick={() => client.capture('new_ui_clicked', { variant: variant ?? null, payload: payload ?? null })}
        >
            Try the new UI
        </button>
    )
}

createRoot(document.getElementById('root')).render(
    <PostHogProvider client={posthog}>
        <App />
    </PostHogProvider>
)
```

Hooks follow the renderer's cached flag semantics: enabled is `boolean | undefined`, variant is `string | boolean | undefined`, and payload is JSON, `null` for a loaded empty payload, or `undefined` while unavailable. Handle loading/unknown values explicitly. Main broadcasts identity, consent and flag changes to every registered window; hooks update from that shared state without a separate browser SDK, identity, session or transport.

Enabled/variant hooks report exposure **after commit**, through main's consent-aware, deduplicating tracker. Payload-only hooks do not report exposure. React 18 is required for stable external-store subscriptions. The provider only manages its subscriptions: unmounting or changing `client` does not dispose your client. Call `posthog.dispose()` yourself when the renderer no longer needs it, after unmounting its provider.

### Trusted utility processes (opt-in)

Only instrument utility code you own and trust. In main, pass the actual result of Electron's `utilityProcess.fork()` immediately to the owner:

```js
import { utilityProcess } from 'electron'

// Inside app.whenReady(), with the main PostHog owner already initialized:
const child = utilityProcess.fork('/absolute/path/to/utility.cjs')
const unregister = posthog.registerUtilityProcess(child)
// unregister() revokes this child's SDK connection without killing it.
```

In `utility.cjs`:

```js
const { init } = require('@posthog/electron/utility')

async function run() {
    const posthog = await init()
    posthog.capture('background_work_completed', { task: 'thumbnail' })
    try {
        throw new Error('Example handled utility error')
    } catch (error) {
        posthog.captureException(error)
    }
    await posthog.flush()
}
run().catch(console.error)
```

The utility facade has the same methods as the renderer facade above, including identity, consent, cached flags, `onStateChange()` and `dispose()`. `init({ onError })` accepts an optional error callback for failed requests, such as a capture over the rate limit. It does not start an independent Node/browser SDK, persist files, or send analytics HTTP requests. Main remains the single authority for identity, consent, queue, session and flag exposure deduplication. Await mutations and handle rejected stale-identity commands as with renderers. Main changes are broadcast to connected children. Each utility request waits at most 10 seconds for main. A timeout rejects only that call and keeps the connection usable; it means the child stopped waiting, not that the work failed. A timed-out `flush()` can still deliver afterwards because main keeps its own retry and timeout policy. Capture and exception events carry protected `$electron_process: 'utility'` and an owner-generated `$utility_process_id` stable for that registration, not a caller-supplied PID.

No preload, window registration, global IPC channel or `ELECTRON_RUN_AS_NODE` is involved. Messages use a dedicated versioned namespace on that child's `parentPort`; unrelated application messages are ignored. Each registration has its own connection token, strictly increasing request sequence, 100 requests/second limit, 100 pending-request cap, 256 KiB JSON message bound and nesting limit. The bridge rejects timed-out requests after 10 seconds. Registration requires a handshake within 10 seconds (including children that never spawn or already exited); register immediately after forking. Exit, unregister and owner shutdown revoke the registration and reject pending child operations. `dispose()` closes the local facade; use one facade lifetime per registration. Do not retry a timed-out mutation blindly: main may already have accepted it.

This is **not** a sandbox or an untrusted-plugin interface: a registered utility can mutate the app's shared identity and consent just like trusted renderer code. Do not register workers running untrusted code. No automatic uncaught-error hooks, native crash reporting, replay, surveys or tours are installed.

## Consent and storage

- Capture is opted in by default; configure `defaultOptIn: false` for explicit opt-in. Call `optIn()`/`optOut()` from either process.
- Opt-out blocks new events. Events accepted while opted in remain queued and deliverable. Already in-flight requests may complete. Identify may still change local identity and reload flags while opted out, as specified by the client SDK contract; opt-out is not an all-network-off switch.
- Files live under `app.getPath('userData')/posthog/<project-and-host-hash>/state.json`. `storageDirectory` changes the base directory; project/host isolation remains enforced. The file contains identity, consent, flags, properties and queued events; it is not encrypted. Do not include secrets or personal API keys in analytics or in the desktop binary.
- Defaults: at most 1,000 events through core's queue, a 5 MiB state file, and seven-day event retention. Configure `maxQueueSize`, `maxStorageBytes` and `maxQueueAgeMs`. Expired events and oldest events exceeding the storage cap are discarded; oversized non-queue state is rejected through the operation/error callback. Budget property/flag payload sizes accordingly.
- Storage writes are serialized and atomically renamed. Acknowledgment means the write/rename completed, not an fsync/power-loss guarantee. Each project/host store allows **one local process writer**. A second process remains inactive (including networking), reports through `onError`, and resolves `ready()` without reading the owner's analytics. Opting in cannot activate an unowned store. Use a separate `storageDirectory` for deliberately independent instances/identities.
- Ownership is released on normal awaited shutdown. Stale ownership is reclaimed only for a same-host PID proven absent; live, permission-denied, foreign-host or unreadable ownership is never stolen. UUID-specific `.reclaim-*` tombstones prevent competing reclaimers from removing a successor's lock; they intentionally remain on disk. A crashed reclaimer or incomplete `.owner` file can require manual recovery: stop **all** application processes before removing the stale `.owner` and associated tombstone. Do not remove these files from a running app. This policy assumes a local filesystem, not a network filesystem or distributed lock service.
- A failed startup write is reported through `onError` without permanently disabling the client. Promise-returning mutations still reject if their write fails. Captures report the failure through `onError` instead.
- Corrupt/unreadable existing storage falls back to opted out and empty analytics, reporting via `onError`. Call `optIn()` explicitly after addressing the cause if appropriate.
- Network errors, 407, 408, 429 and 5xx preserve batches after bounded immediate retries; background retries use backoff, jitter and Retry-After. Permanent failures may drop the batch. Retries retain event UUIDs, but duplicate delivery remains possible. `flushInterval: 0` disables scheduled background flushes; explicit flush and queue-size-triggered flush still work.
- Back up and investigate the store before manual ownership recovery; never erase `state.json` or delete coordination files while a writer may still be active.
- Networking uses an isolated Electron session with `credentials: 'omit'`. **Authenticated proxies are unsupported**; a 407 is retained for later recovery, not silently dropped, but retention does not make proxy authentication work. Validate your unauthenticated proxy/TLS/self-hosted deployment separately; do not promise all system proxy configurations are supported.

Requests use an isolated Electron session with omitted cookies and HTTP credentials. Automatic redirects are rejected: configure the final ingestion URL, including any reverse-proxy path, rather than relying on redirects to move event or flag bodies.

## Lifecycle and shutdown

Lifecycle capture defaults on (`captureAppLifecycleEvents: false` disables its events). Installed means first observed SDK launch, not installer execution. Updates compare the saved app version and optional `appBuild`. Installed/Updated carry Electron/Node/Chromium versions; ordinary events carry app/OS context. Focus is aggregated across registered windows. Sessions start fresh on process restart, with core's default 30-minute inactivity and 24-hour maximum boundaries; periodic flag reloads alone do not extend them. Admitted analytics events currently count as activity; avoid periodic heartbeat captures if that is not the session behavior you want.

The SDK makes only a **best-effort flush** on uncancelled `will-quit`; it never prevents/reissues quit or tears down a client whose host may cancel quit. For a bounded drain and teardown, the host must own its quit flow and call `await posthog.shutdown(2000)` before exiting. Shutdown is idempotent and bounded, including deferred initialization; a timeout reports through `onError` and resolves `ready()` without allowing late startup. Uncancellable filesystem cleanup may finish afterward and retains ownership until pending writes settle, so an immediate replacement instance can remain inactive. On normal process exit, unsaved local state — including an `optIn()`/`optOut()` that was called but not awaited — is written synchronously before ownership is released, so consent survives an immediate `app.quit()`. Network delivery is not part of that final write. Abrupt termination/OS shutdown relies on already written files, not a guaranteed final flush. Mutating calls after shutdown reject; cached getters remain readable. Closing all registered windows emits the aggregate background transition but does not shut down the SDK; tray apps can continue capturing until the host quits. `powerMonitor` suspend pauses delivery and aborts in-flight requests; resume attempts a flush respecting existing backoff. Neither power callback emits analytics nor refreshes session activity. The host owns tray/window quit policy and fatal-error behavior; the SDK does not replace host fatal-error behavior or capture native crashes; optional JavaScript observation is described above. Desktop lifecycle semantics are a new mapping of the published lifecycle contract, not a claim of complete cross-SDK harness conformance.

## Networking limits

Requests use Chromium's isolated in-memory `session.fromPartition('posthog-electron')`, not Node's fetch or the default browser session. A host can configure that session's proxy with Electron's `setProxy()` after app readiness and before capture/flush. SDK requests omit cookies and HTTP credentials. **Authenticated proxies are not currently supported**: a 407 is retained for retry/configuration recovery, not evidence of authenticated-proxy compatibility. Applications requiring authenticated enterprise proxies must treat this limitation as a production-readiness gate.

TLS certificate verification remains Chromium's default. The SDK does not disable verification, install certificate-error overrides, or trust arbitrary private CAs. Validate your actual enterprise trust/proxy deployment separately. There is no exactly-once guarantee: interrupted delivery may be retried with the same UUID and can duplicate events.

## Local validation

See [the Electron example](../../examples/example-electron) for an interactive mock-server application, real two-window sandboxed smoke tests, and live-project configuration.

From the repository root:

```sh
pnpm turbo run build check-types test:unit test:built --filter=@posthog/electron
# After installing the Electron binary explicitly (installs use --ignore-scripts):
node packages/electron/node_modules/electron/install.js
pnpm --filter @posthog/electron test:autocapture
pnpm --filter @posthog/electron test:transport
```

For the dedicated real utility-process test (after building), run `pnpm --filter @posthog/electron test:utility`. It packs and independently installs the SDK/browser-common/core/types tarballs into a temporary app, starts the installed Electron binary normally, and forks actual utility processes. It needs a GUI-capable Electron environment (or Xvfb on Linux), but no credentials. The fixture checks coordinated identity/consent/session, handled exceptions, protected context, flag exposure deduplication, reset, a slow owner flush that times out without disconnecting, pending promise rejection on unregister, unexpected exit cleanup and replacement-child attribution. See [the fixture proof](test/utility-process/README.md).

After building, `pnpm --filter @posthog/electron test:errors` packs and installs local SDK tarballs into an isolated consumer and exercises actual main/renderer throws and rejections against a loopback mock receiver in sandboxed Electron. It compares application-handler behavior with autocapture disabled/enabled, tests consent/dispose/reinit, and separately compares native Node fatal exits and warning modes. It needs a runnable Electron binary/display; `ELECTRON_BINARY` can override the installed binary. Fatal Electron termination/delivery is not exercised or guaranteed.

For loopback subprocess delivery/network tests and their real-versus-synthetic coverage limits, see [delivery tests](test/delivery/README.md).

The example installs tarballs, not source symlinks. No PostHog credentials are needed for its smoke test. The isolated autocapture test uses only local mock endpoints and real sandboxed Electron windows. It checks click/change/submit delivery, delayed config/kill switches, consent/reset/disposal, masking, sensitive-canary exclusion from IPC/network/disk, and absence of recorder requests/artifacts.

Local core tarball overrides are source-integration evidence **only**. The shared release workflow checks the packed manifest's registry dependency minimums and required core hooks without overrides before publishing Electron. Packaged runtime and published harness results must be recorded separately from unit and build checks.
