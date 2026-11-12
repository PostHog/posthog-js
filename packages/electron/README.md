# @posthog/electron (alpha)

Coordinated PostHog analytics and client feature flags for Electron. One main-process client owns identity, consent, sessions, storage and networking; trusted renderer windows use a sandbox-compatible preload bridge.

This alpha supports manual events, identify/reset, groups, registered properties, opt-in/out, cached feature flags/payloads with exposure events, application lifecycle events, handled JavaScript exceptions, opt-in DOM autocapture, flush and shutdown. **Session replay, automatic exception interception, surveys, product tours and native crashes are not supported.** No recorder or remotely loaded executable code is included.

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

One identity/session is shared across the app, not one per window. Use `reset()` on logout before identifying a different account. Reset preserves opt-out state, project autocapture settings, install markers and accepted queued events with their original identities. Stale renderer commands around an account change are rejected rather than assigned to the new user; their promise rejects so the app can decide whether a fresh action is appropriate. Do not blindly replay a rejected capture under another user.

`onStateChange(callback)` returns an unsubscribe function. `getState()` returns a copy of the current identity/consent/flag snapshot. `dispose()` removes renderer subscriptions and DOM autocapture observers. Main flag APIs include `getFeatureFlag()`, `getFeatureFlagPayload()` and `reloadFeatureFlagsAsync()`; renderer uses `reloadFeatureFlags()`. Flag reads report exposure through main's tracker. Options `{ sendEvent: false }` suppress renderer exposure events.

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

## Consent and storage

- Capture is opted in by default; configure `defaultOptIn: false` for explicit opt-in. Call `optIn()`/`optOut()` from either process.
- Opt-out blocks new events. Events accepted while opted in remain queued and deliverable. Already in-flight requests may complete. Identify may still change local identity and reload flags while opted out, as specified by the client SDK contract; opt-out is not an all-network-off switch.
- Files live under `app.getPath('userData')/posthog/<project-and-host-hash>/state.json`. `storageDirectory` changes the base directory; project/host isolation remains enforced. The file contains identity, consent, flags, properties and queued events; it is not encrypted. Do not include secrets or personal API keys in analytics or in the desktop binary.
- Defaults: at most 1,000 events through core's queue, a 5 MiB state file, and seven-day event retention. Configure `maxQueueSize`, `maxStorageBytes` and `maxQueueAgeMs`. Expired events and oldest events exceeding the storage cap are discarded; oversized non-queue state is rejected through the operation/error callback. Budget property/flag payload sizes accordingly.
- Storage writes are serialized and atomically renamed. Acknowledgment means the write/rename completed, not an fsync/power-loss guarantee. There is no multi-process file-locking guarantee: do not point separate application processes at the same store.
- Corrupt/unreadable existing storage falls back to opted out and empty analytics, reporting via `onError`. Call `optIn()` explicitly after addressing the cause if appropriate.
- Network errors, 408, 429 and 5xx preserve batches after bounded immediate retries; background retries use backoff, jitter and Retry-After. Permanent failures may drop the batch. Retries retain event UUIDs, but duplicate delivery remains possible. `flushInterval: 0` disables scheduled background flushes; explicit flush and queue-size-triggered flush still work.

## Lifecycle and shutdown

Lifecycle capture defaults on (`captureAppLifecycleEvents: false` disables its events). Installed means first observed SDK launch, not installer execution. Updates compare the saved app version and optional `appBuild`. Installed/Updated carry Electron/Node/Chromium versions; ordinary events carry app/OS context. Focus is aggregated across registered windows. Sessions start fresh on process restart, with core's default 30-minute inactivity and 24-hour maximum boundaries; periodic flag reloads alone do not extend them. Admitted analytics events currently count as activity; avoid periodic heartbeat captures if that is not the session behavior you want.

The SDK drains on `will-quit` after the app's normal quit-cancellation hooks. For explicit ownership, call `await posthog.shutdown(2000)` before exiting. Shutdown is idempotent and bounded; abrupt termination/OS shutdown relies on already written files, not a guaranteed final flush. Mutating calls after shutdown reject; cached getters remain readable. Desktop lifecycle semantics are a new mapping of the published lifecycle contract, not a claim of complete cross-SDK harness conformance.

## Local validation

See [the Electron example](../../examples/example-electron) for an interactive mock-server application, real two-window sandboxed smoke tests, and live-project configuration.

From the repository root:

```sh
pnpm turbo run build check-types test:unit test:built --filter=@posthog/electron
# After installing the Electron binary explicitly (installs use --ignore-scripts):
node packages/electron/node_modules/electron/install.js
pnpm --filter @posthog/electron test:autocapture
```

The example installs tarballs, not source symlinks. No PostHog credentials are needed for its smoke test. The isolated autocapture test uses only local mock endpoints and real sandboxed Electron windows. It checks click/change/submit delivery, delayed config/kill switches, consent/reset/disposal, masking, sensitive-canary exclusion from IPC/network/disk, and absence of recorder requests/artifacts.
