# @posthog/electron (alpha)

Coordinated PostHog analytics and client feature flags for Electron. One main-process client owns identity, consent, sessions, storage and networking; trusted renderer windows use a sandbox-compatible preload bridge.

This alpha supports manual events, identify/reset, groups, registered properties, opt-in/out, cached feature flags/payloads with exposure events, application lifecycle events, handled JavaScript exceptions, flush and shutdown. The final alpha stack also adds opt-in DOM autocapture and renderer React bindings, described below. **Session replay, surveys, product tours and native crashes are not supported.** No recorder or remotely loaded executable code is included.

**Release status:** not published by this PR. Registry dependency compatibility, cross-OS/runtime CI and published SDK-harness acceptance remain release gates; only macOS runtime execution has been locally demonstrated. See [release gates](../../RELEASING.md#electron-alpha-releases) and [migration](./MIGRATION.md). Do not interpret local tarball tests with a core override as proof that an npm consumer can install this alpha.

## Setup

After a maintainer clears the release gates and publishes the alpha, install it explicitly with `pnpm add @posthog/electron@alpha` alongside your application's Electron development dependency. Pin the resolved alpha version for reproducible builds; `latest` is not the alpha channel. Electron 41+ is the initial experimental runtime range, not an assertion that every OS/runtime combination has passed. Validate your packaged application on every OS/runtime you ship. Do not bundle Electron into your application JavaScript.

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

Main and renderer mutations return promises. Await identity/reset/consent changes before captures that depend on them. A resolved call is an asynchronous operation receipt, not proof that an event was sent: consent, filtering and queue limits can prevent admission. Accepted renderer captures acknowledge completed file writes in main, **not** server delivery or fsync/power-loss durability. `flush()` waits for prior commands and attempts main delivery; delivery errors reject it, and a successful response is not a guarantee of eventual ingestion/query visibility. Cache getters are synchronous after `await init()`.

One identity/session is shared across the app, not one per window. Use `reset()` on logout before identifying a different account. Reset preserves opt-out state, install markers and accepted queued events with their original identities. Stale renderer commands around an account change are rejected rather than assigned to the new user; their promise rejects so the app can decide whether a fresh action is appropriate. Do not blindly replay a rejected capture under another user.

`onStateChange(callback)` returns an unsubscribe function. `getState()` returns a copy of the current identity/consent/flag snapshot. `dispose()` removes renderer subscriptions. Main flag APIs include `getFeatureFlag()`, `getFeatureFlagPayload()` and `reloadFeatureFlagsAsync()`; renderer uses `reloadFeatureFlags()`. Flag reads report exposure through main's tracker. `{ sendFeatureFlagEvent: false }` suppresses exposure events (`sendEvent` is also accepted).

### Optional renderer integrations (final alpha stack)

DOM autocapture is **off by default**. Opt in explicitly with `await init({ autocapture: true })`, or supply an allowlist/masking configuration such as `await init({ autocapture: { maskAllText: true, maskAllElementAttributes: true } })`. Main owns project remote configuration; the renderer applies its authoritative enable/disable policy along with consent. Local opt-in cannot override a remote opt-out. No independent browser client or renderer network transport is needed. This is DOM event autocapture, not replay or full `posthog-js` product parity. Review captured DOM/URL data in your application before rollout.

React 18+ bindings use the **already initialized renderer client**, not a project token and not an `@posthog/react` browser client:

```jsx
import { init } from '@posthog/electron/renderer'
import { PostHogProvider, useFeatureFlagEnabled } from '@posthog/electron/react'

const client = await init()
// In your renderer root:
root.render(
    <PostHogProvider client={client}>
        <App />
    </PostHogProvider>
)

function App() {
    const enabled = useFeatureFlagEnabled('new-ui')
    return <div>{enabled ? 'New UI' : 'Default UI'}</div>
}
```

The provider subscribes to main-owned snapshots; it does not initialize, identify or dispose the client. The host owns `client.dispose()` when permanently tearing down the renderer. Hooks must run under this provider; do not wrap the same app in a second browser-SDK provider to initialize another client.

## Consent and storage

- Capture is opted in by default; configure `defaultOptIn: false` for explicit opt-in. Call `optIn()`/`optOut()` from either process.
- Opt-out blocks new events. Events accepted while opted in remain queued and deliverable. Already in-flight requests may complete. Identify may still change local identity and reload flags while opted out, as specified by the client SDK contract; opt-out is not an all-network-off switch.
- Files live under `app.getPath('userData')/posthog/<project-and-host-hash>/state.json`. `storageDirectory` changes the base directory; project/host isolation remains enforced. The file contains identity, consent, flags, properties and queued events; it is not encrypted. Do not include secrets or personal API keys in analytics or in the desktop binary.
- Defaults: at most 1,000 events through core's queue, a 5 MiB state file, and seven-day event retention. Configure `maxQueueSize`, `maxStorageBytes` and `maxQueueAgeMs`. Expired events and oldest events exceeding the storage cap are discarded; oversized non-queue state is rejected through the operation/error callback. Budget property/flag payload sizes accordingly.
- Storage writes are serialized and atomically renamed. Acknowledgment means the write/rename completed, not an fsync/power-loss guarantee. Use a single main-process owner (for example Electron's application single-instance lock); do not share a store across application instances. Ownership validation fails closed when a live or unverifiable owner exists. A crashed/orphaned reclaimer can require manual recovery: stop **all** application/helper processes, back up the project/host storage directory, investigate the owner, then remove stale `.owner` and `.reclaim-*` coordination files only after verifying no process can still write. Never delete these files while the app is running or silently erase `state.json` to bypass ownership.
- Corrupt/unreadable existing storage falls back to opted out and empty analytics, reporting via `onError`. Call `optIn()` explicitly after addressing the cause if appropriate.
- Network errors, 408, 429 and 5xx preserve batches after bounded immediate retries; background retries use backoff, jitter and Retry-After. Permanent failures may drop the batch. Retries retain event UUIDs, but duplicate delivery remains possible. `flushInterval: 0` disables scheduled background flushes; explicit flush and queue-size-triggered flush still work.
- Networking uses an isolated Electron session with `credentials: 'omit'`. **Authenticated proxies are unsupported**; a 407 is retained for later recovery, not silently dropped, but retention does not make proxy authentication work. Validate your unauthenticated proxy/TLS/self-hosted deployment separately; do not promise all system proxy configurations are supported.

## Lifecycle and shutdown

Lifecycle capture defaults on (`captureAppLifecycleEvents: false` disables its events). Installed means first observed SDK launch, not installer execution. Updates compare the saved app version and optional `appBuild`. Installed/Updated carry Electron/Node/Chromium versions; ordinary events carry app/OS context. Focus is aggregated across registered windows. Sessions start fresh on process restart, with core's default 30-minute inactivity and 24-hour maximum boundaries; periodic flag reloads alone do not extend them. Admitted analytics events currently count as activity; avoid periodic heartbeat captures if that is not the session behavior you want.

Automatic `will-quit` handling is **best effort only**. Electron does not await asynchronous event listeners; the SDK never forces a second quit or overrides a host cancellation. The host must own its quit policy and awaited budget: call `await posthog.shutdown(2000)` in the host's controlled shutdown path before it exits, and decide what to do when that budget expires. Shutdown is idempotent and bounded; abrupt termination/OS shutdown relies on already written files, not a guaranteed final flush. Filesystem work may settle after the caller's budget without making shutdown a power-loss guarantee. Mutating calls after shutdown reject; cached getters remain readable. Desktop lifecycle semantics are a new mapping of the published lifecycle contract, not a claim of complete cross-SDK harness conformance.

## Local validation

See [the Electron example](../../examples/example-electron) for an interactive mock-server application, real two-window sandboxed smoke tests, and live-project configuration.

From the repository root:

```sh
pnpm turbo run build check-types test:unit test:built --filter=@posthog/electron
```

The example installs tarballs, not source symlinks. No PostHog credentials are needed for its smoke test. Local core tarball overrides are useful source-integration evidence **only**. The separate alpha workflow verifies the packed manifest's real registry dependency lower bounds and required core hooks without overrides; it must pass before publication. Windows/Linux execution, packaged-app compatibility and published harness conformance must be recorded separately, not inferred from unit/build checks.
